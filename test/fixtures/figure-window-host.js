// Runs only in the synthetic desktop QA vault; no PDF or paper data is written.
if (!app.vault.getName().startsWith("PaperLibrary-Memory-QA-")) throw Error("QA required");
const p = app.plugins.plugins["paper-library"];
if (!p) throw Error("Paper Library must be enabled in the QA vault");
const check = (value, message) => { if (!value) throw Error(message); };
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw Error("Timed out waiting for viewer"); };
const win = require("electron").remote.getCurrentWindow();
const bounds = win.getBounds();
const originals = { render:p.renderPdfFigure, catalog:p.getPdfFigureCatalog, payload:p.getPortablePdfFigurePayload };
const figures = [
  {figureKey:"wide",label:"Figure 1",pageNumber:1,x:0,y:0,width:684,height:467,caption:"Synthetic scientific figure for compact layout and draggable window verification."},
  {figureKey:"tall",label:"Figure 2",pageNumber:2,x:0,y:0,width:420,height:1000,caption:"Tall figure: the full image should fit at 100%."}
];
p.getPortablePdfFigurePayload = () => ({figures});
p.getPdfFigureCatalog = async () => ({figures,placements:figures,pageSizes:new Map([[1,{width:684,height:467}]])});
p.renderPdfFigure = async (_path, figure, canvas) => {
  canvas.width=figure.width; canvas.height=figure.height;
  const ctx=canvas.getContext("2d"); ctx.fillStyle="white"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle="#333"; ctx.strokeRect(32,32,canvas.width-64,canvas.height-64);
  ctx.fillStyle="#333"; ctx.font="20px sans-serif"; ctx.fillText("Synthetic scientific figure",50,70);
  return {width:figure.width,height:figure.height};
};
const close = () => { win.webContents.sendInputEvent({type:"keyDown",keyCode:"Escape"}); win.webContents.sendInputEvent({type:"keyUp",keyCode:"Escape"}); };
const point = element => { const r=element.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; };
const mouse = (type, pos, button="left") => win.webContents.sendInputEvent({type,...pos,button,clickCount:1});
const click = async element => { const pos=point(element); mouse("mouseDown",pos); mouse("mouseUp",pos); await frame(); };
let result;
try {
  check(!document.querySelector(".paperlib-figure-modal"),"Close previous QA viewer before running");
  await p.openPdfFigureAtPoint("synthetic.pdf",{title:"Synthetic figure viewer QA"},1,.5,.5);
  await frame();
  const modal=document.querySelector(".paperlib-figure-modal"), stage=modal.querySelector(".paperlib-figure-stage"), canvas=modal.querySelector("canvas"), header=modal.querySelector("header");
  check(modal && !canvas.classList.contains("is-loading"),"Viewer renders");
  let r=modal.getBoundingClientRect(), c=canvas.getBoundingClientRect();
  const compact={width:r.width,height:r.height,blankBelow:stage.getBoundingClientRect().bottom-c.bottom};
  check(r.height < 760 && compact.blankBelow < 24,"Window fits the image and bottom caption with compact padding");
  const captionBox=modal.querySelector(".paperlib-figure-sidebar").getBoundingClientRect();
  check(captionBox.top>=stage.getBoundingClientRect().bottom && Math.abs(captionBox.width-stage.getBoundingClientRect().width)<2,"Caption sits below the image at full window width");
  check(canvas.parentElement.scrollWidth <= canvas.parentElement.clientWidth+1,"100% fits without horizontal scroll");
  win.show(); win.focus();
  const resize = async (edge, dx, dy) => {
    const pos = point(modal.querySelector(`.paperlib-figure-resize-handle.is-${edge}`));
    mouse("mouseMove",pos); mouse("mouseDown",pos);
    mouse("mouseMove",{x:pos.x+dx,y:pos.y+dy}); mouse("mouseUp",{x:pos.x+dx,y:pos.y+dy}); await frame();
  };
  check(modal.querySelectorAll(".paperlib-figure-resize-handle").length===8,"All four edges and corners resize");
  for (const edge of ["n","e","s","w","ne","se","sw","nw"]) {
    const before=modal.getBoundingClientRect(), imageBefore=canvas.getBoundingClientRect();
    const dx=edge.includes("e") ? 40 : edge.includes("w") ? -40 : 0;
    const dy=edge.includes("s") ? 40 : edge.includes("n") ? -40 : 0;
    await resize(edge,dx,dy);
    const after=modal.getBoundingClientRect();
    check(Math.abs(after.width-before.width-Math.abs(dx))<2 && Math.abs(after.height-before.height-Math.abs(dy))<2,`${edge} resizes the requested dimensions`);
    check(Math.abs((edge.includes("w") ? after.right-before.right : after.left-before.left))<2,"Horizontal opposite edge stays anchored");
    check(Math.abs((edge.includes("n") ? after.bottom-before.bottom : after.top-before.top))<2,"Vertical opposite edge stays anchored");
    if (edge.length===2) check(canvas.getBoundingClientRect().width>imageBefore.width,"Image enlarges with corner resize");
    check(!modal.classList.contains("is-resizing"),"Release ends resizing");
    await resize(edge,-dx,-dy);
  }
  r=modal.getBoundingClientRect();
  const start={x:Math.round(r.left+80),y:Math.round(r.top+22)}, end={x:start.x+100,y:start.y-70};
  mouse("mouseMove",start); mouse("mouseDown",start); mouse("mouseMove",end); mouse("mouseUp",end); await frame();
  let moved=modal.getBoundingClientRect();
  check(Math.abs(moved.left-r.left-100)<2 && Math.abs(moved.top-r.top+70)<2,"Header drag moves the window");
  check(!modal.classList.contains("is-dragging"),"Release ends dragging");
  const zoom=modal.querySelector(".paperlib-figure-zoom-label");
  await click(modal.querySelector('.paperlib-figure-tool[title="放大"]'));
  check(zoom.textContent==="110%" && modal.getBoundingClientRect().left===moved.left,"Zoom control works without dragging");
  zoom.click(); await frame(); check(zoom.textContent==="100%","Zoom reset works");
  const extreme={x:Math.round(moved.left+80),y:Math.round(moved.top+22)};
  mouse("mouseMove",extreme); mouse("mouseDown",extreme); mouse("mouseMove",{x:2,y:2}); mouse("mouseUp",{x:2,y:2}); await frame();
  r=modal.getBoundingClientRect(); check(r.left>=8 && r.top>=8,"Dragging keeps the header in the viewport");
  await click(modal.querySelector(".is-expand"));
  await wait(()=>document.fullscreenElement===modal); await frame();
  check(modal.getBoundingClientRect().width===innerWidth,"Fullscreen fills the window after dragging");
  check(getComputedStyle(modal.querySelector(".paperlib-figure-resize-handle")).display==="none","Fullscreen hides resize handles");
  await document.exitFullscreen(); await wait(()=>!document.fullscreenElement); await frame();
  check(modal.getBoundingClientRect().height<760,"Exit fullscreen restores compact size");
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})); await frame();
  check(modal.querySelector("h3").textContent==="Figure 2","Arrow key switches figures");
  check(Math.abs(modal.getBoundingClientRect().width-r.width)<2 && Math.abs(modal.getBoundingClientRect().height-r.height)<2,"Figure switch preserves manually chosen window dimensions");
  c=canvas.getBoundingClientRect(); const s=stage.getBoundingClientRect();
  check(c.bottom<=s.bottom && c.width<=s.width,"Tall image fits the stage");
  win.setContentSize(760,900); await frame(); await frame();
  r=modal.getBoundingClientRect(); c=canvas.getBoundingClientRect();
  check(r.right<=innerWidth && r.bottom<=innerHeight,"Narrow viewport keeps moved window visible");
  check(c.bottom<=stage.getBoundingClientRect().bottom,"Narrow viewport keeps image visible");
  check(getComputedStyle(modal.querySelector(".paperlib-figure-body")).gridTemplateColumns.split(" ").length===1,"Narrow layout stacks the caption");
  close(); await frame(); check(!modal.isConnected,"Escape closes the viewer");
  // Drag handlers must be gone after close, including closing during a drag.
  win.setBounds(bounds); await frame();
  await p.openPdfFigureAtPoint("synthetic.pdf",{title:"Synthetic figure viewer QA"},1,.5,.5); await frame();
  const reopened=document.querySelector(".paperlib-figure-modal"), rr=reopened.getBoundingClientRect();
  const pos={x:Math.round(rr.left+80),y:Math.round(rr.top+22)};
  mouse("mouseMove",pos); mouse("mouseDown",pos); await frame();
  check(reopened.classList.contains("is-dragging"),"Reopened viewer can start a new drag");
  close(); await frame(); mouse("mouseUp",pos); mouse("mouseMove",{x:pos.x+40,y:pos.y}); await frame();
  check(!reopened.isConnected && !reopened.classList.contains("is-dragging"),"Closing during a drag cleans up listeners");
  await p.openPdfFigureAtPoint("synthetic.pdf",{title:"Synthetic figure viewer QA"},1,.5,.5); await frame();
  const resizeModal=document.querySelector(".paperlib-figure-modal"), resizeHandle=resizeModal.querySelector(".paperlib-figure-resize-handle.is-se");
  let resizePos;
  await wait(()=>{ resizePos=point(resizeHandle); return document.elementFromPoint(resizePos.x,resizePos.y)===resizeHandle; });
  mouse("mouseMove",resizePos); mouse("mouseDown",resizePos); await frame();
  check(resizeModal.classList.contains("is-resizing"),"New viewer starts resizing");
  close(); await frame(); mouse("mouseUp",resizePos); mouse("mouseMove",{x:resizePos.x+40,y:resizePos.y}); await frame();
  check(!resizeModal.isConnected && !resizeModal.classList.contains("is-resizing"),"Closing during resize cleans up listeners");
  result={compact,dragDelta:[100,-70],checks:["bottom caption","eight resize handles","anchored opposite edge","image enlarges","manual size preserved","zoom","fullscreen restore","tall image","narrow viewport","Escape","close during drag and resize"]};
} finally {
  if(document.fullscreenElement) await document.exitFullscreen();
  close(); win.setBounds(bounds);
  p.renderPdfFigure=originals.render; p.getPdfFigureCatalog=originals.catalog; p.getPortablePdfFigurePayload=originals.payload;
}
return result;
