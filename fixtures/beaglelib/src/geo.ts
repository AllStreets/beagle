// Distance on the globe, and a grade for a point: 1 within 25 km of the nearest true place,
// falling with the logarithm of the distance to 0 at 2,500 km.
export type Point = { lat: number; lon: number };
export type Truth = { places: (Point & { name: string })[] };

export function km(a: Point, b: Point): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function asPoint(x: unknown): Point | null {
  const p = x as Partial<Point> | null;
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number' || !isFinite(p.lat) || !isFinite(p.lon)) return null;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  return { lat: p.lat, lon: p.lon };
}

export function grade(answer: unknown, truth: Truth): number {
  const p = asPoint(answer); if (!p || !truth.places.length) return 0;
  const d = Math.min(...truth.places.map(t => km(p, t)));
  if (d <= 25) return 1;
  return Math.max(0, 1 - Math.log(d / 25) / Math.log(100));
}

// of several points, the one with the least total distance to the others
export function medoid(points: Point[]): Point | null {
  let best: Point | null = null, s = Infinity;
  for (const p of points) { const t = points.reduce((n, q) => n + km(p, q), 0); if (t < s) { s = t; best = p; } }
  return best;
}
