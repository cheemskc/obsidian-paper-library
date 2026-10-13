const assert = require("node:assert/strict");
const viewScopeSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8");
assert.ok(!/\b(?:get|set) scope\(/.test(viewScopeSource), "Library filter state must not shadow Obsidian View.scope keyboard routing");
const fs = require("node:fs");
const vm = require("node:vm");
const Module = require("node:module");
const source = fs.readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return {
    ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    PluginSettingTab: class {}, Setting: class {}, normalizePath: value => value,
    loadPdfJs: async () => null, requestUrl: async () => ({ json: {} }), setIcon: () => {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../main.js");
Module._load = originalLoad;
global.window = globalThis;
const pure = vm.runInNewContext(`${source.slice(source.indexOf("function normalizeTitleForMatch("), source.indexOf("function isTitleSufficientForLookup("))}
({ sequenceOrderScore, titleSimilarity, createRecommendationLibraryMatcher, setBoundedCacheEntry, normalizeTitleForMatch })`, {
  stripMarkup: value => String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  normalizeDoiInput: value => String(value || "").toLowerCase().replace(/^https:\/\/doi.org\//, "")
});
function referenceOrder(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    rows[i][j] = left[i - 1] === right[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]);
  }
  return rows[left.length][right.length] / Math.max(left.length, right.length, 1);
}
let randomState = 71;
const random = n => { randomState = (randomState * 1664525 + 1013904223) >>> 0; return randomState % n; };
for (let i = 0; i < 400; i++) {
  const a = Array.from({ length: random(40) }, () => String(random(9)));
  const b = Array.from({ length: random(40) }, () => String(random(9)));
  assert.equal(pure.sequenceOrderScore(a, b), referenceOrder(a, b));
}
const titles = ["Attention Is All You Need", "无线电能传输系统的研究与设计", "物理系统的智能优化", "a", "", "<b>Efficient language model inference</b>"];
const library = titles.map(title => ({ title }));
for (let i = 0; i < 150; i++) library.push({ title: Array.from({ length: 8 + random(20) }, () => `word${random(50)}`).join(" ") });
for (let i = 0; i < 100; i++) library.push({ title: Array.from({ length: 6 + random(24) }, () => Array.from("文献研究分析智能系统材料设计")[random(16)]).join("") });
const match = pure.createRecommendationLibraryMatcher(library);
for (const title of [...titles, "Attention Is All You Need!", "物理系统的智能优化方法", "An unrelated title", ...library.map(p => p.title + " extra")]) {
  assert.equal(match({ title }), library.some(p => pure.titleSimilarity(p.title, title) >= 0.96), title);
}
assert.equal(pure.createRecommendationLibraryMatcher([{ title: "Original", doi: "10.1/test" }])({ title: "Other", doi: "https://doi.org/10.1/TEST" }), true);
const bounded = new Map();
for (let i = 0; i < 100; i++) pure.setBoundedCacheEntry(bounded, i, i, 8);
assert.equal(bounded.size, 8);
pure.setBoundedCacheEntry(bounded, 92, 92, 8);
pure.setBoundedCacheEntry(bounded, 100, 100, 8);
assert.ok(bounded.has(92) && !bounded.has(93), "recently accessed entries survive eviction");

function fixture() {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = { papers: [] };
  plugin.uiState = {};
  plugin.relationCache = new Map();
  plugin.pdfFigureCatalogCache = new Map();
  plugin.pdfFigureCatalogLoading = new Map();
  plugin.pdfFigureProgressListeners = new Map();
  plugin.pdfFigureAssetCache = new Map();
  plugin.pdfFigureAssetDirectoryCache = new Map();
  return plugin;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const plugin = fixture();
  let computations = 0;
  plugin.computePaperRecommendations = limit => { computations++; return Array.from({ length: limit }, (_, key) => ({ key })); };
  const paper = { id: "a", title: "Paper", tags: [], relations: { status: "ready", citedBy: { items: [{ title: "Candidate" }] } } };
  plugin.settings.papers = [paper];
  plugin.getPaperRecommendations(8);
  plugin.getPaperRecommendations(20);
  assert.equal(computations, 1, "8/20 item callers share one cache");
  paper.tags.push("changed");
  plugin.getPaperRecommendations(8);
  paper.relations.citedBy.items[0].title = "Edited candidate";
  plugin.getPaperRecommendations(8);
  plugin.uiState.selectedId = "a";
  plugin.getPaperRecommendations(8);
  plugin.settings.papers = [];
  plugin.getPaperRecommendations(8);
  assert.equal(computations, 5, "in-place edits, selection and deletion invalidate the cache");

  const catalogPlugin = fixture();
  catalogPlugin.getPortablePdfFigurePayload = () => ({ figures: [{ pageNumber: 1 }] });
  let reads = 0;
  catalogPlugin.loadPdfFigureDocument = async () => { throw new Error("Coordinates must not load PDF bytes"); };
  const loader = catalogPlugin.loadPdfFigureCatalog.bind(catalogPlugin);
  catalogPlugin.loadPdfFigureCatalog = async path => { reads++; await tick(); return loader(path); };
  let progressCalls = 0;
  const results = await Promise.all(Array.from({ length: 12 }, () => catalogPlugin.getPdfFigureCatalog("paper.pdf", () => progressCalls++)));
  assert.equal(reads, 1);
  assert.equal(results[0], results[11]);
  assert.equal(results[0].document, null);
  assert.equal(progressCalls, 12);
  assert.equal(catalogPlugin.pdfFigureProgressListeners.size, 0);
  assert.equal(catalogPlugin.pdfFigureCatalogLoading.size, 0);
  for (let i = 0; i < 22; i++) await catalogPlugin.getPdfFigureCatalog(`${i}.pdf`);
  assert.equal(catalogPlugin.pdfFigureCatalogCache.size, 16);
  const pending = catalogPlugin.getPdfFigureCatalog("late.pdf");
  catalogPlugin.clearPdfFigureRecognitionState();
  await assert.rejects(pending, /取消/);
  assert.equal(catalogPlugin.pdfFigureCatalogCache.size, 0);

  let documentLoads = 0, destroyed = 0;
  const document = { getPage: async () => ({}), destroy: async () => { destroyed++; } };
  catalogPlugin.loadPdfFigureDocument = async () => { documentLoads++; return document; };
  let finish;
  const painting = new Promise(resolve => { finish = resolve; });
  catalogPlugin.renderPdfFigureCrop = () => painting;
  const paints = [catalogPlugin.renderPdfFigure("paint.pdf", { pageNumber: 1 }, {}), catalogPlugin.renderPdfFigure("paint.pdf", { pageNumber: 1 }, {})];
  await tick(); await tick();
  assert.equal(documentLoads, 1, "concurrent thumbnails share one PDF load");
  finish();
  await Promise.all(paints);
  assert.equal(destroyed, 1);
  assert.equal(catalogPlugin.pdfFigureCatalogCache.get("paint.pdf").documentLoading, null);
  catalogPlugin.renderPdfFigureCrop = async () => { throw new Error("Paint failed"); };
  await assert.rejects(catalogPlugin.renderPdfFigure("paint.pdf", { pageNumber: 1 }, {}), /Paint failed/);
  assert.equal(destroyed, 2, "paint errors also release the PDF");

  const assetPlugin = fixture();
  assetPlugin.app = { vault: { getAbstractFileByPath: () => ({}), adapter: { read: async () => "", readBinary: async () => new Uint8Array(1024).buffer } } };
  assetPlugin.computePdfFigureCacheKey = async () => "key";
  assetPlugin.resolveRecognizedPdfFigureCache = async (_path, _key, figureKey) => ({ directory: "cache", payload: { figures: [{ figureKey, cropPath: "figure-test.png" }] } });
  for (let i = 0; i < 70; i++) await assetPlugin.readRecognizedPdfFigureAsset("paper.pdf", `figure${i}`);
  assert.equal(assetPlugin.pdfFigureAssetCache.size, 32);
  let releaseBytes;
  assetPlugin.app.vault.adapter.readBinary = () => new Promise(resolve => { releaseBytes = resolve; });
  const lateAsset = assetPlugin.readRecognizedPdfFigureAsset("paper.pdf", "late");
  await tick();
  assetPlugin.pdfFigureAssetCache.clear();
  releaseBytes(new ArrayBuffer(4));
  await lateAsset;
  assert.equal(assetPlugin.pdfFigureAssetCache.size, 0, "late completion cannot revive a cleared cache");
  assetPlugin.app.vault.adapter.readBinary = async () => new ArrayBuffer(5 * 1024 * 1024);
  await assetPlugin.readRecognizedPdfFigureAsset("paper.pdf", "large-one");
  await assetPlugin.readRecognizedPdfFigureAsset("paper.pdf", "large-two");
  assert.equal(assetPlugin.pdfFigureAssetCache.size, 1, "byte budget evicts large images before the count limit");

  const lifecycle = fixture();
  let workerDestroys = 0, taskDestroys = 0;
  const pdfjs = { PDFWorker: class { destroy() { workerDestroys++; } }, getDocument: options => {
    assert.ok(options.worker instanceof pdfjs.PDFWorker, "plugin supplies its own worker");
    return { promise: Promise.resolve({ numPages: 1 }), destroy: async () => { taskDestroys++; } };
  } };
  const ownedDocument = await lifecycle.createPdfDocument(pdfjs, new Uint8Array());
  assert.equal(lifecycle.pdfDocumentTasks.size, 1);
  await Promise.all([ownedDocument.destroy(), ownedDocument.destroy()]);
  assert.equal(workerDestroys, 1);
  assert.equal(taskDestroys, 1);
  assert.equal(lifecycle.pdfDocumentTasks.size, 0);
  pdfjs.getDocument = () => ({ promise: new Promise(() => {}), destroy: async () => { taskDestroys++; } });
  const abortedDocument = lifecycle.createPdfDocument(pdfjs, new Uint8Array());
  const rejection = assert.rejects(abortedDocument, /取消/);
  await [...lifecycle.pdfDocumentTasks][0].destroy();
  await rejection;
  assert.equal(workerDestroys, 2);
  assert.equal(lifecycle.pdfDocumentTasks.size, 0);
  lifecycle.composerPdfTabs = new Set();
  let disconnected = 0, restored = false;
  const originalSend = () => { restored = true; };
  const attachment = {};
  const tab = { controllers: { inputController: { sendMessage: () => {} } }, paperLibraryPdfState: {
    attachments: [attachment], originalSendMessage: originalSend,
    topControlsObserver: { disconnect: () => disconnected++ }, linkedContentObserver: { disconnect: () => disconnected++ }
  } };
  let lateCallback = false;
  tab.paperLibraryPdfState.linkedPdfReconcileTimer = setTimeout(() => { lateCallback = true; }, 10);
  tab.paperLibraryPdfState.topControlsTimer = setTimeout(() => { lateCallback = true; }, 10);
  lifecycle.composerPdfTabs.add(tab);
  lifecycle.cleanupComposerPdfTab(tab);
  tab.controllers.inputController.sendMessage();
  assert.ok(attachment.cancelled && restored);
  assert.equal(disconnected, 2);
  assert.equal(lifecycle.composerPdfTabs.size, 0);
  assert.equal(tab.paperLibraryPdfState, undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(lateCallback, false, "tab cleanup cancels scheduled callbacks");
  let removed = 0;
  const container = { removeEventListener: () => removed++ };
  lifecycle.nativePdfBindings = new WeakMap([[container, {}]]);
  lifecycle.nativePdfStates = new WeakMap([[container, {}]]);
  const handler = () => {};
  lifecycle.cleanupNativePdfBinding({ container, pointerDown: handler, pointerUp: handler, keyUp: handler, contextMenu: handler, dragStart: handler, click: handler });
  assert.equal(removed, 6, "all native PDF listeners, including keyboard selection, are removed");
  assert.ok(!lifecycle.nativePdfBindings.has(container) && !lifecycle.nativePdfStates.has(container));
  console.log("Performance and resource lifecycle tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
