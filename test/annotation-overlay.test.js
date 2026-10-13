const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    PluginSettingTab: class {}, Setting: class {}, normalizePath: p => p,
    loadPdfJs: async () => { throw new Error("Must reuse the native page"); }, requestUrl: async () => ({}), setIcon() {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../main.js"); Module._load = originalLoad;
const { PDFDocument, PDFName, PDFArray } = require("../vendor/pdf-lib.min.js");
const elton = require("../vendor/elton-annotation-core.cjs");

async function run() {
  const doc = await PDFDocument.create(); doc.addPage([400, 400]);
  let bytes = await doc.save(), note = "# Handwritten note\n";
  const paper = { id: "overlay", title: "Overlay", pdfPath: "paper.pdf", notePath: "paper.md", annotations: [] };
  const file = { path: paper.pdfPath, extension: "pdf" }, noteFile = { path: paper.notePath };
  const p = Object.create(Plugin.prototype);
  p.settings = { papers: [paper] }; p.pdfMutationQueues = new Map(); p.uiState = {};
  let reads = 0, writes = 0, settingsWrites = 0, overlays = 0;
  p.app = { vault: {
    getAbstractFileByPath: path => path === file.path ? file : path === noteFile.path ? noteFile : null,
    readBinary: async () => { reads++; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    modifyBinary: async (_, buffer) => { writes++; bytes = new Uint8Array(buffer); },
    read: async () => note, process: async (_, fn) => { note = fn(note); }
  }, workspace: { getLeavesOfType: () => [] } };
  p.ensurePaperNote = async () => noteFile;
  p.saveSettings = async () => { settingsWrites++; };
  p.refreshDetailViews = () => {}; p.refreshAnnotationViews = () => {}; p.refreshResearchPdfHighlights = () => {};
  p.renderAllNativeAnnotationOverlays = () => { overlays++; };
  const context = { paper, page: 1, text: "A reading selection", pdfPath: file.path,
    range: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 12 },
    pdfRects: [{ rect: [40, 200, 160, 214], quad: [40, 214, 160, 214, 40, 200, 160, 200] }] };
  const beforeBytes = Buffer.from(bytes);
  await p.saveSelectionAnnotation(context, "Highlight", "green", "方法备注");
  assert.equal(paper.annotations.length, 1);
  assert.equal(paper.annotations[0].storageMode, "overlay");
  assert.equal(paper.annotations[0].highlightCornerRadius, 2, "new independent marks preserve rounded appearance on export");
  assert.deepEqual(Buffer.from(bytes), beforeBytes);
  assert.equal(reads + writes, 0, "ordinary annotation performs no PDF IO");
  assert.ok(note.includes("方法备注") && note.includes("Handwritten note"));
  await p.saveSelectionAnnotation(context, "Highlight", "green", "方法备注");
  assert.equal(paper.annotations.length, 1, "rapid duplicate is suppressed");
  const entry = p.getManagedAnnotations(paper.id)[0];
  await p.updateManagedAnnotationRemark(entry, "新备注");
  assert.equal(reads + writes, 0, "remarks don't reload PDF");
  assert.ok(note.includes("新备注"));
  const editId = entry.record.id, originalRects = JSON.stringify(entry.record.pdfRects);
  await p.updateManagedAnnotationRemark(entry, "新备注", "新备注",
    { color: "pink", pdfSubtype: "Underline", expectedColor: "green", expectedStyle: "Highlight" });
  assert.equal(entry.record.id, editId);
  assert.equal(paper.annotations.length, 1, "editing never adds another annotation");
  assert.equal(entry.record.color, "pink"); assert.equal(entry.record.pdfSubtype, "Underline");
  assert.equal(JSON.stringify(entry.record.pdfRects), originalRects, "appearance changes preserve exact selection geometry");
  assert.equal(reads + writes, 0, "editing overlay color/style performs no PDF IO");
  assert.match(note, /> \[!pdf\|pink\]\+ 下划线 · p\. 1/);
  assert.ok(note.includes("&color=pink"), "owned note source link follows the new color");
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "新备注", "新备注",
    { color: "yellow", pdfSubtype: "Highlight", expectedColor: "blue", expectedStyle: "Highlight" }), /别处修改/);
  const durableSave = p.saveSettings;
  p.saveSettings = async () => { throw new Error("Disk full"); };
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "新备注", "新备注",
    { color: "blue", pdfSubtype: "Highlight", expectedColor: "pink", expectedStyle: "Underline" }), /Disk full/);
  assert.equal(entry.record.color, "pink"); assert.equal(entry.record.pdfSubtype, "Underline", "failed appearance save rolls back");
  await assert.rejects(p.saveSelectionAnnotation({ ...context, text: "different", range: { ...context.range, endOffset: 9 } }, "Underline", "blue", ""), /Disk full/);
  assert.equal(paper.annotations.length, 1, "failed save rolls back its preview");
  await assert.rejects(p.deleteManagedAnnotation(entry), /Disk full/);
  assert.equal(paper.annotations.length, 1, "failed delete restores the record");
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "must roll back", "新备注"), /Disk full/);
  assert.equal(entry.record.comment, "新备注", "failed remark save restores previous data");
  p.saveSettings = durableSave;
  await p.saveSelectionAnnotation({ ...context, range: { ...context.range, endOffset: 10 } }, "Underline", "blue", "Second mark");
  await p.embedOverlayAnnotations(paper);
  assert.equal(reads, 1); assert.equal(writes, 1, "batch export rewrites PDF once, not per annotation");
  assert.ok(paper.annotations.every(r => r.storageMode === "pdf"));
  const embedded = await PDFDocument.load(bytes);
  assert.equal(embedded.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(), 2);
  await p.embedOverlayAnnotations(paper);
  assert.equal(writes, 1, "repeat export is idempotent");
  // Simulate a crash after bytes reached disk but before the ownership save.
  paper.annotations[0].storageMode = "overlay";
  paper.annotations[0].pdfExportPending = true;
  await p.recoverOverlayPdfExport(paper);
  assert.equal(paper.annotations[0].storageMode, "pdf", "interrupted export recovers by exact NM identity");
  assert.ok(!paper.annotations[0].pdfExportPending);
  assert.equal(writes, 1, "recovery doesn't rewrite an already embedded mark");
  paper.annotations.push({ ...paper.annotations[0], id: "never-written", pdfAnnotationId: "never-written", storageMode: "overlay", pdfExportPending: true });
  await p.recoverOverlayPdfExport(paper);
  assert.equal(paper.annotations.at(-1).storageMode, "overlay", "intent without a PDF write stays independent");
  paper.annotations.pop();
  // Still honor the original native annotation delete path after explicit export.
  await p.deleteManagedAnnotation(p.getManagedAnnotations(paper.id)[0]);
  assert.equal(writes, 2);
  await p.saveSelectionAnnotation({ ...context, range: { ...context.range, beginOffset: 3 } }, "Highlight", "orange", "");
  const local = p.getManagedAnnotations(paper.id).find(e => e.record.storageMode === "overlay");
  const beforeDelete = writes;
  await p.deleteManagedAnnotation(local);
  assert.equal(writes, beforeDelete, "independent delete performs no binary write");
  const viewport = { width: 800, height: 800, convertToPdfPoint: (x, y) => [x / 2, 400 - y / 2] };
  const selection = await p.getNativePdfSelectionData(file, 1, { getBoundingClientRect: () => ({ width: 400, height: 400 }) },
    [{ left: 40, top: 186, right: 160, bottom: 200 }], { viewport });
  assert.deepEqual(selection.pdfRects[0], context.pdfRects[0]);
  const selectionBounds = elton.selectionRect({ getClientRects: () => [
    { left: 0, right: 2000, top: 0, bottom: 20, width: 2000, height: 0 },
    { left: 10, right: 90, top: 40, bottom: 60, width: 80, height: 20 },
    { left: 1000, right: 1100, top: 40, bottom: 60, width: 100, height: 20 }
  ] }, { getBoundingClientRect: () => ({ left: 0, right: 400, top: 0, bottom: 400 }) });
  assert.equal(selectionBounds.width, 80, "ported helper excludes empty/offscreen rects");
  const order = [], owner = {};
  const failed = elton.enqueue(owner, async () => { order.push(1); throw new Error("expected"); });
  const recovered = elton.enqueue(owner, async () => { order.push(2); });
  await assert.rejects(failed); await recovered; assert.deepEqual(order, [1, 2]);
  assert.ok(settingsWrites && overlays);
  // A sync refresh during an awaited annotation edit must retain the paper AND
  // its annotation object; subsequent stages may still hold those identities.
  const heldPaper = p.settings.papers[0], heldRecord = heldPaper.annotations[0];
  p.activeAnnotationPaperIds = new Set([heldPaper.id]);
  p.normalizeReloadedSettings = settings => settings;
  p.installCustomAppearanceStyle = () => {}; p.restorePaperRelationCache = () => {}; p.refreshViews = () => {};
  const cloned = JSON.parse(JSON.stringify(p.settings));
  cloned.papers[0].annotations[0].comment = "Synced comment";
  p.applyReloadedSettings(cloned);
  assert.equal(p.settings.papers[0], heldPaper);
  assert.equal(p.settings.papers[0].annotations[0], heldRecord);
  assert.equal(heldRecord.comment, "Synced comment");
  p.activeAnnotationPaperIds.clear();
  console.log("Independent native PDF annotations: no binary IO, rollback, native viewport reuse and batch export passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
