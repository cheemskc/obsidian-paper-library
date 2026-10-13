if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw new Error("Synthetic QA vault required");
const p = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw new Error(message); };
const waitFor = async predicate => {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("UI save did not settle");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const original = p.saveSelectionAnnotation;
const calls = [];
let release;
const sourceLeaf = app.workspace.getLeavesOfType("pdf")[0];
const context = { paper: { id: "qa-ui-only" }, text: "Pinned selection", page: 1, sourceLeaf };
try {
  p.saveSelectionAnnotation = (...args) => {
    calls.push(args);
    return new Promise((resolve, reject) => { release = { resolve, reject }; });
  };
  p.settings.lastAnnotationStyle = "Underline";
  p.showSelectionAnnotationPopup(context, document, { left: 350, top: 150, bottom: 180 });
  const root = p.selectionAnnotationPopup.root;
  check(root.querySelector("[data-style=Highlight]").getAttribute("aria-pressed") === "true", "Default highlight");
  root.querySelector("textarea").value = "Preserve draft on failure";
  root.querySelector("[data-color=orange]").click();
  check(sourceLeaf.view.containerEl.style.getPropertyValue("--paperlib-annotation-selection-color") === "#ff9f43", "Chosen orange immediately updates selection preview");
  root.querySelector("[data-color=blue]").click();
  await waitFor(() => calls.length);
  check(calls.length === 1 && calls[0][0] === context && calls[0][1] === "Highlight" && calls[0][2] === "orange", "Only one save with captured source");
  check(root.getAttribute("aria-busy") === "true", "Visible busy state");
  release.reject(new Error("Synthetic write failure"));
  await waitFor(() => !root.querySelector("[data-color=orange]").disabled);
  check(root.querySelector("textarea").value === "Preserve draft on failure", "Draft retained");
  check(root.querySelector(".paperlib-annotation-error").textContent.includes("再次点击颜色"), "Retry recovery visible");
  root.querySelector("[data-style=Underline]").click();
  root.querySelector("[data-color=green]").click();
  check(sourceLeaf.view.containerEl.style.getPropertyValue("--paperlib-annotation-selection-color") === "#7bd88f", "Retry green updates selection preview");
  await waitFor(() => calls.length === 2);
  check(calls[1][1] === "Underline" && calls[1][2] === "green" && calls[1][3] === "Preserve draft on failure", "Retry preserves draft and chosen style");
  release.resolve(true);
  await waitFor(() => !p.selectionAnnotationPopup);
  return { rapidClicksDeduplicated: true, defaultHighlight: true, sourcePinned: true, failureDraftPreserved: true, retrySucceeded: true };
} finally {
  p.saveSelectionAnnotation = original;
  p.closeSelectionAnnotationPopup();
  p.mountNativePdfToolbars();
}
