if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const check = (ok, message) => { if (!ok) throw Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const originalEmbed = p.embedOverlayAnnotations, originalSync = p.syncOverlayAnnotationNote;
const originalActive = p.uiState.selectedId;
let embeddedId, syncedId;
try {
  p.closeSelectionAnnotationPopup();
  const manager = await p.ensureAnnotationView(false);
  manager.view.render();
  check(manager.view.containerEl.querySelectorAll(".paperlib-annotation-manager-heading button").length === 0, "No settings/maintenance buttons in annotation manager");
  app.setting.open(); app.setting.openTabById(p.manifest.id);
  const container = app.setting.activeTab.containerEl;
  const doc = container.ownerDocument;
  const win = doc.defaultView.require("electron").remote.getCurrentWindow();
  win.show(); win.focus();
  const paint = () => new Promise(resolve => doc.defaultView.requestAnimationFrame(() => doc.defaultView.requestAnimationFrame(resolve)));
  await paint(); await paint();
  const rows = [...container.querySelectorAll(".setting-item")];
  const row = name => rows.find(row => row.querySelector(".setting-item-name")?.textContent === name);
  check(row("颜色含义") && row("黄色的悬停提示"), "Color meanings live in settings");
  const selector = row("操作文献").querySelector("select");
  const targetId = "elton-adaptation-qa-20261012";
  check([...selector.options].some(option => option.value === targetId), "Annotated paper is selectable");
  row("操作文献").scrollIntoView({ block: "center" });
  await paint();
  const scroll = container.scrollTop, firstRow = rows[0];
  check(scroll > 0, "Settings must be scrolled before target-change test");
  selector.value = targetId; selector.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  await pause();
  check(container.scrollTop === scroll && firstRow.isConnected, "Selecting a target does not rebuild or jump to top");
  let finish;
  p.embedOverlayAnnotations = async paper => { embeddedId = paper.id; await new Promise(resolve => { finish = resolve; }); };
  p.syncOverlayAnnotationNote = async paper => { syncedId = paper.id; };
  const embedButton = row("写入 PDF").querySelector("button");
  embedButton.click(); await pause();
  check(embeddedId === targetId && embedButton.disabled && selector.disabled, "Export captures the explicit paper and guards duplicate clicks");
  p.uiState.selectedId = "another-paper";
  finish(); await pause();
  check(!embedButton.disabled && !selector.disabled, "Export restores controls");
  // Exported marks normally need no note retry. One temporary in-memory mode
  // change exercises the real settings callback with mocked file IO only.
  const record = p.settings.papers.find(paper => paper.id === targetId).annotations[0];
  const mode = record.storageMode;
  try {
    record.storageMode = "overlay";
    row("同步笔记").querySelector("button").click(); await pause(); await pause();
    check(syncedId === targetId, "Note retry targets the selected article, not a new active article");
  } finally { record.storageMode = mode; }
  row("标注导出与同步").scrollIntoView({ block: "start" });
  await paint();
  require("fs").writeFileSync("/tmp/paperlib-annotation-settings.png", (await win.webContents.capturePage()).toPNG());
  return { managerClean: true, colorHintsInSettings: true, explicitTarget: true, selectionKeepsScroll: true,
    busyGuard: true, syncTarget: true, actionIO: "mocked; real PDF export tested separately" };
} finally {
  p.embedOverlayAnnotations = originalEmbed; p.syncOverlayAnnotationNote = originalSync;
  p.uiState.selectedId = originalActive; app.setting.close();
}
