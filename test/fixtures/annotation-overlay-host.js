if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("Synthetic QA required");
const p = app.plugins.plugins["paper-library"];
const check = (ok, msg) => { if (!ok) throw Error(msg); };
const waitFor = async (fn, msg) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw Error(`Timeout: ${msg}`);
};
const lib = require(require("path").join(app.vault.adapter.getBasePath(), p.manifest.dir, "vendor/pdf-lib.min.js"));
const pdf = await lib.PDFDocument.create();
for (let i = 0; i < 80; i++) {
  const page = pdf.addPage([600, 800]);
  page.drawText(`Annotation QA page ${i + 1}: methods, evidence and conclusions.`, { x: 45, y: 690, size: 17 });
  page.drawText("Another independent reading selection.", { x: 45, y: 650, size: 17 });
}
const pdfPath = "Elton adaptation QA 20261012.pdf", notePath = "Elton adaptation QA 20261012.md";
for (const leaf of app.workspace.getLeavesOfType("pdf")) if (leaf.view.file?.path === pdfPath) leaf.detach();
const bytes = await pdf.save();
let file = app.vault.getAbstractFileByPath(pdfPath);
if (file) await app.vault.modifyBinary(file, bytes.buffer); else file = await app.vault.createBinary(pdfPath, bytes.buffer);
let note = app.vault.getAbstractFileByPath(notePath);
if (note) await app.vault.modify(note, "# Synthetic note\n\nKeep handwritten contents.\n");
else note = await app.vault.create(notePath, "# Synthetic note\n\nKeep handwritten contents.\n");
const id = "elton-adaptation-qa-20261012";
// Only our synthetic record is replaced; the other test/user books are untouched.
p.settings.papers = p.settings.papers.filter(paper => paper.id !== id);
const paper = { id, title: "Elton annotation adapter QA", pdfPath, notePath, annotations: [],
  authors: [], tags: [], collections: [], attachments: [], year: 2026 };
p.settings.papers.push(paper); await p.saveSettings();
const leaf = app.workspace.getLeaf("tab"); await leaf.openFile(file); await app.workspace.revealLeaf(leaf);
const container = leaf.view.containerEl;
const layer = await waitFor(() => [...container.querySelectorAll(".textLayer")].find(el => el.querySelector("span")?.textContent.includes("Annotation QA")), "native text layer");
await waitFor(() => p.nativePdfBindings.has(container), "native binding");
const native = leaf.view.viewer.child.pdfViewer;
check(!!native.pdfViewer?.getPageView(0)?.viewport, "Native viewport available");
let pdfWrites = 0, pdfReads = 0;
const write = app.vault.modifyBinary, read = app.vault.readBinary;
app.vault.modifyBinary = async function(target, ...args) { if (target === file) pdfWrites++; return write.call(this, target, ...args); };
app.vault.readBinary = async function(target, ...args) { if (target === file) pdfReads++; return read.call(this, target, ...args); };
const beforeDocument = native.pdfDocument;
let oldSignature, elapsed;
try {
  const span = [...layer.querySelectorAll("span")].find(s => s.firstChild?.nodeType === 3 && s.textContent.includes("Annotation QA"));
  const range = document.createRange(); range.selectNodeContents(span);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const start = performance.now();
  const context = await p.getNativePdfSelectionContext(leaf, layer);
  check(pdfReads === 0, "Selection mapping must not read PDF binary");
  p.showSelectionAnnotationPopup(context, document, range.getBoundingClientRect());
  const root = p.selectionAnnotationPopup.root;
  check(root.classList.contains("paperlib-annotation-compact-popup"), "Compact annotation toolbar");
  check(root.querySelector(".paperlib-annotation-inline-toolbar").contains(root.querySelector(".paperlib-annotation-color-options")), "Colors in top toolbar");
  check(!root.querySelector(".paperlib-annotation-popup-heading"), "No redundant heading");
  check(root.querySelectorAll(".paperlib-annotation-inline-actions button").length === 1, "Only AI remains in secondary selection actions");
  root.querySelector("textarea").value = "Method evidence remark";
  root.querySelector("[data-color=green]").click();
  const path = await waitFor(() => container.querySelector(".paperlib-native-annotation-overlay path"), "immediate overlay");
  elapsed = performance.now() - start;
  check(path.getAttribute("fill") === "#7bd88f", "Chosen color is drawn");
  check((path.getAttribute("d").match(/\bC\b/g) || []).length >= 4, "Text fragment has rounded corners");
  await waitFor(() => !p.selectionAnnotationPopup, "durable annotation");
  check(pdfWrites === 0 && pdfReads === 0 && native.pdfDocument === beforeDocument, "No PDF IO or document reload");
  check(paper.annotations.length === 1 && paper.annotations[0].storageMode === "overlay", "Independent mark saved");
  const entry = p.getManagedAnnotations(id)[0];
  await p.updateManagedAnnotationRemark(entry, "Updated method remark");
  check(pdfWrites === 0, "Remark update doesn't write PDF");
  oldSignature = path.closest("svg").dataset.signature;
  native.pdfViewer.currentScaleValue = "1.4";
  await waitFor(() => container.querySelector(".paperlib-native-annotation-overlay")?.dataset.signature !== oldSignature, "overlay adapts to zoom");
  check(native.pdfDocument === beforeDocument, "Zoom stays in same native document");
  // Reopening proves the mark does not rely on the selected DOM Range.
  leaf.detach();
  const reopened = app.workspace.getLeaf("tab"); await reopened.openFile(file); await app.workspace.revealLeaf(reopened);
  await waitFor(() => reopened.view.containerEl.querySelector(".paperlib-native-annotation-overlay path"), "mark after reopening");
  await p.saveSelectionAnnotation({ ...context, sourceLeaf: reopened, range: { ...context.range, endOffset: context.range.endOffset - 1 } }, "Underline", "blue", "Second mark");
  check(pdfWrites === 0, "Second mark doesn't write PDF");
  await p.embedOverlayAnnotations(paper);
  check(pdfWrites === 1, "Two marks embedded in one write");
  const embedded = await lib.PDFDocument.load(await read.call(app.vault, file));
  const annots = embedded.getPage(0).node.lookup(lib.PDFName.of("Annots"), lib.PDFArray);
  check(annots.size() === 2, "Both marks persisted inside PDF");
  const first = [...Array(annots.size()).keys()].map(i => embedded.context.lookup(annots.get(i), lib.PDFDict))
    .find(mark => mark.lookup(lib.PDFName.of("Subtype"), lib.PDFName).asString() === "/Highlight");
  const appearance = first.lookup(lib.PDFName.of("AP"), lib.PDFDict).lookup(lib.PDFName.of("N"));
  check((String.fromCharCode(...lib.decodePDFRawStream(appearance).decode()).match(/\bc\b/g) || []).length >= 4, "Export retains rounded corners");
  check(paper.annotations.every(r => r.storageMode === "pdf"), "Embedded marks switch to native ownership");
  check(!reopened.view.containerEl.querySelector(".paperlib-native-annotation-overlay"), "No doubled native+overlay paint");
  await p.embedOverlayAnnotations(paper); check(pdfWrites === 1, "Export repeated without duplication");
  check((await app.vault.read(note)).includes("Keep handwritten contents."), "User note contents preserved");
  check((await p.loadData()).papers.find(paper => paper.id === id)?.annotations?.length === 2, "Durable records read back from disk");
  // Leave a fresh, non-saving compact popup for the batched visual inspection.
  p.showSelectionAnnotationPopup({ ...context, sourceLeaf: reopened }, document, { left: 520, top: 140, bottom: 170, width: 320 });
  p.selectionAnnotationPopup.root.querySelector("textarea").value = "在此添加备注…";
  return { pages: 80, selectionToOverlayMs: Math.round(elapsed), ordinaryPdfWrites: 0, batchPdfWrites: pdfWrites,
    nativeSelectionWithoutBinaryRead: true, zoomAligned: true, reopenRestored: true, noDuplicateExport: true };
} finally {
  app.vault.modifyBinary = write; app.vault.readBinary = read;
}
