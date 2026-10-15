import { searchForcedTiles } from '../game/forced.js';
import { availableEdges, boundaryGeometry, makeBoundary, reconcileBoundary, stageTemplate, validateBoundary, validateStage } from '../game/stage.js';
import { chooseDropOrientation, editorCandidates, fitsNeighbors, halfTurn, isSolved, playCandidates, tileWithinBoundary } from '../game/puzzle.js';
import { edgeKey, point, tileCenter, tileEdges, tileVertices } from '../game/geometry.js';
import { COLORS, drawBoundary, drawLandingShadow, drawPlayRegion, drawRhombus, drawSceneSides, drawTray, edgeDistance, pointInPolygon, polygonPath, recessDepth, tilePoints, transform, trayAngle, trayScale } from './board.js';

const $=id=>document.getElementById(id),canvas=$('board'),ctx=canvas.getContext('2d');
const STORAGE='p3nrose_level_editor_v2';
const PROGRESS_STORAGE='p3nrose_play_progress_v1';
const freshStages=()=>Array.from({length:8},(_,i)=>stageTemplate(`stage-${i+1}`));
function validTile(t){return t&&typeof t.id==='string'&&['thin','fat'].includes(t.kind)&&Number.isInteger(t.direction)&&t.direction>=0&&t.direction<10&&Array.isArray(t.anchor)&&t.anchor.length===4&&t.anchor.every(Number.isInteger);}
function validStage(s){return s&&typeof s.id==='string'&&Array.isArray(s.solutionTiles)&&s.solutionTiles.every(validTile)&&Array.isArray(s.boundary)&&Array.isArray(s.fixedTileIds||[]);}
function load(){try{const x=JSON.parse(localStorage.getItem(STORAGE));if(x?.schemaVersion===2&&Array.isArray(x.stages)&&x.stages.length&&x.stages.every(validStage))return x.stages.map(s=>({...s,viewAngle:Number.isFinite(s.viewAngle)?s.viewAngle:18}));}catch{}return freshStages();}
function loadProgress(){
  try{
    const data=JSON.parse(localStorage.getItem(PROGRESS_STORAGE));
    if(data?.schemaVersion!==1||!data.stages||typeof data.stages!=='object')return new Map();
    return new Map(Object.entries(data.stages).filter(([,entry])=>entry&&Array.isArray(entry.tiles)&&entry.tiles.every(validTile)&&typeof entry.cleared==='boolean'));
  }catch{return new Map();}
}
const state={stages:load(),progress:loadProgress(),index:0,mode:'edit',fixedSelect:false,forced:new Map(),playTiles:[],playUndo:[],activeKind:'thin',paletteSelected:false,drag:null,clickDrop:null,clear:null,view:{scale:112,angle:0,pan:{x:0,y:0}},hoverCandidate:null,hoverEdge:null,markHits:[],pointerPan:null,stageDragIndex:null,resetArmedAt:0};
const current=()=>state.stages[state.index],placed=()=>current().solutionTiles,forced=()=>state.forced.get(current().id)||[],allTiles=()=>[...placed(),...forced()];
const status=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
function save(){try{localStorage.setItem(STORAGE,JSON.stringify({schemaVersion:2,stages:state.stages}));}catch{status('ブラウザに保存できません。JSONを書き出してください。');}}
function saveProgress(){try{localStorage.setItem(PROGRESS_STORAGE,JSON.stringify({schemaVersion:1,stages:Object.fromEntries(state.progress)}));}catch{status('進行状況を保存できません。',true);}}
function initialPlayTiles(stage){
  const fixed=stage.solutionTiles.filter(tile=>stage.fixedTileIds.includes(tile.id)).map(tile=>structuredClone(tile));
  const seen=new Set(fixed.map(tile=>tile.id));
  for(const tile of state.progress.get(stage.id)?.tiles||[])if(!seen.has(tile.id)){seen.add(tile.id);fixed.push(structuredClone(tile));}
  return fixed;
}
function saveCurrentProgress(){
  const id=current().id,cleared=state.progress.get(id)?.cleared||false;
  state.progress.set(id,{tiles:snapshotPlay(),cleared});saveProgress();
}
function markCleared(){
  const id=current().id;if(state.progress.get(id)?.cleared)return;
  state.progress.set(id,{tiles:snapshotPlay(),cleared:true});saveProgress();renderStages();
}
function mutate(message){save();render();if(message)status(message);}
function uniqueTileId(){return `tile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;}
const snapshotPlay=()=>structuredClone(state.playTiles);
function samePlayTiles(before,after){
  if(before.length!==after.length)return false;
  const byId=new Map(after.map(tile=>[tile.id,tile]));
  return before.every(tile=>{const other=byId.get(tile.id);return other&&tile.kind===other.kind&&tile.direction===other.direction&&tile.anchor.every((n,i)=>n===other.anchor[i]);});
}
function recordPlayUndo(before){if(state.mode==='play'&&!samePlayTiles(before,state.playTiles)){state.playUndo.push(before);saveCurrentProgress();}}
function undoPlay(){
  if(state.mode!=='play'||state.drag||state.clickDrop||!state.playUndo.length)return;
  cancelClear();state.playTiles=state.playUndo.pop();saveCurrentProgress();render();status('1手戻しました。');
}
function updateUndoButton(){$('undo-play').disabled=state.mode!=='play'||!state.playUndo.length||!!state.drag||!!state.clickDrop;}
function selectPalette(kind){state.activeKind=kind;state.paletteSelected=true;drawTray($('thin-preview'),'thin',kind==='thin');drawTray($('fat-preview'),'fat',kind==='fat');}
const candidateCache=new Map();
function invalidateCandidates(){candidateCache.clear();}
function candidateList(kind){
  const cacheKey=`${state.mode}:${kind}`;
  if(!candidateCache.has(cacheKey))candidateCache.set(cacheKey,state.mode==='play'?playCandidates(current(),state.playTiles,kind):editorCandidates(placed(),forced(),kind));
  return candidateCache.get(cacheKey);
}
function pointer(event){const r=canvas.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
function tileAt(p,list){
  const ordered=orderedTiles(list).reverse();
  const top=ordered.find(tile=>pointInPolygon(p,tilePoints(canvas,state.view,tile)));
  if(top)return top;
  const depth=recessDepth(state.view);
  return ordered.find(tile=>{
    const points=tilePoints(canvas,state.view,tile);
    return points.some((a,i)=>{const b=points[(i+1)%4];return pointInPolygon(p,[a,b,{x:b.x,y:b.y+depth},{x:a.x,y:a.y+depth}]);});
  });
}
function nearestCandidate(kind,p,preferredDirection=null){
  const list=candidateList(kind);
  if(!list.length)return null;
  if(state.mode==='edit'&&!placed().length)return preferredDirection==null?list[0]:{...list[0],direction:preferredDirection};
  let closest=null,closestDistance=Infinity,preferred=null,preferredDistance=Infinity;
  for(const tile of list){
    const c=transform(canvas,state.view,tileCenter(tile)),distance=Math.hypot(c.x-p.x,c.y-p.y);
    if(distance<closestDistance){closest=tile;closestDistance=distance;}
    if(tile.direction===preferredDirection&&distance<preferredDistance){preferred=tile;preferredDistance=distance;}
  }
  if(closestDistance>=state.view.scale*.85)return null;
  return preferredDistance<=closestDistance+state.view.scale*.08?preferred:closest;
}
function hitEdge(p){
  const edges=availableEdges(allTiles());
  const marks=new Set(current().boundary.map(m=>m.id));
  const options=[...edges].map(([id,e])=>{const a=transform(canvas,state.view,point(e.a)),b=transform(canvas,state.view,point(e.b));return{id,edge:e,distance:edgeDistance(p,a,b),selected:marks.has(id)};}).sort((a,b)=>a.distance-b.distance);
  return options[0]?.distance<9?options[0]:null;
}
function hitMark(p){return state.markHits.find(m=>m.samples?.some((sample,i)=>i&&edgeDistance(p,m.samples[i-1],sample)<12));}
function renderStages(){
  const host=$('stage-list');host.replaceChildren();
  state.stages.forEach((stage,i)=>{
    const button=document.createElement('button');button.textContent=String(i+1);button.title=stage.name||`ステージ ${i+1}`;button.className=[state.progress.get(stage.id)?.cleared?'completed':'',i===state.index?'active':''].filter(Boolean).join(' ');button.draggable=state.mode==='edit';
    button.addEventListener('click',()=>selectStage(i));
    button.addEventListener('dragstart',()=>{state.stageDragIndex=i;});
    button.addEventListener('dragover',event=>{if(state.mode==='edit')event.preventDefault();});
    button.addEventListener('drop',event=>{event.preventDefault();const from=state.stageDragIndex;if(from==null||from===i)return;const moved=state.stages.splice(from,1)[0];state.stages.splice(i,0,moved);state.index=i;state.stageDragIndex=null;mutate('ステージの順序を変更しました。');});
    host.append(button);
  });
}
function selectStage(index){
  if(state.drag)cancelDrag();
  cancelClickDrop();cancelClear();
  state.index=index;state.fixedSelect=false;state.playUndo=[];state.paletteSelected=false;state.playTiles=initialPlayTiles(current());
  state.view.angle=(current().viewAngle||0)*Math.PI/180;state.view.pan={x:0,y:0};fitView();render();
  status(`ステージ ${index+1}`);
}
function fitView(){
  const geometry=state.mode==='play'&&validateBoundary(current(),[]).valid?validateBoundary(current(),[]).polygon:[...allTiles().flatMap(t=>tileVertices(t).map(point)),...current().boundary.flatMap(e=>[point(e.a),point(e.b)])];
  if(!geometry.length){state.view.scale=Math.min(canvas.clientWidth,canvas.clientHeight)*.29;state.view.pan={x:0,y:0};return;}
  const angle=state.view.angle,c=Math.cos(angle),s=Math.sin(angle),rot=geometry.map(p=>({x:p.x*c+p.y*s,y:-p.x*s+p.y*c}));
  const xs=rot.map(p=>p.x),ys=rot.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  state.view.scale=Math.min(180,Math.max(28,Math.min((canvas.clientWidth-115)/Math.max(maxX-minX,1),(canvas.clientHeight-95)/Math.max(maxY-minY,1))));
  state.view.pan={x:-(minX+maxX)*state.view.scale/2,y:(minY+maxY)*state.view.scale/2};
}
function canvasSize(){const ratio=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);}
function renderHeldOverlay(){
  const overlay=$('held-tile'),held=overlay.getContext('2d'),ratio=devicePixelRatio||1;
  const width=innerWidth,height=innerHeight;
  if(overlay.width!==Math.round(width*ratio)||overlay.height!==Math.round(height*ratio)){overlay.width=Math.round(width*ratio);overlay.height=Math.round(height*ratio);}
  held.setTransform(ratio,0,0,ratio,0,0);held.clearRect(0,0,width,height);
  const drag=state.drag;if(!drag?.screen)return;
  const fakeCanvas={clientWidth:width,clientHeight:height},fakeView={scale:drag.scale||state.view.scale,angle:drag.displayAngle,pan:{x:0,y:0}};
  const tile={kind:drag.kind,direction:0,anchor:[0,0,0,0]},center=transform(fakeCanvas,fakeView,tileCenter(tile));
  held.save();held.translate(drag.screen.x-center.x,drag.screen.y-center.y+4);drawLandingShadow(held,fakeCanvas,fakeView,tile,.3);held.restore();
  held.save();held.translate(drag.screen.x-center.x,drag.screen.y-(drag.lift||0)-center.y);
  held.globalAlpha=drag.opacity??1;drawRhombus(held,fakeCanvas,fakeView,tile);held.restore();
}
function orderedTiles(tiles){return [...tiles].sort((a,b)=>transform(canvas,state.view,tileCenter(a)).y-transform(canvas,state.view,tileCenter(b)).y);}
function canRotate(tile){
  if(state.mode!=='play'||current().fixedTileIds.includes(tile.id))return false;
  const replacement=halfTurn(tile),remaining=state.playTiles.filter(other=>other.id!==tile.id);
  return tileWithinBoundary(replacement,current().boundary)&&fitsNeighbors(replacement,remaining);
}
function renderRotationControls(){
  const host=$('rotation-controls');host.replaceChildren();
  if(state.mode!=='play'||state.drag||state.clickDrop||state.clear)return;
  for(const tile of state.playTiles){
    if(!canRotate(tile))continue;
    const c=transform(canvas,state.view,tileCenter(tile)),button=document.createElement('button');
    button.type='button';button.title='180°回転';button.setAttribute('aria-label',`${tile.kind.toUpperCase()} タイルを180度回転`);
    button.style.left=`${c.x}px`;button.style.top=`${c.y}px`;
    button.onclick=()=>{
      if(button.classList.contains('pressed'))return;
      button.classList.add('pressed');
      setTimeout(()=>{
        const live=state.playTiles.find(other=>other.id===tile.id);
        if(!live||!canRotate(live))return;
        const before=snapshotPlay();
        state.playTiles=state.playTiles.map(other=>other.id===tile.id?halfTurn(live):other);
        recordPlayUndo(before);
        renderBoard();const solved=isSolved(current(),state.playTiles);status(solved?'クリア！':'180°回転しました。');if(solved)startClear();
      },100);
    };
    host.append(button);
  }
}
let clickFrame=null,clearFrame=null;
function cancelClickDrop(){cancelAnimationFrame(clickFrame);clickFrame=null;state.clickDrop=null;}
function cancelClear(){cancelAnimationFrame(clearFrame);clearFrame=null;state.clear=null;}
function startClear(){
  cancelClear();
  markCleared();
  const diagonal=p=>p.x+p.y;
  const tiles=[...state.playTiles].sort((a,b)=>diagonal(transform(canvas,state.view,tileCenter(a)))-diagonal(transform(canvas,state.view,tileCenter(b))));
  const starts=new Map(tiles.map((tile,i)=>[tile.id,i*420/Math.max(1,tiles.length-1)]));
  const outer=new Set(current().boundary.map(edge=>edge.id)),unique=new Map();
  for(const tile of tiles)for(const edge of tileEdges(tile)){
    const id=edgeKey(edge.a,edge.b);
    if(!unique.has(id))unique.set(id,{...edge,id,outer:outer.has(id)});
  }
  const edges=[...unique.values()].sort((a,b)=>{
    const midpoint=edge=>{const p=transform(canvas,state.view,point(edge.a)),q=transform(canvas,state.view,point(edge.b));return(p.x+p.y+q.x+q.y)/2;};
    return midpoint(a)-midpoint(b);
  }).map((edge,i)=>({...edge,start:i*690/Math.max(1,unique.size-1)}));
  const fadeStart=reducedMotion.matches?1000:1790,fadeDuration=reducedMotion.matches?0:180;
  const clear={started:performance.now(),elapsed:0,starts,edges,tileById:new Map(tiles.map(tile=>[tile.id,tile])),fadeStart,fadeDuration,duration:fadeStart+fadeDuration};
  state.clear=clear;
  renderBoard();
  const tick=now=>{
    if(state.clear!==clear)return;
    clear.elapsed=now-clear.started;
    if(clear.elapsed>=clear.duration){state.clear=null;clearFrame=null;renderBoard();return;}
    renderBoard();clearFrame=requestAnimationFrame(tick);
  };
  clearFrame=requestAnimationFrame(tick);
}
function clearLift(tile){
  if(!state.clear||reducedMotion.matches)return 0;
  const progress=(state.clear.elapsed-state.clear.starts.get(tile.id))/300;
  return progress>0&&progress<1?Math.sin(Math.PI*progress)*Math.min(14,state.view.scale*.12):0;
}
function drawClearEdges(){
  const clear=state.clear;if(!clear)return;
  const fadeProgress=clear.fadeDuration?Math.max(0,Math.min(1,(clear.elapsed-clear.fadeStart)/clear.fadeDuration)):0;
  const fade=1-fadeProgress*fadeProgress*(3-2*fadeProgress);
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  for(const edge of clear.edges){
    const progress=reducedMotion.matches?1:Math.max(0,Math.min(1,(clear.elapsed-edge.start)/95));
    if(!progress)continue;
    const a=transform(canvas,state.view,point(edge.a)),b=transform(canvas,state.view,point(edge.b));
    const lift=clearLift(clear.tileById.get(edge.tileId));
    ctx.globalAlpha=progress*fade;ctx.strokeStyle='#8ea800';ctx.lineWidth=edge.outer?Math.max(9,state.view.scale*.095):Math.max(3,state.view.scale*.035);
    ctx.beginPath();ctx.moveTo(a.x,a.y-lift);ctx.lineTo(b.x,b.y-lift);ctx.stroke();
  }
  ctx.restore();
}
function renderBoard(){
  updateUndoButton();
  canvasSize();const view=state.view,stage=current(),boundary=boundaryGeometry(stage,allTiles());
  if(state.mode==='play'){
    const check=validateBoundary(stage,[]);if(check.valid)drawPlayRegion(ctx,canvas,view,check.polygon,{floorOnly:true});
    ctx.save();if(check.valid){polygonPath(ctx,check.polygon.map(p=>transform(canvas,view,p)));ctx.clip();}
    const ordered=orderedTiles(state.playTiles),resting=ordered.filter(tile=>!clearLift(tile));
    drawSceneSides(ctx,canvas,view,resting,{boundaryPolygon:check.valid?check.polygon:[],fixedTileIds:stage.fixedTileIds});
    resting.forEach(tile=>drawRhombus(ctx,canvas,view,tile,{layer:'top',recessedFixed:stage.fixedTileIds.includes(tile.id)}));
    for(const tile of ordered){const lift=clearLift(tile);if(!lift)continue;ctx.save();ctx.translate(0,-lift);drawRhombus(ctx,canvas,view,tile,{recessedFixed:stage.fixedTileIds.includes(tile.id)});ctx.restore();}
    ctx.restore();
    state.markHits=drawBoundary(ctx,canvas,view,boundary,{play:true,boundaryCheck:check});
    drawClearEdges();
  }else{
    forced().forEach(tile=>drawRhombus(ctx,canvas,view,tile,{forced:true}));
    const ordered=orderedTiles(placed());
    drawSceneSides(ctx,canvas,view,placed());
    ordered.forEach(tile=>drawRhombus(ctx,canvas,view,tile,{layer:'top',fixed:stage.fixedTileIds.includes(tile.id)}));
    state.markHits=drawBoundary(ctx,canvas,view,boundary,{boundaryCheck:validateBoundary(stage,[])});
    if(state.hoverEdge&&!stage.boundary.some(m=>m.id===state.hoverEdge.id)){
      const a=transform(canvas,view,point(state.hoverEdge.edge.a)),b=transform(canvas,view,point(state.hoverEdge.edge.b));
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=COLORS.outline;ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  if(state.drag?.target){drawLandingShadow(ctx,canvas,view,state.drag.target);drawRhombus(ctx,canvas,view,state.drag.target,{ghost:true,highlight:true});}
  if(state.clickDrop){
    const {tile,progress}=state.clickDrop,fall=1-(1-progress)**3,offset=(1-fall)*Math.max(70,view.scale*.65);
    drawLandingShadow(ctx,canvas,view,tile,.28*(1-fall));
    ctx.save();ctx.translate(0,-offset);drawRhombus(ctx,canvas,view,tile);ctx.restore();
  }
  renderRotationControls();
  renderHeldOverlay();
}
function render(){
  invalidateCandidates();
  $('app').dataset.mode=state.mode;$('fixed-select').classList.toggle('active',state.fixedSelect);
  $('stage-heading').textContent=state.mode==='play'?'STAGE':'ステージ選択';
  renderStages();drawTray($('thin-preview'),'thin',state.paletteSelected&&state.activeKind==='thin');drawTray($('fat-preview'),'fat',state.paletteSelected&&state.activeKind==='fat');renderBoard();
}
function commitClickPlacement(entry){
  if(state.mode==='play'){
    const before=snapshotPlay();state.playTiles.push(entry);recordPlayUndo(before);render();
    const solved=isSolved(current(),state.playTiles);
    status(solved?'クリア！':'タイルを配置しました。');if(solved)startClear();
  }else{placed().push(entry);state.forced.delete(current().id);reconcileBoundary(current(),placed());mutate('タイルを配置しました。確定配置は再探索してください。');}
}
function startClickDrop(entry){
  cancelClickDrop();
  if(reducedMotion.matches){commitClickPlacement(entry);return;}
  const drop={tile:entry,progress:0,started:performance.now()};state.clickDrop=drop;
  const tick=now=>{
    if(state.clickDrop!==drop)return;
    drop.progress=Math.min(1,(now-drop.started)/210);renderBoard();
    if(drop.progress<1)clickFrame=requestAnimationFrame(tick);
    else{state.clickDrop=null;clickFrame=null;commitClickPlacement(entry);}
  };
  clickFrame=requestAnimationFrame(tick);
}
function removeTile(tile){
  current().solutionTiles=placed().filter(t=>t.id!==tile.id);current().fixedTileIds=current().fixedTileIds.filter(id=>id!==tile.id);
  state.forced.delete(current().id);reconcileBoundary(current(),placed());mutate('タイルを削除しました。確定配置は再探索してください。');
}
function place(kind,p,direction=null){
  let tile=nearestCandidate(kind,p);
  if(!tile){status('配置できる位置にドロップしてください。');return;}
  selectPalette(kind);
  if(state.mode==='edit'&&!placed().length&&direction!=null)tile={...tile,direction};
  else if(direction!=null){const options=candidateList(kind).filter(t=>Math.hypot(transform(canvas,state.view,tileCenter(t)).x-p.x,transform(canvas,state.view,tileCenter(t)).y-p.y)<state.view.scale*.85);tile=options.find(t=>t.direction===direction)||tile;}
  if(state.mode==='edit'&&!placed().length){const c=transform(canvas,state.view,tileCenter(tile));state.view.pan.x+=p.x-c.x;state.view.pan.y+=p.y-c.y;}
  if(state.mode==='play')tile=chooseDropOrientation(tile,current().boundary,state.playTiles);
  const entry={...tile,id:uniqueTileId()};
  startClickDrop(entry);
}
function toggleEdge(hit){
  const stage=current();if(stage.boundary.some(m=>m.id===hit.id))return;
  stage.boundary.push({id:hit.id,a:hit.edge.a,b:hit.edge.b,symbol:hit.edge.symbol,mode:'hidden',sourceId:hit.edge.tileId});mutate('外周辺を追加しました。');
}
function cycleMark(hit){const mark=current().boundary.find(m=>m.id===hit.id);if(!mark)return;mark.mode=mark.mode==='hidden'?'colored':mark.mode==='colored'?'neutral':'hidden';mutate(`外周記号: ${mark.mode==='hidden'?'非表示':mark.mode==='colored'?'色付き':'色なし'}`);}
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let motionFrame=null;
function cancelDrag(){
  cancelAnimationFrame(motionFrame);motionFrame=null;
  state.drag?.sourceElement?.classList.remove('dragging');
  if(state.drag?.sourceTile&&!state.playTiles.some(t=>t.id===state.drag.sourceTile.id))state.playTiles.push(state.drag.sourceTile);
  state.drag=null;invalidateCandidates();renderBoard();
}
function respawnTray(element){
  if(!element)return;
  element.classList.remove('dragging','respawning');
  void element.offsetWidth;
  element.classList.add('respawning');
}
function beginDrag(event,{kind,direction,sourceTile=null,sourceElement=null,origin,scale,displayAngle=state.view.angle-direction*Math.PI/5}){
  if(state.drag||state.clickDrop||state.clear||event.button!==0)return;
  event.preventDefault();
  const drag={kind,direction,displayAngle,sourceTile,sourceElement,undoBefore:state.mode==='play'?snapshotPlay():null,origin,screen:{...origin},scale,originScale:scale,startX:event.clientX,startY:event.clientY,pointerId:event.pointerId,started:performance.now(),lift:0,moved:false,userRotated:false,target:null,settling:false};
  sourceElement?.classList.remove('respawning');
  sourceElement?.classList.add('dragging');
  if(sourceTile){state.playTiles=state.playTiles.filter(t=>t.id!==sourceTile.id);invalidateCandidates();}
  state.drag=drag;renderBoard();
  const lift=now=>{if(state.drag!==drag||drag.settling)return;drag.lift=10*(reducedMotion.matches?1:Math.min(1,(now-drag.started)/100));renderHeldOverlay();if(drag.lift<10)motionFrame=requestAnimationFrame(lift);};
  motionFrame=requestAnimationFrame(lift);
}
function updateDrag(event){
  const drag=state.drag;if(!drag||drag.settling||event.pointerId!==drag.pointerId)return;
  drag.screen={x:drag.origin.x+event.clientX-drag.startX,y:drag.origin.y+event.clientY-drag.startY};
  drag.moved ||= Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>3;
  const rect=canvas.getBoundingClientRect(),overBoard=event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;
  drag.pointer={x:drag.screen.x-rect.left,y:drag.screen.y-rect.top};
  drag.target=overBoard?nearestCandidate(drag.kind,drag.pointer,drag.direction):null;
  renderBoard();
}
function finishDrag(drag,target){
  if(state.drag!==drag)return;
  cancelAnimationFrame(motionFrame);motionFrame=null;state.drag=null;
  let solved=false;
  if(target){
    const entry={...target,id:drag.sourceTile?.id||uniqueTileId()};
    if(state.mode==='play'){state.playTiles.push(entry);solved=isSolved(current(),state.playTiles);status(solved?'クリア！':'タイルを配置しました。');}
    else{if(!placed().length){const rect=canvas.getBoundingClientRect(),c=transform(canvas,state.view,tileCenter(target));state.view.pan.x+=drag.screen.x-rect.left-c.x;state.view.pan.y+=drag.screen.y-rect.top-c.y;}placed().push(entry);state.forced.delete(current().id);reconcileBoundary(current(),placed());save();status('タイルを配置しました。');}
  }else if(drag.sourceTile)status('タイルを盤面から戻しました。');
  if(drag.undoBefore)recordPlayUndo(drag.undoBefore);
  render();
  if(target)respawnTray(drag.sourceElement);
  else drag.sourceElement?.classList.remove('dragging');
  if(solved)startClear();
}
function releaseDrag(event){
  const drag=state.drag;if(!drag||drag.settling||event.pointerId!==drag.pointerId||event.button!==0)return;
  updateDrag(event);
  let target=drag.sourceTile&&!drag.moved?drag.sourceTile:drag.target;
  if(target&&drag.moved&&!drag.userRotated&&state.mode==='play')target=chooseDropOrientation(target,current().boundary,state.playTiles);
  cancelAnimationFrame(motionFrame);drag.settling=true;
  const rect=canvas.getBoundingClientRect(),destination=target?(state.mode==='edit'&&!placed().length?{...drag.screen}:{x:rect.left+transform(canvas,state.view,tileCenter(target)).x,y:rect.top+transform(canvas,state.view,tileCenter(target)).y}):drag.sourceTile?{...drag.screen}:drag.origin;
  const start={...drag.screen},startScale=drag.scale,startLift=drag.lift,startTime=performance.now(),duration=reducedMotion.matches?0:100;
  const targetScale=target?state.view.scale:drag.originScale;
  const startAngle=drag.displayAngle,targetAngle=target?state.view.angle-target.direction*Math.PI/5:startAngle;
  const delta=Math.atan2(Math.sin(targetAngle-startAngle),Math.cos(targetAngle-startAngle));
  const tick=now=>{
    if(state.drag!==drag)return;
    const t=duration?Math.min(1,(now-startTime)/duration):1;
    const landing=delta?t*t*(3-2*t):1-(1-t)**3;
    const turnTime=Math.min(1,t/0.7),turn=turnTime*turnTime*(3-2*turnTime);
    drag.screen={x:start.x+(destination.x-start.x)*landing,y:start.y+(destination.y-start.y)*landing};
    drag.scale=startScale+(targetScale-startScale)*landing;drag.lift=startLift*(1-landing);drag.displayAngle=startAngle+delta*turn;
    if(!target&&drag.sourceTile)drag.opacity=1-landing;
    renderBoard();
    if(t<1)motionFrame=requestAnimationFrame(tick);else finishDrag(drag,target);
  };
  motionFrame=requestAnimationFrame(tick);
}
canvas.addEventListener('contextmenu',event=>{event.preventDefault();if(state.drag||state.clickDrop||state.clear)return;const p=pointer(event);if(state.mode==='edit'){
  const selected=current().boundary.find(m=>{const a=transform(canvas,state.view,point(m.a)),b=transform(canvas,state.view,point(m.b));return edgeDistance(p,a,b)<9;});
  if(selected){current().boundary=current().boundary.filter(m=>m.id!==selected.id);mutate('外周辺を削除しました。');return;}
  const tile=tileAt(p,placed());if(tile)removeTile(tile);
}else{const tile=tileAt(p,state.playTiles);if(tile&&!current().fixedTileIds.includes(tile.id)){const before=snapshotPlay();state.playTiles=state.playTiles.filter(t=>t.id!==tile.id);recordPlayUndo(before);render();status('タイルを削除しました。');}}});
canvas.addEventListener('pointerdown',event=>{if(state.drag||state.clickDrop||state.clear||event.button!==0)return;const p=pointer(event),tile=state.mode==='play'?tileAt(p,state.playTiles):null;canvas.setPointerCapture(event.pointerId);if(tile&&!current().fixedTileIds.includes(tile.id)){const center=transform(canvas,state.view,tileCenter(tile)),rect=canvas.getBoundingClientRect();beginDrag(event,{kind:tile.kind,direction:tile.direction,sourceTile:tile,origin:{x:rect.left+center.x,y:rect.top+center.y},scale:state.view.scale});return;}state.pointerPan={start:p,last:p,moved:false};});
canvas.addEventListener('pointermove',event=>{const p=pointer(event);if(state.drag){updateDrag(event);return;}if(state.pointerPan&&event.buttons){const pan=state.pointerPan,dx=p.x-pan.last.x,dy=p.y-pan.last.y;if(Math.hypot(p.x-pan.start.x,p.y-pan.start.y)>5)pan.moved=true;if(pan.moved){state.view.pan.x+=dx;state.view.pan.y+=dy;pan.last=p;renderBoard();}return;}state.hoverEdge=state.mode==='edit'?hitEdge(p):null;renderBoard();});
canvas.addEventListener('pointerup',event=>{if(state.drag){releaseDrag(event);return;}if(state.clickDrop||state.clear||event.button!==0)return;const p=pointer(event),pan=state.pointerPan;state.pointerPan=null;if(pan?.moved)return;
  if(state.mode==='edit'){
    const mark=hitMark(p);if(mark){cycleMark(mark);return;}
    const tile=tileAt(p,placed());if(state.fixedSelect&&tile){const list=current().fixedTileIds;current().fixedTileIds=list.includes(tile.id)?list.filter(id=>id!==tile.id):[...list,tile.id];mutate('初期表示タイルを変更しました。');return;}
    const edge=hitEdge(p);if(edge){toggleEdge(edge);return;}
    if(tile)return;
  }
  if(state.mode==='play'&&tileAt(p,state.playTiles))return;
  if(state.activeKind)place(state.activeKind,p);
});
canvas.addEventListener('wheel',event=>{event.preventDefault();state.view.scale=Math.max(24,Math.min(280,state.view.scale*(event.deltaY<0?1.1:.9)));renderBoard();},{passive:false});
for(const kind of ['thin','fat']){
  const tray=$(`${kind}-tray`);tray.addEventListener('pointerdown',event=>{if(event.button!==0)return;state.activeKind=kind;state.paletteSelected=false;drawTray($('thin-preview'),'thin');drawTray($('fat-preview'),'fat');const preview=$(`${kind}-preview`),rect=preview.getBoundingClientRect();tray.setPointerCapture(event.pointerId);beginDrag(event,{kind,direction:kind==='thin'?0:2,displayAngle:trayAngle(kind),sourceElement:tray,origin:{x:rect.left+rect.width/2,y:rect.top+rect.height/2},scale:trayScale(preview)});});
  tray.addEventListener('pointermove',event=>{if(state.drag?.kind===kind)updateDrag(event);});
  tray.addEventListener('pointerup',event=>{if(state.drag?.kind===kind)releaseDrag(event);});
}
document.addEventListener('contextmenu',event=>{if(state.drag&&!state.drag.settling){event.preventDefault();state.drag.direction=(state.drag.direction+5)%10;state.drag.displayAngle+=Math.PI;state.drag.userRotated=true;if(state.drag.pointer&&state.drag.target)state.drag.target=nearestCandidate(state.drag.kind,state.drag.pointer,state.drag.direction);renderBoard();}});
window.addEventListener('pointercancel',event=>{if(state.drag?.pointerId===event.pointerId)cancelDrag();});
window.addEventListener('blur',()=>{if(state.drag)cancelDrag();});
$('stage-add').onclick=()=>{cancelClickDrop();cancelClear();const id=`stage-${Date.now().toString(36)}`;state.stages.push(stageTemplate(id));state.index=state.stages.length-1;state.view.pan={x:0,y:0};mutate('ステージを追加しました。');};
$('stage-delete').onclick=()=>{if(state.stages.length===1){status('最後のステージは削除できません。');return;}if(!confirm(`ステージ ${state.index+1} を削除しますか？`))return;cancelClickDrop();cancelClear();state.forced.delete(current().id);state.progress.delete(current().id);saveProgress();state.stages.splice(state.index,1);state.index=Math.min(state.index,state.stages.length-1);mutate('ステージを削除しました。');};
$('search-forced').onclick=()=>{if(!placed().length){status('最初のタイルを置いてください。');return;}status('確定配置を探索しています…');requestAnimationFrame(()=>{try{const result=searchForcedTiles(placed());state.forced.set(current().id,result.tiles);reconcileBoundary(current(),allTiles());render();status(`確定配置 ${result.tiles.length}枚${result.unmatched?`（変換できなかった配置 ${result.unmatched}枚）`:''}`);}catch(error){status(`探索に失敗しました: ${error.message}`);}});};
$('auto-boundary').onclick=()=>{if(!allTiles().length){status('タイルを配置してください。');return;}makeBoundary(current(),allTiles());mutate(`外周辺 ${current().boundary.length}本を作成しました。`);};
$('shuffle-marks').onclick=()=>{if(!current().boundary.length){status('外周を作成してください。');return;}for(const mark of current().boundary){const r=Math.random();mark.mode=r<.45?'colored':r<.72?'neutral':'hidden';}mutate('外周記号の表示をシャッフルしました。');};
$('fixed-select').onclick=()=>{state.fixedSelect=!state.fixedSelect;render();status(state.fixedSelect?'初期表示するタイルをクリックしてください。':'初期表示タイル選択を終了しました。');};
$('rotate-board').onclick=()=>{const degrees=Number($('rotation-angle').value);current().viewAngle=((current().viewAngle||0)+degrees)%360;state.view.angle=current().viewAngle*Math.PI/180;mutate(`盤面を${degrees}°回転しました。`);};
$('reset-board').onclick=()=>{
  if(Date.now()-state.resetArmedAt>5000){state.resetArmedAt=Date.now();$('reset-board').textContent='もう一度押してリセット';status('5秒以内にもう一度押すと、タイルと外周を削除します。');return;}
  if(state.drag)cancelDrag();cancelClickDrop();cancelClear();state.resetArmedAt=0;$('reset-board').textContent='全体リセット';current().solutionTiles=[];current().fixedTileIds=[];current().boundary=[];state.forced.delete(current().id);fitView();mutate('盤面をリセットしました。');
};
$('test-play').onclick=()=>{const check=validateStage(current());if(!check.valid){status(`テストプレイできません: ${check.message}`,true);return;}cancelClickDrop();cancelClear();state.mode='play';state.playUndo=[];state.paletteSelected=false;state.playTiles=initialPlayTiles(current());state.fixedSelect=false;fitView();render();status('外周内をタイルで埋めてください。');};
$('back-to-editor').onclick=()=>{if(state.drag)cancelDrag();cancelClickDrop();cancelClear();state.mode='edit';state.playUndo=[];state.paletteSelected=false;state.playTiles=[];fitView();render();status('レベルエディタに戻りました。');};
$('reset-play').onclick=()=>{if(state.drag)cancelDrag();cancelClickDrop();cancelClear();const before=snapshotPlay();state.playTiles=placed().filter(t=>current().fixedTileIds.includes(t.id)).map(t=>structuredClone(t));recordPlayUndo(before);render();status('タイルをすべてリセットしました。');};
$('undo-play').onclick=undoPlay;
$('reset-stage-progress').onclick=()=>{if(!confirm(`ステージ ${state.index+1} の配置とクリア記録を初期化しますか？`))return;state.progress.delete(current().id);saveProgress();state.playUndo=[];state.playTiles=initialPlayTiles(current());render();status(`ステージ ${state.index+1} の記録を初期化しました。`);};
$('reset-all-progress').onclick=()=>{if(!confirm('全ステージの配置とクリア記録を初期化しますか？'))return;state.progress.clear();saveProgress();state.playUndo=[];state.playTiles=initialPlayTiles(current());render();status('全ステージの記録を初期化しました。');};
$('show-all').onclick=()=>{fitView();renderBoard();};
function exportJson(){const data={schemaVersion:2,stages:state.stages.map((stage,i)=>({id:stage.id,name:stage.name||`ステージ ${i+1}`,revision:stage.revision||1,order:i+1,solutionTiles:stage.solutionTiles,fixedTileIds:stage.fixedTileIds,boundary:stage.boundary,viewAngle:stage.viewAngle||0}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='p3nrose-stages.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('JSONを書き出しました。確定配置は含まれません。');}
$('json-export').onclick=exportJson;$('json-import').onclick=()=>$('json-file').click();
$('json-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());if(data.schemaVersion!==2||!Array.isArray(data.stages)||!data.stages.length||!data.stages.every(validStage)||new Set(data.stages.map(s=>s.id)).size!==data.stages.length)throw new Error('形式またはステージIDが不正です。');if(!confirm('現在の下書きをJSONの内容で置き換えますか？'))return;cancelClickDrop();cancelClear();state.stages=data.stages;state.index=0;state.forced.clear();state.mode='edit';state.playUndo=[];state.paletteSelected=false;state.view.angle=(current().viewAngle||0)*Math.PI/180;fitView();mutate('JSONを読み込みました。');}catch(error){status(`読込み失敗: ${error.message}`);}finally{event.target.value='';}});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.drag){cancelDrag();return;}
  if(event.key==='Escape'&&state.mode==='play'){$('back-to-editor').click();return;}
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.repeat){
    const key=event.key.toLowerCase();
    if(key==='z'&&state.mode==='play'){event.preventDefault();undoPlay();return;}
    if(key==='x'&&!state.drag){event.preventDefault();selectPalette(state.paletteSelected?(state.activeKind==='thin'?'fat':'thin'):state.activeKind);return;}
  }
  if(state.drag&&!state.drag.settling&&event.key.toLowerCase()==='r'){state.drag.direction=(state.drag.direction+5)%10;state.drag.displayAngle+=Math.PI;state.drag.userRotated=true;if(state.drag.pointer&&state.drag.target)state.drag.target=nearestCandidate(state.drag.kind,state.drag.pointer,state.drag.direction);renderBoard();}
});
new ResizeObserver(()=>{fitView();render();}).observe(canvas);
state.view.angle=(current().viewAngle||0)*Math.PI/180;render();status('THIN / FAT をドラッグして最初のタイルを配置してください。');
