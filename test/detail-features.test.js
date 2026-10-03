const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8");
const methods = source.slice(source.indexOf("  getPaperTranslation(paper, field) {"), source.indexOf("  applyPaperComposerModelOptions(runtime) {"));
const Harness = vm.runInNewContext(`class Harness { ${methods} }; Harness`, {
  window: { setTimeout, clearTimeout }, Map, Promise, Date, Error
});
function fixture() {
  const plugin = new Harness();
  const paper = { id: "one", title: "Original title", abstract: "Original abstract" };
  plugin.settings = { papers: [paper] };
  plugin.saved = 0;
  plugin.saveSettings = async () => { plugin.saved++; };
  plugin.loadEmbeddedClaudian = async () => ({});
  const controllers = [];
  plugin.paperTranslationBridge = { create: async () => {
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
  console.log("Paper detail translation lifecycle tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
