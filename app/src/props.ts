// What is in each room of the model, drawn from the live voyage.
import { THREE, canvas, type Room } from './kit.ts';
import { BEAM, DECK, ROOMS, type RoomId } from './ship.ts';
import { organism, scaleBar, chart, paper, INK, SOFT } from './drawings.ts';
import { pct, type Entrant, type Telling, type Voyage } from './data.ts';

const box = (r: RoomId) => ROOMS.find(x => x.id === r)!;
const wallZ = -BEAM + .26;

export function furnish(room: Room, ship: THREE.Group, o: { voyage: Voyage; entrants: Entrant[]; telling: Telling | null; generation: number }) {
  const { tex } = room;
  const add = <T extends THREE.Object3D>(x: T) => { x.traverse(c => { (c as THREE.Mesh).castShadow = (c as THREE.Mesh).receiveShadow = true; }); ship.add(x); return x; };
  const oak = new THREE.MeshStandardMaterial({ color: '#5a3c22', roughness: .7 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a4a', metalness: 1, roughness: .3 });
  // paper under the gallery spot: toned down so it reads instead of glaring
  const paperMat = (c: HTMLCanvasElement) => new THREE.MeshStandardMaterial({ map: tex(c), roughness: .95, color: '#bdb39c' });
  const jars: { id: string; mesh: THREE.Group; fluid: THREE.Mesh }[] = [];

  // THE HOLD: one jar per entrant on two shelves, the spirit risen to its score
  {
    const b = box('specimens'), n = o.entrants.length, perShelf = Math.ceil(n / 2);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#dfe9e2', roughness: .05, transparent: true, opacity: .26, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#cfdcd4', roughness: .2, transparent: true, opacity: .7 });
    const spirit = new THREE.MeshStandardMaterial({ color: '#b5731c', roughness: .3, transparent: true, opacity: .78, emissive: '#5a2a02', emissiveIntensity: .6 });
    const cork = new THREE.MeshStandardMaterial({ color: '#a07a4c', roughness: .95 });
    const bone = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: .6 });
    // one row along the hold, best first from stern to bow, each with a small paper label below
    const y = b.y0 + .05, n2 = o.entrants.length;
    const shelf = add(new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0 - .5, .07, .8), oak)); shelf.position.set((b.x0 + b.x1) / 2, y - .03, wallZ + .42);
    o.entrants.forEach((e, i) => {
      const x = b.x0 + .55 + i * ((b.x1 - b.x0 - 1.1) / Math.max(1, n2 - 1)), g = new THREE.Group(); g.position.set(x, y, wallZ + .42);
      const jh = 1.18, jr = .27, lvl = Math.max(.02, e.mean * (jh - .12));
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(jr, jr, jh, 32, 1, true), glass)).position.y = jh / 2;
      for (const yy of [.015, jh - .01]) { const rr = new THREE.Mesh(new THREE.TorusGeometry(jr, .014, 8, 40), rimMat); rr.rotation.x = Math.PI / 2; rr.position.y = yy; g.add(rr); }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(jr, jr, .03, 32), rimMat); base.position.y = .015; g.add(base);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(jr - .02, jr - .02, lvl, 32), spirit); f.position.y = lvl / 2 + .03; g.add(f);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(jr * .8, jr * .72, .14, 20), cork); c.position.y = jh + .06; g.add(c);
      const sp = new THREE.Mesh(e.control ? new THREE.BoxGeometry(.14, .14, .14) : new THREE.SphereGeometry(.09, 16, 12), bone); sp.position.y = Math.min(lvl, jh * .7) * .5 + .1; g.add(sp);
      const lab = canvas(256, 128, (k, w, h) => { paper(k, w, h, '#e9dfc6', 90 + i); k.fillStyle = INK; k.font = '500 54px "EB Garamond"'; k.textAlign = 'center'; k.fillText(String(pct(e.mean)), w / 2, 62); k.font = 'italic 22px "EB Garamond"'; k.fillStyle = SOFT; k.fillText(e.control ? 'control' : `No. ${i + 1}`, w / 2, 100); }, 90 + i);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(.46, .23), new THREE.MeshStandardMaterial({ map: tex(lab), roughness: .9, color: '#d8cfb8' })); l.position.set(0, .42, jr + .005); g.add(l);
      add(g); jars.push({ id: e.genome, mesh: g, fluid: f });
    });
  }

  // THE DRAWING ROOM: plates of the leading agents pinned to the far side, a sloped desk
  {
    const b = box('drawing'), lead = o.entrants.filter(e => !e.control).slice(0, 5);
    lead.forEach((e, i) => {
      const c = canvas(420, 520, (k, w, h) => {
        paper(k, w, h, '#efe7d3', 30 + i);
        k.strokeStyle = 'rgba(36,28,20,.6)'; k.lineWidth = 2; k.strokeRect(14, 14, w - 28, h - 28);
        organism(k, { ...e.body!, id: e.genome }, w / 2, 200, 120);
        scaleBar(k, 50, w - 50, 380, e.mean, e.lo, e.hi, 2);
        k.fillStyle = INK; k.font = '30px "IM Fell English"'; k.fillText(`Fig. ${i + 1}. ${e.name}`, 30, 445, w - 60);
        k.font = '500 40px "EB Garamond"'; k.fillText(String(pct(e.mean)), 30, 495); k.font = 'italic 24px "EB Garamond"'; k.fillStyle = SOFT; k.textAlign = 'right'; k.fillText(`${pct(e.lo)} to ${pct(e.hi)}`, w - 30, 495); k.textAlign = 'left';
      }, 40 + i);
      const p = add(new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.3), paperMat(c))); p.position.set(b.x0 + 1.1 + i * 1.55, b.y0 + 1.2, wallZ + .02); p.rotation.z = (i % 2 ? .015 : -.012);
    });
    const desk = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, .08, 1.0), oak)); desk.position.set(b.x1 - 1.6, b.y0 + .82, -1.6); desk.rotation.x = -.25;
    for (const dx of [-.95, .95]) add(new THREE.Mesh(new THREE.BoxGeometry(.08, .8, .08), oak)).position.set(b.x1 - 1.6 + dx, b.y0 + .4, -1.6);
  }

  // THE CHART ROOM: the chart table under its lamp, the telling task's chart laid on it
  {
    const b = box('chart'), cx = (b.x0 + b.x1) / 2 + .4;
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(3.4, .1, 2.0), oak)); top.position.set(cx, b.y0 + .9, -1.3);
    for (const [dx, dz] of [[-1.5, -.8], [1.5, -.8], [-1.5, .8], [1.5, .8]]) add(new THREE.Mesh(new THREE.BoxGeometry(.1, .85, .1), oak)).position.set(cx + dx, b.y0 + .43, -1.3 + dz);
    if (o.telling) {
      // a map for geotagging; for any other arena, the item itself on a sheet of paper
      const truth = o.telling.task.truth as { places?: unknown[] } | null;
      const c = truth && Array.isArray(truth.places) ? canvas(1600, 1000, (k, w, h) => chart(k, w, h, o.telling!)) : canvas(1600, 1000, (k, w, h) => {
        paper(k, w, h, '#f4eedd', 9); k.fillStyle = '#2b2925'; k.font = '34px "Courier Prime", monospace';
        o.telling!.task.shown.split('\n').slice(0, 22).forEach((l, i) => k.fillText(l.slice(0, 70), 90, 110 + i * 40));
      });
      const ch = add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 1, color: '#9e9682' }))); ch.rotation.x = -Math.PI / 2 + .55; ch.position.set(cx, b.y0 + 1.15, -1.25);
    }
    // the stern windows: dusk light through the transom
    const win = new THREE.MeshStandardMaterial({ color: '#c9b48a', emissive: '#d9a860', emissiveIntensity: .7 });
    for (let i = 0; i < 4; i++) add(new THREE.Mesh(new THREE.PlaneGeometry(.55, .8), win)).position.set(b.x0 + .1 + i * .7, b.y0 + 1.05, wallZ - .01);
    // dividers and a sextant on the chart's edge
    const sx = add(new THREE.Mesh(new THREE.TorusGeometry(.22, .02, 8, 24, Math.PI / 3), brass)); sx.position.set(cx + 1.2, b.y0 + 1.0, -.5); sx.rotation.x = -Math.PI / 2;
  }

  // THE CAPTAIN'S LOG: a desk with the log open on it, the voyage's own figures written in
  {
    const b = box('log'), cx = (b.x0 + b.x1) / 2;
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(2.6, .1, 1.3), oak)); top.position.set(cx, b.y0 + .85, -1.6);
    for (const [dx, dz] of [[-1.2, -.5], [1.2, -.5], [-1.2, .5], [1.2, .5]]) add(new THREE.Mesh(new THREE.BoxGeometry(.1, .8, .1), oak)).position.set(cx + dx, b.y0 + .4, -1.6 + dz);
    const v = o.voyage;
    const c = canvas(1200, 800, (k, w, h) => {
      paper(k, w, h, '#ece2c8', 71); k.fillStyle = 'rgba(60,40,20,.35)'; k.fillRect(w / 2 - 2, 0, 4, h);
      k.fillStyle = INK; k.font = '44px "IM Fell English"'; k.fillText('The Log', 60, 90);
      k.font = 'italic 28px "EB Garamond"'; k.fillStyle = SOFT; k.fillText(`Voyage ${v.id}`, 60, 136);
      k.font = '30px "EB Garamond"'; k.fillStyle = INK;
      const lines = [`Began ${v.started_at.slice(0, 10)}.`, `Spent $${v.spent.toFixed(2)} of $${v.settings.capVoyage}.`, `${o.entrants.length} entrants raced.`, 'Sealed test fingerprint:', v.sealed_hash.slice(0, 32), v.sealed_hash.slice(32)];
      lines.forEach((l, i) => k.fillText(l, 60, 210 + i * 46));
      k.font = '30px "EB Garamond"'; o.entrants.slice(0, 9).forEach((e, i) => { k.fillText(e.name, w / 2 + 50, 100 + i * 46, 380); k.textAlign = 'right'; k.fillText(String(pct(e.mean)), w - 60, 100 + i * 46); k.textAlign = 'left'; });
    }, 72);
    const book = add(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.07), paperMat(c))); book.rotation.x = -Math.PI / 2 + .5; book.position.set(cx, b.y0 + 1.05, -1.5);
    const chest = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, .7, .8), new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: .6 }))); chest.position.set(b.x0 + 1.0, b.y0 + .35, -2.6);
  }

  // THE FOSSIL LOCKER: stone slabs waiting, still blank; nothing has been fossilised yet
  {
    const b = box('fossils'), stone = new THREE.MeshStandardMaterial({ color: '#8f877a', roughness: .95 });
    for (let i = 0; i < 3; i++) { const s = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, .7, .12), stone)); s.position.set(b.x0 + 1.1 + i * 1.3, b.y0 + .4, wallZ + .2); s.rotation.z = (i - 1) * .06; }
  }

  // THE FORECASTLE: the binnacle, where the course is set (Settings)
  {
    const b = box('settings'), cx = (b.x0 + b.x1) / 2;
    const post = add(new THREE.Mesh(new THREE.CylinderGeometry(.22, .3, .9, 16), oak)); post.position.set(cx, b.y0 + .45, -1.4);
    const bowl = add(new THREE.Mesh(new THREE.SphereGeometry(.3, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), brass)); bowl.position.set(cx, b.y0 + .9, -1.4);
    const lamp = add(new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, .3, 12), brass)); lamp.position.set(cx + .35, b.y0 + 1.1, -1.4);
  }
  void DECK;
  return { jars };
}
