import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, edgeKey, key, polygonsOverlap, tileEdges, tileVertices } from '../src/game/geometry.js';
import { analyze, candidates } from '../src/game/rules.js';
import { chooseDropOrientation, editorCandidates, fitsNeighbors, halfTurn, isSolved, playCandidates } from '../src/game/puzzle.js';
import { makeBoundary, stageTemplate, validateBoundary, validateStage } from '../src/game/stage.js';
import { searchForcedTiles } from '../src/game/forced.js';

test('10 directions remain exact and close at 180 degrees', () => {
  assert.equal(DIRECTIONS.length, 10);
  for (let i = 0; i < 5; i++) assert.deepEqual(DIRECTIONS[i + 5], DIRECTIONS[i].map(n => n === 0 ? 0 : -n));
});

test('a first tile generates a four-edge boundary and both kinds of neighbors', () => {
  const first = { ...candidates([], 'thin')[0], id: 'a' };
  const summary = analyze([first]);
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.boundaryEdges.length, 4);
  assert.deepEqual(summary.inventory, { thin: 1, fat: 0 });
  assert.ok(candidates([first], 'thin').length > 0);
  assert.ok(candidates([first], 'fat').length > 0);
});

test('legal neighbor removes the shared boundary and does not overlap', () => {
  const first = { ...candidates([], 'thin')[0], id: 'a' };
  const second = { ...candidates([first], 'fat')[0], id: 'b' };
  assert.equal(polygonsOverlap(first, second), false);
  assert.deepEqual(analyze([first, second]).errors, []);
  assert.equal(analyze([first, second]).boundaryEdges.length, 6);
  const shared = tileEdges(first).find(a => tileEdges(second).some(b => edgeKey(a.a, a.b) === edgeKey(b.a, b.b)));
  assert.ok(shared);
});

test('overlap and separated tiles are rejected', () => {
  const first = { ...candidates([], 'thin')[0], id: 'a' };
  const overlap = { ...first, id: 'b' };
  assert.ok(analyze([first, overlap]).errors.some(e => e.includes('重なって')));
  const far = { ...first, anchor: [5, 0, 0, 0], id: 'c' };
  assert.ok(analyze([first, far]).errors.some(e => e.includes('つながっていない')));
});

test('vertex and edge coordinates are stable identifiers', () => {
  const tile = { ...candidates([], 'fat')[0], id: 'a' };
  assert.equal(new Set(tileVertices(tile).map(key)).size, 4);
  assert.equal(new Set(tileEdges(tile).map(e => edgeKey(e.a, e.b))).size, 4);
});

test('authored board can be played without showing its solution', () => {
  const first = { ...candidates([], 'thin')[0], id: 'a' };
  const second = { ...candidates([first], 'fat')[0], id: 'b' };
  const stage = stageTemplate('stage-1');
  stage.solutionTiles = [first, second];
  makeBoundary(stage, stage.solutionTiles);
  assert.equal(validateBoundary(stage, stage.solutionTiles).valid, true);
  assert.ok(playCandidates(stage, [], 'thin').some(t => key(t.anchor) === key(first.anchor) && t.direction === first.direction));
  assert.ok(playCandidates(stage, [first], 'fat').some(t => key(t.anchor) === key(second.anchor) && t.direction === second.direction));
  assert.equal(isSolved(stage, [first]), false);
  assert.equal(isSolved(stage, [first, second]), true);
});

test('drop orientation is random only when both half turns are legal',()=>{
  const tile={...candidates([], 'fat')[0],id:'a'},stage=stageTemplate('rotation');
  makeBoundary(stage,[tile]);
  assert.deepEqual(chooseDropOrientation(tile,stage.boundary,[],()=>0),tile);
  assert.deepEqual(chooseDropOrientation(tile,stage.boundary,[],()=>.99),halfTurn(tile));
  stage.boundary.forEach(mark=>{mark.mode='colored';});
  assert.deepEqual(chooseDropOrientation(tile,stage.boundary,[],()=>.99),tile);
});

test('boundary candidates remain available away from the currently placed tile', () => {
  const first={...candidates([], 'thin')[0],id:'a'};
  const middle={...candidates([first], 'fat')[0],id:'b'};
  const sharesEdge=(a,b)=>tileEdges(a).some(edge=>tileEdges(b).some(other=>edgeKey(edge.a,edge.b)===edgeKey(other.a,other.b)));
  const remote={...candidates([first,middle], 'thin').find(tile=>!sharesEdge(first,tile)),id:'c'};
  const stage=stageTemplate('separated-placement');stage.solutionTiles=[first,middle,remote];makeBoundary(stage,stage.solutionTiles);
  assert.equal(validateBoundary(stage,stage.solutionTiles).valid,true);
  assert.equal(sharesEdge(first,remote),false);
  assert.ok(playCandidates(stage,[first],'thin').some(tile=>key(tile.anchor)===key(remote.anchor)&&tile.direction===remote.direction));
});

test('a matching FAT can start from the colored rim without a placed neighbor',()=>{
  const first={...candidates([], 'thin')[0],id:'a'};
  const fat={...candidates([first], 'fat')[0],id:'b'};
  const stage=stageTemplate('rim-only');stage.solutionTiles=[first,fat];makeBoundary(stage,stage.solutionTiles);
  stage.boundary.forEach(mark=>{mark.mode='colored';});
  const same=(a,b)=>a.kind===b.kind&&a.direction===b.direction&&key(a.anchor)===key(b.anchor);
  assert.ok(playCandidates(stage,[], 'fat').some(tile=>same(tile,fat)));
  assert.equal(playCandidates(stage,[], 'fat').length,1);
});

test('a FAT touching a concave rim only at vertices remains a starting candidate',()=>{
  const tiles=[{...candidates([], 'fat')[0],id:'t0'}];
  for(let n=1;n<11;n++){
    const kind=(2+n)%3?'fat':'thin',options=candidates(tiles,kind);
    tiles.push({...options[(10+n*7)%options.length],id:`t${n}`});
  }
  const target=tiles[2],stage=stageTemplate('vertex-rim');stage.solutionTiles=tiles;
  makeBoundary(stage,tiles);
  const edgeIds=new Set(stage.boundary.map(edge=>edge.id));
  assert.ok(!tileEdges(target).some(edge=>edgeIds.has(edgeKey(edge.a,edge.b))));
  assert.ok(playCandidates(stage,[],target.kind).some(tile=>tile.direction===target.direction&&key(tile.anchor)===key(target.anchor)));
});

test('editor permits a tile beside a forced tile away from the placed tile',()=>{
  const first={...candidates([], 'thin')[0],id:'a'};
  const forced=searchForcedTiles([first]).tiles;
  const sharesEdge=(a,b)=>tileEdges(a).some(edge=>tileEdges(b).some(other=>edgeKey(edge.a,edge.b)===edgeKey(other.a,other.b)));
  assert.ok(forced.length);
  const options=editorCandidates([first],forced,'thin');
  assert.ok(options.some(tile=>!sharesEdge(tile,first)&&forced.some(other=>sharesEdge(tile,other))));
  assert.ok(editorCandidates([first],forced,'fat').some(tile=>forced.some(other=>tile.direction===other.direction&&key(tile.anchor)===key(other.anchor))));
  assert.equal(fitsNeighbors({...first,id:'duplicate'},[first]),false);
});

test('fast Penrosanne template search maps forced placements into exact coordinates', () => {
  const first = { ...candidates([], 'thin')[0], id: 'a' };
  const result = searchForcedTiles([first]);
  assert.equal(result.unmatched, 0);
  assert.ok(result.tiles.length >= 2);
  assert.ok(result.macroApplications > 0);
});

test('a broken outer ring is rejected', () => {
  const stage = stageTemplate('stage-1');
  const first = { ...candidates([], 'fat')[0], id: 'a' };
  stage.solutionTiles = [first];
  makeBoundary(stage, stage.solutionTiles);
  stage.boundary.pop();
  assert.equal(validateBoundary(stage, stage.solutionTiles).valid, false);
  assert.equal(validateStage(stage).valid, false);
});

test('test play accepts a later stage with a closed rim while its tile layout is being edited', () => {
  const stage = stageTemplate('stage-10');
  const first = { ...candidates([], 'fat')[0], id: 'a' };
  makeBoundary(stage, [first]);
  stage.solutionTiles = [first, { ...first, id: 'b' }];
  assert.ok(analyze(stage.solutionTiles).errors.length);
  assert.equal(validateStage(stage).valid, true);
});
