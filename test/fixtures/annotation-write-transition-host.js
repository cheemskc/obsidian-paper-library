if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw new Error("Synthetic QA vault required");
const p = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async (predicate, message) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
p.closeSelectionAnnotationPopup();
const file = app.vault.getAbstractFileByPath("Native annotation QA.pdf");
check(file, "Run native-annotations-host fixture first");
const leaf = app.workspace.getLeavesOfType("pdf").find(l => l.view.file === file);
await app.workspace.revealLeaf(leaf);
const native = leaf.view.viewer.child.pdfViewer;
const initialViewMethod = native.getInitialViewOverrides;
const setInitialViewMethod = native.setInitialView;
const host = leaf.view.containerEl.querySelector(".pdf-container");
const ready = () => native.pdfDocument && native.pdfViewer.getPageView(0)?.renderingState === 3;
await waitFor(ready, "native page ready");
p.mountNativePdfToolbars();
const paper = p.settings.papers.find(paper => paper.pdfPath === file.path);
const originalClose = native.close;
const originalRefresh = p.refreshViews;
let fullRefreshes = 0;
const refreshStacks = [];
const reloads = [];
let previewPixel = null, samplePoint = null;
native.close = async function(...args) {
  const start = performance.now();
  const result = await originalClose.apply(this, args);
  const preview = host.querySelector(".paperlib-pdf-write-transition canvas[data-preview-color]");
  if (preview && samplePoint) {
    const rect = preview.getBoundingClientRect();
    previewPixel = [...preview.getContext("2d").getImageData(
      Math.floor((samplePoint.x - rect.left) * preview.width / rect.width),
      Math.floor((samplePoint.y - rect.top) * preview.height / rect.height), 1, 1).data];
  }
  reloads.push({ protected: !!host.querySelector(".paperlib-pdf-write-transition canvas"), previewColor: preview?.dataset.previewColor,
    blankNativePage: !native.pdfDocument, closeMs: Math.round(performance.now() - start) });
  return result;
};
p.refreshViews = (...args) => { fullRefreshes++; refreshStacks.push(new Error().stack); return originalRefresh.apply(p, args); };
const recordsBefore = p.getManagedAnnotations(paper.id).length;
try {
  const span = [...host.querySelectorAll(".textLayer span")].find(s => s.firstChild?.nodeType === 3 && s.textContent.includes("Middle line"));
  const range = document.createRange(); range.selectNodeContents(span);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const context = await p.getNativePdfSelectionContext(leaf, span.closest(".textLayer"));
  const expected = p.constructor.annotationInternals.colorForRecord(p.settings, { color: p.settings.defaultHighlightColor }).value;
  const probe = document.createElement("span");
  probe.style.backgroundColor = `color-mix(in srgb, ${expected} 38%, transparent)`;
  document.body.appendChild(probe);
  const expectedSelection = getComputedStyle(probe).backgroundColor;
  probe.remove();
  check(getComputedStyle(span, "::selection").backgroundColor === expectedSelection, "Native selection uses remembered color, not system purple");
  check(getComputedStyle(span.closest(".textLayer")).opacity === "1", "Selection color is not faded twice by the native text layer");
  check(getComputedStyle(span.closest(".textLayer")).mixBlendMode === "multiply", "Preview leaves the PDF text black like the saved highlight");
  const rect = context.pdfRects[0].rect;
  const pageView = native.pdfViewer.getPageView(0);
  const point = pageView.viewport.convertToViewportPoint(rect[2] - 1, rect[1] + 1);
  const canvasBox = pageView.canvas.getBoundingClientRect();
  samplePoint = { x: canvasBox.left + point[0] * canvasBox.width / pageView.viewport.width,
    y: canvasBox.top + point[1] * canvasBox.height / pageView.viewport.height };
  const beforeDocument = native.pdfDocument;
  const started = performance.now();
  await p.saveSelectionAnnotation(context, "Highlight", "orange", "Write transition QA");
  const saveMs = Math.round(performance.now() - started);
  check(native.pdfDocument !== beforeDocument, "Native reader uses freshly saved PDF, not stale in-memory data");
  check(ready(), "New page finished rendering before transition released");
  const canvas = native.pdfViewer.getPageView(0).canvas;
  const box = canvas.getBoundingClientRect();
  const finalPixel = [...canvas.getContext("2d").getImageData(
    Math.floor((samplePoint.x - box.left) * canvas.width / box.width),
    Math.floor((samplePoint.y - box.top) * canvas.height / box.height), 1, 1).data];
  check(previewPixel && finalPixel.every((value, index) => Math.abs(value - previewPixel[index]) <= 3), `Color retained through save: ${previewPixel} vs ${finalPixel}`);
  check(p.nativePdfWriteTransitions.size === 0 && !host.querySelector(".paperlib-pdf-write-transition"), "Save releases buffers and transition");
  const mark = p.getManagedAnnotations(paper.id).find(e => e.record.comment === "Write transition QA");
  check(mark, "New annotation persisted");
  await p.deleteManagedAnnotation(mark);
  check(p.getManagedAnnotations(paper.id).length === recordsBefore, "Deletion persisted");
  check(p.nativePdfWriteTransitions.size === 0, "Deletion releases buffers");
  check(fullRefreshes === 0, `No full plugin UI refresh on adding/deleting: ${refreshStacks.join("\n")}`);
  check(reloads.length === 2 && reloads.every(r => r.protected && r.blankNativePage), "Both real native blank reloads retain the visible page");
  check(reloads[0].previewColor === "orange" && !reloads[1].previewColor, "New color preview added only once; deletion has no stacked preview");
  check(native.getInitialViewOverrides === initialViewMethod, "Successful reload restores initial-view adapter");
  // Reproduce the actual bug away from page one and the default zoom.
  const viewer = native.pdfViewer;
  check(native.pdfDocument.numPages === 2, "Two-page fixture required for view-state test");
  viewer.currentScaleValue = "1.7";
  viewer.currentPageNumber = 2;
  await waitFor(() => viewer.getPageView(1)?.renderingState === 3, "page two at manual zoom");
  viewer.container.scrollTop += 75;
  viewer.container.scrollLeft = 40;
  viewer.update();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const state = () => ({ scale: viewer.currentScale, value: viewer.currentScaleValue, page: viewer.currentPageNumber,
    top: viewer.container.scrollTop, left: viewer.container.scrollLeft });
  const manualBefore = state();
  const span2 = [...host.querySelectorAll('.page[data-page-number="2"] .textLayer span')].find(s => s.textContent.includes("Second page"));
  const range2 = document.createRange(); range2.selectNodeContents(span2);
  selection.removeAllRanges(); selection.addRange(range2);
  const context2 = await p.getNativePdfSelectionContext(leaf, span2.closest(".textLayer"));
  samplePoint = null;
  await p.saveSelectionAnnotation(context2, "Highlight", "green", "Zoom state QA");
  const manualAfter = state();
  check(manualAfter.page === manualBefore.page && manualAfter.scale === manualBefore.scale
    && Math.abs(manualAfter.top - manualBefore.top) <= 2 && Math.abs(manualAfter.left - manualBefore.left) <= 2,
    `Save retains manual zoom/page/scroll: ${JSON.stringify({ manualBefore, manualAfter })}`);
  viewer.currentScaleValue = "page-width";
  await waitFor(() => viewer.getPageView(1)?.renderingState === 3, "page-width render");
  viewer.update();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const widthBefore = state();
  await p.deleteManagedAnnotation(p.getManagedAnnotations(paper.id).find(e => e.record.comment === "Zoom state QA"));
  const widthAfter = state();
  check(widthAfter.value === "page-width" && widthAfter.page === widthBefore.page
    && Math.abs(widthAfter.top - widthBefore.top) <= 2, `Delete retains page-width/page/scroll: ${JSON.stringify({ widthBefore, widthAfter })}`);
  check(native.getInitialViewOverrides === initialViewMethod, "Adapter released after both view-state tests");
  check(native.setInitialView === setInitialViewMethod, "Pixel scroll adapter released after view-state tests");
  viewer.currentPageNumber = 1;
  await waitFor(ready, "return to page one");
  // Snapshots must never remain pinned during user navigation.
  const navigation = p.beginNativePdfWriteTransition(file);
  check(p.nativePdfWriteTransitions.size > 0, "Visible native page captured");
  host.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }));
  await navigation.finished;
  check(!host.querySelector(".paperlib-pdf-write-transition") && p.nativePdfWriteTransitions.size === 0, "Wheel releases the bridge");
  check(native.getInitialViewOverrides === initialViewMethod, "Navigation restores initial-view adapter");
  check(native.setInitialView === setInitialViewMethod, "Navigation restores pixel scroll adapter");
  const copied = p.beginNativePdfWriteTransition(file);
  const snapshot = [...p.nativePdfWriteTransitions][0];
  const canvases = [...snapshot.root.querySelectorAll("canvas")];
  check(snapshot.pixels <= 4 * 1024 * 1024, "Global snapshot budget respected");
  copied.cancel(); await copied.finished;
  check(canvases.every(c => !c.width && !c.height), "Cancelled canvas buffers explicitly released");
  // A non-plugin writer must continue to reach the reader: no onModify hook.
  const oldDocument = native.pdfDocument;
  const bytes = await app.vault.readBinary(file);
  await app.vault.modifyBinary(file, bytes);
  await waitFor(() => native.pdfDocument && native.pdfDocument !== oldDocument && ready(), "external file changes reload");
  check(!host.querySelector(".paperlib-pdf-write-transition"), "No blanket suppression/masking of external changes");
  return { saveMs, reloads: reloads.slice(0, 2), noFullRefresh: fullRefreshes === 0,
    manualBefore, manualAfter, widthBefore, widthAfter, initialViewAdapterReleased: true,
    selectionMatchesSavedColor: true, previewPixel, finalPixel, colorMaintainedThroughSave: true,
    currentPdfBytesUsed: true, snapshotReleased: true, wheelCleanup: true, explicitCanvasRelease: true, externalReloadPreserved: true };
} finally {
  native.close = originalClose;
  p.refreshViews = originalRefresh;
  for (const transition of p.nativePdfWriteTransitions || []) transition.cancel();
}
