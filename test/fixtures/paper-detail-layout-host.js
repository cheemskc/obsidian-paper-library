// Synthetic desktop QA: replace state in memory and restore it after the checks.
if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
const check = (value, message) => { if (!value) throw Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async fn => { for (let n=0;n<100;n++) { if(fn()) return; await new Promise(r=>setTimeout(r,20)); } throw Error("Timed out waiting for UI"); };
const old = { settings:p.settings, ui:{...p.uiState}, cache:p.relationCache, preferences:p.deviceAppearancePreferences, theme:document.body.classList.contains("theme-dark") };
const methods = ["saveSettings","enrichPaperVenueRanks","organizePaperFiles","refreshPaperInfo","loadPaperMetrics","loadPaperRelations","prefetchSemanticScholarRelationCache"];
const originals = Object.fromEntries(methods.map(name=>[name,p[name]]));
let saved, metricLoads=0, relationLoads=0, infoLoads=0;
const refreshSequence=[];
p.saveSettings = async () => { saved = p.settingsForPersistence(p.settings); };
p.enrichPaperVenueRanks = async () => {};
p.organizePaperFiles = async () => {};
p.refreshPaperInfo = async () => { infoLoads++;refreshSequence.push("info"); };
p.loadPaperMetrics = async (_paper,force) => { metricLoads++;refreshSequence.push(force ? "metrics:forced" : "metrics"); };
p.loadPaperRelations = async () => { relationLoads++; };
p.prefetchSemanticScholarRelationCache = async () => {};
const paper = { id:"detail-layout-qa", title:"Synthetic paper for literature details", authors:["QA Author"], year:2026, venue:"Nature", abstract:"Synthetic abstract for testing the reorganized literature panel.", tags:["qa-tag"], collections:["QA"], doi:"10.1/qa", arxiv:"", pdfPath:"", notePath:"", venueRanks:[], rating:0, publicationType:"patent", metrics:{status:"ready",citations:4,references:2,type:"patent",source:"Synthetic QA",publisher:"QA Publisher",updatedAt:new Date().toISOString()} };
const relations = { status:"ready",updatedAt:new Date().toISOString(),citedBy:{items:[],total:4,allLoaded:true},references:{items:[],total:2,allLoaded:true} };
const win = require("electron").remote.getCurrentWindow();
const shot = async name => { await frame(); const image=await win.webContents.capturePage(); require("fs").writeFileSync(`/tmp/paperlib-${name}.png`,image.toPNG()); };
let view;
try {
  p.settings = {...old.settings,papers:[paper],tags:["qa-tag"],collections:["QA"]};
  p.relationCache = new Map([[paper.id,relations]]);
  p.deviceAppearancePreferences = {appearance:"standard",accent:"#2563c9"};
  p.uiState.selectedId=paper.id; p.uiState.detailTab="info";
  await p.activateMainView(true);
  await p.ensureDetailView(true);
  view=app.workspace.getLeavesOfType("paper-library-detail-view")[0].view;
  view.render(); await frame();
  const root=()=>view.containerEl;
  const content=()=>root().querySelector(".paperlib-detail-scroll");
  const tab=id=>root().querySelector(`[data-detail-tab="${id}"]`);
  check(tab("info").getAttribute("aria-label")==="文献信息", "info tab label");
  check(tab("data").getAttribute("aria-label")==="参考文献", "references tab label");
  check(content().querySelectorAll(".paperlib-metric-card").length===4,"metrics moved to literature information");
  check(!content().querySelector(".paperlib-data-heading"),"data has no orphan refresh toolbar");
  const dataNote=content().querySelector(".paperlib-data-note"), identifiers=content().querySelector(".paperlib-meta-section");
  check(Boolean(dataNote.compareDocumentPosition(identifiers) & Node.DOCUMENT_POSITION_FOLLOWING),"DOI identifiers follow all literature data");
  check(!content().querySelector(".paperlib-relations"),"information contains no citation lists");
  check(!content().querySelector(".paperlib-chips"),"tags and collections removed from information");
  let refresh=root().querySelector('.paperlib-detail-footer button[aria-label="刷新文献信息与数据"]');
  check(refresh,"combined refresh lives in the footer");
  refresh.click();await wait(()=>metricLoads===1);
  check(infoLoads===1 && refreshSequence.join("|")==="info|metrics:forced","footer refresh updates metadata before fetching fresh statistics");
  p.metricsLoading.add(paper.id);view.render();
  refresh=root().querySelector('.paperlib-detail-footer button[aria-label="刷新文献信息与数据"]');
  check(refresh.disabled && refresh.classList.contains("is-spinning"),"metric loading disables the combined refresh");
  p.metricsLoading.delete(paper.id);view.render();await frame();
  await shot("literature-info");
  tab("data").click(); await frame();
  const relationStyle=getComputedStyle(content().querySelector(".paperlib-relations"));
  check(relationStyle.borderTopWidth==="0px" && relationStyle.marginTop==="0px" && relationStyle.paddingTop==="0px","reference page has no inherited top separator or spacer");
  check([...content().querySelectorAll("h3,h4")].map(el=>el.textContent).join("|")==="论文关系|被引论文|引用列表", "only three reference sections");
  check(!content().querySelector(".paperlib-metrics-grid,.paperlib-info-header,.paperlib-meta-section"),"reference page excludes metadata and statistics");
  await shot("references");
  tab("edit").click(); await frame();
  const select=content().querySelector(".paperlib-editor-field select");
  check(select && select.options.length===9,"all eight literature types plus automatic mode");
  check(select.value==="", "legacy records start with automatic inference");
  const sections=[...content().querySelectorAll(".paperlib-editor-field,.paperlib-editor-choice-section")];
  check(sections.at(-1).querySelector("label")?.textContent==="Tags","tags are the last editable field");
  select.value="journal";select.dispatchEvent(new Event("change",{bubbles:true}));
  await shot("literature-editor");
  [...content().querySelectorAll("button")].find(el=>el.textContent==="保存修改").click();
  await wait(()=>saved?.papers[0]?.itemType==="journal" && p.uiState.detailTab==="info");
  check(p.getPaperItemType(paper).id==="journal", "saved type overrides imported patent");
  check(saved.papers[0].tags[0]==="qa-tag" && saved.papers[0].collections[0]==="QA","removing display fields preserves data");
  check([...content().querySelectorAll(".paperlib-metric-card")].some(el=>el.textContent.includes("期刊文章")),"information displays edited type");
  tab("edit").click(); check(content().querySelector("select").value==="journal","reopening editor restores selected type");
  content().querySelector("select").value="thesis";content().querySelector("select").dispatchEvent(new Event("change",{bubbles:true}));
  [...content().querySelectorAll("button")].find(el=>el.textContent==="取消").click();
  check(paper.itemType==="journal", "cancel leaves the saved type intact");
  p.deviceAppearancePreferences={appearance:"blueprint",accent:"#2563c9"};view.render();await frame();
  check(root().querySelector(".paperlib-native-detail").dataset.paperlibAppearance==="standard","saved blueprint selection falls back to standard");
  check(!document.querySelector(".paperlib-view-style-toggle"),"view switching buttons removed");
  check(typeof p.showLibraryAppearanceMenu==="undefined" && typeof p.setLibraryAppearance==="undefined","layout switching API removed");
  for (const appearance of ["gallery","paperglass","custom:my-layout","blueprint","custom:blueprint"]) {
    p.deviceAppearancePreferences={appearance,accent:"#2563c9"};
    check(p.getLibraryAppearanceId()==="standard","retired appearances cannot be reactivated");
  }
  // Check both themes and a narrower detail pane without writing settings.
  for (const appearance of ["standard"]) for (const dark of [false,true]) {
    p.deviceAppearancePreferences={appearance,accent:"#2563c9"};
    document.body.classList.toggle("theme-dark",dark);document.body.classList.toggle("theme-light",!dark);
    p.uiState.detailTab="edit";view.render();await frame();
    const surface=root().querySelector(".paperlib-native-detail");
    const priorWidth=surface.style.width;surface.style.width="260px";await frame();
    check(content().scrollWidth<=content().clientWidth+1,"editor stays within a narrow pane");
    check(content().querySelector("select").getBoundingClientRect().width>100,"type control remains usable");
    surface.style.width=priorWidth;
  }
  // Test the modal editor/add flow through its registered command.
  const command=app.commands.commands["paper-library:add-paper"];
  command.callback();await frame();
  let modal=document.querySelector(".paperlib-modal");
  check(modal,"add paper modal opens");
  const rows=[...modal.querySelectorAll(".setting-item")];
  check(rows.at(-1).querySelector(".setting-item-name")?.textContent==="Tags","modal puts tag editing last");
  const typeRow=rows.find(el=>el.querySelector(".setting-item-name")?.textContent==="文献类型");
  typeRow.querySelector("select").value="report";typeRow.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}));
  const titleInput=rows.find(el=>el.querySelector(".setting-item-name")?.textContent==="Title").querySelector("input");
  titleInput.value="Synthetic report";titleInput.dispatchEvent(new Event("input",{bubbles:true}));
  [...modal.querySelectorAll("button")].find(el=>el.classList.contains("mod-cta")).click();
  await wait(()=>saved?.papers.some(item=>item.title==="Synthetic report" && item.itemType==="report"));
  check(!document.querySelector(".paperlib-modal"), "modal saves and closes");
  return {informationMetrics:4,referenceSections:3,types:8,tagsLast:true,typeSaveAndCancel:true,modalTypeSave:true,preservedTagsAndCollections:true,retiredAppearancesBlocked:true,pluginVersion:p.manifest.version,metricLoads,relationLoads,screenshots:["/tmp/paperlib-literature-info.png","/tmp/paperlib-references.png","/tmp/paperlib-literature-editor.png"]};
} finally {
  methods.forEach(name=>p[name]=originals[name]);
  p.settings=old.settings;p.uiState=old.ui;p.relationCache=old.cache;p.deviceAppearancePreferences=old.preferences;
  // Restore device-local preferences after testing rejected appearance selections.
  p.writeDeviceAppearancePreferences(old.preferences || {appearance:"standard",accent:"#2563c9"});
  document.body.classList.toggle("theme-dark",old.theme);document.body.classList.toggle("theme-light",!old.theme);
  p.refreshViews();
}
