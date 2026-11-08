import { createRoom, THREE, canvas, grain } from './kit.ts';
import { buildShip, ROOMS, BEAM, type RoomId } from './ship.ts';
import { furnish } from './props.ts';
import { api, entrants, pct, type Voyage, type Generation, type Telling } from './data.ts';

const room = createRoom(document.getElementById('stage')!);
const { scene, camera, renderer, composer, tex } = room;

// the gallery: a dark green wall, a floor in shadow
scene.background = new THREE.Color('#121512');
const wallC = canvas(1024, 1024, (k, w, h, r) => { k.fillStyle = '#1f2722'; k.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { k.strokeStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${.012 + r() * .018})`; k.lineWidth = 1 + r() * 3; const x = r() * w, y = r() * h; k.beginPath(); k.moveTo(x, y); k.lineTo(x + (r() - .5) * 6, y + 20 + r() * 60); k.stroke(); } grain(k, w, h, 7, r); });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ map: tex(wallC, { repeat: [6, 3] }), roughness: .95 }));
wall.position.set(0, 8, -9); wall.receiveShadow = true; scene.add(wall);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshStandardMaterial({ color: '#17130f', roughness: .9 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -2.45; floor.receiveShadow = true; scene.add(floor);

scene.add(new THREE.HemisphereLight('#d8d0c0', '#0b0907', .12));
const key = new THREE.SpotLight('#ffe4c0', 520, 0, .5, .7, 1.2); key.position.set(-14, 30, 26); key.target.position.set(0, 4, -1); scene.add(key.target);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -.0002; key.shadow.normalBias = .03; key.shadow.radius = 6; scene.add(key);
const fill = new THREE.DirectionalLight('#aebfd6', .25); fill.position.set(20, 8, 20); scene.add(fill);

// the voyage: the most recent one with a finished generation, read from the API
const voyages = await api<Voyage[]>('/voyages', []);
const voyage = voyages.find(v => (v as any).spent > 0 && v.arena === 'geotag') ?? voyages[0];
const full = voyage ? await api<Voyage>(`/voyages/${voyage.id}`) : null;
const genN = full?.generations.filter(g => g.generation >= 0).at(-1)?.generation ?? 0;
const gen = full ? await api<Generation>(`/voyages/${full.id}/generations/${genN}`) : null;
const telling = full ? await api<Telling | null>(`/voyages/${full.id}/generations/${genN}/telling`, null) : null;
const es = gen ? entrants(gen) : [];

const { ship, lamps } = buildShip(room);
if (full && gen) furnish(room, ship, { voyage: full, entrants: es, telling, generation: genN });

// tags: what each room is and what is in it now, in plain words
const lead = es.find(e => !e.control);
const TAGS: Record<RoomId, { name: string; line: string }> = {
  chart: { name: 'The chart room', line: telling ? `Where ${telling.answers.length} answers fell on one news item` : 'No task has been answered yet' },
  drawing: { name: 'The drawing room', line: lead ? `Leading: ${lead.name}, ${pct(lead.mean)} of 100` : 'No agents drawn yet' },
  specimens: { name: 'The hold', line: `${es.filter(e => !e.control).length} agents and ${es.filter(e => e.control).length} controls, each in its jar` },
  log: { name: 'The log', line: full ? `$${full.spent.toFixed(2)} spent; the sealed test fingerprinted` : 'No voyage yet' },
  fossils: { name: 'The fossil locker', line: 'Empty: no skill has been fossilised yet' },
  settings: { name: 'The forecastle', line: 'Settings' },
};
const layer = document.getElementById('tags')!;
const svg = document.getElementById('leaders') as unknown as SVGSVGElement;
const tagEls = new Map<RoomId, HTMLAnchorElement>();
for (const r of ROOMS) {
  const a = document.createElement('a'); a.className = 'tag'; a.href = `#/${r.id}`;
  a.innerHTML = `<b>${TAGS[r.id].name}</b><span>${TAGS[r.id].line}</span>`;
  a.addEventListener('mouseenter', () => hover(r.id)); a.addEventListener('mouseleave', () => hover(null));
  a.addEventListener('focus', () => hover(r.id)); a.addEventListener('blur', () => hover(null));
  layer.appendChild(a); tagEls.set(r.id, a);
}
// where each tag sits: above the ship for the upper rooms, below it for the hold
const SIDE: Record<RoomId, 'above' | 'below'> = { chart: 'above', settings: 'above', drawing: 'above', log: 'below', specimens: 'below', fossils: 'below' };
function placeTags() {
  const v = new THREE.Vector3(), lines: string[] = [];
  const slots = { above: [] as [RoomId, number, number][], below: [] as [RoomId, number, number][] };
  for (const r of ROOMS) { v.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, -BEAM / 2).project(camera); slots[SIDE[r.id]].push([r.id, (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]); }
  for (const side of ['above', 'below'] as const) {
    const row = slots[side].sort((a, b) => a[1] - b[1]);
    row.forEach(([id, ax, ay], i) => {
      const el = tagEls.get(id)!, w = el.offsetWidth, h = el.offsetHeight;
      const tx = Math.max(16, Math.min(innerWidth - w - 16, ax - w / 2 + (i - (row.length - 1) / 2) * 40));
      const ty = side === 'above' ? innerHeight * .1 + (i % 2) * (h + 10) : innerHeight * .86 - h - (i % 2) * (h + 10);
      el.style.transform = `translate(${tx}px, ${ty}px)`;
      const ex = tx + w / 2, ey = side === 'above' ? ty + h : ty;
      lines.push(`<path d="M${ex},${ey} L${ex},${(ey + ay) / 2} L${ax},${(ey + ay) / 2} L${ax},${ay}" /><circle cx="${ax}" cy="${ay}" r="3.5"/>`);
    });
  }
  svg.innerHTML = lines.join('');
}

let hovered: RoomId | null = null;
function hover(id: RoomId | null) {
  hovered = id;
  for (const [rid, l] of lamps) l.userData.target = rid === id ? 22 : id ? 3 : 6;
  for (const [rid, el] of tagEls) el.classList.toggle('dim', !!id && rid !== id);
}
for (const l of lamps.values()) l.userData.target = l.intensity;

// the plaque: what this is, in a sentence
const plaque = document.getElementById('plaque')!;
plaque.innerHTML = full && gen
  ? `<b>HMS Beagle</b><span>A section through the voyage ${full.id}. ${gen.racing ? `Generation ${genN + 1} is racing.` : `Generation ${genN + 1} has raced: ${gen.runs} runs on ${full.settings.raceTasks} news items with every place name hidden.`}${lead ? ` ${lead.name} leads, placing ${lead.within} of ${lead.tasks} items within 25 km.` : ''}</span>`
  : '<b>HMS Beagle</b><span>No voyage yet. Start one from the forecastle.</span>';

function frame() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h;
  const v = THREE.MathUtils.degToRad(camera.fov), needW = 34, needH = 21;
  const d = Math.max((needH / 2) / Math.tan(v / 2), (needW / 2) / (Math.tan(v / 2) * camera.aspect));
  camera.position.set(.8, 5.4, d); camera.lookAt(.8, 5.0, -1); camera.updateProjectionMatrix();
  placeTags();
}
addEventListener('resize', frame);
document.getElementById('loading')?.remove();
frame();
renderer.setAnimationLoop(() => {
  for (const l of lamps.values()) l.intensity += ((l.userData.target ?? 6) - l.intensity) * .12;
  composer.render();
});
(window as any).beagle = { hover, rooms: () => ROOMS.map(r => r.id), hovered: () => hovered };
