import { Board } from '../reference-penrose/Board.js';
import { localVertices, verticesFor } from '../reference-penrose/Tile.js';
import { structuralPlacementFrontier } from '../reference-penrose/Rules.js';
import { cachedVertexExpansionTemplates } from '../reference-penrose/TrainingVertexTemplates.js';
import { edgeKey, key, point, tileCenter, tileEdges, tileVertices, translatedTile, vertexNames } from './geometry.js';

const SIDE = 120;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function penTile(tile) {
  const verts = tileVertices(tile).map(point);
  const center = tileCenter(tile);
  const names = vertexNames(tile.kind);
  const topIndex = names.indexOf(tile.kind === 'thin' ? 'A' : 'E');
  const top = verts[topIndex];
  const local = localVertices(tile.kind, SIDE)[names[topIndex]];
  const rotation = Math.atan2(-top.y + center.y, top.x - center.x) - Math.atan2(local.y, local.x);
  return {
    id: tile.id, shape: tile.kind, centerX: center.x * SIDE, centerY: -center.y * SIDE,
    rotation, edgeTerrain: Object.fromEntries((tile.kind === 'thin' ? ['AB','BC','CD','DA'] : ['EF','FG','GH','HE']).map(e => [e, 'F'])),
    featureGroups: { city: [], road: [], field: [] }, matchingPattern: null, isStructural: true,
  };
}
function matches(candidate, reference) {
  if (candidate.kind !== reference.shape) return false;
  const center = tileCenter(candidate);
  if (distance({ x: center.x * SIDE, y: -center.y * SIDE }, { x: reference.centerX, y: reference.centerY }) > 1e-4) return false;
  const names = vertexNames(candidate.kind), vertices = tileVertices(candidate).map(point);
  const target = verticesFor(reference, SIDE);
  return names.every((name, i) => distance({ x: vertices[i].x * SIDE, y: -vertices[i].y * SIDE }, target[name]) < 1e-4);
}
export function physicalNeighbors(known) {
  const counts = new Map();
  for (const tile of known) for (const edge of tileEdges(tile)) {
    const id = edgeKey(edge.a, edge.b);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const result = [], seen = new Set();
  for (const tile of known) for (const edge of tileEdges(tile)) {
    if (counts.get(edgeKey(edge.a, edge.b)) !== 1) continue;
    for (const kind of ['thin', 'fat']) for (let direction = 0; direction < 10; direction++) for (let index = 0; index < 4; index++) {
      const candidate = translatedTile(kind, direction, edge, index);
      const verts = tileVertices(candidate);
      if (key(verts[index]) !== key(edge.b) || key(verts[(index + 1) % 4]) !== key(edge.a)) continue;
      const id = `${kind}:${direction}:${key(candidate.anchor)}`;
      if (!seen.has(id)) { seen.add(id); result.push(candidate); }
    }
  }
  return result;
}

export function searchForcedTiles(tiles) {
  if (!tiles.length) return { tiles: [], unmatched: 0, macroApplications: 0 };
  const board = new Board(SIDE);
  for (const tile of tiles) board.add(penTile(tile));
  const found = structuralPlacementFrontier(board, { vertexTemplates: cachedVertexExpansionTemplates(SIDE) });
  const remaining = [...found.forced], known = [...tiles], mapped = [];
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    const options = physicalNeighbors(known);
    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = options.find(t => matches(t, remaining[i]));
      if (!candidate) continue;
      const placed = { ...candidate, id: `forced-${mapped.length}` };
      known.push(placed); mapped.push(placed); remaining.splice(i, 1); progress = true;
    }
  }
  return { tiles: mapped, unmatched: remaining.length, macroApplications: found.macroApplications };
}
