// The room the ship sits in: renderer, light, post-processing, and materials made in code.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export { THREE };

export const rng = (seed = 1) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export function canvas(w: number, h: number, draw: (k: CanvasRenderingContext2D, w: number, h: number, r: () => number) => void, seed = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!, w, h, rng(seed)); return c;
}
export function grain(k: CanvasRenderingContext2D, w: number, h: number, amp: number, r: () => number) {
  const id = k.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - .5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  k.putImageData(id, 0, 0);
}

export function createRoom(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .35;
  const camera = new THREE.PerspectiveCamera(24, 1, .1, 400);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1); ao.blendIntensity = .8; ao.updateGtaoMaterial({ radius: .6, distanceExponent: 1.4, thickness: 2, scale: 1, samples: 16 }); composer.addPass(ao);
  composer.addPass(new OutputPass());
  const tex = (c: HTMLCanvasElement, o: { color?: boolean; repeat?: [number, number] } = {}) => {
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...(o.repeat ?? [1, 1]));
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (o.color !== false) t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  return { renderer, scene, camera, composer, ao, tex };
}
export type Room = ReturnType<typeof createRoom>;

// Planks: long boards with butt joints, grain, and a slight variation board to board.
export function planks(o: { w?: number; h?: number; base: string; dark: string; light: string; rows: number; seed?: number; tar?: boolean }) {
  const W = o.w ?? 2048, H = o.h ?? 1024;
  return canvas(W, H, (k, w, h, r) => {
    const row = h / o.rows;
    for (let i = 0; i < o.rows; i++) {
      let x = -r() * 600;
      while (x < w) {
        const len = 500 + r() * 700, y = i * row;
        k.fillStyle = o.base; k.fillRect(x, y, len, row);
        k.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,240,220'},${.03 + r() * .07})`; k.fillRect(x, y, len, row);
        for (let g = 0; g < 26; g++) { k.strokeStyle = r() < .6 ? o.dark : o.light; k.globalAlpha = .1 + r() * .22; k.lineWidth = .6 + r() * 1.6; const gy = y + r() * row, amp = r() * 3; k.beginPath(); for (let gx = x; gx < x + len; gx += 20) k.lineTo(gx, gy + Math.sin(gx * .01 + g) * amp); k.stroke(); }
        k.globalAlpha = 1; k.fillStyle = o.tar ? 'rgba(10,6,3,.85)' : 'rgba(20,12,6,.6)'; k.fillRect(x + len - 2, y, 2.5, row);
        x += len;
      }
      k.fillStyle = o.tar ? 'rgba(12,8,4,.9)' : 'rgba(25,15,8,.55)'; k.fillRect(0, i * row, w, o.tar ? 3.5 : 2);
    }
    grain(k, w, h, 10, r);
  }, o.seed ?? 3);
}
