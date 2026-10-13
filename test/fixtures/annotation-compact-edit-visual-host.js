if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const paper = p.settings.papers.find(paper => paper.id === "compact-annotation-edit-qa-20261013");
const entry = p.getManagedAnnotations(paper.id)[0];
const leaf = app.workspace.getLeavesOfType("pdf").find(leaf => leaf.view.file?.path === paper.pdfPath);
if (!leaf) throw Error("Run compact edit host fixture first");
await app.workspace.revealLeaf(leaf);
app.workspace.setActiveLeaf(leaf, { focus: true });
const win = require("electron").remote.getCurrentWindow(); win.show(); win.focus();
const body = document.body, wasLight = body.classList.contains("theme-light"), wasDark = body.classList.contains("theme-dark");
const fs = require("fs"), paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const native = leaf.view.viewer.child.pdfViewer;
const span = [...leaf.view.containerEl.querySelectorAll(".textLayer span")].find(span => span.textContent.includes("Edit the same"));
if (!span) throw Error("PDF text not rendered");
const viewport = native.pdfViewer.getPageView(0).viewport, r = entry.record.pdfRects[0].rect;
const pt = viewport.convertToViewportPoint((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
const box = span.closest(".textLayer").getBoundingClientRect();
const anchor = { left: box.left + pt[0] * box.width / viewport.width, top: box.top + pt[1] * box.height / viewport.height, width: 0 };
anchor.bottom = anchor.top;
const result = {};
try {
  for (const mode of ["light", "dark"]) {
    body.classList.toggle("theme-light", mode === "light"); body.classList.toggle("theme-dark", mode === "dark");
    p.showOverlayAnnotationPopup(entry, document, anchor, leaf);
    await paint();
    const popup = p.selectionAnnotationPopup.root.getBoundingClientRect(), pane = native.pdfViewer.container.getBoundingClientRect(), text = span.getBoundingClientRect();
    if (popup.left < pane.left || popup.right > pane.right || popup.top < pane.top || popup.bottom > pane.bottom) throw Error("Popup outside pane");
    if (!(popup.bottom <= text.top || popup.top >= text.bottom)) throw Error("Popup covers marked text");
    result[mode] = { left: popup.left, top: popup.top, width: popup.width, height: popup.height, textTop: text.top, textBottom: text.bottom };
    fs.writeFileSync(`/tmp/paperlib-compact-edit-${mode}.png`, (await win.webContents.capturePage()).toPNG());
  }
  return result;
} finally {
  body.classList.toggle("theme-light", wasLight); body.classList.toggle("theme-dark", wasDark);
  p.closeSelectionAnnotationPopup();
}
