import { edgeKey, key, point, tileEdges } from './geometry.js';

export const stageTemplate = (id) => ({ id, name: '', revision: 1, solutionTiles: [], fixedTileIds: [], boundary: [], viewAngle: 18 });
export function availableEdges(tiles) {
  const groups = new Map();
  for (const tile of tiles) for (const edge of tileEdges(tile)) {
    const id = edgeKey(edge.a, edge.b);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(edge);
  }
  return new Map([...groups].map(([id, value]) => [id, value[0]]));
}
export function reconcileBoundary(stage, allTiles) {
  const available = availableEdges(allTiles);
  stage.boundary = (stage.boundary || []).filter(mark => available.has(mark.id));
  return available;
}
export function makeBoundary(stage, allTiles) {
  const groups = new Map();
  for (const tile of allTiles) for (const edge of tileEdges(tile)) {
    const id = edgeKey(edge.a, edge.b);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(edge);
  }
  const available = new Map([...groups].filter(([, group]) => group.length === 1).map(([id, group]) => [id, group[0]]));
  const previous = new Map((stage.boundary || []).map(mark => [mark.id, mark]));
  stage.boundary = [...available].map(([id, edge]) => previous.get(id) || { id, a: edge.a, b: edge.b, symbol: edge.symbol, mode: 'hidden', sourceId: edge.tileId });
}
export function boundaryGeometry(stage, allTiles) {
  return (stage.boundary || []).filter(mark => Array.isArray(mark.a) && Array.isArray(mark.b) && typeof mark.symbol === 'string');
}
export function validateBoundary(stage, allTiles) {
  const edges = boundaryGeometry(stage, allTiles);
  if (edges.length < 4) return { valid: false, message: '外周辺を4本以上指定してください。', polygon: [] };
  const links = new Map();
  for (const edge of edges) for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) {
    const id = key(a);
    if (!links.has(id)) links.set(id, []);
    links.get(id).push(b);
  }
  if ([...links.values()].some(neighbors => neighbors.length !== 2)) return { valid: false, message: '外周に分岐または途切れがあります。', polygon: [] };
  const first = edges[0].a, firstKey = key(first), visited = new Set();
  const polygon = [], orderedKeys = []; let previous = null, current = first;
  do {
    const id = key(current);
    if (visited.has(id)) break;
    visited.add(id); orderedKeys.push(id); polygon.push(point(current));
    const next = links.get(id).find(v => key(v) !== previous);
    previous = id; current = next;
  } while (current && key(current) !== firstKey && polygon.length <= edges.length);
  if (!current || key(current) !== firstKey || polygon.length !== edges.length || visited.size !== links.size) return { valid: false, message: '外周は1本の環状にしてください。', polygon: [] };
  const area = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p.x*q.y - q.x*p.y; }, 0) / 2;
  if (Math.abs(area) < 1e-8) return { valid: false, message: '外周の面積がありません。', polygon: [] };
  for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
    if (Math.abs(i-j) <= 1 || (i === 0 && j === polygon.length-1)) continue;
    const a = polygon[i], b = polygon[(i+1)%polygon.length], c = polygon[j], d = polygon[(j+1)%polygon.length];
    const cross = (u,v,w) => (v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x);
    if (cross(a,b,c)*cross(a,b,d) < -1e-8 && cross(c,d,a)*cross(c,d,b) < -1e-8) return { valid: false, message: '外周が交差しています。', polygon: [] };
  }
  return { valid: true, message: '外周は閉じています。', polygon, orderedKeys, area: Math.abs(area) };
}
export function validateStage(stage) {
  return validateBoundary(stage, []);
}
