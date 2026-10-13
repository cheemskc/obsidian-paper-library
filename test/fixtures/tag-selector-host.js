// Synthetic QA only: no real notes, credentials or data writes.
if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw new Error("QA vault required");
const plugin = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw new Error(message); };
const settle = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const seed = count => {
  const tags = Array.from({ length: count }, (_, i) => `qa-tag-${String(i).padStart(3, "0")}`);
  plugin.settings.tags = tags;
  plugin.settings.collections = [];
  plugin.settings.papers = tags.map((tag, i) => ({ id: `selector-${i}`, title: `Synthetic paper ${i}`, tags: [tag], authors: [], annotations: [], collections: [] }));
};
await plugin.setLibraryAppearance("standard", false);
await plugin.ensureNavigationView(true);
await settle(600);
let leaf = app.workspace.getLeavesOfType("paper-library-navigation-view")[0];
let view = leaf.view;
for (const count of [0, 1, 6, 279]) {
  seed(count);
  view.tagCloudQuery = "";
  view.render();
  check(view.containerEl.querySelectorAll(".paperlib-tag-label").length === count, "all tags must be rendered");
  if (!count) check(view.containerEl.querySelector(".paperlib-tag-list-empty")?.textContent === "暂无标签", "empty library");
}
await settle();
let selector = view.containerEl.querySelector(".paperlib-tag-selector");
let list = selector.querySelector(".paperlib-tag-list");
const input = selector.querySelector('input[type="search"]');
const buttons = [...list.querySelectorAll(".paperlib-tag-label")];
check(selector.firstElementChild.classList.contains("paperlib-tag-filter"), "search must be above the tags");
check(input.getBoundingClientRect().bottom <= list.getBoundingClientRect().top, "search must visually sit above the tags");
check(buttons.every(button => button.textContent && getComputedStyle(button).opacity === "1"), "tag names must always be visible");
check(new Set(buttons.map(button => getComputedStyle(button).fontSize)).size === 1, "all tags must use the same font size");
check(!selector.querySelector("svg line, canvas, .paperlib-tag-cloud, .paperlib-tag-node-dot"), "graph removed");
check(list.scrollHeight > list.clientHeight, "large tag lists must scroll internally");
check(list.scrollWidth <= list.clientWidth + 1, "tags must not overflow horizontally");
list.scrollTop = 90;
list.dispatchEvent(new Event("scroll"));
check(view.tagListScrollTop === list.scrollTop && view.tagListScrollTop > 0, "scroll position must be stored");
view.render();
selector = view.containerEl.querySelector(".paperlib-tag-selector");
list = selector.querySelector(".paperlib-tag-list");
check(list.scrollTop > 0, "refresh must retain the scroll position");
const search = text => {
  const current = selector.querySelector("input");
  current.value = text;
  current.dispatchEvent(new Event("input", { bubbles: true }));
};
search("QA-TAG-0");
check(list.querySelectorAll(".paperlib-tag-label").length === 100, "search must be case insensitive and show every match");
check(list.scrollTop === 0, "search must start at the top");
search("qa-tag-042");
const match = list.querySelector(".paperlib-tag-label");
check(match?.textContent === "qa-tag-042" && list.querySelectorAll("button").length === 1, "exact tag search");
match.click();
await settle();
check(plugin.uiState.scope === "tag:qa-tag-042" && match.getAttribute("aria-pressed") === "true" && match.classList.contains("is-active"), "click must filter papers and show selected state");
check(view.getFilteredPapers().length === 1, "paper filter must match the selected tag");
match.click();
await settle();
check(plugin.uiState.scope === "all" && match.getAttribute("aria-pressed") === "false", "second click must clear tag selection");
search("no-such-tag");
check(list.querySelector(".paperlib-tag-list-empty")?.textContent === "没有匹配的标签", "no search matches");
selector.querySelector(".paperlib-tag-filter-clear").click();
check(list.querySelectorAll(".paperlib-tag-label").length === 279 && selector.querySelector("input").value === "", "clear restores every tag");
check(document.activeElement === selector.querySelector("input"), "clear returns focus to search");

// Long Chinese / Latin names remain fully readable inside the sidebar.
plugin.settings.tags = ["磁耦合无线传能系统设计", "VeryLongUnbrokenTag".repeat(10), "<tag>&文字"];
plugin.settings.papers = [];
view.render();
await settle();
list = view.containerEl.querySelector(".paperlib-tag-list");
check(list.scrollWidth <= list.clientWidth + 1, "long tags must wrap");
check([...list.querySelectorAll(".paperlib-tag-label")].every(button => plugin.getAllTags().includes(button.textContent) && !button.childElementCount), "normalized tag names must remain plain text");
for (const appearance of ["paperglass", "blueprint", "standard"]) {
  await plugin.setLibraryAppearance(appearance, false);
  view.render();
  await settle();
  check(view.containerEl.querySelectorAll(".paperlib-tag-label").length === 3, "every appearance uses the text selector");
  list = view.containerEl.querySelector(".paperlib-tag-list");
  check(list.clientHeight > 0 && list.scrollWidth <= list.clientWidth + 1, "selector stays usable in every appearance");
}
// Existing paper tag spellings must remain selectable without rewriting data.
plugin.settings.tags = ["raw-tag"];
plugin.settings.papers = [{ id: "legacy-tag", title: "Legacy tag spelling", tags: ["raw:tag"] }];
view.render();
const legacy = [...view.containerEl.querySelectorAll(".paperlib-tag-label")].find(button => button.textContent === "raw:tag");
check(legacy, "older exact tag spellings must remain selectable");
legacy.click();
await settle();
check(view.getFilteredPapers().length === 1 && plugin.settings.papers[0].tags[0] === "raw:tag", "legacy tag filters work without rewriting tags");
seed(279);
view.render();
await settle(700);
selector = view.containerEl.querySelector(".paperlib-tag-selector");
let idleMutations = 0;
const observer = new MutationObserver(records => { idleMutations += records.length; });
observer.observe(selector, { attributes: true, subtree: true, childList: true });
await settle(2000);
observer.disconnect();
check(idleMutations === 0 && selector.getAnimations({subtree:true}).length === 0, "idle tag selector must stay still");
for (let round = 0; round < 5; round++) {
  const closed = view;
  leaf.detach();
  await settle();
  check(closed.closed && !closed.contentEl.childElementCount && !closed.sidebarViewportCleanup, "close releases the selector DOM and scroll handlers");
  await plugin.ensureNavigationView(true);
  leaf = app.workspace.getLeavesOfType("paper-library-navigation-view")[0];
  view = leaf.view;
  check(view.containerEl.isConnected, "sidebar must reopen");
}
return { allTags:279, topSearch:true, alwaysVisibleNames:true, textWrapping:true, internalScroll:true,
  caseInsensitiveSearch:true, selectionToggle:true, appearanceCoverage:["standard","paperglass","blueprint"],
  idleMutationsIn2s:idleMutations, animations:0, repeatedOpenClose:5, pluginVersion:plugin.manifest.version };
