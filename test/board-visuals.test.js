import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, drawBoundary, drawLandingShadow, drawOutsideMark, drawPlayRegion, drawRhombus, matchingLineWidth, pointInPolygon, recessDepth, tileSideFaces, tilePoints, sortSideFaces, transform } from '../src/ui/board.js';
import { point, tileCenter, tileEdges } from '../src/game/geometry.js';
import { makeBoundary, stageTemplate, validateBoundary } from '../src/game/stage.js';

function context(){
  const arcs=[],fills=[],translations=[],strokes=[];
  const ctx={arcs,fills,translations,strokes,globalAlpha:1,clips:0,curves:0,beginPath(){},moveTo(){},lineTo(){},closePath(){},quadraticCurveTo(){this.curves++;},fill(){fills.push(this.fillStyle);},stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth});if(arcs.length)arcs.at(-1).color=this.strokeStyle;},save(){},restore(){},translate(x,y){translations.push([x,y]);},clip(){this.clips++;},setLineDash(){},arc(...args){arcs.push({args,color:null});}};
  return ctx;
}
const canvas={clientWidth:600,clientHeight:600},view={scale:100,angle:0,pan:{x:0,y:0}};

test('THIN A and C arcs both have a 25% edge radius, including forced outlines',()=>{
  const tile={id:'t',kind:'thin',direction:0,anchor:[0,0,0,0]};
  const ctx=context();drawRhombus(ctx,canvas,view,tile,{forced:true});
  assert.deepEqual(ctx.arcs.map(arc=>Math.round(arc.args[2])),[25,25]);
  assert.deepEqual(ctx.arcs.map(arc=>arc.color),['#aaa8f8','#f39fa4']);
});

test('recessed floor is clipped and placed tiles retain their sides',()=>{
  const region=context();drawPlayRegion(region,canvas,view,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);
  assert.equal(region.clips,1);
  assert.ok(region.fills.includes(COLORS.cream));
  assert.ok(region.fills.includes(COLORS.wall));
  const tile={id:'t',kind:'thin',direction:0,anchor:[0,0,0,0]};
  const open=context();drawRhombus(open,canvas,view,tile,{exposedEdges:[0,1,2,3]});
  assert.ok(open.fills.includes(COLORS.sideThin));
  const fixed=context();drawRhombus(fixed,canvas,view,tile,{recessedFixed:true,exposedEdges:[0,1,2,3]});
  assert.ok(fixed.fills.includes(COLORS.wall));
  assert.ok(fixed.fills.includes(COLORS.background));
});

test('exterior marks are straight and begin at the matching arc intersection',()=>{
  const tile={id:'t',kind:'thin',direction:0,anchor:[0,0,0,0]};
  for(const edge of tileEdges(tile)){
    const ctx=context(),mark=drawOutsideMark(ctx,canvas,view,edge,'colored');
    assert.equal(ctx.arcs.length,0);
    const a=point(edge.a),b=point(edge.b);
    const blue=edge.symbol.startsWith('beta'),concave=edge.symbol.endsWith('concave');
    const fraction=blue?(concave?.75:.25):(concave?.25:.75);
    assert.ok(Math.abs(mark.samples[0].x-(300+(a.x+(b.x-a.x)*fraction)*100))<1e-8);
    assert.ok(Math.abs(mark.samples[0].y-(300-(a.y+(b.y-a.y)*fraction)*100))<1e-8);
    const center=tileCenter(tile),inside={x:300+center.x*100-mark.samples[0].x,y:300-center.y*100-mark.samples[0].y};
    const outside={x:mark.samples[1].x-mark.samples[0].x,y:mark.samples[1].y-mark.samples[0].y};
    assert.ok(inside.x*outside.x+inside.y*outside.y<0);
  }
});

test('hidden exterior marks are editor guides and disappear during play',()=>{
  const edge=tileEdges({id:'t',kind:'thin',direction:0,anchor:[0,0,0,0]})[0];
  const marked={...edge,id:'edge-1',mode:'hidden'};
  const editor=context(),play=context();
  assert.equal(drawBoundary(editor,canvas,view,[marked]).length,1);
  assert.equal(drawBoundary(play,canvas,view,[marked],{play:true}).length,0);
});

test('closed boundary marks point outside even when a source edge runs backward',()=>{
  const tile={id:'t',kind:'thin',direction:0,anchor:[0,0,0,0]};
  const stage=stageTemplate('outside-marks');makeBoundary(stage,[tile]);
  [stage.boundary[0].a,stage.boundary[0].b]=[stage.boundary[0].b,stage.boundary[0].a];
  const check=validateBoundary(stage,[tile]);
  assert.equal(check.valid,true);
  for(const angle of [0,Math.PI/10,Math.PI/2]){
    const rotated={...view,angle};
    const polygon=check.polygon.map(p=>transform(canvas,rotated,p));
    const marks=drawBoundary(context(),canvas,rotated,stage.boundary,{boundaryCheck:check});
    assert.equal(marks.length,4);
    for(const mark of marks){
      const [start,end]=mark.samples,dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
      const outside={x:start.x+dx/length*3,y:start.y+dy/length*3};
      const inside={x:start.x-dx/length*3,y:start.y-dy/length*3};
      assert.equal(pointInPolygon(outside,polygon),false,`mark ${mark.id} points inward`);
      assert.equal(pointInPolygon(inside,polygon),true,`mark ${mark.id} does not touch the boundary`);
    }
  }
  stage.boundary.pop();
  assert.equal(validateBoundary(stage,[tile]).valid,false);
  assert.equal(drawBoundary(context(),canvas,view,stage.boundary,{boundaryCheck:validateBoundary(stage,[tile])}).length,0);
});

test('tile body extrudes the same rounded outline down to a rounded underside',()=>{
  const tile={id:'t',kind:'fat',direction:0,anchor:[0,0,0,0]};
  const side=context(),top=context();
  drawRhombus(side,canvas,view,tile,{layer:'side',exposedEdges:[0,1,2,3]});
  drawRhombus(top,canvas,view,tile,{layer:'top',exposedEdges:[0,1,2,3]});
  const depth=recessDepth(view);
  assert.equal(depth,16);
  assert.ok(side.curves>=4);
  assert.deepEqual(side.translations,[]);
  assert.ok(side.fills.includes(COLORS.sideFat));
  assert.ok(!side.fills.includes(COLORS.fat));
  assert.ok(top.fills.includes(COLORS.fat));
  assert.ok(!top.fills.includes(COLORS.sideFat));
  const shadow=context();drawLandingShadow(shadow,canvas,view,tile);
  assert.ok(shadow.fills.includes('#6d5446'));
});

test('rounded silhouette is swept fully, including the exact vertical tangents',()=>{
  for(const kind of ['thin','fat'])for(let degrees=0;degrees<360;degrees+=3){
    const tile={kind,direction:0,anchor:[0,0,0,0]},points=tilePoints(canvas,{...view,angle:degrees*Math.PI/180},tile);
    const faces=tileSideFaces(points,view.scale,COLORS.sideFat);
    // Visible segments form one continuous lower outline, without omitted half-corners.
    const ordered=[...faces].sort((a,b)=>Math.min(a.a.x,a.b.x)-Math.min(b.a.x,b.b.x));
    for(let i=1;i<ordered.length;i++)assert.ok(Math.abs(Math.max(ordered[i-1].a.x,ordered[i-1].b.x)-Math.min(ordered[i].a.x,ordered[i].b.x))<1e-7,`${kind} ${degrees}`);
    assert.ok(faces.every(f=>Math.abs(f.a.x-f.b.x)>1e-8));
    const left=ordered[0],right=ordered.at(-1);
    for(const [f,isLeft] of [[left,true],[right,false]]){
      assert.ok(f.c);
      const end=isLeft?(f.a.x<f.b.x?f.a:f.b):(f.a.x>f.b.x?f.a:f.b);
      assert.ok(Math.abs(end.x-f.c.x)<1e-7,`${kind} ${degrees}: tangent`);
    }
  }
});

test('side overlap uses depth at the shared horizontal range, including rim walls',()=>{
  const tile={a:{x:0,y:0},b:{x:100,y:100},color:COLORS.sideFat};
  const wall={a:{x:0,y:20},b:{x:10,y:20},color:COLORS.wall};
  assert.deepEqual(sortSideFaces([wall,tile]),[tile,wall]);
  const frontTile={a:{x:0,y:30},b:{x:10,y:30},color:COLORS.sideThin};
  assert.deepEqual(sortSideFaces([frontTile,wall,tile]),[tile,wall,frontTile]);
});

test('both tile shapes retain visible sides at every 18-degree board angle',()=>{
  for(const kind of ['thin','fat'])for(let direction=0;direction<10;direction++)for(let angle=0;angle<360;angle+=18){
    const tile={id:'t',kind,direction,anchor:[0,0,0,0]},ctx=context();
    drawRhombus(ctx,canvas,{...view,angle:angle*Math.PI/180},tile,{layer:'side'});
    assert.ok(ctx.fills.includes(kind==='thin'?COLORS.sideThin:COLORS.sideFat),`${kind} direction ${direction}, angle ${angle}`);
  }
});

test('outside strokes and tile arcs keep the same width at every zoom',()=>{
  const tile={id:'t',kind:'fat',direction:0,anchor:[0,0,0,0]};
  for(const scale of [40,100,200]){
    const zoom={...view,scale},tileContext=context(),markContext=context();
    drawRhombus(tileContext,canvas,zoom,tile,{layer:'top'});
    drawOutsideMark(markContext,canvas,zoom,tileEdges(tile)[0],'colored');
    const arcWidths=tileContext.strokes.filter(stroke=>[COLORS.red,COLORS.blue].includes(stroke.color)).map(stroke=>stroke.width);
    assert.deepEqual(arcWidths,[matchingLineWidth(zoom),matchingLineWidth(zoom)]);
    assert.equal(markContext.strokes[0].width,matchingLineWidth(zoom));
  }
});

