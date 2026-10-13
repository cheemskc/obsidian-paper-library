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
p.closeSelectionAnnotationPopup(); p.closeAnnotationRemarkPopup();
const file = app.vault.getAbstractFileByPath("Native annotation QA.pdf");
const leaf = app.workspace.getLeavesOfType("pdf").find(l => l.view.file === file);
await app.workspace.revealLeaf(leaf);
const child = leaf.view.viewer.child, native = child.pdfViewer, viewer = native.pdfViewer;
child.destroyAnnotationPopup?.();
await waitFor(() => native.pdfDocument && viewer.getPageView(0)?.renderingState === 3, "native page");
p.mountNativePdfToolbars();
const paper = p.settings.papers.find(paper => paper.pdfPath === file.path);
const entry = p.getManagedAnnotations(paper.id).find(e => e.source === "annotation" && e.record.pdfSubtype === "Highlight");
check(entry, "Native annotation fixture first");
const id = entry.record.id, original = entry.record.comment || "";
const beforeCount = p.getManagedAnnotations(paper.id).length;
for (const old of app.workspace.getLeavesOfType("paper-library-annotation-view")) old.detach();
const manager = (await p.ensureAnnotationView(true)).view;
manager.filters = { scope: "current", style: "", color: "", query: "" }; manager.renderList();
const card = () => [...manager.list.querySelectorAll("article")].find(el => el.dataset.annotationId === id);
card().querySelector(".paperlib-annotation-edit").click();
check(card().querySelector("textarea").value === original, "Existing remark prefilled");
const input = () => card().querySelector("textarea");
input().value = "中文备注🙂\n继续补充方法与结论";
input().dispatchEvent(new Event("input", { bubbles: true }));
input().setSelectionRange(2, 5); input().focus();
p.refreshAnnotationViews();
check(input().value === "中文备注🙂\n继续补充方法与结论" && document.activeElement === input()
  && input().selectionStart === 2 && input().selectionEnd === 5, "Refresh preserves draft/focus/selection");
const update = p.updateManagedAnnotationRemark;
try {
  p.updateManagedAnnotationRemark = async () => { throw new Error("Synthetic failed save"); };
  card().querySelector(".paperlib-annotation-remark-save").click();
  await waitFor(() => card().querySelector(".paperlib-annotation-error").textContent.includes("Synthetic failed save"), "inline error");
  check(!input().disabled && input().value.includes("继续补充"), "Failed edit retains retryable draft");
} finally { p.updateManagedAnnotationRemark = update; }
viewer.currentScaleValue = "1.4"; viewer.container.scrollTo({ top: 100, left: 0, behavior: "instant" }); viewer.update();
await waitFor(() => viewer.getPageView(0)?.renderingState === 3, "manual zoom");
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const state = () => ({ scale: viewer.currentScale, page: viewer.currentPageNumber, top: viewer.container.scrollTop, left: viewer.container.scrollLeft });
const before = state();
const save = card().querySelector(".paperlib-annotation-remark-save");
save.click(); save.click();
await waitFor(() => !card()?.querySelector("textarea"), "successful inline save");
const after = state();
check(JSON.stringify(before) === JSON.stringify(after), `Remark edit retains exact reader view state: ${JSON.stringify({ before, after })}`);
check(entry.record.id === id && p.getManagedAnnotations(paper.id).length === beforeCount, "Updates original without duplicates");
check(card().querySelector(".paperlib-annotation-comment").textContent.includes("继续补充方法与结论"), "Sidebar displays saved remark");
const note = app.vault.getAbstractFileByPath(paper.notePath);
check((await app.vault.read(note)).includes("继续补充方法与结论"), "Note synchronizes remark");
await app.workspace.revealLeaf(leaf);
const nativePopup = async () => {
  const annotations = await child.getPage(1).pdfPage.getAnnotations();
  const data = annotations.find(a => a.contentsObj.str === (entry.record.comment || entry.record.text));
  check(data, "Saved native annotation Contents updated");
  const r = data.rect;
  let actual;
  await waitFor(() => {
    actual = child.getPage(1)?.annotationLayer?.getAnnotationAtPoint((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    return actual?.data?.id === data.id;
  }, "actual native hit layer ready after canvas repaint");
  child.renderAnnotationPopup(actual);
  await waitFor(() => child.activeAnnotationPopupEl?.querySelector(".paperlib-native-annotation-edit"), "native popup edit action");
  return child.activeAnnotationPopupEl;
};
let popup = await nativePopup();
const editIcon = popup.querySelector(".paperlib-native-annotation-edit");
check(editIcon.querySelector("svg") && editIcon.previousElementSibling?.classList.contains("clickable-icon"), "Pencil icon immediately follows native copy icon");
check(getComputedStyle(editIcon.querySelector(".paperlib-annotation-swatch-name")).clipPath === "inset(50%)", "Edit label is accessible, not a visible button caption");
popup.querySelector(".paperlib-native-annotation-edit").click();
check(p.annotationRemarkPopup.root.querySelector("textarea").value.includes("继续补充"), "Native editor uses same current remark");
const nativeInput = p.annotationRemarkPopup.root.querySelector("textarea");
nativeInput.value = "";
nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
nativeInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ctrlKey: true, isComposing: true }));
check(!p.annotationRemarkPopup.state.saving, "IME confirm does not save");
nativeInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", ctrlKey: true }));
await waitFor(() => !p.annotationRemarkPopup, "native shortcut save");
check(entry.record.comment === "" && !(await app.vault.read(note)).includes("继续补充方法与结论"), "Clear remark synchronizes all layers");
popup = await nativePopup();
check(popup.querySelector(".popupContent").textContent === entry.record.text, "Cleared native popup shows original excerpt");
popup.querySelector(".paperlib-native-annotation-edit").click();
const cancel = [...p.annotationRemarkPopup.root.querySelectorAll("button")].find(b => b.textContent === "取消");
p.annotationRemarkPopup.root.querySelector("textarea").value = "Should not be saved"; cancel.click();
check(entry.record.comment === "", "Cancel does not write");
// An earlier save completing after switching the popup must not close the new
// document's editor. Use a controlled task: no extra PDF or note writes.
const other = p.getManagedAnnotations("native-other-qa")[0];
check(other, "Second document fixture");
let release;
try {
  p.updateManagedAnnotationRemark = () => new Promise(resolve => { release = resolve; });
  p.showAnnotationRemarkPopup(entry, document, { left: 400, bottom: 200 });
  p.annotationRemarkPopup.root.querySelector(".paperlib-annotation-remark-save").click();
  p.showAnnotationRemarkPopup(other, document, { left: 400, bottom: 200 });
  const nextRoot = p.annotationRemarkPopup.root;
  release(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  check(p.annotationRemarkPopup?.root === nextRoot, "Late save cannot close another article's remark editor");
} finally { p.updateManagedAnnotationRemark = update; p.closeAnnotationRemarkPopup(); }
// Roundtrip back to the original fixture content, then leave both editor entries
// visible for one bounded visual inspection without touching real user files.
await p.updateManagedAnnotationRemark(entry, original, "");
manager.filters = { scope: "current", style: "", color: "", query: "" }; manager.renderList();
card().querySelector(".paperlib-annotation-edit").click();
popup = await nativePopup();
check(p.nativePdfWriteTransitions.size === 0, "No retained transition buffers");
return { sidebarEdit: true, nativePopupEdit: true, exactViewState: { before, after }, noDuplicate: true,
  draftFocusRetained: true, failedSaveRetry: true, noteAndPdfSync: true, clearAndCancel: true, shortcutAndIME: true };
