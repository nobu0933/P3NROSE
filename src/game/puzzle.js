import { edgeKey, key, oppositeSymbol, point, polygonArea, polygonsOverlap, sub, tileEdges, tileVertices } from './geometry.js';
import { analyze } from './rules.js';
import { physicalNeighbors } from './forced.js';
import { validateBoundary } from './stage.js';

const EPS=1e-8;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function onSegment(p,a,b){return Math.abs(cross(a,b,p))<EPS&&p.x>=Math.min(a.x,b.x)-EPS&&p.x<=Math.max(a.x,b.x)+EPS&&p.y>=Math.min(a.y,b.y)-EPS&&p.y<=Math.max(a.y,b.y)+EPS;}
function inPolygon(p,polygon){for(let i=0;i<polygon.length;i++)if(onSegment(p,polygon[i],polygon[(i+1)%polygon.length]))return true;let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++)if((polygon[i].y>p.y)!==(polygon[j].y>p.y)&&p.x<(polygon[j].x-polygon[i].x)*(p.y-polygon[i].y)/(polygon[j].y-polygon[i].y)+polygon[i].x)inside=!inside;return inside;}
function properCross(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<-EPS&&cross(c,d,a)*cross(c,d,b)<-EPS;}
const endpointFraction=edge=>{
  const blue=edge.symbol.startsWith('beta'),concave=edge.symbol.endsWith('concave');
  const fraction=blue?(concave?.75:.25):(concave?.25:.75);
  return key(edge.a)<key(edge.b)?fraction:1-fraction;
};
function withinPolygon(tile,boundary,polygon,marks){
  const shape=tileVertices(tile).map(point);
  for(const p of shape)if(!inPolygon(p,polygon))return false;
  for(let i=0;i<4;i++){
    const a=shape[i],b=shape[(i+1)%4],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(!inPolygon(mid,polygon))return false;
    for(let j=0;j<polygon.length;j++)if(properCross(a,b,polygon[j],polygon[(j+1)%polygon.length]))return false;
  }
  for(const edge of tileEdges(tile)){
    const mark=marks.get(edgeKey(edge.a,edge.b));
    if(!mark||mark.mode==='hidden')continue;
    if(Math.abs(endpointFraction(edge)-endpointFraction(mark))>EPS)return false;
    if(mark.mode==='colored'&&edge.symbol.split('-')[0]!==mark.symbol.split('-')[0])return false;
  }
  return true;
}
export function tileWithinBoundary(tile,boundary){
  const check=validateBoundary({boundary},[]);
  return check.valid&&withinPolygon(tile,boundary,check.polygon,new Map(boundary.map(e=>[e.id,e])));
}
export function halfTurn(tile){return {...tile,direction:(tile.direction+5)%10,anchor:tileVertices(tile)[2]};}
export function chooseDropOrientation(tile,boundary,placed,random=Math.random){
  const turned=halfTurn(tile);
  if(!tileWithinBoundary(turned,boundary)||!fitsNeighbors(turned,placed))return tile;
  return random()<.5?tile:turned;
}
// A candidate only changes the edges and vertices it touches. In particular,
// disconnected groups elsewhere on the board must not veto this placement.
export function fitsNeighbors(tile,known){
  const edges=tileEdges(tile);
  for(const other of known){
    if(polygonsOverlap(tile,other))return false;
    const otherEdges=new Map(tileEdges(other).map(edge=>[edgeKey(edge.a,edge.b),edge.symbol]));
    for(const edge of edges){const symbol=otherEdges.get(edgeKey(edge.a,edge.b));if(symbol&&symbol!==oppositeSymbol(edge.symbol))return false;}
  }
  return true;
}
export function editorCandidates(placed,forced,kind){
  if(!placed.length)return [{kind,direction:kind==='thin'?0:2,anchor:[0,0,0,0]}];
  const options=[...forced.filter(tile=>tile.kind===kind),...physicalNeighbors([...placed,...forced]).filter(tile=>tile.kind===kind)];
  const result=new Map();
  for(const tile of options){
    const footprint=`${tile.kind}:${tile.direction}:${key(tile.anchor)}`;
    if(!fitsNeighbors(tile,placed))continue;
    if(!fitsNeighbors(tile,forced.filter(other=>`${other.kind}:${other.direction}:${key(other.anchor)}`!==footprint)))continue;
    result.set(footprint,tile);
  }
  return [...result.values()];
}
export function playCandidates(stage,placed,kind){
  const boundary=stage.boundary||[];
  const check=validateBoundary(stage,[]);
  if(!check.valid)return [];
  const marks=new Map(boundary.map(edge=>[edge.id,edge]));
  const options=new Map();
  for(const tile of physicalNeighbors(placed).filter(t=>t.kind===kind))options.set(`${kind}:${tile.direction}:${key(tile.anchor)}`,tile);
  for(const edge of boundary)for(let direction=0;direction<10;direction++)for(let index=0;index<4;index++){
    const base={kind,direction,anchor:[0,0,0,0]},vertices=tileVertices(base),anchor=sub(edge.a,vertices[index]);
    const tile={kind,direction,anchor},actual=tileVertices(tile);
    if(key(actual[(index+1)%4])!==key(edge.b))continue;
    options.set(`${kind}:${direction}:${key(anchor)}`,tile);
  }
  // At a concave rim a valid rhombus may touch the rim only at a vertex.
  // Edge-anchored seeds alone cannot discover it before a neighbor is played.
  const vertices=new Map(boundary.flatMap(edge=>[edge.a,edge.b]).map(vertex=>[key(vertex),vertex]));
  for(const vertex of vertices.values())for(let direction=0;direction<10;direction++){
    const base={kind,direction,anchor:[0,0,0,0]},local=tileVertices(base);
    for(const corner of local){const anchor=sub(vertex,corner);options.set(`${kind}:${direction}:${key(anchor)}`,{kind,direction,anchor});}
  }
  return [...options.values()].filter(tile=>withinPolygon(tile,boundary,check.polygon,marks)&&fitsNeighbors(tile,placed));
}
export function isSolved(stage,placed){
  const check=validateBoundary(stage,[]);
  if(!check.valid||!placed.length||analyze(placed).errors.filter(e=>!e.includes('つながっていない')).length)return false;
  if(!placed.every(tile=>tileWithinBoundary(tile,stage.boundary)))return false;
  const area=placed.reduce((sum,tile)=>sum+polygonArea(tileVertices(tile).map(point)),0);
  return Math.abs(area-check.area)<1e-7;
}
