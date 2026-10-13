if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw Error(message); };
const wait = async (fn, message) => {
  const until = Date.now() + 10000;
  while (Date.now() < until) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 25)); }
  throw Error(`Timeout: ${message}`);
};
const lib = require(require("path").join(app.vault.adapter.getBasePath(), p.manifest.dir, "vendor/pdf-lib.min.js"));
const pdf = await lib.PDFDocument.create();
pdf.addPage([600, 800]).drawText("Edit the same annotation: evidence and methods.", { x: 45, y: 690, size: 18 });
const path = "Compact annotation edit QA 20261013.pdf", notePath = "Compact annotation edit QA 20261013.md", id = "compact-annotation-edit-qa-20261013";
for (const leaf of app.workspace.getLeavesOfType("pdf")) if (leaf.view.file?.path === path) leaf.detach();
const bytes = await pdf.save();
let file = app.vault.getAbstractFileByPath(path);
if (file) await app.vault.modifyBinary(file, bytes.buffer); else file = await app.vault.createBinary(path, bytes.buffer);
if (!app.vault.getAbstractFileByPath(notePath)) await app.vault.create(notePath, "# Synthetic QA\n\nPreserve handwritten note.\n");
p.settings.papers = p.settings.papers.filter(paper => paper.id !== id);
const paper = { id, title: "Compact annotation edit QA", pdfPath: path, notePath, annotations: [], tags: [], authors: [], collections: [], attachments: [] };
p.settings.papers.push(paper); await p.saveSettings();
const leaf = app.workspace.getLeaf("tab"); await leaf.openFile(file); await app.workspace.revealLeaf(leaf);
app.workspace.setActiveLeaf(leaf, { focus: true });
const hostWindow = require("electron").remote.getCurrentWindow(); hostWindow.show(); hostWindow.focus();
const container = leaf.view.containerEl;
const span = await wait(() => [...container.querySelectorAll(".textLayer span")].find(s => s.firstChild?.nodeType === 3 && s.textContent.includes("Edit the same")), "native text");
await wait(() => p.nativePdfBindings.has(container), "native binding");
const range = document.createRange(); range.selectNodeContents(span);
window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
const context = await p.getNativePdfSelectionContext(leaf, span.closest(".textLayer"));
await p.saveSelectionAnnotation(context, "Underline", "blue", "Existing remark");
const entry = p.getManagedAnnotations(id)[0], markId = entry.record.id;
const native = leaf.view.viewer.child.pdfViewer;
const nativeDocument = native.pdfDocument, scale = native.pdfViewer.currentScale;
const read = app.vault.readBinary, write = app.vault.modifyBinary;
let reads = 0, writes = 0;
app.vault.readBinary = async function(target, ...args) { if (target.path === path) reads++; return read.call(this, target, ...args); };
app.vault.modifyBinary = async function(target, ...args) { if (target.path === path) writes++; return write.call(this, target, ...args); };
const popup = () => p.selectionAnnotationPopup?.root;
const idle = () => !popup() || popup().getAttribute("aria-busy") !== "true";
const clickMark = () => {
  const viewport = native.pdfViewer.getPageView(0).viewport, r = entry.record.pdfRects[0].rect;
  const pt = viewport.convertToViewportPoint((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
  const box = span.closest(".textLayer").getBoundingClientRect();
  span.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: box.left + pt[0] * box.width / viewport.width, clientY: box.top + pt[1] * box.height / viewport.height }));
};
try {
  clickMark();
  check(popup()?.classList.contains("paperlib-annotation-compact-popup") && !p.annotationRemarkPopup, "Existing mark opens the same compact toolbar");
  check(popup().querySelector('[data-action="delete-annotation"]'), "Existing editor has a delete icon");
  const popupBox = popup().getBoundingClientRect(), paneBox = native.pdfViewer.container.getBoundingClientRect(), textBox = span.getBoundingClientRect();
  check(popupBox.left >= paneBox.left && popupBox.right <= paneBox.right, "Popup remains inside PDF pane, not the sidebars");
  check(popupBox.bottom <= textBox.top || popupBox.top >= textBox.bottom, "Popup does not cover the clicked text line");
  check(popup().querySelector("[data-color=blue]").getAttribute("aria-pressed") === "true", "Existing color is selected");
  check(popup().querySelector("[data-style=Underline]").getAttribute("aria-pressed") === "true", "Existing style is selected");
  const input = popup().querySelector("textarea");
  check(input.value === "Existing remark", "Existing remark prefilled");
  input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); input.focus();
  check(!!popup(), "Clicking/focusing remark stays open");
  p.scheduleSelectionAnnotationPopup(leaf, container); check(!!popup(), "Collapsed selection doesn't dismiss active editing");
  popup().querySelector("[data-color=green]").click();
  await wait(() => entry.record.color === "green" && idle(), "color saved");
  check(popup(), "Color edit keeps editor open");
  popup().querySelector("[data-style=Highlight]").click();
  await wait(() => entry.record.pdfSubtype === "Highlight" && idle(), "style saved");
  input.value = "Updated method remark"; input.dispatchEvent(new Event("input", { bubbles: true }));
  // Closing flushes the draft immediately rather than waiting for the debounce.
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  check(!popup(), "Click outside dismisses immediately");
  await wait(() => entry.record.comment === "Updated method remark" && !p.activeAnnotationPaperIds?.size, "remark flushed on close");
  check(paper.annotations.length === 1 && entry.record.id === markId, "Editing updates original record without duplicates");
  check(reads === 0 && writes === 0 && native.pdfDocument === nativeDocument && native.pdfViewer.currentScale === scale, "Overlay edit doesn't read/write/reload/zoom PDF");
  check((await app.vault.read(app.vault.getAbstractFileByPath(notePath))).includes("Updated method remark"), "Note sync follows edits");
  clickMark(); document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  check(!popup(), "Escape dismisses");
  const update = p.updateManagedAnnotationRemark;
  try {
    p.updateManagedAnnotationRemark = async () => { throw Error("Synthetic save failure"); };
    clickMark();
    popup().querySelector("textarea").value = "Retryable draft";
    popup().querySelector("[data-color=pink]").click();
    await wait(() => idle() && popup()?.querySelector(".is-error"), "failed save feedback");
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    check(!popup(), "Failed editor also dismisses");
    clickMark();
    check(popup().querySelector("textarea").value === "Retryable draft", "Reopen restores failed draft");
  } finally { p.updateManagedAnnotationRemark = update; }
  popup().querySelector("[data-color=pink]").click();
  await wait(() => entry.record.comment === "Retryable draft" && idle(), "draft retry");
  clickMark();
  await leaf.openFile(app.vault.getAbstractFileByPath(notePath));
  check(!popup(), "Switching file dismisses");
  await leaf.openFile(file); await app.workspace.revealLeaf(leaf);
  // The embedded compatibility path must route to the same compact editor too.
  await p.embedOverlayAnnotations(paper);
  const child = leaf.view.viewer.child;
  const actual = await wait(() => {
    const page = child.getPage(1), r = entry.record.pdfRects[0].rect;
    return page?.annotationLayer?.getAnnotationAtPoint((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
  }, "embedded annotation hit layer");
  p.mountNativePdfToolbars();
  await wait(() => p.nativePdfBindings.get(leaf.view.containerEl)?.remarkChild === child, "embedded native popup binding");
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  p.closeSelectionAnnotationPopup();
  child.renderAnnotationPopup(actual);
  await wait(() => p.selectionAnnotationPopup?.editingEntry?.record.id === markId, "embedded mark opens compact editor");
  check(!p.annotationRemarkPopup && popup().querySelector("textarea").value === "Retryable draft", "Embedded editor restores same remark");
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  check(!popup(), "Embedded compact editor dismisses outside");
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check(!popup(), "Dismissed editor is not resurrected by a late native popup lookup");
  p.showOverlayAnnotationPopup(entry, document, leaf.view.containerEl.getBoundingClientRect(), leaf);
  const remove = p.deleteManagedAnnotation;
  try {
    p.deleteManagedAnnotation = async () => { throw Error("Synthetic delete failure"); };
    popup().querySelector('[data-action="delete-annotation"]').click();
    await wait(() => idle() && popup()?.querySelector(".is-error"), "delete failure feedback");
    check(p.getManagedAnnotations(id).length === 1 && !popup().querySelector("textarea").disabled, "Failed delete keeps editor and annotation usable");
  } finally { p.deleteManagedAnnotation = remove; }
  popup().querySelector('[data-action="delete-annotation"]').click();
  await wait(() => !popup() && p.getManagedAnnotations(id).length === 0 && !p.activeAnnotationPaperIds?.size, "embedded delete icon");
  // Deleting an independent mark must not flush a queued remark or reload its PDF.
  await p.saveSelectionAnnotation({ ...context, sourceLeaf: leaf }, "Highlight", "yellow", "Overlay to delete");
  const overlay = p.getManagedAnnotations(id)[0];
  p.showOverlayAnnotationPopup(overlay, document, span.getBoundingClientRect(), leaf);
  const beforeDeleteReads = reads, beforeDeleteWrites = writes, beforeDeleteDocument = leaf.view.viewer.child.pdfViewer.pdfDocument;
  const updateRemark = p.updateManagedAnnotationRemark;
  let remarkWrites = 0;
  try {
    p.updateManagedAnnotationRemark = async function(...args) { remarkWrites++; return updateRemark.apply(this, args); };
    popup().querySelector("textarea").value = "Pending remark discarded by explicit delete";
    popup().querySelector("textarea").dispatchEvent(new Event("input", { bubbles: true }));
    const deleteIcon = popup().querySelector('[data-action="delete-annotation"]');
    deleteIcon.click(); deleteIcon.click();
    await wait(() => !popup() && p.getManagedAnnotations(id).length === 0 && !p.activeAnnotationPaperIds?.size, "overlay delete icon");
    check(remarkWrites === 0, "Deleting cancels pending remark autosave");
    check(!p.annotationEditDrafts.has(`${id}:${overlay.record.id}`), "Deleted mark has no retained draft");
    check(reads === beforeDeleteReads && writes === beforeDeleteWrites && leaf.view.viewer.child.pdfViewer.pdfDocument === beforeDeleteDocument, "Overlay deletion avoids PDF binary IO/reload");
    check(!(await app.vault.read(app.vault.getAbstractFileByPath(notePath))).includes(`^${overlay.record.id}`), "Deleted mark removed from generated note block");
  } finally { p.updateManagedAnnotationRemark = updateRemark; }
  p.showSelectionAnnotationPopup({ ...context, sourceLeaf: leaf }, document, span.getBoundingClientRect());
  check(!popup().querySelector('[data-action="delete-annotation"]'), "New selection has no delete button");
  p.closeSelectionAnnotationPopup();
  return { sameCompactToolbar: true, restoredStyleAndColor: true, noDuplicate: true, autoRemark: true,
    outsideDismiss: true, inputKeptOpen: true, escapeDismiss: true, fileSwitchDismiss: true,
    overlayBinaryIO: 0, embeddedAlsoCompact: true, failedDraftRetry: true, noLateReopen: true, paneClamped: true, textNotCovered: true,
    deleteIcon: true, failedDeleteRetry: true, embeddedDelete: true, overlayDelete: true, pendingRemarkCancelled: true, newSelectionNoDelete: true };
} finally { app.vault.readBinary = read; app.vault.modifyBinary = write; p.closeSelectionAnnotationPopup(); p.closeAnnotationRemarkPopup(); }
