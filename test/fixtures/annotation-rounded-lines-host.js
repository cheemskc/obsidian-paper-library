if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const lib = require(require("path").join(app.vault.adapter.getBasePath(), p.manifest.dir, "vendor/pdf-lib.min.js"));
const pdfPath = "Rounded highlight QA 20261012.pdf", notePath = "Rounded highlight QA 20261012.md";
const id = "rounded-highlight-qa-20261012";
const pdf = await lib.PDFDocument.create(), page = pdf.addPage([600, 800]);
const font = await pdf.embedFont(lib.StandardFonts.TimesRoman);
const lines = ["Native annotation test: methods and", "evidence. Select this sentence to add a",
  "reading remark. Middle line should not", "have duplicated rectangles. Last line of the", "multi-line annotation.",
  "Second page: zoom and reading position", "must be retained."];
for (let i = 0; i < lines.length; i++) page.drawText(lines[i], { x: 45, y: 720 - i * 42 - (i > 4 ? 16 : 0), font, size: 24 });
for (const leaf of app.workspace.getLeavesOfType("pdf")) if (leaf.view.file?.path === pdfPath) leaf.detach();
const bytes = await pdf.save();
let file = app.vault.getAbstractFileByPath(pdfPath);
if (file) await app.vault.modifyBinary(file, bytes.buffer); else file = await app.vault.createBinary(pdfPath, bytes.buffer);
if (!app.vault.getAbstractFileByPath(notePath)) await app.vault.create(notePath, "# Rounded highlight QA\n");
p.settings.papers = p.settings.papers.filter(paper => paper.id !== id);
const paper = { id, title: "Rounded line highlights QA", pdfPath, notePath, annotations: [], authors: [], tags: [], collections: [], attachments: [] };
p.settings.papers.push(paper); await p.saveSettings();
const leaf = app.workspace.getLeaf("tab"); await leaf.openFile(file); await app.workspace.revealLeaf(leaf);
const container = leaf.view.containerEl;
const end = Date.now() + 8000;
while (!container.querySelector(".textLayer span") || !p.nativePdfBindings.has(container)) {
  if (Date.now() > end) throw Error("Native text not ready"); await new Promise(r => setTimeout(r, 30));
}
const layer = container.querySelector(".textLayer");
const spans = lines.map(line => [...layer.querySelectorAll("span")].find(s => s.textContent === line));
if (spans.some(s => !s?.firstChild)) throw Error("Missing synthetic text");
const mark = async (startLine, start, endLine, finish, color) => {
  const range = document.createRange(); range.setStart(spans[startLine].firstChild, start); range.setEnd(spans[endLine].firstChild, finish);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const context = await p.getNativePdfSelectionContext(leaf, layer);
  await p.saveSelectionAnnotation(context, "Highlight", color, "");
};
p.closeSelectionAnnotationPopup();
await mark(0, 7, 2, 15, "blue");
await mark(2, 15, 2, 35, "green");
await mark(3, 5, 3, 27, "pink");
await mark(5, 18, 6, 5, "green");
const paths = [...container.querySelectorAll(".paperlib-native-annotation-overlay path")];
if (paths.length !== 4 || paths.some(path => !(path.getAttribute("d").match(/\bC\b/g) || []).length)) throw Error("Rounded per-line paths missing");
const first = paths.find(path => path.dataset.annotationId === paper.annotations[0].id);
if ((first.getAttribute("d").match(/\bM\b/g) || []).length < 3) throw Error("Multiline must not use a paragraph bounding box");
return { multiLine: true, fourColoredMarks: true, fragmentCorners: true, paragraphBoundingBox: false };
