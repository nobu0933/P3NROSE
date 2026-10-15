import { key, point, tileVertices, vertexNames } from '../game/geometry.js';

export const COLORS = { background: '#294845', outline: '#d4a81d', cream: '#e7cbb8', wall: '#785748', thin: '#3d3430', fat: '#faf9f4', sideThin: '#092e2d', sideFat: '#2aa094', red: '#f39fa4', blue: '#aaa8f8', ghost: '#a9b3a9' };
export const recessDepth = view => Math.max(6,Math.min(28,view.scale*.16));
export const matchingLineWidth = view => Math.max(2,Math.min(8,view.scale*.035));
const signedArea = points => points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
const insetPoints = (points,factor=.985) => {const center=points.reduce((sum,p)=>({x:sum.x+p.x/points.length,y:sum.y+p.y/points.length}),{x:0,y:0});return points.map(p=>({x:center.x+(p.x-center.x)*factor,y:center.y+(p.y-center.y)*factor}));};
export function transform(canvas, view, p) {
  const x = p.x * view.scale, y = -p.y * view.scale;
  const c = Math.cos(view.angle), s = Math.sin(view.angle);
  return { x: canvas.clientWidth / 2 + view.pan.x + x*c - y*s, y: canvas.clientHeight / 2 + view.pan.y + x*s + y*c };
}
export function tilePoints(canvas, view, tile) { return tileVertices(tile).map(v => transform(canvas, view, point(v))); }
export function polygonPath(ctx, points) { ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath(); }
function roundedCorners(points,side){
  const inset=insetPoints(points);
  const cut=side*.075;
  return inset.map((p,i)=>{
    const prev=inset[(i+inset.length-1)%inset.length],next=inset[(i+1)%inset.length];
    const toward=q=>{const length=Math.hypot(q.x-p.x,q.y-p.y);return{x:p.x+(q.x-p.x)*cut/length,y:p.y+(q.y-p.y)*cut/length};};
    return{corner:p,start:toward(prev),end:toward(next)};
  });
}
export function roundedPolygonPath(ctx, points, side) {
  const corners=roundedCorners(points,side);
  ctx.beginPath();ctx.moveTo(corners[0].start.x,corners[0].start.y);
  for(let i=0;i<corners.length;i++){const item=corners[i],next=corners[(i+1)%corners.length];ctx.quadraticCurveTo(item.corner.x,item.corner.y,item.end.x,item.end.y);ctx.lineTo(next.start.x,next.start.y);}ctx.closePath();
}
const lerpPoint=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function splitCurve(a,c,b,t){
  const ac=lerpPoint(a,c,t),cb=lerpPoint(c,b,t),p=lerpPoint(ac,cb,t);
  return [{a,c:ac,b:p},{a:p,c:cb,b}];
}
export function tileSideFaces(points,side,color){
  const corners=roundedCorners(points,side),winding=Math.sign(signedArea(points)),faces=[];
  const add=face=>{if((face.a.x-face.b.x)*winding>1e-8)faces.push({...face,color});};
  for(let i=0;i<corners.length;i++){
    const {start:a,corner:c,end:b}=corners[i],denominator=a.x-2*c.x+b.x;
    const t=Math.abs(denominator)>1e-12?(a.x-c.x)/denominator:-1;
    // Split at the actual vertical tangent, not halfway around each corner.
    (t>0&&t<1?splitCurve(a,c,b,t):[{a,c,b}]).forEach(add);
    add({a:b,b:corners[(i+1)%corners.length].start});
  }
  return faces;
}
function wallFaces(points){
  const winding=Math.sign(signedArea(points));
  return points.flatMap((a,i)=>{const b=points[(i+1)%points.length];return (b.x-a.x)*winding>1e-8?[{a,b,color:COLORS.wall,group:'wall'}]:[];});
}
function faceY(face,x){
  if(!face.c)return face.a.y+(face.b.y-face.a.y)*(x-face.a.x)/(face.b.x-face.a.x);
  let lo=0,hi=1;
  for(let i=0;i<35;i++){const t=(lo+hi)/2,p=lerpPoint(lerpPoint(face.a,face.c,t),lerpPoint(face.c,face.b,t),t);if((p.x<x)===(face.a.x<face.b.x))lo=t;else hi=t;}
  const t=(lo+hi)/2;return lerpPoint(lerpPoint(face.a,face.c,t),lerpPoint(face.c,face.b,t),t).y;
}
export function sortSideFaces(faces){
  const next=faces.map(()=>[]),incoming=faces.map(()=>0);
  for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j],left=Math.max(Math.min(a.a.x,a.b.x),Math.min(b.a.x,b.b.x)),right=Math.min(Math.max(a.a.x,a.b.x),Math.max(b.a.x,b.b.x));
    if(right-left<1e-7)continue;
    const delta=faceY(a,(left+right)/2)-faceY(b,(left+right)/2);
    if(Math.abs(delta)<1e-7)continue;
    const before=delta<0?i:j,after=delta<0?j:i;next[before].push(after);incoming[after]++;
  }
  const ready=incoming.flatMap((n,i)=>n===0?[i]:[]),result=[],seen=new Set();
  while(ready.length){const i=ready.pop();seen.add(i);result.push(faces[i]);for(const j of next[i])if(--incoming[j]===0)ready.push(j);}
  return result.concat(faces.filter((_,i)=>!seen.has(i)));
}
function drawSideFaces(ctx,faces,depth){
  let activeColor,activeGroup,hasPath=false;
  const flush=()=>{if(hasPath){ctx.fillStyle=activeColor;ctx.fill();hasPath=false;}};
  for(const {a,b,c,color,group} of sortSideFaces(faces)){
    if(!hasPath||color!==activeColor||group!==activeGroup){flush();ctx.beginPath();activeColor=color;activeGroup=group;hasPath=true;}
    ctx.moveTo(a.x,a.y);
    if(c)ctx.quadraticCurveTo(c.x,c.y,b.x,b.y);else ctx.lineTo(b.x,b.y);
    ctx.lineTo(b.x,b.y+depth);
    if(c)ctx.quadraticCurveTo(c.x,c.y+depth,a.x,a.y+depth);else ctx.lineTo(a.x,a.y+depth);
    ctx.closePath();
  }
  flush();
}
export function drawSceneSides(ctx,canvas,view,tiles,{boundaryPolygon=[],fixedTileIds=[]}={}){
  const faces=wallFaces(boundaryPolygon.map(p=>transform(canvas,view,p)));
  for(const tile of tiles){const points=tilePoints(canvas,view,tile);faces.push(...tileSideFaces(points,view.scale,fixedTileIds.includes(tile.id)?COLORS.wall:tile.kind==='thin'?COLORS.sideThin:COLORS.sideFat).map(face=>({...face,group:tile.id})));}
  drawSideFaces(ctx,faces,recessDepth(view));
}
const norm = angle => (angle % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
function drawArc(ctx, center, prev, next, radius, color, width = 4, dashed = false) {
  const a = Math.atan2(prev.y-center.y,prev.x-center.x), b = Math.atan2(next.y-center.y,next.x-center.x);
  const delta = norm(b-a);
  const ccw = delta > Math.PI;
  ctx.beginPath(); ctx.arc(center.x,center.y,radius,a,b,ccw); ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.setLineDash(dashed ? [4,5] : []); ctx.stroke(); ctx.setLineDash([]);
}
export function drawRhombus(ctx, canvas, view, tile, { ghost=false, fixed=false, forced=false, recessedFixed=false, layer='both' }={}) {
  const points = tilePoints(canvas,view,tile), side = Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
  if (forced) {
    if(layer==='side')return;
    roundedPolygonPath(ctx,points,side); ctx.strokeStyle='#69b4a8';ctx.lineWidth=1.25;ctx.stroke();
  } else {
    const sideColor=recessedFixed?COLORS.wall:tile.kind==='thin'?COLORS.sideThin:COLORS.sideFat;
    if(!ghost&&layer!=='top'){
      drawSideFaces(ctx,tileSideFaces(points,side,sideColor),recessDepth(view));
    }
    if(layer==='side')return;
    roundedPolygonPath(ctx,points,side);ctx.fillStyle=ghost?'#d8e1d54d':recessedFixed?COLORS.background:tile.kind==='thin'?COLORS.thin:COLORS.fat;ctx.fill();
    if(!ghost){ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1;ctx.lineJoin='round';ctx.stroke();}
  }
  const names=vertexNames(tile.kind);
  ctx.save();polygonPath(ctx,points);ctx.clip();
  for(const [name,color,fraction] of [[tile.kind==='thin'?'A':'E',COLORS.blue,.25],[tile.kind==='thin'?'C':'G',COLORS.red,tile.kind==='thin'?.25:.75]]){
    const i=names.indexOf(name);
    drawArc(ctx,points[i],points[(i+3)%4],points[(i+1)%4],side*fraction,color,matchingLineWidth(view));
  }
  ctx.restore();
  if(fixed&&!recessedFixed){const c=points.reduce((a,p)=>({x:a.x+p.x/4,y:a.y+p.y/4}),{x:0,y:0});ctx.fillStyle='#b7d314';ctx.beginPath();ctx.arc(c.x,c.y,Math.max(4,side*.04),0,Math.PI*2);ctx.fill();}
}
export function drawOutsideMark(ctx,canvas,view,edge,mode,outwardSign=1){
  const a=transform(canvas,view,point(edge.a)),b=transform(canvas,view,point(edge.b));
  const blue=edge.symbol.startsWith('beta'),color=mode==='colored'?(blue?COLORS.blue:COLORS.red):'#909a98';
  const concave=edge.symbol.endsWith('concave');
  const fraction=blue?(concave?.75:.25):(concave?.25:.75);
  const start={x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction};
  const length=Math.hypot(b.x-a.x,b.y-a.y),extent=Math.max(35,Math.min(90,length*.56));
  const end={x:start.x-(b.y-a.y)/length*extent*outwardSign,y:start.y+(b.x-a.x)/length*extent*outwardSign};
  ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);
  ctx.strokeStyle=color;ctx.lineWidth=matchingLineWidth(view);ctx.setLineDash(mode==='hidden'?[5,6]:[]);ctx.stroke();ctx.setLineDash([]);
  return {samples:[start,end]};
}
export function drawLandingShadow(ctx,canvas,view,tile,opacity=.7){
  const points=tilePoints(canvas,view,tile),center=points.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0});
  const shadow=points.map(p=>({x:center.x+(p.x-center.x)*.8,y:center.y+(p.y-center.y)*.8+recessDepth(view)}));
  ctx.save();ctx.globalAlpha*=opacity;roundedPolygonPath(ctx,shadow,view.scale*.8);ctx.fillStyle='#6d5446';ctx.fill();ctx.restore();
}
export function drawBoundary(ctx,canvas,view,edges,{play=false,boundaryCheck=null}={}){
  const hits=[];
  const ring=boundaryCheck?.valid?boundaryCheck.orderedKeys:null;
  const vertexIndex=ring?new Map(ring.map((id,i)=>[id,i])):null;
  const winding=ring?Math.sign(signedArea(boundaryCheck.polygon.map(p=>transform(canvas,view,p)))):0;
  for(const edge of edges){
    const a=transform(canvas,view,point(edge.a)),b=transform(canvas,view,point(edge.b));
    if(!play){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=COLORS.outline;ctx.lineWidth=5;ctx.lineCap='round';ctx.stroke();}
    if(boundaryCheck&&!boundaryCheck.valid||play&&edge.mode==='hidden')continue;
    const from=vertexIndex?.get(key(edge.a)),to=vertexIndex?.get(key(edge.b));
    const forward=from!==undefined&&to===(from+1)%ring.length;
    const outwardSign=from===undefined||to===undefined?1:-winding*(forward?1:-1);
    hits.push({id:edge.id,...drawOutsideMark(ctx,canvas,view,edge,edge.mode,outwardSign)});
  }
  return hits;
}
export function drawPlayRegion(ctx,canvas,view,polygon,{floorOnly=false}={}){
  if(!polygon.length)return;
  const points=polygon.map(p=>transform(canvas,view,p));
  ctx.save();polygonPath(ctx,points);ctx.clip();
  polygonPath(ctx,points);ctx.fillStyle=COLORS.cream;ctx.fill();
  if(!floorOnly)drawSideFaces(ctx,wallFaces(points),recessDepth(view));
  ctx.restore();
}
export function drawTray(canvas,kind,selected=false){
  const ratio=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
  const tile={kind,direction:0,anchor:[0,0,0,0]};
  const angle=trayAngle(kind),c=Math.cos(angle),s=Math.sin(angle);
  const vertices=tileVertices(tile).map(point).map(p=>({x:p.x*c+p.y*s,y:p.x*s-p.y*c}));
  const xs=vertices.map(p=>p.x),ys=vertices.map(p=>p.y);
  const center={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2};
  const scale=trayScale(canvas);
  const view={scale,angle,pan:{x:-center.x*scale,y:-center.y*scale}};
  drawRhombus(ctx,canvas,view,tile);
  if(selected){
    roundedPolygonPath(ctx,tilePoints(canvas,view,tile),scale);
    ctx.strokeStyle='#8ea800';ctx.lineWidth=Math.max(3,scale*.04);ctx.lineJoin='round';ctx.stroke();
  }
}
export const trayAngle=kind=>(kind==='thin'?18:-54)*Math.PI/180;
const trayExtents=['thin','fat'].map(kind=>{
  const angle=trayAngle(kind),c=Math.cos(angle),s=Math.sin(angle);
  const positions=tileVertices({kind,direction:0,anchor:[0,0,0,0]}).map(point).map(p=>({x:p.x*c+p.y*s,y:p.x*s-p.y*c}));
  return{x:Math.max(...positions.map(p=>p.x))-Math.min(...positions.map(p=>p.x)),y:Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))};
});
export function trayScale(canvas){
  return Math.max(1,Math.min((canvas.clientWidth-8)/Math.max(...trayExtents.map(e=>e.x)),(canvas.clientHeight-8)/Math.max(...trayExtents.map(e=>e.y))));
}
export function pointInPolygon(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){if((poly[i].y>p.y)!==(poly[j].y>p.y)&&p.x<(poly[j].x-poly[i].x)*(p.y-poly[i].y)/(poly[j].y-poly[i].y)+poly[i].x)inside=!inside;}return inside;}
export function edgeDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
