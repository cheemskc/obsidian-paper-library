const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") return {
    ItemView: class {}, Menu: class {}, Modal: class {}, Notice: class {}, Plugin: class {},
    PluginSettingTab: class {}, Setting: class {}, normalizePath: p => p,
    loadPdfJs: async () => null, requestUrl: async () => ({}), setIcon() {}
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../main.js");
Module._load = originalLoad;
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString } = require("../vendor/pdf-lib.min.js");
const internals = Plugin.annotationInternals;

async function run() {
  assert.equal(internals.colorForRecord({ annotationColorMeanings: { green: "实验方法" } }, { color: "GREEN", pdfSubtype: "Underline" }).meaning, "实验方法");
  assert.equal(internals.colorForRecord({ annotationStyleMeanings: { Underline: "旧样式含义" } }, { color: "green", pdfSubtype: "Underline" }).meaning, "方法", "style meanings must not override color hints");
  assert.deepEqual(internals.STYLES.map(s => s.id), ["Highlight", "Underline"], "only two styles are offered for new annotations");
  const appearance = internals.annotationAppearanceCommands({ pdfSubtype: "Highlight", pdfRects: [
    { rect: [0, 0, 100, 14] }, { rect: [0, 2, 100, 12] }, { rect: [0, 12, 100, 26] }
  ] }, [0, 0, 100, 26]);
  assert.equal((appearance.match(/\bf\b/g) || []).length, 1, "overlapping rectangles must be painted in one fill, never darkened by repeated translucent fills");
  assert.equal((appearance.match(/\bre\b/g) || []).length, 3);
  const roundedMark = { pdfSubtype: "Highlight", highlightCornerRadius: 2, pdfRects: [
    { rect: [10, 20, 100, 34], quad: [10, 34, 100, 34, 10, 20, 100, 20] },
    { rect: [10, 0, 80, 14], quad: [10, 14, 80, 14, 10, 0, 80, 0] }
  ] };
  const roundedAppearance = internals.annotationAppearanceCommands(roundedMark, [10, 0, 100, 34]);
  assert.equal((roundedAppearance.match(/\bf\b/g) || []).length, 1, "rounded lines retain a single translucent fill");
  assert.equal((roundedAppearance.match(/\bc\b/g) || []).length, 8, "each line has four rounded corners, not a rounded paragraph box");
  assert.ok(!roundedAppearance.includes("NaN"));
  const quad = [[0, 0], [100, 0], [100, 14], [0, 14]];
  const svg = internals.roundedQuadPath(quad, 2);
  assert.match(svg, /^M 2 0 /);
  assert.equal((svg.match(/\bC\b/g) || []).length, 4);
  const rotated = internals.roundedQuadPath(quad.map(([x, y]) => [y, -x]), 2);
  assert.match(rotated, /^M 0 -2 /, "rounded geometry rotates with the native viewport");
  assert.ok(!internals.roundedQuadPath([[0, 0], [1, 0], [1, 1], [0, 1]], 20).includes("NaN"), "short selections clamp radius");
  assert.ok(!internals.roundedQuadPath([[0, 0], [0, 0], [0, 1], [0, 1]], 2).includes("NaN"), "degenerate fragments cannot divide by zero");
  assert.equal(internals.roundedQuadPath([[NaN, 0], ...quad.slice(1)], 2), "");
  const paneBounds = { left: 300, right: 1000, top: 120, bottom: 900 }, popupSize = { width: 304, height: 110 };
  assert.deepEqual(internals.annotationPopupPosition({ left: 500, top: 400, bottom: 440, width: 200 }, popupSize, paneBounds), { left: 448, top: 280 }, "popup prefers above selected text");
  assert.deepEqual(internals.annotationPopupPosition({ left: 950, top: 130, bottom: 160, width: 0 }, popupSize, paneBounds), { left: 688, top: 170 }, "near top/right edge popup goes below and stays inside the PDF pane");
  const draws = [], previewContext = {
    save() {}, restore() {}, setTransform(...args) { draws.push(["transform", ...args]); },
    beginPath() {}, rect(...args) { draws.push(["rect", ...args]); },
    fill() { draws.push(["fill", this.globalAlpha, this.fillStyle]); },
    moveTo() {}, lineTo() {}, stroke() {}
  };
  assert.equal(internals.paintAnnotationPreview(previewContext, { color: "orange", pdfSubtype: "Highlight",
    pdfRects: [{ rect: [0, 0, 100, 14] }, { rect: [0, 2, 100, 12] }] },
    { width: 400, height: 400, convertToViewportRectangle: r => r },
    { left: 0, top: 0, width: 400, height: 400 }, { left: 0, top: 0, width: 400, height: 400 },
    { width: 800, height: 800 }), true);
  assert.deepEqual(draws.filter(d => d[0] === "fill"), [["fill", .38, "#ff9f43"]], "preview uses the saved PDF color/opacity and one fill");
  assert.equal(internals.styleForRecord({}, { type: "ink" }).id, "Ink");
  const doc = await PDFDocument.create(); doc.addPage([400, 400]);
  let bytes = await doc.save();
  let note = "# My note\n\nHandwritten contents remain.\n";
  const pdfFile = { path: "Papers/Test.pdf", extension: "pdf" };
  const noteFile = { path: "Papers/Test.md", extension: "md" };
  const paper = { id: "paper", title: "Test paper", pdfPath: pdfFile.path, notePath: noteFile.path };
  const other = { id: "other", title: "Another paper", pdfPath: "other.pdf", annotations: [{ id: "other-mark", text: "Control group", page: 3, color: "blue" }] };
  const p = Object.create(Plugin.prototype);
  p.settings = { papers: [paper, other], annotationHeading: "PDF Annotations" };
  p.uiState = {}; p.pdfMutationQueues = new Map();
  p.app = { vault: {
    getAbstractFileByPath: path => path === pdfFile.path ? pdfFile : path === noteFile.path ? noteFile : null,
    readBinary: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    modifyBinary: async (_, buffer) => { bytes = new Uint8Array(buffer); },
    read: async () => note,
    process: async (_, callback) => { note = callback(note); }
  }, workspace: { getLeavesOfType: () => [], getLeaf: () => ({ openFile: async file => { p.openedFile = file; } }) } };
  p.ensurePaperNote = async () => noteFile;
  let saves = 0, fullRefreshes = 0;
  p.saveSettings = async () => { saves++; };
  p.refreshViews = () => { fullRefreshes++; }; p.refreshResearchPdfHighlights = () => {};
  const context = { paper, pdfPath: pdfFile.path, text: "Native PDF selection", page: 1,
    range: { beginIndex: 0, beginOffset: 0, endIndex: 0, endOffset: 20 },
    pdfRects: [{ rect: [40, 200, 160, 214], quad: [40, 214, 160, 214, 40, 200, 160, 200] }],
    selectionSource: "native", rectCoordinateSpace: "pdf", storageMode: "pdf" };
  for (const style of ["Highlight", "Underline", "Squiggly", "StrikeOut", "Text"]) {
    const before = saves;
    const saved = await p.saveSelectionAnnotation(context, style, "green", `${style} remark`);
    assert.equal(saves - before, 1, "annotation saves settings only once");
    assert.equal(fullRefreshes, 0, "annotation saving must not rebuild library/daily/navigation views");
    assert.equal(saved, true);
    const parsed = await PDFDocument.load(bytes);
    const arr = parsed.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const annotation = parsed.context.lookup(arr.get(arr.size() - 1), PDFDict);
    assert.equal(annotation.lookup(PDFName.of("Subtype"), PDFName).asString(), `/${style}`);
    assert.equal(annotation.lookup(PDFName.of("Contents"), PDFHexString).decodeText(), `${style} remark`);
    assert.ok(annotation.has(PDFName.of("AP")) || style === "Text", "markup must have a visible appearance stream");
    assert.match(note, /Handwritten contents remain/);
    assert.ok(note.includes(`${style} remark`));
  }
  assert.equal(p.getManagedAnnotations("paper").length, 5, "legacy excerpt mirrors must not duplicate annotations");
  const entry = p.getManagedAnnotations("paper").find(e => e.record.pdfSubtype === "Highlight");
  const stableId = entry.record.id;
  const beforeEdit = await PDFDocument.load(bytes);
  const firstArray = beforeEdit.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  const firstDict = beforeEdit.context.lookup(firstArray.get(0), PDFDict);
  const appearanceRef = String(firstDict.get(PDFName.of("AP")));
  const createdAt = entry.record.createdAt;
  await p.updateManagedAnnotationRemark(entry, "中文备注🙂\n追加思考", entry.record.comment);
  let edited = await PDFDocument.load(bytes);
  let editedArray = edited.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  assert.equal(editedArray.size(), 5, "remark update must not add an annotation");
  let editedDict = edited.context.lookup(editedArray.get(0), PDFDict);
  assert.equal(editedDict.lookup(PDFName.of("Contents"), PDFHexString).decodeText(), "中文备注🙂\n追加思考");
  assert.equal(String(editedDict.get(PDFName.of("AP"))), appearanceRef, "appearance is untouched");
  assert.equal(entry.record.id, stableId); assert.equal(entry.record.createdAt, createdAt);
  assert.equal(fullRefreshes, 0);
  assert.ok(note.includes("**批注：** 中文备注🙂\n> 追加思考"));
  assert.ok(note.includes("Handwritten contents remain."));
  const nativeEntry = await p.getNativeManagedAnnotationEntry(pdfFile, 1, `${editedArray.get(0).objectNumber}R`);
  assert.equal(nativeEntry.record.id, stableId, "native popup uses exact NM identity");
  assert.equal(await p.getNativeManagedAnnotationEntry(pdfFile, 1, "invalid"), null);
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "Stale replacement", "old remark"), /别处修改/);
  const beforeFailureNote = note;
  const originalModify = p.app.vault.modifyBinary;
  p.app.vault.modifyBinary = async () => { throw new Error("Disk write failed"); };
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "Will fail", entry.record.comment), /Disk write failed/);
  assert.equal(entry.record.comment, "中文备注🙂\n追加思考"); assert.equal(note, beforeFailureNote);
  p.app.vault.modifyBinary = originalModify;
  await p.updateManagedAnnotationRemark(entry, "", entry.record.comment);
  assert.equal(entry.record.comment, ""); assert.ok(!note.includes("追加思考"));
  edited = await PDFDocument.load(bytes); editedArray = edited.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
  editedDict = edited.context.lookup(editedArray.get(0), PDFDict);
  assert.equal(editedDict.lookup(PDFName.of("Contents"), PDFHexString).decodeText(), entry.record.text, "cleared remark falls back to original excerpt");
  const beforePartial = note;
  const process = p.app.vault.process;
  p.app.vault.process = async () => { throw new Error("Note write failed"); };
  await assert.rejects(p.updateManagedAnnotationRemark(entry, "Retry note", ""), /同步未完成/);
  assert.equal(note, beforePartial);
  p.app.vault.process = process;
  await p.updateManagedAnnotationRemark(entry, "Retry note", "");
  assert.ok(note.includes("Retry note"), "partial sync can be retried without a duplicate");
  assert.equal((await PDFDocument.load(bytes)).getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(), 5);
  const ownedBlock = "> [!pdf|yellow]+ 高亮\n> Hand-edited excerpt stays\n>\n> **批注：** old\n>\n> [[a|打开原文高亮]]\n\n^mark\n\nHandwritten after";
  assert.ok(internals.updateRemarkBlock(ownedBlock, ["mark"], "old", "new").includes("Hand-edited excerpt stays"));
  assert.throws(() => internals.updateRemarkBlock(ownedBlock, ["mark"], "unexpected", "new"), /笔记中的备注/);
  const leaves = p.app.workspace.getLeavesOfType;
  let editorText = `${note}\nUnsaved manual editor text.\n`, editorWrites = 0;
  const editor = {
    getValue: () => editorText, offsetToPos: offset => ({ offset }),
    replaceRange: (text, from, to) => { editorWrites++; editorText = editorText.slice(0, from.offset) + text + editorText.slice(to.offset); }
  };
  p.app.workspace.getLeavesOfType = type => type === "markdown" ? [{ view: { file: noteFile, editor } }] : [];
  await p.updateManagedAnnotationRemark(entry, "Edit without losing unsaved notes", entry.record.comment);
  assert.equal(editorWrites, 1, "open note is changed through the Editor's undoable range API");
  assert.ok(editorText.includes("Unsaved manual editor text."));
  assert.ok(editorText.includes("Edit without losing unsaved notes"));
  note = editorText;
  p.app.workspace.getLeavesOfType = leaves;
  assert.equal(p.getManagedAnnotations().length, 6);
  const matched = internals.filterAnnotations(p.getManagedAnnotations(), { style: "Underline", color: "green", query: "remark" }, p.settings);
  assert.equal(matched.length, 1);
  p.settings.annotationColorMeanings = { green: "实验方法" };
  assert.equal(internals.filterAnnotations(p.getManagedAnnotations(), { query: "实验方法" }, p.settings).length, 5, "color meaning applies to every style using this color");
  await assert.rejects(p.saveSelectionAnnotation(context, "Text", "yellow", ""), /填写注释/);
  const target = matched[0];
  await p.deletePdfMark(paper, { record: target.record, source: target.source });
  assert.equal(fullRefreshes, 0, "deleting an annotation must not rebuild the entire plugin UI");
  assert.equal(p.getManagedAnnotations("paper").length, 4);
  assert.ok(!note.includes("Underline remark"));
  assert.ok(note.includes("Squiggly remark"));
  const parsed = await PDFDocument.load(bytes);
  assert.equal(parsed.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).size(), 4);
  const failedTarget = p.getManagedAnnotations("paper")[0];
  const remove = p.removeLocalPdfAnnotations;
  p.removeLocalPdfAnnotations = async () => { throw new Error("Read-only PDF"); };
  await assert.rejects(p.deletePdfMark(paper, failedTarget), /Read-only/);
  assert.equal(p.getManagedAnnotations("paper").length, 4, "failed PDF deletion must keep the annotation record");
  p.removeLocalPdfAnnotations = remove;
  const beginTransition = p.beginNativePdfWriteTransition;
  const modifyBinary = p.app.vault.modifyBinary;
  let cancelled = 0;
  p.beginNativePdfWriteTransition = () => ({ finished: Promise.resolve(), cancel: () => { cancelled++; } });
  p.app.vault.modifyBinary = async () => { throw new Error("Disk write failure"); };
  await assert.rejects(p.upsertLocalPdfAnnotation(p.getManagedAnnotations("paper")[0].record), /Disk write failure/);
  assert.equal(cancelled, 1, "write failures must release the temporary page transition");
  p.beginNativePdfWriteTransition = beginTransition;
  p.app.vault.modifyBinary = modifyBinary;
  await p.savePdfInkStroke(paper, { pdfPath: pdfFile.path, page: 1, points: [{ x: .1, y: .2 }] });
  const ink = p.getManagedAnnotations("paper").find(e => e.source === "ink");
  assert.ok(ink);
  await p.deleteManagedAnnotation(ink);
  assert.equal(p.getManagedAnnotations("paper").length, 4);
  p.settings.doubleClickOpenMode = "workspace";
  await p.openPaperFromDoubleClick(paper);
  assert.equal(p.openedFile, pdfFile, "legacy workspace default must open native PDF");
  assert.ok(!fs.readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8").includes("class PaperResearchWorkspaceView"));
  // Figure targets follow the active PDF, then the last tracked PDF or selected paper.
  const figuresFile = { path: "Figures.pdf", extension: "pdf" };
  p.app.vault.getAbstractFileByPath = path => path === figuresFile.path ? figuresFile : path === pdfFile.path ? pdfFile : null;
  p.app.workspace.getActiveFile = () => figuresFile;
  p.figureSidebarPath = pdfFile.path;
  assert.equal(p.getFigureSidebarSource().path, figuresFile.path);
  p.app.workspace.getActiveFile = () => null;
  assert.equal(p.getFigureSidebarSource().path, pdfFile.path);
  p.figureSidebarPath = "";
  p.uiState.selectedId = paper.id;
  assert.equal(p.getFigureSidebarSource().path, pdfFile.path);
  p.figureSidebarPath = "removed.pdf";
  assert.equal(p.getFigureSidebarSource(), null, "missing files must not show another paper's images");
  const nativeSource = fs.readFileSync(require("node:path").join(__dirname, "../main.js"), "utf8");
  const mountSource = nativeSource.slice(nativeSource.indexOf("  mountNativePdfToolbars() {"), nativeSource.indexOf("  cleanupNativePdfBinding(binding) {"));
  assert.ok(!mountSource.includes("createElement"), "PDF binding must not recreate a floating toolbar");
  assert.ok(mountSource.includes("scheduleSelectionAnnotationPopup"), "native text annotations remain available without the toolbar");
  const popupSource = nativeSource.slice(nativeSource.indexOf("    showSelectionAnnotationPopup(context, doc, anchor, editingEntry = null) {"), nativeSource.indexOf("  Plugin.annotationInternals"));
  assert.ok(!popupSource.includes("paperlib-annotation-selected-text"), "popup must not repeat annotation source text");
  assert.ok(popupSource.indexOf('cls: "paperlib-annotation-color-options"') < popupSource.indexOf('cls: "paperlib-annotation-style-options"'), "color controls must be the first option row");
  assert.ok(popupSource.includes("saveSelectionAnnotation(context, style, color, note.value)"), "hiding the text preview must preserve the original save context");
  assert.ok(!popupSource.includes('"保存标注"'), "color click replaces the save button");
  assert.ok(popupSource.includes('editingEntry ? normalizeSubtype(editingEntry.record.pdfSubtype) : "Highlight"'), "new selections default to highlight; existing annotations restore their own style");
  assert.ok(!popupSource.includes('cls: "paperlib-annotation-meaning"'), "color meanings only appear on hover");
  assert.ok(popupSource.includes('button(colorGroup, "",'), "swatches have no visible color names");
  assert.ok(popupSource.includes('btn.setAttribute("title", value)'), "user-requested hover meanings");
  assert.ok(popupSource.includes("if (saving) return"), "rapid clicks cannot create duplicate annotations");
  assert.ok(popupSource.includes('iconButton(actions, "trash-2", "删除标注"'), "existing compact editor has a delete icon");
  assert.ok(popupSource.includes("editingEntry && !deleting"), "closing after deletion must not save a stale remark");
  console.log("Native PDF annotation persistence, styles, filtering, deletion and migration tests passed.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
