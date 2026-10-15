// Coordinates are integer coefficients of 1, ζ, ζ², ζ³ where ζ = exp(iπ/5).
// ζ⁴ = ζ³ - ζ² + ζ - 1. This keeps shared edges exact.
export const ZERO = [0, 0, 0, 0];
const add = (a, b) => a.map((n, i) => n + b[i]);
const neg = a => a.map(n => -n);
export const sub = (a, b) => add(a, neg(b));
export const key = a => a.join(',');
const mulZeta = a => [-a[3], a[0] + a[3], a[1] - a[3], a[2] + a[3]].map(n => n === 0 ? 0 : n);
export const DIRECTIONS = Array.from({ length: 10 }, (_, i) => {
  let value = [1, 0, 0, 0];
  for (let j = 0; j < i; j++) value = mulZeta(value);
  return value;
});
export const point = a => {
  const t = Math.PI / 5;
  return {
    x: a.reduce((v, n, i) => v + n * Math.cos(i * t), 0),
    y: a.reduce((v, n, i) => v + n * Math.sin(i * t), 0),
  };
};
export const same = (a, b) => key(a) === key(b);
export const tileVertices = tile => {
  const u = DIRECTIONS[tile.direction];
  const v = DIRECTIONS[(tile.direction + (tile.kind === 'thin' ? 1 : 2)) % 10];
  const p = tile.anchor;
  return [p, add(p, u), add(add(p, u), v), add(p, v)];
};
// The screen-facing winding is the reverse of Penrosanne's A-B-C-D / E-F-G-H.
export const vertexNames = kind => kind === 'thin' ? ['B', 'A', 'D', 'C'] : ['E', 'H', 'G', 'F'];
const SYMBOLS = { AB: 'beta-concave', BC: 'alpha-concave', CD: 'alpha-convex', DA: 'beta-convex', EF: 'beta-concave', FG: 'alpha-convex', GH: 'alpha-concave', HE: 'beta-convex' };
export const edgeSymbol = (kind, index) => {
  const names = vertexNames(kind);
  const a = names[index], b = names[(index + 1) % 4];
  return SYMBOLS[a + b] || SYMBOLS[b + a];
};
export const oppositeSymbol = symbol => symbol.replace(/convex|concave/, value => value === 'convex' ? 'concave' : 'convex');
export const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');
export const tileEdges = tile => {
  const vertices = tileVertices(tile);
  return vertices.map((a, i) => ({ a, b: vertices[(i + 1) % 4], symbol: edgeSymbol(tile.kind, i), tileId: tile.id, index: i }));
};
export const tileCenter = tile => {
  const vertices = tileVertices(tile).map(point);
  return { x: vertices.reduce((s, v) => s + v.x, 0) / 4, y: vertices.reduce((s, v) => s + v.y, 0) / 4 };
};
export const translatedTile = (kind, direction, edge, edgeIndex) => {
  const base = { kind, direction, anchor: ZERO };
  const vertices = tileVertices(base);
  const target = vertices[(edgeIndex + 1) % 4];
  return { kind, direction, anchor: add(edge.a, sub(ZERO, target)) };
};
export const polygonArea = vertices => Math.abs(vertices.reduce((sum, p, i) => {
  const q = vertices[(i + 1) % vertices.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;
export const polygonsOverlap = (a, b) => {
  const va = tileVertices(a).map(point), vb = tileVertices(b).map(point);
  for (const poly of [va, vb]) for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4];
    const axis = { x: q.y - p.y, y: p.x - q.x };
    const project = shape => shape.map(v => v.x * axis.x + v.y * axis.y);
    const pa = project(va), pb = project(vb);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-8 || Math.max(...pb) <= Math.min(...pa) + 1e-8) return false;
  }
  return true;
};
