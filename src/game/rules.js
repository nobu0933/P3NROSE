import { edgeKey, key, oppositeSymbol, point, polygonsOverlap, tileCenter, tileEdges, tileVertices, translatedTile, vertexNames } from './geometry.js';

const VERTEX_PATTERNS = ['GGGGG', 'EEEEE', 'GGGGBD', 'GGBDGBD', 'EEEA', 'HFDGB', 'AAE', 'FHC'];
const cyclicContains = (pattern, run) => (pattern + pattern).includes(run);
const compatibleVertex = (entries, complete) => {
  const ordered = entries.slice().sort((a, b) => b.angle - a.angle).map(e => e.name).join('');
  return VERTEX_PATTERNS.some(pattern => complete
    ? pattern.length === ordered.length && cyclicContains(pattern, ordered)
    : Array.from({ length: ordered.length }, (_, i) => ordered.slice(i) + ordered.slice(0, i)).some(run => cyclicContains(pattern, run)));
};

export function analyze(tiles) {
  const errors = [];
  const edges = new Map(), vertices = new Map();
  const ids = new Set();
  for (const tile of tiles) {
    if (!['thin', 'fat'].includes(tile.kind) || !Number.isInteger(tile.direction) || tile.direction < 0 || tile.direction > 9 || !Array.isArray(tile.anchor) || tile.anchor.length !== 4 || tile.anchor.some(n => !Number.isInteger(n))) {
      errors.push('不正なタイルデータがあります。'); continue;
    }
    if (ids.has(tile.id)) errors.push('重複したタイルIDがあります。');
    ids.add(tile.id);
    tileEdges(tile).forEach(edge => {
      const id = edgeKey(edge.a, edge.b);
      if (!edges.has(id)) edges.set(id, []);
      edges.get(id).push(edge);
    });
    tileVertices(tile).forEach((vertex, index) => {
      const id = key(vertex), center = tileCenter(tile), p = point(vertex);
      if (!vertices.has(id)) vertices.set(id, []);
      vertices.get(id).push({ name: vertexNames(tile.kind)[index], angle: Math.atan2(center.y - p.y, center.x - p.x), corner: tile.kind === 'thin' ? (index % 2 === 0 ? 36 : 144) : (index % 2 === 0 ? 72 : 108) });
    });
  }
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    if (polygonsOverlap(tiles[i], tiles[j])) errors.push(`タイル ${tiles[i].id} と ${tiles[j].id} が重なっています。`);
  }
  const boundaryEdges = [];
  for (const [id, group] of edges) {
    if (group.length > 2) errors.push(`辺 ${id} を3枚以上が共有しています。`);
    else if (group.length === 2 && group[0].symbol !== oppositeSymbol(group[1].symbol)) errors.push(`辺 ${id} の模様が一致しません。`);
    else if (group.length === 1) {
      const edge = group[0];
      boundaryEdges.push({ id, a: edge.a, b: edge.b, symbol: oppositeSymbol(edge.symbol), tileId: edge.tileId });
    }
  }
  // Full 360° vertices must match a complete Penrose vertex star.
  for (const [id, entries] of vertices) {
    const angle = entries.reduce((sum, e) => sum + e.corner, 0);
    if (angle > 360) errors.push(`頂点 ${id} の角度が360°を超えています。`);
    else if (angle === 360 && !compatibleVertex(entries, true)) errors.push(`頂点 ${id} の型が一致しません。`);
    else if (angle < 360 && !compatibleVertex(entries, false)) errors.push(`頂点 ${id} の並びが頂点型と整合しません。`);
  }
  if (tiles.length > 1) {
    const visited = new Set([tiles[0].id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of edges.values()) if (group.length === 2) {
        const [a, b] = group.map(e => e.tileId);
        if (visited.has(a) && !visited.has(b)) { visited.add(b); changed = true; }
        if (visited.has(b) && !visited.has(a)) { visited.add(a); changed = true; }
      }
    }
    if (visited.size !== tiles.length) errors.push('辺でつながっていないタイルがあります。');
  }
  const boundaryVertices = new Map();
  for (const edge of boundaryEdges) for (const v of [edge.a, edge.b]) boundaryVertices.set(key(v), (boundaryVertices.get(key(v)) || 0) + 1);
  if (boundaryEdges.length && [...boundaryVertices.values()].some(n => n !== 2)) errors.push('外周に分岐または穴があります。');
  if (boundaryEdges.length) {
    const first = key(boundaryEdges[0].a), seen = new Set([first]);
    const links = new Map();
    for (const edge of boundaryEdges) {
      for (const [a, b] of [[edge.a, edge.b], [edge.b, edge.a]]) {
        const id = key(a);
        if (!links.has(id)) links.set(id, []);
        links.get(id).push(key(b));
      }
    }
    const queue = [first];
    for (const id of queue) for (const other of links.get(id) || []) if (!seen.has(other)) { seen.add(other); queue.push(other); }
    if (seen.size !== boundaryVertices.size) errors.push('外周が複数あります（穴の可能性があります）。');
  }
  return { errors: [...new Set(errors)], boundaryEdges, inventory: { thin: tiles.filter(t => t.kind === 'thin').length, fat: tiles.filter(t => t.kind === 'fat').length } };
}

export function candidates(tiles, kind) {
  if (!tiles.length) return [{ kind, direction: 0, anchor: [0, 0, 0, 0] }];
  const counts = new Map();
  for (const tile of tiles) for (const edge of tileEdges(tile)) {
    const id = edgeKey(edge.a, edge.b);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const result = [], seen = new Set();
  for (const tile of tiles) for (const edge of tileEdges(tile)) {
    if (counts.get(edgeKey(edge.a, edge.b)) !== 1) continue;
    for (let direction = 0; direction < 10; direction++) for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
      const candidate = translatedTile(kind, direction, edge, edgeIndex);
      const id = `${kind}:${direction}:${key(candidate.anchor)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const candidateEdge = tileEdges(candidate)[edgeIndex];
      if (key(candidateEdge.a) !== key(edge.b) || key(candidateEdge.b) !== key(edge.a)) continue;
      if (analyze([...tiles, { ...candidate, id: '__candidate__' }]).errors.length) continue;
      result.push(candidate);
    }
  }
  return result;
}
