const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8");
const methods = source.slice(source.indexOf("  getPaperTranslation(paper, field) {"), source.indexOf("  applyPaperComposerModelOptions(runtime) {"));
let requestImpl = () => { throw new Error("Unexpected network request"); };
let timerObserver = null;
const Harness = vm.runInNewContext(`class Harness { ${methods} }; Harness`, {
  window: { setTimeout: (callback, ms) => { timerObserver?.(callback, ms); return setTimeout(callback, ms); }, clearTimeout }, Map, Promise, Date, Error,
  requestUrl: options => requestImpl(options)
});
function fixture() {
  const plugin = new Harness();
  const paper = { id: "one", title: "Original title", abstract: "Original abstract" };
  plugin.settings = { papers: [paper] };
  plugin.saved = 0;
  plugin.saveSettings = async () => { plugin.saved++; };
  plugin.loadEmbeddedClaudian = async () => ({});
  const controllers = [];
  plugin.paperTranslationBridge = { create: async (_runtime, selection) => {
    plugin.lastSelection = selection;
    let resolve;
    const response = new Promise((done) => { resolve = done; });
    const controller = {
      startRoot: async () => {},
      execute: (request) => { controller.request = request; return response; },
      cancel: () => { controller.cancelled = true; resolve(""); },
      dispose: async () => { controller.disposed = true; },
      resolve
    };
    controllers.push(controller);
    return { controller, model: "test-model" };
  } };
  return { plugin, paper, controllers };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  const { plugin, paper, controllers } = fixture();
  const first = plugin.translatePaperField("one", "title");
  assert.equal(plugin.translatePaperField("one", "title"), first, "duplicate clicks share one request");
  await tick();
  controllers[0].resolve("中文标题");
  await first;
  assert.equal(plugin.saved, 1);
  assert.equal(plugin.getPaperTranslation(paper, "title").text, "中文标题");
  assert.equal(paper.title, "Original title", "translation preserves the original field");
  assert.ok(controllers[0].disposed);
  assert.equal(plugin.paperTranslationTasks.size, 0);
  paper.title = "Edited title";
  assert.equal(plugin.getPaperTranslation(paper, "title"), null, "edited source invalidates cached translation");

  const pending = plugin.translatePaperField("one", "abstract");
  await tick();
  paper.abstract = "Changed during request";
  controllers[1].resolve("过期摘要");
  await assert.rejects(pending, /原文已更改/);
  assert.equal(paper.translations.abstract, undefined);
  assert.equal(plugin.saved, 1);

  const cancelled = plugin.translatePaperField("one", "abstract");
  const rejection = assert.rejects(cancelled, /已取消/);
  await tick();
  plugin.paperTranslationTasks.get("one:abstract").cancel();
  await rejection;
  await tick();
  assert.ok(controllers[2].cancelled && controllers[2].disposed);
  assert.equal(paper.translations.abstract, undefined);

  plugin.saveSettings = async () => { throw new Error("disk error"); };
  const failedSave = plugin.translatePaperField("one", "title");
  await tick();
  controllers[3].resolve("新标题");
  await assert.rejects(failedSave, /译文保存失败/);
  assert.equal(paper.translations.title.text, "中文标题", "failed save restores previous cache");

  const deleted = fixture();
  const deletedRequest = deleted.plugin.translatePaperField("one", "title");
  await tick();
  deleted.plugin.settings.papers = [];
  deleted.controllers[0].resolve("已删除文献的标题");
  await assert.rejects(deletedRequest, /原文已更改/);
  assert.equal(deleted.plugin.saved, 0);

  const configured = fixture();
  configured.plugin.settings.translationMethod = "model";
  await assert.rejects(configured.plugin.translatePaperField("one", "title"), /选择翻译模型/);
  configured.plugin.settings.translationModel = { providerId: "example", model: "translator-a" };
  const customRequest = configured.plugin.translatePaperField("one", "title");
  configured.plugin.settings.translationModel.model = "translator-b";
  await tick();
  assert.equal(configured.plugin.lastSelection.model, "translator-a", "request uses a frozen model selection");
  configured.controllers[0].resolve("指定模型的译文");
  await customRequest;
  assert.equal(configured.plugin.getPaperTranslation(configured.paper, "title").text, "指定模型的译文");

  const web = fixture();
  web.plugin.loadEmbeddedClaudian = async () => { throw new Error("Web translation must not start Composer"); };
  web.plugin.settings.translationMethod = "microsoft";
  let sent;
  requestImpl = async options => {
    sent = options;
    return {status: 200, json: [{translations: [{to: "zh-Hans", text: "微软译文"}]}]};
  };
  await web.plugin.translatePaperField("one", "title");
  assert.deepEqual(JSON.parse(sent.body), ["Original title"]);
  assert.equal(sent.method, "POST");
  assert.equal(new URL(sent.url).searchParams.has("from"), false, "source language should be autodetected");
  assert.equal(web.paper.translations.title.provider, "microsoft");
  web.plugin.settings.translationMethod = "google";
  requestImpl = async options => {
    sent = options;
    return {status: 200, json: [[["第一句。", "First."], ["第二句。", "Second."]]]};
  };
  await web.plugin.translatePaperField("one", "abstract");
  assert.equal(new URL(sent.url).searchParams.get("q"), "Original abstract");
  assert.equal(web.paper.translations.abstract.text, "第一句。第二句。");
  let requests = 0;
  requestImpl = async () => { requests++; return {status: 429}; };
  await assert.rejects(web.plugin.translatePaperField("one", "title"), /429/);
  await assert.rejects(web.plugin.translatePaperField("one", "title"), /限流/);
  assert.equal(requests, 1, "rate-limited service must not be retried or silently fall back");
  assert.equal(web.paper.translations.title.text, "微软译文", "failure preserves last translation");
  web.plugin.settings.translationMethod = "microsoft";
  requestImpl = async () => ({status: 200, json: [{translations: [{to:"en",text:"wrong target"}]}]});
  await assert.rejects(web.plugin.translatePaperField("one", "title"), /有效译文/);
  requestImpl = async () => ({status: 200, get json() { throw new Error("HTML response"); }});
  await assert.rejects(web.plugin.translatePaperField("one", "title"), /无效数据/);
  let finishWeb;
  requestImpl = () => new Promise(resolve => { finishWeb = resolve; });
  const late = web.plugin.translatePaperField("one", "title");
  const lateRejected = assert.rejects(late, /已取消/);
  await tick();
  web.plugin.paperTranslationTasks.get("one:title").cancel();
  await lateRejected;
  finishWeb({status: 200, json: [{translations:[{to:"zh-Hans",text:"取消后的迟到译文"}]}]});
  await tick();
  assert.equal(web.paper.translations.title.text, "微软译文", "cancelled network responses must not write cache");
  let fireTimeout;
  timerObserver = (callback, ms) => { assert.equal(ms, 20000); fireTimeout = callback; };
  requestImpl = () => new Promise(() => {});
  const timedOut = web.plugin.translatePaperField("one", "abstract");
  const timeoutRejected = assert.rejects(timedOut, /网页翻译超时/);
  await tick();
  fireTimeout();
  await timeoutRejected;
  timerObserver = null;
  assert.equal(web.plugin.paperTranslationTasks.size, 0);
  console.log("Paper detail translation lifecycle tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
