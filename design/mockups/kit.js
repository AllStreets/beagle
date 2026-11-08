// Shared by the three cabinet concepts: the room, the light, and materials made in code.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export { THREE };

export const FELL = '"IM Fell English"', FELL_SC = '"IM Fell English SC"', GARAMOND = '"EB Garamond"';
export async function fonts() {
  for (const f of [`28px ${FELL}`, `italic 28px ${FELL}`, `28px ${FELL_SC}`, `28px ${GARAMOND}`, `italic 28px ${GARAMOND}`, `500 28px ${GARAMOND}`]) await document.fonts.load(f);
  await document.fonts.ready;
}

export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function canvas(w, h, draw, seed = 1) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h, rng(seed)); return c; }
export function grain(k, w, h, amp, r) { const id = k.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; } k.putImageData(id, 0, 0); }

export function room(host, { background = '#0d0a07', exposure = 1 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(background);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .3;
  const camera = new THREE.PerspectiveCamera(30, 1, .05, 100);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1); ao.blendIntensity = .75; ao.updateGtaoMaterial({ radius: .25, distanceExponent: 1.3, thickness: 1, scale: 1, samples: 16 }); composer.addPass(ao);
  composer.addPass(new OutputPass());
  const tex = (c, { color = true, repeat = [1, 1] } = {}) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (color) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const fit = (cx, cy, cz, width, height, tilt = .22) => {
    const resize = () => {
      const w = innerWidth, h = innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h;
      const v = THREE.MathUtils.degToRad(camera.fov), d = Math.max((height / 2) / Math.tan(v / 2), (width / 2) / (Math.tan(v / 2) * camera.aspect)) * 1.02;
      camera.position.set(cx, cy + d * Math.sin(tilt), cz + d * Math.cos(tilt)); camera.lookAt(cx, cy, cz); camera.updateProjectionMatrix();
    };
    addEventListener('resize', resize); resize();
  };
  return { renderer, scene, camera, composer, tex, fit, render: () => composer.render() };
}

// mahogany: deep red-brown, close straight grain with ray flecks, a varnished sheen
export function mahogany(seed = 3) {
  return canvas(1024, 1024, (k, w, h, r) => {
    k.fillStyle = '#4a2015'; k.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x0 = r() * w, amp = 1 + r() * 5, f = .004 + r() * .01, ph = r() * 7;
      k.strokeStyle = r() < .55 ? `rgba(30,8,4,${.08 + r() * .2})` : `rgba(140,60,35,${.04 + r() * .1})`; k.lineWidth = .5 + r() * 2.2;
      k.beginPath(); for (let y = 0; y <= h; y += 12) { const x = x0 + Math.sin(y * f + ph) * amp; y ? k.lineTo(x, y) : k.moveTo(x, y); } k.stroke();
    }
    for (let i = 0; i < 260; i++) { k.fillStyle = `rgba(180,90,55,${.04 + r() * .06})`; k.fillRect(r() * w, r() * h, 2 + r() * 10, 1 + r() * 1.5); }
    grain(k, w, h, 10, r);
  }, seed);
}
export function paperStock(w, h, seed = 5, base = '#efe6d2') {
  return canvas(w, h, (k, W, H, r) => {
    k.fillStyle = base; k.fillRect(0, 0, W, H);
    for (let i = 0; i < (W * H) / 4000; i++) { k.strokeStyle = `rgba(110,85,50,${.03 + r() * .05})`; k.lineWidth = .6; const x = r() * W, y = r() * H, a = r() * 6.3, l = 4 + r() * 14; k.beginPath(); k.moveTo(x, y); k.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); k.stroke(); }
    grain(k, W, H, 8, r);
    const g = k.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,60,25,.16)'); k.fillStyle = g; k.fillRect(0, 0, W, H);
  }, seed);
}
export function wrap(k, text, x, y, maxW, lh, maxLines = 99) {
  const words = String(text).split(/\s+/); let line = '', n = 0;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (k.measureText(t).width > maxW && line) { if (++n >= maxLines) { k.fillText(line + '…', x, y); return y + lh; } k.fillText(line, x, y); y += lh; line = w; } else line = t; }
  if (line) { k.fillText(line, x, y); y += lh; }
  return y;
}
export const pct = x => `${Math.round(x * 100)}`;
export async function data() { return (await fetch('data.json')).json(); }
