if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const leaf = app.workspace.getLeavesOfType("pdf").find(l => l.view.file?.path === "Elton adaptation QA 20261012.pdf");
const paper = p.settings.papers.find(paper => paper.id === "elton-adaptation-qa-20261012");
if (!leaf || !paper) throw Error("Run annotation-overlay-host first");
const check = (value, message) => { if (!value) throw Error(message); };
const waitFor = async fn => {
  const end = Date.now() + 6000;
  while (Date.now() < end) { const result = fn(); if (result) return result; await new Promise(r => setTimeout(r, 30)); }
  throw Error("Timed out waiting for rotated text/overlay");
};
const native = leaf.view.viewer.child.pdfViewer;
const beforeDocument = native.pdfDocument;
let reads = 0, writes = 0;
const read = app.vault.readBinary, write = app.vault.modifyBinary;
const priorRotation = native.pdfViewer.pagesRotation;
const container = leaf.view.containerEl;
await app.workspace.revealLeaf(leaf);
app.workspace.setActiveLeaf(leaf, { focus: true });
const hostWindow = require("electron").remote.getCurrentWindow(); hostWindow.show(); hostWindow.focus();
native.pdfViewer.currentPageNumber = 1;
app.vault.readBinary = async function(file, ...args) { if (file.path === paper.pdfPath) reads++; return read.call(this, file, ...args); };
app.vault.modifyBinary = async function(file, ...args) { if (file.path === paper.pdfPath) writes++; return write.call(this, file, ...args); };
try {
  p.closeSelectionAnnotationPopup();
  native.pdfViewer.pagesRotation = 90;
  const pageView = await waitFor(() => { const page = native.pdfViewer.getPageView(0); return page.viewport.rotation === 90 && page.renderingState === 3 && page.textLayer?.div?.querySelector("span") && page; });
  const layer = pageView.div.querySelector(".textLayer");
  const span = [...layer.querySelectorAll("span")].find(s => s.firstChild?.nodeType === 3 && s.textContent.includes("Another independent"));
  const range = document.createRange(); range.selectNodeContents(span);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  const context = await p.getNativePdfSelectionContext(leaf, layer);
  check(context, "Native selection remains available after rotated page finishes rendering");
  check(reads === 0, "Rotated mapping must reuse native viewport");
  const before = new Set(paper.annotations.map(r => r.id));
  await p.saveSelectionAnnotation(context, "Underline", "pink", "Rotated native page");
  const entry = p.getManagedAnnotations(paper.id).find(e => !before.has(e.record.id));
  const path = await waitFor(() => [...container.querySelectorAll(".paperlib-native-annotation-overlay path")].find(path => path.dataset.annotationId === entry.record.id));
  const q = entry.record.pdfRects[0].quad;
  const left = pageView.viewport.convertToViewportPoint(q[4], q[5]);
  check(path.getAttribute("d").startsWith(`M ${left.join(" ")}`), "Underline uses the rotated quad edge");
  const binding = p.nativePdfBindings.get(container);
  p.cleanupNativePdfBinding(binding);
  check(!container.querySelector(".paperlib-native-annotation-overlay"), "Closing binding removes all owned SVGs");
  p.nativePdfBindingList = p.nativePdfBindingList.filter(item => item !== binding);
  p.mountNativePdfToolbars();
  await waitFor(() => container.querySelector(".paperlib-native-annotation-overlay"));
  const replacement = p.nativePdfBindings.get(container);
  p.attachNativeAnnotationOverlay(leaf, replacement);
  check(pageView.div.querySelectorAll(".paperlib-native-annotation-overlay").length === 1, "Repeated attach doesn't duplicate a page overlay");
  await p.deleteManagedAnnotation(entry);
  check(![...container.querySelectorAll(".paperlib-native-annotation-overlay path")].some(path => path.dataset.annotationId === entry.record.id), "Delete clears only the owned rotated mark, preserving other annotations");
  check(reads === 0 && writes === 0 && native.pdfDocument === beforeDocument, "No reload or PDF IO for rotated add/delete");
  return { rotation90: true, zeroBinaryIO: true, bindingCleanup: true, repeatedAttachIdempotent: true };
} finally {
  app.vault.readBinary = read; app.vault.modifyBinary = write;
  native.pdfViewer.pagesRotation = priorRotation;
  p.closeSelectionAnnotationPopup();
}
