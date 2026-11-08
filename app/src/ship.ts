// HMS Beagle as a museum section model: the near half cut away on the centreline, so every
// deck and room shows, on a mahogany plinth. Bow to the right. Units are metres of the real ship.
import { THREE, canvas, grain, planks, type Room } from './kit.ts';

// the hull's profile: keel line and sheer line along the length (x from stern to bow)
export const STERN = -14, BOW = 15.2;
export const keel = (x: number) => x < -11 ? ((-11 - x) / 3) ** 2 * 3.1 : x > 9.5 ? ((x - 9.5) / 5.7) ** 1.7 * 5.6 : 0;
export const sheer = (x: number) => 6.0 + .0065 * x * x - (x > 0 ? .002 * x * x : 0);
export const BEAM = 3.6;                    // half breadth: the far side of the hull, behind the cut
export const DECK = { main: 5.0, lower: 3.0, hold: .75, poop: 6.95, fore: 6.55 };

export type RoomId = 'chart' | 'log' | 'drawing' | 'specimens' | 'fossils' | 'settings';
export type RoomBox = { id: RoomId; x0: number; x1: number; y0: number; y1: number };
export const ROOMS: RoomBox[] = [
  { id: 'chart', x0: -12.9, x1: -7.4, y0: DECK.main, y1: DECK.poop },
  { id: 'log', x0: -11.2, x1: -5.2, y0: DECK.lower, y1: DECK.main },
  { id: 'drawing', x0: -5.2, x1: 3.2, y0: DECK.lower, y1: DECK.main },
  { id: 'specimens', x0: -8.6, x1: 4.6, y0: DECK.hold, y1: DECK.lower },
  { id: 'fossils', x0: 4.6, x1: 9.4, y0: DECK.hold, y1: DECK.lower },
  { id: 'settings', x0: 10.2, x1: 13.4, y0: DECK.main, y1: DECK.fore },
];

// the profile as a closed outline: keel from stern to bow, then the sheer back
function profile(step = .1): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let x = STERN; x <= BOW; x += step) pts.push(new THREE.Vector2(x, keel(x)));
  for (let x = BOW; x >= STERN; x -= step) pts.push(new THREE.Vector2(x, Math.max(sheer(x), keel(x) + .01)));
  return pts;
}
// the same outline moved inward by t, along each point's normal
function inset(pts: THREE.Vector2[], t: number) {
  return pts.map((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(p.x - ty / len * t, p.y + tx / len * t);
  });
}
const span = (y: number) => { let lo = BOW, hi = STERN; for (let x = STERN; x <= BOW; x += .02) if (keel(x) < y && y < sheer(x) + .4) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return [lo, hi]; };

export function buildShip(room: Room) {
  const { scene, tex } = room;
  const ship = new THREE.Group(); scene.add(ship);
  const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = ship) => { o.traverse(c => { (c as THREE.Mesh).castShadow = (c as THREE.Mesh).receiveShadow = true; }); parent.add(o); return o; };

  // materials, all made in code
  const oakTex = planks({ base: '#6b4a2e', dark: '#2e1d10', light: '#a07a52', rows: 22, seed: 4 });
  const oak = new THREE.MeshStandardMaterial({ map: tex(oakTex, { repeat: [4, 1.2] }), roughness: .78 });
  const deckTex = planks({ base: '#a8875e', dark: '#4a3420', light: '#d6b88a', rows: 26, seed: 9, tar: true });
  const deck = new THREE.MeshStandardMaterial({ map: tex(deckTex, { repeat: [3, .5] }), roughness: .8 });
  const sectionC = canvas(256, 256, (k, w, h, r) => { k.fillStyle = '#2a1b10'; k.fillRect(0, 0, w, h); for (let i = -h; i < w; i += 6) { k.strokeStyle = `rgba(150,105,60,${.18 + r() * .1})`; k.lineWidth = 1.2; k.beginPath(); k.moveTo(i, 0); k.lineTo(i + h, h); k.stroke(); } grain(k, w, h, 14, r); });
  const section = new THREE.MeshStandardMaterial({ map: tex(sectionC, { repeat: [12, 1] }), roughness: .9 });
  const copper = new THREE.MeshStandardMaterial({ map: tex(canvas(512, 128, (k, w, h, r) => { k.fillStyle = '#9c5a32'; k.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 32) for (let y = 0; y < h; y += 16) { k.fillStyle = `rgba(${r() < .3 ? '60,120,95' : '190,110,60'},${.15 + r() * .25})`; k.fillRect(x + (y / 16 % 2) * 16, y, 31, 15); k.fillStyle = 'rgba(40,20,10,.5)'; k.fillRect(x + (y / 16 % 2) * 16, y, 1, 15); } grain(k, w, h, 18, r); }), { repeat: [10, 1] }), metalness: .7, roughness: .45 });
  const black = new THREE.MeshStandardMaterial({ color: '#141210', roughness: .6 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: .3 });
  const rope = new THREE.LineBasicMaterial({ color: '#2a2016', transparent: true, opacity: .75 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: '#c9b991', roughness: .95, bumpMap: tex(canvas(64, 256, (k, w, h, r) => { k.fillStyle = '#808080'; k.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 5 + r() * 9) { k.fillStyle = `rgba(0,0,0,${.2 + r() * .3})`; k.fillRect(0, y, w, 1.5); } }), { color: false, repeat: [1, 6] }), bumpScale: 2 });
  const paint = new THREE.MeshStandardMaterial({ color: '#efe9da', roughness: .7 });

  // the far side of the hull, seen from inside: planking with frames standing in front of it
  const outline = profile();
  const farShape = new THREE.Shape(outline);
  const far = add(new THREE.Mesh(new THREE.ShapeGeometry(farShape, 64), oak)); far.position.z = -BEAM;
  // UVs from position so the strakes run along the ship
  { const g = far.geometry as THREE.BufferGeometry, p = g.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) - STERN) / 30; uv[i * 2 + 1] = p.getY(i) / 8; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
  for (let x = -12.6; x < 13.8; x += .62) {
    const y0 = keel(x) + .12, y1 = sheer(x) - .05; if (y1 - y0 < .3) continue;
    const f = add(new THREE.Mesh(new THREE.BoxGeometry(.2, y1 - y0, .22), oak)); f.position.set(x, (y0 + y1) / 2, -BEAM + .12);
  }

  // the cut: a band of solid timber along the outline, drawn as a section with its hatching
  const inner = inset(outline, .34);
  const ring = new THREE.Shape(outline); ring.holes.push(new THREE.Path(inner));
  const cut = add(new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: BEAM, bevelEnabled: false, curveSegments: 1 }), [section, oak]));
  cut.position.z = -BEAM;
  // copper sheathing: the cut timber below the waterline is clad in copper on its outer face,
  // so the band of section is copper on its outside edge
  const outer = outline.filter(p => p.y <= 3.05 && Math.abs(p.y - keel(p.x)) < .0001);
  const sheath = new THREE.Shape([...outer.map(p => new THREE.Vector2(p.x, p.y)), ...inset(outer, -.09).reverse()]);
  add(new THREE.Mesh(new THREE.ExtrudeGeometry(sheath, { depth: BEAM + .06, bevelEnabled: false, curveSegments: 1 }), copper)).position.z = -BEAM - .03;
  // decks: planked slabs between the hull's sides at each level, with beam ends showing in the cut
  const deckAt = (y: number, x0?: number, x1?: number) => {
    const s = span(y); const a = Math.max(s[0] + .25, x0 ?? -99), b = Math.min(s[1] - .25, x1 ?? 99);
    const d = add(new THREE.Mesh(new THREE.BoxGeometry(b - a, .14, BEAM), [section, section, deck, oak, section, section])); d.position.set((a + b) / 2, y - .07, -BEAM / 2);
    for (let x = a + .45; x < b - .2; x += .9) { const beam = add(new THREE.Mesh(new THREE.BoxGeometry(.22, .24, BEAM - .05), section)); beam.position.set(x, y - .26, -BEAM / 2); }
  };
  deckAt(DECK.main); deckAt(DECK.lower); deckAt(DECK.hold);
  deckAt(DECK.poop, STERN, -7.4); deckAt(DECK.fore, 10.1, BOW);
  // bulkheads between rooms, with a door in each
  const bulk = (x: number, y0: number, y1: number) => { const b = add(new THREE.Mesh(new THREE.BoxGeometry(.12, y1 - y0 - .14, BEAM - .1), oak)); b.position.set(x, (y0 + y1) / 2 - .07, -BEAM / 2 - .05); const door = add(new THREE.Mesh(new THREE.BoxGeometry(.14, (y1 - y0) * .62, .8), section)); door.position.set(x, y0 + (y1 - y0) * .31 - .07, -1.0); };
  bulk(-7.4, DECK.main, DECK.poop); bulk(-5.2, DECK.lower, DECK.main); bulk(3.2, DECK.lower, DECK.main); bulk(4.6, DECK.hold, DECK.lower); bulk(10.1, DECK.main, DECK.fore);
  // bulwarks along the weather deck, and the rail on the poop
  for (const [a, b, y] of [[-7.4, 10.1, DECK.main], [STERN + .6, -7.4, DECK.poop], [10.1, BOW - 1.4, DECK.fore]] as const) {
    const top = (x: number) => Math.max(sheer(x), y + .6);
    const s = new THREE.Shape(); s.moveTo(a, y); for (let x = a; x <= b; x += .2) s.lineTo(x, top(x)); s.lineTo(b, y); s.lineTo(a, y);
    add(new THREE.Mesh(new THREE.ShapeGeometry(s), oak)).position.z = -BEAM + .02;
  }

  // masts: fore, main and mizzen, cut off above the tops as section models are; yards with furled sails
  const masts: [number, number][] = [[8.2, 13.6], [1.2, 14.4], [-6.4, 12.2]];
  for (const [mx, h] of masts) {
    const y0 = DECK.hold;
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(.19, .27, h - y0, 18), new THREE.MeshStandardMaterial({ color: '#5e4229', roughness: .55 }))); m.position.set(mx, (h + y0) / 2, -1.2);
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, .12, 1.6), oak)); top.position.set(mx, h - 1.6, -1.2);
    for (const [yy, len] of [[h - 2.4, 9.5], [h - 4.8, 11.5]] as const) {
      if (yy < DECK.main + 1) continue;
      const yard = add(new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, len, 10), new THREE.MeshStandardMaterial({ color: '#5a4026', roughness: .6 }))); yard.rotation.x = Math.PI / 2; yard.rotation.z = Math.PI / 2; yard.position.set(mx, yy, -1.2); yard.rotation.set(Math.PI / 2, 0, 0);
      const furl = add(new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, len * .76, 14), canvasMat)); furl.rotation.set(Math.PI / 2, 0, 0); furl.position.set(mx, yy - .2, -1.2);
      // seen end-on the yards would vanish; the model shows them squared across, so lay them along x
      yard.rotation.set(0, 0, Math.PI / 2); furl.rotation.set(0, 0, Math.PI / 2); yard.scale.set(1, .55, 1); furl.scale.set(1, .55, 1);
    }
    // standing rigging: shrouds from the top down to the ship's side, stays fore and aft
    const pts: THREE.Vector3[] = [];
    for (let k = -2; k <= 2; k++) { pts.push(new THREE.Vector3(mx + k * .05, h - 1.6, -1.2), new THREE.Vector3(mx + k * .55 - .4, sheer(mx) + .1, -BEAM + .1)); }
    ship.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), rope));
  }
  const stays = [[8.2, 13.6, BOW + 3.2, 6.8], [1.2, 14.4, 8.2, 11.4], [-6.4, 12.2, 1.2, 10.6], [-6.4, 11.2, STERN + .5, sheer(STERN)]];
  for (const [ax, ay, bx, by] of stays) ship.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, -1.2), new THREE.Vector3(bx, by, -1.2)]), rope));
  // the bowsprit
  const bs = add(new THREE.Mesh(new THREE.CylinderGeometry(.11, .18, 6, 12), new THREE.MeshStandardMaterial({ color: '#8a6a44', roughness: .6 }))); bs.position.set(BOW + 1.4, 6.2, -1.2); bs.rotation.z = -Math.PI / 2 + .32;

  // on the weather deck: guns, the wheel, a skylight
  for (const gx of [-3.4, -0.8, 4.6, 7.0]) { const gun = add(new THREE.Mesh(new THREE.CylinderGeometry(.12, .17, 1.4, 14), black)); gun.rotation.z = Math.PI / 2; gun.position.set(gx, DECK.main + .45, -BEAM + .9); const car = add(new THREE.Mesh(new THREE.BoxGeometry(.9, .35, .6), oak)); car.position.set(gx + .2, DECK.main + .18, -BEAM + .9); }
  const wheel = add(new THREE.Group()); wheel.position.set(-9.6, DECK.poop + .75, -1.0);
  add(new THREE.Mesh(new THREE.TorusGeometry(.62, .05, 8, 40), oak), wheel);
  for (let k = 0; k < 8; k++) { const sp = add(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.5, 6), oak), wheel); sp.rotation.z = k / 8 * Math.PI; }
  add(new THREE.Mesh(new THREE.BoxGeometry(.2, .9, .2), oak)).position.set(-9.6, DECK.poop + .38, -1.0);

  // the plinth: a mahogany base, two brass cradles, and a plaque
  const mahogC = canvas(1024, 256, (k, w, h, r) => { k.fillStyle = '#2e140c'; k.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { k.strokeStyle = r() < .5 ? `rgba(12,3,1,${.2 + r() * .25})` : `rgba(120,55,30,${.05 + r() * .08})`; k.lineWidth = .5 + r() * 2; const y0 = r() * h, a = r() * 4; k.beginPath(); for (let x = 0; x <= w; x += 16) k.lineTo(x, y0 + Math.sin(x * .006 + i) * a); k.stroke(); } grain(k, w, h, 10, r); });
  const mahog = new THREE.MeshPhysicalMaterial({ map: tex(mahogC, { repeat: [2, 1] }), roughness: .35, clearcoat: .7, clearcoatRoughness: .25 });
  const plinth = add(new THREE.Mesh(new THREE.BoxGeometry(31, .7, 7), mahog)); plinth.position.set(.6, -1.9, -1.8);
  const step = add(new THREE.Mesh(new THREE.BoxGeometry(31.8, .2, 7.6), mahog)); step.position.set(.6, -2.35, -1.8);
  for (const cx of [-7, 6]) { const h = 1.55; const c = add(new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, h, 16), brass)); c.position.set(cx, -1.55 + h / 2, -BEAM / 2); const cr = add(new THREE.Mesh(new THREE.BoxGeometry(.9, .14, BEAM * .8), brass)); cr.position.set(cx, -.04, -BEAM / 2); }

  // a lamp in every room, hung from the deck above, so each reads as a lit space
  const lamps = new Map<RoomId, THREE.PointLight>();
  for (const r of ROOMS) {
    const x = (r.x0 + r.x1) / 2, y = r.y1 - .55;
    const glass = add(new THREE.Mesh(new THREE.SphereGeometry(.11, 16, 12), new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb860', emissiveIntensity: 2.2 })));
    glass.position.set(x, y, -1.4); glass.castShadow = false;
    const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(.06, .12, .1, 12), brass)); cap.position.set(x, y + .12, -1.4);
    const chain = add(new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .3, 4), brass)); chain.position.set(x, y + .33, -1.4);
    const l = new THREE.PointLight('#ffc88a', 6, (r.x1 - r.x0) * 1.1, 1.6); l.position.set(x, y - .1, -2.2);
    l.castShadow = false; ship.add(l); lamps.set(r.id, l);
  }
  return { ship, lamps, materials: { brass, oak, deck, section, black, paint } };
}
