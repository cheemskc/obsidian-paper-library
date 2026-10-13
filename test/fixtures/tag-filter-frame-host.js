// Reproduce side-dock theme rules without copying or changing the user's theme.
if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw new Error("QA vault required");
const p=app.plugins.plugins["paper-library"];
await p.setLibraryAppearance("standard",false);
await p.ensureNavigationView(true);
await new Promise(r=>setTimeout(r,600));
const v=app.workspace.getLeavesOfType("paper-library-navigation-view")[0].view;
v.tagCloudQuery="";v.render();
const input=v.containerEl.querySelector(".paperlib-tag-filter input");
if(!input.closest(".mod-sidedock"))throw new Error("Test must use the real side-dock");
const doc=input.ownerDocument;
const style=doc.createElement("style");
style.textContent=`
.mod-sidedock :is(input[type="search"], textarea) { outline: 1px solid rgba(0,0,0,.08); }
.mod-sidedock input[type="search"] { border-radius: 20px; }
.mod-sidedock input[type="search"]:focus { outline: 1px solid red; border: 1px solid red; border-radius: 20px; box-shadow: 0 0 0 2px red; }
`;
doc.head.appendChild(style);
const check=(value,message)=>{if(!value)throw new Error(message);};
const snapshots=[];
try{
 for(const state of ["blurred","focused"]){
  if(state==="focused")input.focus();else input.blur();
  await new Promise(r=>setTimeout(r,150));
  const c=getComputedStyle(input);
  const snapshot={state,radius:c.borderRadius,outline:c.outlineStyle,border:c.borderTopWidth,shadow:c.boxShadow,appearance:c.appearance};
  snapshots.push(snapshot);
  check(c.borderRadius==="0px",`${state}: extra input rounding (${c.borderRadius})`);
  check(c.outlineStyle==="none"&&c.borderTopWidth==="0px"&&c.boxShadow==="none",`${state}: inner border/outline/shadow must be absent`);
  check(c.appearance==="none",`${state}: native search decoration disabled`);
 }
 input.value="qa-tag";input.dispatchEvent(new Event("input",{bubbles:true}));
 const outer=input.closest(".paperlib-tag-filter"),icon=outer.querySelector(".paperlib-tag-filter-icon"),clear=outer.querySelector(".paperlib-tag-filter-clear");
 check(!clear.hidden,"typed query must show clear control");
 const box=outer.getBoundingClientRect(),ib=input.getBoundingClientRect(),fb=icon.getBoundingClientRect();
 check(Math.abs((ib.top+ib.height/2)-(fb.top+fb.height/2))<1,"icon and input must align vertically");
 check(fb.right<box.right&&ib.left>box.left&&ib.right<=fb.left,"input and filter icon must stay inside the single frame");
 clear.click();
 check(input.value===""&&doc.activeElement===input,"clear must work and retain input focus");
 return {replicatedSideDockTheme:true,snapshots,singleFrame:true,iconAligned:true,searchAndClear:true};
}finally{style.remove();input.blur();}
