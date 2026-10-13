if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw new Error("Synthetic QA vault required");
const p = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async (fn, message) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const result = fn(); if (result) return result; await new Promise(r => setTimeout(r, 80)); }
  throw new Error(`Timed out: ${message}`);
};
const fs = require("fs"), path = require("path");
const base = app.vault.adapter.getBasePath();
const lib = require(path.join(base, p.manifest.dir, "vendor/pdf-lib.min.js"));
const pdf = await lib.PDFDocument.create();
const page = pdf.addPage([600, 800]);
page.drawText("Native annotation test: methods and evidence.", { x: 45, y: 690, size: 18 });
page.drawText("Select this sentence to add a reading remark.", { x: 45, y: 645, size: 18 });
page.drawText("Middle line should not have duplicated rectangles.", { x: 45, y: 600, size: 18 });
page.drawText("Last line of the multi-line annotation.", { x: 45, y: 555, size: 18 });
const secondPage = pdf.addPage([600, 800]);
secondPage.drawText("Second page: zoom and reading position must be retained.", { x: 45, y: 690, size: 18 });
const pdfPath = "Native annotation QA.pdf", notePath = "Native annotation QA.md";
for (const oldLeaf of app.workspace.getLeavesOfType("pdf")) if (oldLeaf.view.file?.path === pdfPath) oldLeaf.detach();
let file = app.vault.getAbstractFileByPath(pdfPath);
const bytes = await pdf.save();
if (file) await app.vault.modifyBinary(file, bytes.buffer); else file = await app.vault.createBinary(pdfPath, bytes.buffer);
let noteFile = app.vault.getAbstractFileByPath(notePath);
if (noteFile) await app.vault.modify(noteFile, "# QA note\n\nKeep handwritten text.\n");
else noteFile = await app.vault.create(notePath, "# QA note\n\nKeep handwritten text.\n");
const paper = { id: "native-annotation-qa", title: "Native annotation QA", pdfPath, notePath,
  tags: [], collections: [], authors: [], attachments: [], year: 2026, annotations: [] };
const other = { id: "native-other-qa", title: "Other synthetic paper", pdfPath: "other.pdf", notePath: "", tags: [], collections: [], authors: [], attachments: [],
  annotations: [{ id: "other-note", page: 2, text: "Other document annotation", comment: "Other note", color: "blue", pdfSubtype: "Highlight" }] };
fs.writeFileSync(path.join(base, ".obsidian", "native-annotation-settings-before.json"), JSON.stringify(p.settings));
p.settings.papers = [paper, other];
p.settings.doubleClickOpenMode = "workspace";
p.settings.selectionAnnotationPopup = true;
p.settings.annotationColorMeanings = { green: "Experimental evidence" };
p.settings.lastAnnotationStyle = "Highlight";
p.uiState.selectedId = paper.id;
await p.saveSettings();
await p.openPaperFromDoubleClick(paper);
const leaf = await waitFor(() => app.workspace.getLeavesOfType("pdf").find(l => l.view.file?.path === pdfPath), "native reader");
const container = leaf.view.containerEl;
await waitFor(() => container.querySelector(".textLayer span") && p.nativePdfBindings.has(container), "PDF text and native selection binding");
check(!document.querySelector(".paperlib-research-root"), "No research canvas should render");
check(!app.commands.commands["paper-library:open-research-workspace"], "Old workspace command removed");
const textLayer = container.querySelector(".textLayer");
const textSpans = [...textLayer.querySelectorAll("span")].filter(s => s.firstChild?.nodeType === 3 && s.textContent.trim());
const multi = document.createRange();
multi.setStart(textSpans[0].firstChild, 0);
multi.setEnd(textSpans.at(-1).firstChild, textSpans.at(-1).firstChild.length);
const rawCount = [...multi.getClientRects()].filter(r => r.width > .5 && r.height > .5).length;
const cleanRects = p.captureDomSelectionRects(multi, textLayer);
check(cleanRects.length === 4, "Each of four selected lines produces exactly one rectangle");
check(rawCount > cleanRects.length, "Fixture reproduces duplicated DOM rectangles before the fix");
const selectText = async () => {
  await app.workspace.revealLeaf(leaf);
  const span = await waitFor(() => [...container.querySelectorAll(".textLayer span")].find(s => s.firstChild?.nodeType === 3 && s.textContent.includes("Native annotation")), "first PDF text span");
  const range = document.createRange(); range.setStart(span.firstChild, 0); range.setEnd(span.firstChild, span.firstChild.length);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  span.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, view: window }));
  return await waitFor(() => p.selectionAnnotationPopup?.root, "automatic selection popup");
};
let popup = await selectText();
check(p.getManagedAnnotations(paper.id).length === 0, "Selecting text must not automatically save");
check(popup.querySelectorAll(".paperlib-annotation-style-options button").length === 2, "Two annotation styles");
check(popup.querySelectorAll(".paperlib-annotation-color-options button").length === 5, "Five colors");
check(!popup.querySelector(".paperlib-annotation-selected-text"), "Popup does not repeat selected source text");
check(popup.querySelector(".paperlib-annotation-color-options").compareDocumentPosition(popup.querySelector(".paperlib-annotation-style-options")) & Node.DOCUMENT_POSITION_FOLLOWING, "Color row precedes style row");
popup.querySelector("[data-style=Underline]").click();
check(!popup.querySelector(".paperlib-annotation-meaning"), "No permanent meaning row");
check(popup.querySelector("[data-color=green]").title === "Experimental evidence", "Configured meaning shown on hover");
check(getComputedStyle(popup.querySelector(".paperlib-annotation-swatch-name")).clipPath === "inset(50%)", "Color names are accessible but not visible");
check(![...popup.querySelectorAll("button")].some(b => b.textContent === "保存标注"), "No save button");
popup.querySelector("textarea").value = "Important experimental method";
popup.querySelector("[data-color=green]").click();
popup.querySelector("[data-color=orange]").click();
await waitFor(() => !p.selectionAnnotationPopup, "saved annotation");
check(p.getManagedAnnotations(paper.id).length === 1, "Saved record listed once");
const first = p.getManagedAnnotations(paper.id)[0];
check(first.record.pdfSubtype === "Underline" && first.record.comment === "Important experimental method", "Subtype and remark persisted");
const parsed = await lib.PDFDocument.load(await app.vault.readBinary(file));
const arr = parsed.getPage(0).node.lookup(lib.PDFName.of("Annots"), lib.PDFArray);
check(parsed.context.lookup(arr.get(0), lib.PDFDict).lookup(lib.PDFName.of("Subtype"), lib.PDFName).asString() === "/Underline", "Real PDF contains underline annotation");
await waitFor(() => container.querySelector(".annotationLayer .underlineAnnotation"), "native underline rendering");
const manager = (await p.ensureAnnotationView(true)).view;
manager.filters = { scope: "current", style: "", color: "", query: "" }; manager.render();
check(manager.list.querySelectorAll("article").length === 1, "Current paper manager");
manager.filters.scope = "all"; manager.renderList();
check(manager.list.querySelectorAll("article").length === 2, "All paper manager");
manager.filters.style = "Underline"; manager.filters.color = "green"; manager.filters.query = "evidence"; manager.renderList();
check(manager.list.querySelectorAll("article").length === 1, "Combined style/color/meaning filters");
manager.filters.query = "no match"; manager.renderList();
check(manager.list.querySelectorAll("article").length === 0, "Empty filter result");
manager.filters.query = ""; manager.renderList();
await p.savePdfInkStroke(paper, { pdfPath, page: 1, points: [{ x: .2, y: .4 }, { x: .6, y: .4 }], color: "pink" });
check(p.getManagedAnnotations(paper.id).some(e => e.source === "ink"), "Ink included in manager");
// Actual sidebar delete click must remove the same record from PDF and note.
manager.list.querySelector(".paperlib-annotation-delete").click();
await waitFor(() => !p.getManagedAnnotations(paper.id).some(e => e.record.id === first.record.id), "sidebar deletion");
await p.annotationMutationQueue;
const after = await lib.PDFDocument.load(await app.vault.readBinary(file));
check(after.getPage(0).node.lookup(lib.PDFName.of("Annots"), lib.PDFArray).size() === 0, "PDF deletion synchronized");
const note = await app.vault.read(noteFile);
check(note.includes("Keep handwritten text.") && !note.includes("Important experimental method"), "Note deletion keeps handwritten contents");
// Restored old view should redirect to the native reader.
const legacy = app.workspace.getLeaf("tab");
await legacy.setViewState({ type: "paper-library-research-workspace-view", state: { paperId: paper.id } });
await waitFor(() => legacy.view.getViewType() === "pdf", "legacy view redirected");
legacy.detach();
// Leave a visible, saved example for visual inspection.
popup = await selectText();
check(popup.querySelector("[data-style=Highlight]").classList.contains("is-active"), "Always defaults to highlight after an underline");
popup.querySelector("textarea").value = "Main result to remember";
popup.querySelector("[data-color=yellow]").click();
await waitFor(() => !p.selectionAnnotationPopup, "final example save");
manager.filters = { scope: "current", style: "", color: "", query: "" }; manager.render();
await p.ensureAnnotationView(true);
await selectText();
return { vault: app.vault.getName(), version: p.manifest.version, nativeReader: true, automaticPopup: true,
  multiLineRects: { raw: rawCount, fixed: cleanRects.length },
  nativeUnderlineRendered: true, twoStylesAndFiveSwatches: true, hoverMeaningOnly: true, colorClickAutoSave: true, remarkSaved: true,
  currentAndAllScopes: true, combinedFilters: true, inkIncluded: true,
  sidebarDeletionSynchronizesPdfAndNote: true, handwrittenNotePreserved: true, legacyLayoutRedirect: true };
