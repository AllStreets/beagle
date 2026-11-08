import { createRoom, THREE, canvas, grain } from './kit.ts';
import { buildShip } from './ship.ts';

const room = createRoom(document.getElementById('stage')!);
const { scene, camera, renderer, composer, tex } = room;

// the gallery: a dark green wall, a floor in shadow
scene.background = new THREE.Color('#121512');
const wallC = canvas(1024, 1024, (k, w, h, r) => { k.fillStyle = '#1f2722'; k.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { k.strokeStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${.012 + r() * .018})`; k.lineWidth = 1 + r() * 3; const x = r() * w, y = r() * h; k.beginPath(); k.moveTo(x, y); k.lineTo(x + (r() - .5) * 6, y + 20 + r() * 60); k.stroke(); } grain(k, w, h, 7, r); });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ map: tex(wallC, { repeat: [6, 3] }), roughness: .95 }));
wall.position.set(0, 8, -9); wall.receiveShadow = true; scene.add(wall);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshStandardMaterial({ color: '#17130f', roughness: .9 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -2.68; floor.receiveShadow = true; scene.add(floor);

buildShip(room);

// light: gallery spots from above and left, warm; a cool fill
scene.add(new THREE.HemisphereLight('#d8d0c0', '#0b0907', .12));
const key = new THREE.SpotLight('#ffe4c0', 520, 0, .5, .7, 1.2); key.position.set(-14, 30, 26); key.target.position.set(0, 4, -1); scene.add(key.target);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -.0002; key.shadow.normalBias = .03; key.shadow.radius = 6; scene.add(key);
const fill = new THREE.DirectionalLight('#aebfd6', .25); fill.position.set(20, 8, 20); scene.add(fill);

function frame() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h;
  const v = THREE.MathUtils.degToRad(camera.fov), needW = 36, needH = 19;
  const d = Math.max((needH / 2) / Math.tan(v / 2), (needW / 2) / (Math.tan(v / 2) * camera.aspect));
  camera.position.set(1, 6, d); camera.lookAt(1, 5.2, -1); camera.updateProjectionMatrix();
}
addEventListener('resize', frame); frame();
document.getElementById('loading')?.remove();
renderer.setAnimationLoop(() => composer.render());
