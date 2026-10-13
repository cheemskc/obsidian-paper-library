if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const paper = p.settings.papers.find(paper => paper.id === "rounded-highlight-qa-20261012")
  || p.settings.papers.find(paper => paper.id === "elton-adaptation-qa-20261012");
const leaf = app.workspace.getLeavesOfType("pdf").find(l => l.view.file?.path === paper.pdfPath);
const body = document.body, wasLight = body.classList.contains("theme-light"), wasDark = body.classList.contains("theme-dark");
const win = require("electron").remote.getCurrentWindow();
const fs = require("fs");
const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
try {
  await app.workspace.revealLeaf(leaf);
  p.showSelectionAnnotationPopup({ paper, page: 1, pdfPath: paper.pdfPath, text: "Annotation visual QA", sourceLeaf: leaf }, document,
    { left: 620, width: 240, top: 680, bottom: 710 });
  const popup = p.selectionAnnotationPopup.root;
  const toolbar = popup.querySelector(".paperlib-annotation-inline-toolbar");
  const textarea = popup.querySelector("textarea");
  const result = {};
  if (popup.querySelectorAll(".paperlib-annotation-inline-actions button").length !== 1) throw Error("Unexpected secondary actions");
  for (const mode of ["light", "dark"]) {
    body.classList.toggle("theme-light", mode === "light"); body.classList.toggle("theme-dark", mode === "dark");
    await paint();
    const box = popup.getBoundingClientRect();
    const computed = getComputedStyle(textarea);
    result[mode] = { width: box.width, height: box.height, inputTop: textarea.getBoundingClientRect().top,
      toolbarBottom: toolbar.getBoundingClientRect().bottom, background: getComputedStyle(popup).backgroundColor,
      inputBackground: computed.backgroundColor, textColor: computed.color, textareaLabel: textarea.closest("label") !== null };
    if (textarea.getBoundingClientRect().top < toolbar.getBoundingClientRect().bottom) throw Error("Remark must be below icons");
    fs.writeFileSync(`/tmp/paperlib-elton-overlay-${mode}.png`, (await win.webContents.capturePage()).toPNG());
  }
  return result;
} finally {
  body.classList.toggle("theme-light", wasLight); body.classList.toggle("theme-dark", wasDark);
  p.closeSelectionAnnotationPopup();
}
