import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ============================================================
//  東京タワー、見上げる場所。  60 seconds
// ============================================================
const DUR = 60;
const qs = new URLSearchParams(location.search);
const RENDER = qs.has('render');

// ---------- utils ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let rng = mulberry32(20261114);
const R = () => rng();
const RR = (a, b) => a + (b - a) * rng();
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeIO = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- renderer / stage ----------
const stage = document.getElementById('stage');
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: RENDER, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const FOGC = new THREE.Color('#2c2640');
scene.fog = new THREE.FogExp2(FOGC, 0.00030);
const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 30000);

function resize() {
  let w, h;
  if (RENDER) { w = 1920; h = 1080; renderer.setPixelRatio(parseFloat(qs.get('ss') || '1')); }
  else {
    const vw = window.innerWidth, vh = window.innerHeight;
    w = vw; h = vw * 9 / 16; if (h > vh) { h = vh; w = vh * 16 / 9; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  stage.style.fontSize = (h / 1080 * 16) + 'px';
  renderer.setSize(w, h, false);
  camera.aspect = 16 / 9; camera.updateProjectionMatrix();
}

// ---------- textures ----------
function makeGlowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.6)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.15)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const GLOW = makeGlowTex();
const spriteMats = new Map();
function glowMat(color, opacity) {
  const k = color + '|' + opacity;
  if (!spriteMats.has(k)) spriteMats.set(k, new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  return spriteMats.get(k);
}
function glow(color, size, opacity = 1) { const s = new THREE.Sprite(glowMat(color, opacity)); s.scale.set(size, size, 1); return s; }

function makeWindowTex(seed, kind) {
  const r = mulberry32(seed);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = kind === 'res' ? '#15131a' : '#0f1119'; g.fillRect(0, 0, 256, 256);
  const warm = ['#ffd49a', '#ffe2b8', '#f7c98a', '#ffeccc'];
  const cool = ['#d9e6ff', '#c3d6ff', '#eef3ff'];
  const litP = kind === 'office' ? 0.55 : kind === 'res' ? 0.42 : 0.48;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    const x = col * 32, y = row * 32;
    if (r() < litP) {
      const useCool = kind === 'office' ? r() < 0.7 : kind === 'res' ? r() < 0.15 : r() < 0.4;
      g.fillStyle = useCool ? cool[Math.floor(r() * cool.length)] : warm[Math.floor(r() * warm.length)];
      g.globalAlpha = 0.55 + r() * 0.45;
      g.fillRect(x + 6, y + 8, 21, 16);
      if (r() < 0.3) { g.fillStyle = 'rgba(40,30,30,0.5)'; g.fillRect(x + 6, y + 8, 21, 5 + r() * 8); }
      g.globalAlpha = 1;
    } else {
      g.fillStyle = r() < 0.5 ? '#161b2a' : '#121522';
      g.fillRect(x + 6, y + 8, 21, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------- geometry builder (merged boxes, vertex colors) ----------
class BB {
  constructor() { this.p = []; this.uv = []; this.c = []; this.i = []; }
  face(o, right, up, w, h, uv0, uv1, col) {
    const n = this.p.length / 3;
    const a = o, b = o.clone().addScaledVector(right, w), cc = b.clone().addScaledVector(up, h), d = o.clone().addScaledVector(up, h);
    for (const v of [a, b, cc, d]) this.p.push(v.x, v.y, v.z);
    this.uv.push(uv0[0], uv0[1], uv1[0], uv0[1], uv1[0], uv1[1], uv0[0], uv1[1]);
    for (let k = 0; k < 4; k++) this.c.push(col.r, col.g, col.b);
    this.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  building(x, z, w, d, h, uo, vo, TW = 28.8, TH = 28, y0 = 0) {
    const UP = V(0, 1, 0);
    const sides = [[V(1, 0, 0), d, 0.92], [V(-1, 0, 0), d, 0.74], [V(0, 0, 1), w, 0.84], [V(0, 0, -1), w, 0.66]];
    for (const [n, len, sh] of sides) {
      const right = new THREE.Vector3().crossVectors(UP, n);
      const center = V(x + n.x * w / 2, y0, z + n.z * d / 2);
      const o = center.clone().addScaledVector(right, -len / 2);
      const col = new THREE.Color(sh, sh, sh);
      this.face(o, right, UP, len, h, [uo, vo], [uo + len / TW, vo + h / TH], col);
    }
    const top = V(x - w / 2, y0 + h, z + d / 2);
    this.face(top, V(1, 0, 0), V(0, 0, -1), w, d, [0.01, 0.01], [0.011, 0.011], new THREE.Color(0.5, 0.5, 0.55));
  }
  quad(o, right, up, w, h, color) { this.face(o, right, up, w, h, [0, 0], [1, 1], new THREE.Color(color)); }
  box(x, y, z, w, h, d, color) {
    const UP = V(0, 1, 0); const col = new THREE.Color(color);
    const sides = [[V(1, 0, 0), d], [V(-1, 0, 0), d], [V(0, 0, 1), w], [V(0, 0, -1), w]];
    for (const [n, len] of sides) {
      const right = new THREE.Vector3().crossVectors(UP, n);
      const center = V(x + n.x * w / 2, y, z + n.z * d / 2);
      this.face(center.clone().addScaledVector(right, -len / 2), right, UP, len, h, [0, 0], [1, 1], col);
    }
    this.face(V(x - w / 2, y + h, z + d / 2), V(1, 0, 0), V(0, 0, -1), w, d, [0, 0], [1, 1], col);
  }
  geom() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

function hipRoofGeom(w, d, h) {
  if (d > w) { const g = hipRoofGeom(d, w, h); g.rotateY(Math.PI / 2); return g; }
  const hw = w / 2, hd = d / 2, r = hw - hd;
  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd], R1 = [-r, h, 0], R2 = [r, h, 0];
  const tris = [D, C, R2, D, R2, R1, B, A, R1, B, R1, R2, C, B, R2, A, D, R1, A, C, D, A, B, C];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

// ---------- materials ----------
const lamCache = new Map();
function lam(color, emi = 0) {
  const k = color + '|' + emi;
  if (!lamCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color }); if (emi) m.emissive = new THREE.Color(color).multiplyScalar(emi); lamCache.set(k, m); }
  return lamCache.get(k);
}
const basCache = new Map();
function bas(color) { if (!basCache.has(color)) basCache.set(color, new THREE.MeshBasicMaterial({ color })); return basCache.get(color); }
const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y + h / 2, z); return m; }

// ---------- lights ----------
const hemi = new THREE.HemisphereLight('#8f9fd6', '#3b2c24', 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffcf9e', 0.55); sun.position.set(900, 420, 500); scene.add(sun);
const PL = [];
for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ffd6a0', 0, 22, 2); scene.add(l); PL.push(l); }
function setLights(list) { PL.forEach((l, i) => { const s = list[i]; if (s) { l.position.copy(s[0]); l.color.set(s[1]); l.intensity = s[2]; l.distance = s[3] || 22; } else l.intensity = 0; }); }

// ---------- sky ----------
const skyU = { uDark: { value: 0 } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `varying vec3 vDir; void main(){ vDir=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }`,
  fragmentShader: `varying vec3 vDir; uniform float uDark;
  float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  void main(){ float y=vDir.y;
    vec3 zen=vec3(0.045,0.06,0.15), mid=vec3(0.11,0.13,0.28), hor=vec3(0.30,0.23,0.34), glw=vec3(0.45,0.24,0.18);
    vec3 col=mix(hor,mid,smoothstep(0.0,0.22,y)); col=mix(col,zen,smoothstep(0.18,0.8,y));
    col+=glw*pow(1.0-clamp(y,0.,1.),9.0)*0.8;
    col*=1.0-0.28*uDark;
    vec3 d=vDir*700.; vec3 cell=floor(d); float h=hash(cell);
    if(h>0.9972 && y>0.1){ vec3 f=fract(d)-0.5; float s=smoothstep(0.16,0.0,length(f)); col+=vec3(s*0.9); }
    if(y<0.0) col=hor*0.7;
    gl_FragColor=vec4(col,1.); }`
}));
sky.renderOrder = -1; scene.add(sky);

// ============================================================
//  TOKYO TOWER (333m)  — red & white, 11 bands
// ============================================================
const towerGlowU = { value: 0.62 };
const towerHW = (y) => y <= 250 ? 4 + 38 * Math.pow(Math.max(0, 1 - y / 250), 1.8) : (y <= 315 ? 3.6 - (y - 250) / 65 * 2.5 : 0.8);
const BANDH = 333 / 11;
const ORANGE = new THREE.Color('#e63a16'), WHITE = new THREE.Color('#f5ede3');
const bandCol = (y) => (Math.floor(y / BANDH) % 2 === 0) ? ORANGE : WHITE;

function buildTower() {
  const grp = new THREE.Group();
  const members = [];
  const add = (a, b, t) => {
    // split at band boundaries so the red/white bands stay crisp
    let p = a.clone(); const q = b.clone();
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    const cuts = [];
    for (let k = Math.ceil(lo / BANDH); k * BANDH < hi; k++) if (k * BANDH > lo) cuts.push(k * BANDH);
    if (a.y > b.y) cuts.reverse();
    for (const cy of cuts) { const f = (cy - a.y) / (b.y - a.y); const m = a.clone().lerp(b, f); members.push([p, m, t]); p = m; }
    members.push([p, q, t]);
  };
  const hw = towerHW;
  const legW = (y) => 6.8 - y * 0.06;
  const fp = (f, u, y) => { const h = hw(y); switch (f) { case 0: return V(u, y, h); case 1: return V(-u, y, -h); case 2: return V(h, y, -u); default: return V(-h, y, u); } };
  const thC = (y) => 0.55 + hw(y) * 0.034;
  const thB = (y) => 0.2 + hw(y) * 0.011;
  function levelsOf(a, b) { const out = [a]; let y = a; for (;;) { const s = clamp(hw(y) * 0.95, 3.0, 13); if (y + s * 1.45 >= b) { out.push(b); break; } y += s; out.push(y); } return out; }
  const ARCH = 47;
  const L0 = levelsOf(0, ARCH);
  const archU = (y) => Math.max(0, hw(y) - legW(y)) * Math.sqrt(Math.max(0, 1 - Math.pow(y / ARCH, 2.2)));
  for (let f = 0; f < 4; f++) {
    for (const sg of [-1, 1]) {
      for (let i = 0; i < L0.length - 1; i++) {
        const y0 = L0[i], y1 = L0[i + 1];
        const c0 = fp(f, sg * hw(y0), y0), c1 = fp(f, sg * hw(y1), y1);
        const a0 = fp(f, sg * archU(y0), y0), a1 = fp(f, sg * archU(y1), y1);
        if (f < 2) add(c0, c1, thC(y0) * 1.1);
        add(a0, a1, thC(y0) * 0.85);
        add(c0, a1, thB(y0)); add(a0, c1, thB(y0)); add(c1, a1, thB(y1) * 1.1);
      }
    }
    add(fp(f, -hw(ARCH), ARCH), fp(f, hw(ARCH), ARCH), thC(ARCH) * 0.8);
  }
  for (const [a, b] of [[ARCH, 145], [160, 248], [254, 315]]) {
    const Ls = levelsOf(a, b);
    const sc = a >= 254 ? 0.55 : 1;
    for (let i = 0; i < Ls.length - 1; i++) {
      const y0 = Ls[i], y1 = Ls[i + 1];
      for (let f = 0; f < 4; f++) {
        const p00 = fp(f, -hw(y0), y0), p01 = fp(f, hw(y0), y0), p10 = fp(f, -hw(y1), y1), p11 = fp(f, hw(y1), y1);
        if (f < 2) { add(p00, p10, thC(y0) * sc); add(p01, p11, thC(y0) * sc); }
        add(p00, p11, thB(y0) * sc); add(p01, p10, thB(y0) * sc);
        add(p10, p11, thB(y1) * 1.25 * sc);
        // secondary bracing in the wide lower faces
        if (hw(y0) > 14) { const m0 = fp(f, 0, y0), m1 = fp(f, 0, y1); add(m0, m1, thB(y0) * 0.8); }
      }
    }
  }
  for (const [a, b] of [[145, 160], [248, 254]]) for (let f = 0; f < 2; f++) for (const sg of [-1, 1]) add(fp(f, sg * hw(a), a), fp(f, sg * hw(b), b), thC(a));

  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = towerGlowU;
    sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uGlow;');
  };
  const im = new THREE.InstancedMesh(BOX, mat, members.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V(0, 1, 0), sc = V(0, 0, 0), mid = V(0, 0, 0), dir = V(0, 0, 0);
  members.forEach(([a, b, t], i) => {
    dir.subVectors(b, a); const len = dir.length(); dir.normalize();
    q.setFromUnitVectors(up, dir); mid.addVectors(a, b).multiplyScalar(0.5);
    sc.set(t, len + t * 0.5, t); m4.compose(mid, q, sc);
    im.setMatrixAt(i, m4); im.setColorAt(i, bandCol(mid.y));
  });
  grp.add(im);

  // observation decks
  const frame = lam('#e7e1d8', 0.25);
  const win = bas('#ffe1ad');
  grp.add(box(31, 15.5, 31, frame, 0, 144.5, 0));
  grp.add(box(31.3, 3.0, 31.3, win, 0, 147.0, 0));
  grp.add(box(31.3, 3.0, 31.3, win, 0, 154.0, 0));
  grp.add(box(12, 7, 12, frame, 0, 247.5, 0));
  grp.add(box(12.2, 2.4, 12.2, win, 0, 249.8, 0));
  // antenna mast
  for (let k = 0; k < 6; k++) {
    const y0 = 315 + k * 3, r0 = 0.95 - k * 0.11;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.1, r0, 3, 8), lam(k % 2 ? '#f5ede3' : '#e63a16', 0.6));
    m.position.y = y0 + 1.5; grp.add(m);
  }
  // FootTown building under the legs
  grp.add(box(58, 19, 44, lam('#d6cfc4', 0.18), 0, 0, 0));
  for (let k = 0; k < 4; k++) grp.add(box(58.3, 1.6, 44.3, bas('#ffd9a3'), 0, 2.6 + k * 4.2, 0));

  // glow (the tower's own light in the air)
  const glowG = new THREE.Group();
  for (let y = 12; y < 300; y += 16) { const s = glow('#ff6a30', hw(y) * 4.2 + 18, 0.085); s.position.y = y; glowG.add(s); }
  const g1 = glow('#ffe6c0', 70, 0.32); g1.position.y = 152; glowG.add(g1);
  const g2 = glow('#ffe6c0', 26, 0.4); g2.position.y = 251; glowG.add(g2);
  const halo = glow('#ff7a40', 520, 0.07); halo.position.y = 150; glowG.add(halo);
  grp.add(glowG);
  // aviation lights
  const avi = [];
  const aviPts = [V(0, 334, 0), V(0, 316, 0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { aviPts.push(V(sx * 6.1, 254.6, sz * 6.1)); aviPts.push(V(sx * 15.6, 160.2, sz * 15.6)); }
  for (const p of aviPts) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: '#ff2414', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(7, 7, 1); s.position.copy(p); grp.add(s); avi.push(s); }
  grp.userData.avi = avi; grp.userData.glow = glowG;
  return grp;
}
const tower = buildTower();
scene.add(tower);

// ============================================================
//  geography
// ============================================================
// Alley (三田): local +z points away from the tower.
const ALLEY_DIR = new THREE.Vector2(-0.33, 1).normalize();
const ALLEY_O = V(ALLEY_DIR.x * 430, 0, ALLEY_DIR.y * 430);
const ALLEY_ROT = Math.atan2(ALLEY_DIR.x, ALLEY_DIR.y) + 0.045;
const alleyToLocal = (x, z) => { const dx = x - ALLEY_O.x, dz = z - ALLEY_O.z; const c = Math.cos(-ALLEY_ROT), s = Math.sin(-ALLEY_ROT); return { x: dx * c + dz * s, z: -dx * s + dz * c }; };
const alleyToWorld = (lx, ly, lz) => { const c = Math.cos(ALLEY_ROT), s = Math.sin(ALLEY_ROT); return V(ALLEY_O.x + lx * c + lz * s, ly, ALLEY_O.z - lx * s + lz * c); };

const STREET_Z = 14; // half width building line of 大門通り (x 600..1520)
function excluded(x, z) {
  if (Math.hypot(x, z) < 160) return true;
  if (x > 180 && x < 640 && Math.abs(z) < 140) return true; // 増上寺
  if (x > 40 && x < 320 && z > -340 && z < -30) return true; // 芝公園
  if (x > 590 && x < 1540 && Math.abs(z) < STREET_Z + 30) return true; // street + its own buildings
  const L = alleyToLocal(x, z); if (Math.abs(L.x) < 40 && L.z > -25 && L.z < 260) return true;
  if (x > 2480) return true; // bay
  return false;
}

// ---------- ground ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 160, 160), bas('#0b0b11')); ground.rotation.x = -Math.PI / 2; scene.add(ground);
const bay = new THREE.Mesh(new THREE.PlaneGeometry(12000, 40000, 48, 160), bas('#06080f')); bay.rotation.x = -Math.PI / 2; bay.position.set(2520 + 6000, 0.3, 0); scene.add(bay);
const parkG = new THREE.Mesh(new THREE.CircleGeometry(300, 48), bas('#0d120e')); parkG.rotation.x = -Math.PI / 2; parkG.position.set(60, 0.05, -40); scene.add(parkG);

// ============================================================
//  CITY
// ============================================================
function buildCity() {
  const kinds = ['office', 'res', 'mix'];
  const texs = kinds.map((k, i) => makeWindowTex(100 + i, k));
  const bbs = [new BB(), new BB(), new BB()];
  for (let gx = -2200; gx <= 2480; gx += 40) for (let gz = -2200; gz <= 2200; gz += 40) {
    const x = gx + RR(-9, 9), z = gz + RR(-9, 9);
    if (Math.hypot(x, z) > 2450) continue;
    const w = RR(13, 30), d = RR(13, 30);
    const rx = ((x - 37) % 160 + 160) % 160, rz = ((z - 37) % 160 + 160) % 160;
    const dx = Math.min(rx, 160 - rx), dz = Math.min(rz, 160 - rz);
    if (dx < w / 2 + 7 || dz < d / 2 + 7) continue;
    if (excluded(x, z) || excluded(x - w / 2, z - d / 2) || excluded(x + w / 2, z + d / 2) || excluded(x - w / 2, z + d / 2) || excluded(x + w / 2, z - d / 2)) continue;
    let h = RR(7, 22) + (R() < 0.2 ? RR(12, 45) : 0);
    const east = x > 700 && Math.abs(z) < 900, nw = x < -250 && z < -150 && x > -1500 && z > -1500;
    if ((east || nw) && R() < 0.25) h += RR(40, 170);
    else if (R() < 0.04) h += RR(60, 140);
    { const L = alleyToLocal(x, z); if (Math.abs(L.x) < 90 && L.z > 200 && L.z < 1600) h = Math.min(h, 12 + R() * 8); }
    const k = h > 70 ? (R() < 0.8 ? 0 : 2) : (R() < 0.55 ? 1 : 2);
    bbs[k].building(x, z, w, d, h, R(), R());
  }
  // buildings lining 大門通り (street along x, z=0)
  const shop = new BB();
  const shopCols = ['#c8a070', '#d8bc94', '#b09478', '#b4bccc', '#d0a468', '#a89070', '#e0c8a0'];
  const signCols = ['#a8443a', '#c8c4bc', '#b0903a', '#46689a', '#a86080', '#4a8a62'];
  for (const side of [-1, 1]) {
    let x = 600;
    while (x < 1520) {
      const w = RR(9, 19), d = RR(14, 26);
      let h = RR(14, 44) + (R() < 0.18 ? RR(25, 70) : 0);
      const cx = x + w / 2, cz = side * (STREET_Z + d / 2);
      bbs[R() < 0.5 ? 2 : (R() < 0.5 ? 0 : 1)].building(cx, cz, w - 0.5, d, h, R(), R());
      // shop front (ground floor) facing the street
      const n = V(0, 0, -side); const right = new THREE.Vector3().crossVectors(V(0, 1, 0), n);
      const fz = side * (STREET_Z - 0.04);
      const o = V(cx, 0.3, fz).addScaledVector(right, -(w - 1.4) / 2);
      { const col = pick(shopCols); const panes = Math.max(2, Math.round((w - 1.4) / 2.2)); const pw = (w - 1.4) / panes; for (let k = 0; k < panes; k++) shop.quad(o.clone().addScaledVector(right, k * pw + 0.06), right, V(0, 1, 0), pw - 0.12, 2.6, col); }
      // awning strip
      shop.box(cx, 3.5, side * (STREET_Z - 0.6), w - 1.2, 0.35, 1.2, '#2a2420');
      if (R() < 0.5) { // vertical sign
        const sx = x + 0.8, sh = RR(2.2, 4.5);
        shop.box(sx, 5, side * (STREET_Z - 0.6), 0.22, sh, 0.8, pick(signCols));
      }
      if (R() < 0.3) shop.quad(V(cx, 4.2, fz - side * 0.02).addScaledVector(right, -(w - 4) / 2), right, V(0, 1, 0), w - 4, 0.7, pick(signCols));
      x += w;
    }
  }
  const out = new THREE.Group();
  bbs.forEach((b, i) => { const m = new THREE.Mesh(b.geom(), new THREE.MeshBasicMaterial({ map: texs[i], vertexColors: true })); out.add(m); });
  out.add(new THREE.Mesh(shop.geom(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  return out;
}
scene.add(buildCity());

// streetlights & traffic seen from above
const cityLights = (() => {
  const pos = [], col = [];
  const c1 = new THREE.Color('#ffb868'), c2 = new THREE.Color('#fff0d8');
  for (let k = -14; k <= 15; k++) {
    const L = k * 160 + 37;
    for (let s = -2300; s < 2480; s += 28) {
      for (const off of [-9, 9]) {
        const pts = [[L + off, s], [s, L + off]];
        for (const [x, z] of pts) { if (Math.hypot(x, z) > 2450 || excluded(x, z)) continue; pos.push(x, 7, z); const c = R() < 0.7 ? c1 : c2; col.push(c.r, c.g, c.b); }
      }
    }
  }
  // far carpet of lights
  for (let i = 0; i < 26000; i++) {
    const a = R() * Math.PI * 2, r = 2450 + Math.pow(R(), 0.7) * 7500;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (x > 2550 && x < 4700) continue;
    const c = R() < 0.6 ? c1 : (R() < 0.6 ? c2 : new THREE.Color('#cfe0ff'));
    pos.push(x, RR(2, 30), z); col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 14, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9, fog: false }));
  return p;
})();
scene.add(cityLights);

// traffic streams (headlights / taillights)
const traffic = (() => {
  const roads = [];
  for (let k = -12; k <= 13; k += 2) { roads.push({ ax: 'x', L: k * 160 + 37 }); roads.push({ ax: 'z', L: k * 160 + 37 }); }
  const N = 1400; const pos = new Float32Array(N * 3), col = new Float32Array(N * 3); const meta = [];
  for (let i = 0; i < N; i++) {
    const rd = pick(roads); const dir = R() < 0.5 ? 1 : -1; const s0 = RR(-2300, 2400); const v = RR(9, 15);
    meta.push({ rd, dir, s0, v, lane: dir * 3.5 });
    const c = dir > 0 ? new THREE.Color('#fff2dc') : new THREE.Color('#ff3424');
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.frustumCulled = false;
  p.userData.update = (t) => {
    for (let i = 0; i < N; i++) {
      const m = meta[i]; let s = m.s0 + m.dir * m.v * t; s = ((s + 2300) % 4700 + 4700) % 4700 - 2300;
      let x, z; if (m.rd.ax === 'x') { x = m.rd.L + m.lane; z = s; } else { x = s; z = m.rd.L + m.lane; }
      if (Math.hypot(x, z) > 2450 || excluded(x, z)) { pos[i * 3 + 1] = -100; continue; }
      pos[i * 3] = x; pos[i * 3 + 1] = 1.2; pos[i * 3 + 2] = z;
    }
    g.attributes.position.needsUpdate = true;
  };
  return p;
})();
scene.add(traffic);

// ============================================================
//  PEOPLE
// ============================================================
const COATS = ['#2a2d36', '#3b3530', '#4b4540', '#23252b', '#5a5249', '#6e6457', '#2f3640', '#4a3a36', '#1f2228', '#77685a', '#3d4450', '#565a62', '#5e4a3e'];
const PANTS = ['#1d1e22', '#2a2b30', '#24262c', '#33302c'];
const HAIRS = ['#1a1614', '#241d19', '#2e2420', '#121112', '#4a443e'];
const lathe = (pts, seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const capsule = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 16).translate(0, -len / 2, 0);
// tapered limb: ball of radius r0 at the joint (y=0), narrowing to a ball of radius r1 at y=-len.
// neighbouring segments share the joint radius, so elbows and knees read as one continuous sleeve / trouser leg.
const limb = (r0, r1, len, seg = 18) => {
  const pts = [], N = 7;
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI / 2; pts.push([Math.max(1e-4, r0 * Math.sin(a)), r0 * Math.cos(a)]); }
  for (let i = 0; i <= N; i++) { const a = i / N * Math.PI / 2; pts.push([Math.max(1e-4, r1 * Math.cos(a)), -len - r1 * Math.sin(a)]); }
  return lathe(pts.reverse(), seg);
};
const PG = {
  torso: lathe([[0.001, -0.085], [0.12, -0.085], [0.158, -0.078], [0.17, -0.055], [0.171, 0.03], [0.166, 0.12], [0.16, 0.22], [0.166, 0.34], [0.186, 0.45], [0.2, 0.52], [0.203, 0.565], [0.19, 0.605], [0.155, 0.635], [0.105, 0.655], [0.06, 0.668], [0.001, 0.672]], 28),
  skirt: lathe([[0.171, 0.03], [0.186, -0.12], [0.205, -0.35], [0.228, -0.7], [0.24, -0.95], [0.243, -1.0], [0.236, -1.012]].reverse(), 28),
  neck: new THREE.CylinderGeometry(0.046, 0.056, 0.12, 16),
  head: new THREE.SphereGeometry(0.098, 28, 20),
  hair: new THREE.SphereGeometry(0.105, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.6),
  hairBack: new THREE.SphereGeometry(1, 20, 14),
  upper: limb(0.06, 0.047, 0.3), fore: limb(0.047, 0.037, 0.285), hand: new THREE.SphereGeometry(1, 14, 10),
  thigh: limb(0.076, 0.062, 0.46), shin: limb(0.062, 0.046, 0.44),
  shoe: new THREE.CapsuleGeometry(0.046, 0.13, 5, 14).rotateX(Math.PI / 2).translate(0, -0.035, 0.05),
  scarf: new THREE.TorusGeometry(0.075, 0.042, 12, 28),
  tail: new THREE.CapsuleGeometry(0.5, 1, 4, 12),
};
// --- hands: one merged mesh per pose (no extra draw calls), mirrored for left / right ---
function buildHand(side, curls, thumbIn = 0) {
  const inward = -side, parts = [];
  const root = new THREE.Object3D();
  const addM = (geom, parent, pos, scl) => { const o = new THREE.Object3D(); if (pos) o.position.set(pos[0], pos[1], pos[2]); if (scl) o.scale.set(scl[0], scl[1], scl[2]); parent.add(o); parts.push([geom, o]); return o; };
  addM(new THREE.SphereGeometry(1, 14, 10), root, [0, -0.041, 0.001], [0.0165, 0.045, 0.038]);            // palm
  const zf = [0.0265, 0.0085, -0.0095, -0.026], yk = [-0.077, -0.081, -0.079, -0.072];
  const L1 = [0.040, 0.044, 0.041, 0.032], L2 = [0.036, 0.040, 0.037, 0.029], rr = [0.0090, 0.0092, 0.0088, 0.0079];
  for (let i = 0; i < 4; i++) {
    const k = new THREE.Object3D(); k.position.set(0, yk[i], zf[i]); k.rotation.z = inward * curls[i]; root.add(k);
    addM(capsule(rr[i], L1[i] + rr[i]), k, [0, rr[i] * 0.6, 0]);
    const m = new THREE.Object3D(); m.position.set(0, -L1[i], 0); m.rotation.z = inward * curls[i] * 1.15; k.add(m);
    addM(capsule(rr[i] * 0.92, L2[i] + rr[i]), m, [0, rr[i] * 0.5, 0]);
  }
  const tb = new THREE.Object3D(); tb.position.set(inward * 0.006, -0.03, 0.03); tb.rotation.set(-0.85, 0, inward * (0.25 + thumbIn)); root.add(tb);
  addM(capsule(0.0108, 0.04), tb, [0, 0.008, 0]);
  const tm = new THREE.Object3D(); tm.position.set(0, -0.032, 0); tm.rotation.set(0.35 + thumbIn * 0.6, 0, inward * thumbIn); tb.add(tm);
  addM(capsule(0.0098, 0.034), tm, [0, 0.006, 0]);
  root.updateMatrixWorld(true);
  return mergeGeometries(parts.map(([g, o]) => g.clone().applyMatrix4(o.matrixWorld)));
}
const HAND_POSES = { relax: [[0.16, 0.26, 0.36, 0.46], 0], point: [[0.0, 1.5, 1.55, 1.6], 0.55], grip: [[0.95, 1.0, 1.05, 1.1], 0.3], flat: [[0.02, 0.02, 0.03, 0.05], 0.1] };
const HANDG = { '-1': {}, '1': {} };
for (const sd of [-1, 1]) for (const k in HAND_POSES) HANDG[sd][k] = buildHand(sd, HAND_POSES[k][0], HAND_POSES[k][1]);
// head with a nose and ears, so a profile reads as a face turned somewhere
PG.headF = (() => {
  const at = (g, x, y, z, sx, sy, sz) => g.scale(sx, sy, sz).translate(x, y, z);
  return mergeGeometries([PG.head.clone(), at(new THREE.SphereGeometry(1, 10, 8), 0, -0.016, 0.094, 0.013, 0.02, 0.019), at(new THREE.SphereGeometry(1, 10, 8), 0.097, -0.008, -0.004, 0.011, 0.024, 0.016), at(new THREE.SphereGeometry(1, 10, 8), -0.097, -0.008, -0.004, 0.011, 0.024, 0.016)]);
})();
// coat skirt: as narrow as the torso at the waist, rounder toward the hem so a striding leg stays inside it
(() => { const g = PG.skirt, p = g.attributes.position; for (let i = 0; i < p.count; i++) { const f = clamp((0.03 - p.getY(i)) / 1.0, 0, 1); p.setZ(i, p.getZ(i) * (0.76 + 0.3 * Math.pow(f, 0.6))); p.setX(i, p.getX(i) * (1 + 0.05 * f)); } g.computeVertexNormals(); })();
// soft contact shadow under every person
const SHADOW_MAT = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.75, fog: false }); })();
const SHADOW_GEO = new THREE.PlaneGeometry(1.05, 0.85).rotateX(-Math.PI / 2);
const SKINS = ['#9a7a64', '#8a6a56', '#a8866e', '#7a5e4c'];
class Person {
  constructor(o = {}) {
    const s = o.h ? o.h / 1.7 : RR(0.93, 1.06); this.s = s;
    const coat = o.coat || pick(COATS), pants = o.pants || pick(PANTS), hair = o.hair || pick(HAIRS), skin = o.skin || pick(SKINS);
    const mc = lam(coat, 0.06), mp = lam(pants), mh = lam(hair), mk = lam(skin, 0.05), msh = lam('#141416');
    this.root = new THREE.Group(); this.root.scale.setScalar(s); this.groundY = o.ground || 0;
    this.shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT); this.shadow.position.y = 0.018; this.shadow.renderOrder = 2; this.root.add(this.shadow);
    this.hips = new THREE.Group(); this.hips.position.y = 0.92; this.root.add(this.hips);
    this.torsoG = new THREE.Group(); this.hips.add(this.torsoG);
    const wd = o.wide || 1;
    const torso = new THREE.Mesh(PG.torso, mc); torso.scale.set(wd, 1, wd * 0.74); this.torsoG.add(torso);
    if (o.coatLen) { const sk = new THREE.Mesh(PG.skirt, mc); sk.scale.set(wd, o.coatLen, wd); this.hips.add(sk); this.skirt = sk; }
    const neck = new THREE.Mesh(PG.neck, mk); neck.position.y = 0.7; this.torsoG.add(neck);
    this.headG = new THREE.Group(); this.headG.position.y = 0.72; this.torsoG.add(this.headG);
    const hs = o.headScale || 1;
    const head = new THREE.Mesh(PG.headF, mk); head.scale.set(0.92 * hs, 1.12 * hs, 1.0 * hs); head.position.y = 0.1 * hs; this.headG.add(head);
    const hr = new THREE.Mesh(PG.hair, mh); hr.scale.set(0.95 * hs, (o.longHair ? 1.25 : 1.05) * hs, 1.04 * hs); hr.position.set(0, 0.112 * hs, -0.012); hr.rotation.x = -0.35; this.headG.add(hr);
    if (o.longHair) { const lh = new THREE.Mesh(PG.hairBack, mh); lh.scale.set(0.1 * hs, 0.165 * hs, 0.062 * hs); lh.position.set(0, 0.0, -0.062 * hs); this.headG.add(lh); }
    else { const nb = new THREE.Mesh(PG.hairBack, mh); nb.scale.set(0.088 * hs, 0.075 * hs, 0.05 * hs); nb.position.set(0, 0.075 * hs, -0.058 * hs); this.headG.add(nb); }
    if (o.hat) { const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.108, 0.07, 14), lam(o.hat)); hat.position.y = 0.2 * hs; this.headG.add(hat); const br = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 16), lam(o.hat)); br.position.y = 0.17 * hs; this.headG.add(br); }
    if (o.scarf) {
      const sm = lam(o.scarf, 0.4);
      const n = new THREE.Mesh(PG.scarf, sm); n.rotation.x = Math.PI / 2; n.scale.set(1.15, 1.1, 1.3); n.position.y = 0.66; this.torsoG.add(n);
      const tail = new THREE.Mesh(PG.tail, sm); tail.scale.set(0.09, 0.19, 0.036); tail.position.set(0.06, 0.48, 0.15); tail.rotation.x = -0.12; this.torsoG.add(tail);
      const tail2 = new THREE.Mesh(PG.tail, sm); tail2.scale.set(0.09, 0.16, 0.036); tail2.position.set(-0.03, 0.5, -0.15); tail2.rotation.x = 0.1; this.torsoG.add(tail2);
    }
    this.arms = []; this.legs = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(side * 0.208 * (0.5 + 0.5 * wd), 0.565, 0); this.torsoG.add(sh);
      sh.add(new THREE.Mesh(PG.upper, mc));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      el.add(new THREE.Mesh(PG.fore, mc));
      const hand = new THREE.Group(); hand.position.y = -0.285; el.add(hand);
      const hm = new THREE.Mesh(HANDG[side].relax, mk); hand.add(hm);
      this.arms.push({ sh, el, hand, hm, side });
      const hp = new THREE.Group(); hp.position.set(side * 0.086, 0.02, 0); this.hips.add(hp);
      hp.add(new THREE.Mesh(PG.thigh, mp));
      const kn = new THREE.Group(); kn.position.y = -0.46; hp.add(kn);
      kn.add(new THREE.Mesh(PG.shin, mp));
      const ft = new THREE.Mesh(PG.shoe, msh); ft.position.y = -0.445; kn.add(ft);
      this.legs.push({ hp, kn, ft });
    }
    this.baseHip = 0.92;
  }
  setHand(i, pose) { const a = this.arms[i]; const g = HANDG[a.side][pose]; if (a.hm.geometry !== g) a.hm.geometry = g; }
  reset() {
    this.hips.position.y = this.baseHip; this.hips.rotation.set(0, 0, 0); this.torsoG.rotation.set(0, 0, 0); this.headG.rotation.set(0, 0, 0);
    for (let i = 0; i < 2; i++) { const a = this.arms[i]; a.sh.rotation.set(0, 0, 0); a.el.rotation.set(0, 0, 0); a.hand.rotation.set(0, 0, 0); this.setHand(i, 'relax'); }
    this.hips.position.x = 0; if (this.skirt) this.skirt.visible = true;
    for (const l of this.legs) { l.hp.rotation.set(0, 0, 0); l.kn.rotation.set(0, 0, 0); l.ft.rotation.set(0, 0, 0); }
  }
  walk(phase, amp = 1) {
    this.reset();
    const s = Math.sin(phase), c = Math.cos(phase);
    this.legs[0].hp.rotation.x = -s * 0.42 * amp; this.legs[1].hp.rotation.x = s * 0.42 * amp;
    this.legs[0].kn.rotation.x = Math.max(0, -c) * 0.7 * amp + 0.04; this.legs[1].kn.rotation.x = Math.max(0, c) * 0.7 * amp + 0.04;
    this.legs[0].ft.rotation.x = -this.legs[0].hp.rotation.x * 0.4 - this.legs[0].kn.rotation.x * 0.6; this.legs[1].ft.rotation.x = -this.legs[1].hp.rotation.x * 0.4 - this.legs[1].kn.rotation.x * 0.6;
    this.arms[0].sh.rotation.x = s * 0.32 * amp; this.arms[1].sh.rotation.x = -s * 0.32 * amp;
    this.arms[0].el.rotation.x = -0.18 - 0.15 * amp * Math.max(0, s); this.arms[1].el.rotation.x = -0.18 - 0.15 * amp * Math.max(0, -s);
    this.arms[0].sh.rotation.z = -0.07; this.arms[1].sh.rotation.z = 0.07;
    this.hips.position.y = this.baseHip + Math.abs(c) * 0.028 * amp - 0.018 * amp;
    this.hips.rotation.y = s * 0.07 * amp; this.torsoG.rotation.y = -s * 0.1 * amp;
    this.torsoG.rotation.x = 0.035 * amp;
    this.hips.position.x = -c * 0.014 * amp; this.hips.rotation.z = c * 0.028 * amp; this.torsoG.rotation.z = -c * 0.04 * amp;
    this.headG.rotation.y = s * 0.03 * amp; this.headG.rotation.z = c * 0.012 * amp; this.headG.rotation.x = -0.03 * amp;
    this.arms[0].hand.rotation.x = -0.12; this.arms[1].hand.rotation.x = -0.12;
  }
  stand() { this.walk(0, 0); this.arms[0].el.rotation.x = -0.12; this.arms[1].el.rotation.x = -0.12; }
  sit(seatH) {
    this.reset(); this.hips.position.y = seatH / this.s;
    for (const l of this.legs) { l.hp.rotation.x = -1.45; l.kn.rotation.x = 1.4; }
    if (this.skirt) this.skirt.visible = false;   // seated: the coat hem is under her on the bench
    this.arms[0].sh.rotation.x = -0.35; this.arms[1].sh.rotation.x = -0.35; this.arms[0].el.rotation.x = -0.65; this.arms[1].el.rotation.x = -0.65;
    this.torsoG.rotation.x = -0.06;
  }
}
function placePerson(p, x, z, heading) { p.root.position.set(x, p.groundY, z); p.root.rotation.y = heading; }
// swing an arm so it points at a world-space target (k: 0 = leave the pose alone, 1 = fully aimed, index finger out)
const _av = new THREE.Vector3(), _aq = new THREE.Quaternion(), ARM_DOWN = new THREE.Vector3(0, -1, 0);
function aimArm(p, i, target, k, bend = 0.07, pose = 'point') {
  if (k <= 0) return; const a = p.arms[i];
  p.root.updateMatrixWorld(true);
  _av.copy(target); p.torsoG.worldToLocal(_av); _av.sub(a.sh.position).normalize();
  _aq.setFromUnitVectors(ARM_DOWN, _av); a.sh.quaternion.slerp(_aq, k);
  a.el.rotation.x = lerp(a.el.rotation.x, -bend, k); a.el.rotation.z = lerp(a.el.rotation.z, 0, k);
  p.setHand(i, k > 0.4 ? pose : 'relax');
}

// accessories
function suitcase() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(BOX, lam('#46566a', 0.15)); b.scale.set(0.38, 0.56, 0.24); b.position.y = 0.36; g.add(b);
  const h = new THREE.Mesh(BOX, lam('#2a2a2e')); h.scale.set(0.03, 0.36, 0.03); h.position.set(0, 0.82, 0); g.add(h);
  for (const sx of [-0.14, 0.14]) { const w = new THREE.Mesh(BOX, lam('#111')); w.scale.set(0.05, 0.07, 0.07); w.position.set(sx, 0.04, -0.08); g.add(w); }
  return g;
}
function shoppingBag() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(BOX, lam('#d8cfbf', 0.2)); b.scale.set(0.3, 0.32, 0.14); b.position.y = -0.2; g.add(b);
  const leek = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.5, 6), lam('#e9efe0', 0.2)); leek.position.set(0.06, 0.02, 0.02); leek.rotation.z = -0.25; g.add(leek);
  const leaf = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.22, 6), lam('#5f9a3c', 0.25)); leaf.position.set(0.12, 0.3, 0.02); leaf.rotation.z = -0.3; g.add(leaf);
  return g;
}
function briefcase() { const g = new THREE.Group(); const b = new THREE.Mesh(BOX, lam('#1c1a18')); b.scale.set(0.08, 0.28, 0.38); b.position.y = -0.14; g.add(b); return g; }

// Bicycle with rider
function makeBike(rider) {
  const g = new THREE.Group();
  const wg = new THREE.TorusGeometry(0.33, 0.028, 6, 22);
  const wm = lam('#1a1a1c');
  const w1 = new THREE.Mesh(wg, wm); w1.rotation.y = Math.PI / 2; w1.position.set(0, 0.34, 0.52); g.add(w1);
  const w2 = new THREE.Mesh(wg, wm); w2.rotation.y = Math.PI / 2; w2.position.set(0, 0.34, -0.52); g.add(w2);
  const fm = lam('#8a8f96', 0.1);
  const bar = (a, b, r = 0.025) => { const d = b.clone().sub(a); const m = new THREE.Mesh(BOX, fm); m.scale.set(r, d.length(), r); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); g.add(m); };
  bar(V(0, 0.34, -0.52), V(0, 0.42, 0)); bar(V(0, 0.42, 0), V(0, 0.9, -0.12)); bar(V(0, 0.42, 0), V(0, 0.88, 0.42)); bar(V(0, 0.88, 0.42), V(0, 0.34, 0.52)); bar(V(0, 0.9, -0.12), V(0, 0.34, -0.52));
  bar(V(-0.25, 1.0, 0.42), V(0.25, 1.0, 0.42)); bar(V(0, 0.88, 0.42), V(0, 1.0, 0.42));
  const basket = new THREE.Mesh(BOX, lam('#3a3a3c')); basket.scale.set(0.34, 0.22, 0.26); basket.position.set(0, 0.88, 0.62); g.add(basket);
  const lamp = glow('#fff4d8', 0.9, 1); lamp.position.set(0, 0.72, 0.78); g.add(lamp);
  const lamp2 = glow('#fff4d8', 3.5, 0.25); lamp2.position.set(0, 0.72, 0.85); g.add(lamp2);
  if (rider) { rider.root.position.set(0, 0, -0.12); g.add(rider.root); }
  g.userData.wheels = [w1, w2];
  return g;
}
function poseRider(p, phase) {
  p.reset(); p.hips.position.y = 0.98 / p.s;
  p.torsoG.rotation.x = 0.32; p.headG.rotation.x = -0.25;
  for (let i = 0; i < 2; i++) {
    const ph = phase + i * Math.PI; const l = p.legs[i];
    l.hp.rotation.x = -0.95 + Math.sin(ph) * 0.42; l.kn.rotation.x = 0.85 + Math.cos(ph) * 0.45;
    p.arms[i].sh.rotation.x = -0.95; p.arms[i].el.rotation.x = -0.25; p.arms[i].sh.rotation.z = (i ? 0.12 : -0.12);
  }
}

// Dog
function makeDog() {
  const g = new THREE.Group(); const m = lam('#b89870', 0.1);
  const body = new THREE.Mesh(BOX, m); body.scale.set(0.24, 0.24, 0.55); body.position.y = 0.36; g.add(body);
  const head = new THREE.Mesh(BOX, m); head.scale.set(0.2, 0.2, 0.24); head.position.set(0, 0.52, 0.34); g.add(head);
  const ear1 = new THREE.Mesh(BOX, m); ear1.scale.set(0.05, 0.1, 0.06); ear1.position.set(-0.07, 0.65, 0.3); g.add(ear1);
  const ear2 = ear1.clone(); ear2.position.x = 0.07; g.add(ear2);
  const tail = new THREE.Mesh(BOX, m); tail.scale.set(0.05, 0.05, 0.22); tail.position.set(0, 0.48, -0.32); tail.rotation.x = 0.6; g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.08, 0.2], [0.08, 0.2], [-0.08, -0.2], [0.08, -0.2]]) { const lg = new THREE.Group(); lg.position.set(x, 0.27, z); const l = new THREE.Mesh(PG.leg, m); l.scale.set(0.5, 0.27, 0.5); lg.add(l); g.add(lg); legs.push(lg); }
  g.userData = { legs, tail };
  return g;
}
function poseDog(d, phase) { d.userData.legs.forEach((l, i) => { l.rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.5; }); d.userData.tail.rotation.y = Math.sin(phase * 1.5) * 0.5; }

// Car
function makeCar(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(BOX, lam(color, 0.08)); body.scale.set(1.75, 0.75, 4.3); body.position.y = 0.55; g.add(body);
  const cab = new THREE.Mesh(BOX, lam('#15171c')); cab.scale.set(1.55, 0.55, 2.2); cab.position.set(0, 1.18, -0.2); g.add(cab);
  for (const sx of [-0.62, 0.62]) {
    const h = glow('#fff6e2', 1.3, 1); h.position.set(sx, 0.62, 2.18); g.add(h);
    const t = glow('#ff2a1c', 0.8, 1); t.position.set(sx, 0.7, -2.18); g.add(t);
  }
  const beam = glow('#fff2d8', 7, 0.18); beam.position.set(0, 0.6, 4); g.add(beam);
  return g;
}

// ============================================================
//  大門通り (Hamamatsucho → tower)
// ============================================================
const street = new THREE.Group(); scene.add(street);
(function buildStreet() {
  const road = new THREE.Mesh(new THREE.PlaneGeometry(940, 16), bas('#16161b')); road.rotation.x = -Math.PI / 2; road.position.set(1060, 0.06, 0); street.add(road);
  for (const s of [-1, 1]) { const sw = new THREE.Mesh(new THREE.PlaneGeometry(940, 6), bas('#26252c')); sw.rotation.x = -Math.PI / 2; sw.position.set(1060, 0.12, s * 11); street.add(sw); street.add(box(940, 0.16, 0.25, bas('#3a3940'), 1060, 0, s * 8)); }
  const dash = bas('#6a6a6e');
  for (let x = 600; x < 1520; x += 9) street.add(box(3.2, 0.02, 0.14, dash, x, 0.07, 0));
  for (let z = -7; z <= 7; z += 1.1) street.add(box(4, 0.02, 0.55, bas('#8a8a8e'), 1128, 0.07, z));
  for (let x = 610; x < 1510; x += 26) for (const s of [-1, 1]) {
    street.add(box(0.14, 7.2, 0.14, lam('#3a3c42'), x, 0, s * 12.9));
    street.add(box(0.1, 0.1, 1.6, lam('#3a3c42'), x, 7.1, s * 12.2));
    const l = glow('#ffdcab', 1.4, 1); l.position.set(x, 7.0, s * 11.6); street.add(l);
    const h = glow('#ffcf96', 9, 0.22); h.position.set(x, 6.6, s * 11.6); street.add(h);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: GLOW, color: '#ffbf80', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.15, s * 10.5); street.add(pool);
  }
  // shop light spill on sidewalks
  for (let x = 610; x < 1510; x += 14) for (const s of [-1, 1]) {
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), new THREE.MeshBasicMaterial({ map: GLOW, color: pick(['#ffcf90', '#ffe6c4', '#e8f0ff']), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.rotation.x = -Math.PI / 2; sp.position.set(x + RR(-3, 3), 0.16, s * 12.6); street.add(sp);
  }
  // 大門 (the great gate over the street)
  const vm = lam('#b8361f', 0.32);
  for (const s of [-1, 1]) { street.add(box(1.6, 9, 1.6, vm, 760, 0, s * 10.5)); street.add(box(1.2, 7, 1.2, vm, 760, 0, s * 13)); }
  street.add(box(2.2, 1.1, 27, vm, 760, 8.6, 0));
  const r = new THREE.Mesh(hipRoofGeom(5.2, 30, 2.6), lam('#26292d', 0.1)); r.position.set(760, 9.7, 0); street.add(r);
  const gl = glow('#ffb070', 30, 0.18); gl.position.set(760, 6, 0); street.add(gl);
})();

// ============================================================
//  増上寺
// ============================================================
const zojo = new THREE.Group(); scene.add(zojo);
(function buildZojoji() {
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(260, 230), bas('#1d1b1c')); gnd.rotation.x = -Math.PI / 2; gnd.position.set(360, 0.08, 0); zojo.add(gnd);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(190, 9), bas('#35322f')); path.rotation.x = -Math.PI / 2; path.position.set(360, 0.12, 0); zojo.add(path);
  // 大殿 (main hall) at x=250, facing east
  zojo.add(box(54, 3.2, 64, lam('#4a4540'), 250, 0, 0));
  zojo.add(box(14, 1.6, 26, lam('#4a4540'), 284, 0, 0));
  zojo.add(box(40, 13, 52, lam('#2b211c', 0.08), 250, 3.2, 0));
  const fr = new THREE.Mesh(new THREE.PlaneGeometry(34, 8.5), bas('#e8b46e')); fr.rotation.y = Math.PI / 2; fr.position.set(270.15, 8.0, 0); zojo.add(fr);
  for (let z = -18; z <= 18; z += 4.5) zojo.add(box(0.9, 10, 0.9, lam('#7a2a1a', 0.2), 270.6, 3.2, z));
  zojo.add(box(1.2, 1.4, 54, lam('#3a2a20', 0.1), 270.8, 13.6, 0));
  const roof1 = new THREE.Mesh(hipRoofGeom(58, 72, 6), lam('#23292a', 0.12)); roof1.position.set(250, 16.2, 0); zojo.add(roof1);
  const roof2 = new THREE.Mesh(hipRoofGeom(36, 50, 11), lam('#23292a', 0.12)); roof2.position.set(250, 20.5, 0); zojo.add(roof2);
  const ridge = box(1.2, 1.4, 16, lam('#1a1d1e', 0.1), 250, 31.2, 0); zojo.add(ridge);
  const hallGlow = glow('#ffc078', 38, 0.35); hallGlow.position.set(274, 8, 0); zojo.add(hallGlow);
  // 三解脱門 at x=450
  const ver = lam('#c03c22', 0.32);
  for (const x of [444, 456]) for (const z of [-15, -9, -3, 3, 9, 15]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 9.5, 10), ver); p.position.set(x, 4.75, z); zojo.add(p); }
  zojo.add(box(14, 1.0, 33, ver, 450, 8.6, 0));
  const lr = new THREE.Mesh(hipRoofGeom(19, 38, 2.6), lam('#22262a', 0.12)); lr.position.set(450, 9.5, 0); zojo.add(lr);
  zojo.add(box(11, 6.2, 29, ver, 450, 11.2, 0));
  for (let z = -12; z <= 12; z += 6) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), bas('#3a1a12')); w.rotation.y = Math.PI / 2; w.position.set(455.55, 14.2, z); zojo.add(w); }
  const ur = new THREE.Mesh(hipRoofGeom(19, 38, 7.5), lam('#22262a', 0.12)); ur.position.set(450, 17.2, 0); zojo.add(ur);
  const gateGlow = glow('#ff9a60', 26, 0.2); gateGlow.position.set(458, 6, 0); zojo.add(gateGlow);
  // stone lanterns along the approach
  for (let x = 300; x <= 430; x += 18) for (const s of [-1, 1]) {
    const z = s * 8.5;
    zojo.add(box(0.9, 0.5, 0.9, lam('#55504a'), x, 0, z)); zojo.add(box(0.35, 1.1, 0.35, lam('#55504a'), x, 0.5, z));
    zojo.add(box(0.7, 0.6, 0.7, bas('#ffc27c'), x, 1.6, z)); zojo.add(box(1.0, 0.25, 1.0, lam('#4a4540'), x, 2.2, z));
    const g = glow('#ffb46a', 3.6, 0.55); g.position.set(x, 1.9, z); zojo.add(g);
  }
  // incense burner
  zojo.add(box(2.2, 1.2, 2.2, lam('#4a3e30', 0.1), 300, 0, 0)); zojo.add(box(1.6, 0.9, 1.6, lam('#4a3e30', 0.1), 300, 1.2, 0));
  const smoke = new THREE.Group(); smoke.position.set(300, 2.2, 0); zojo.add(smoke);
  const smokeMat = new THREE.SpriteMaterial({ map: GLOW, color: '#9aa0b0', transparent: true, opacity: 0.12, depthWrite: false });
  for (let i = 0; i < 14; i++) { const s = new THREE.Sprite(smokeMat); s.userData.k = i / 14; smoke.add(s); }
  zojo.userData.smoke = smoke;
})();

// ============================================================
//  TREES (芝公園・増上寺)
// ============================================================
const viewLines = [
  [V(445, 0, 0.2), V(0, 0, 0), 0.06, 3],     // 増上寺 view
  [V(192, 0, -250), V(0, 0, 0), 0.13, 7],    // 芝公園 view
];
function blocksView(x, z) {
  for (const [c, t, k, b] of viewLines) {
    const d = t.clone().sub(c); const len = d.length(); d.normalize();
    const px = x - c.x, pz = z - c.z; const along = px * d.x + pz * d.z; if (along < 0 || along > len - 40) continue;
    const lat = Math.abs(px * d.z - pz * d.x); if (lat < b + along * k) return true;
  }
  return false;
}
const trees = (() => {
  const pts = [];
  const tryAdd = (x, z) => { if (blocksView(x, z)) return; if (Math.hypot(x, z) < 52) return; if (x > 196 && x < 300 && Math.abs(z) < 40) return; if (x > 300 && x < 470 && Math.abs(z) < 24) return; if (x > 590 && Math.abs(z) < 16) return; pts.push([x, z]); };
  for (let i = 0; i < 1800 && pts.length < 900; i++) {
    const a = R() * Math.PI * 2, r = RR(55, 290); const x = 60 + Math.cos(a) * r, z = -30 + Math.sin(a) * r;
    if (Math.hypot(x, z) > 310 && !(x > 180 && x < 640 && Math.abs(z) < 140)) continue;
    tryAdd(x, z);
  }
  for (let i = 0; i < 260; i++) { const x = RR(190, 630); const z = (R() < 0.5 ? -1 : 1) * RR(28, 135); tryAdd(x, z); }
  const can = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), pts.length);
  const trk = new THREE.InstancedMesh(BOX, lam('#1a1512'), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); const cols = ['#1b2b1d', '#203423', '#16241a', '#283a24', '#1d2e26'];
  pts.forEach(([x, z], i) => {
    const r = RR(3.2, 6.5), h = RR(5, 9);
    q.setFromEuler(new THREE.Euler(0, R() * 6, 0));
    m4.compose(V(x, h + r * 0.6, z), q, V(r, r * RR(1.0, 1.35), r)); can.setMatrixAt(i, m4); can.setColorAt(i, new THREE.Color(pick(cols)));
    m4.compose(V(x, (h + 1) / 2, z), q, V(0.45, h + 1, 0.45)); trk.setMatrixAt(i, m4);
  });
  const g = new THREE.Group(); g.add(can); g.add(trk); return g;
})();
scene.add(trees);

// park lamps & bench
const park = new THREE.Group(); scene.add(park);
const S4 = (() => {
  const C = V(192, 0, -250); const f = V(-C.x, 0, -C.z).normalize(); const r = V(-f.z, 0, f.x); // right of view
  const at = (fw, rt) => C.clone().addScaledVector(f, fw).addScaledVector(r, rt);
  return { C, f, r, at, head: Math.atan2(f.x, f.z) };
})();
(function buildPark() {
  const pathM = new THREE.Mesh(new THREE.PlaneGeometry(4, 200), bas('#24232a'));
  pathM.rotation.x = -Math.PI / 2; pathM.rotation.z = -S4.head + Math.PI / 2; const pc = S4.at(14, 0); pathM.position.set(pc.x, 0.1, pc.z); park.add(pathM);
  const lampPos = [S4.at(10, -6.5), S4.at(26, 7), S4.at(44, -8), S4.at(7.4, 4.6), S4.at(70, 6)];
  for (const p of lampPos) {
    park.add(box(0.13, 3.6, 0.13, lam('#2c2e33'), p.x, 0, p.z));
    park.add(box(0.26, 0.36, 0.26, bas('#fff0d0'), p.x, 3.55, p.z)); park.add(box(0.4, 0.06, 0.4, lam('#2c2e33'), p.x, 3.92, p.z));
    const g = glow('#ffe2b0', 3.2, 0.5); g.position.set(p.x, 3.75, p.z); park.add(g);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: GLOW, color: '#ffd8a0', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, 0.14, p.z); park.add(pool);
  }
  // bench
  const b = new THREE.Group(); const bp = S4.at(6.6, 2.1); b.position.set(bp.x, 0, bp.z); b.rotation.y = S4.head;
  const wood = lam('#4a3626', 0.1);
  b.add(box(1.9, 0.06, 0.45, wood, 0, 0.44, 0)); b.add(box(1.9, 0.4, 0.05, wood, 0, 0.55, -0.24));
  for (const sx of [-0.85, 0.85]) b.add(box(0.06, 0.45, 0.45, lam('#222'), sx, 0, 0));
  park.add(b);
})();

// ============================================================
//  三田の路地 (alley) — built in local coordinates
// ============================================================
const alley = new THREE.Group(); alley.position.copy(ALLEY_O); alley.rotation.y = ALLEY_ROT; scene.add(alley);
const alleyAnim = { laundry: [], steam: [], lantern: null };
(function buildAlley() {
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 300), bas('#19191d')); asphalt.rotation.x = -Math.PI / 2; asphalt.position.set(0, 0.07, 120); alley.add(asphalt);
  for (const s of [-1, 1]) { const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 300), bas('#77736a')); ln.rotation.x = -Math.PI / 2; ln.position.set(s * 2.25, 0.09, 120); alley.add(ln); }
  const wallCols = ['#4a443e', '#3c3c40', '#524a42', '#3a3632', '#48443f', '#5a5048', '#3e3a37', '#5c5a54'];
  const winCols = ['#e8c590', '#f0d4a8', '#d8b07a', '#f0dcc0', '#aebfd8'];
  const clothCols = ['#d9d2c4', '#9fb4c8', '#c8a0a0', '#e8e2d0', '#8a9a7a', '#d0b48a', '#b8c8d8', '#f0ece4'];
  for (const side of [-1, 1]) {
    let z = -12;
    while (z < 250) {
      const w = RR(5, 9);
      if (Math.abs(z + w / 2 - 105) < 4.2) { z += 8.5; continue; } // cross street
      if (side < 0 && z + w > 179.5 && z < 193.5) { z = 193.5; continue; } // konbini
      const d = RR(7, 11), floors = R() < 0.25 ? 3 : 2, h = floors * 2.9 + RR(0.3, 1.0);
      const setback = RR(0.3, 1.2); const x0 = side * (2.6 + setback);
      const cz = z + w / 2;
      const wall = lam(pick(wallCols), 0.03);
      const body = box(d, h, w - 0.25, wall, x0 + side * d / 2, 0, cz); alley.add(body);
      // roof
      if (R() < 0.6) { const r = new THREE.Mesh(hipRoofGeom(d + 0.8, w + 0.2, 1.6), lam('#2a2c30', 0.05)); r.position.set(x0 + side * d / 2, h, cz); alley.add(r); }
      else alley.add(box(d + 0.2, 0.3, w, lam('#3a3836'), x0 + side * d / 2, h, cz));
      // windows facing alley
      const fx = x0 - side * 0.03;
      for (let fl = 0; fl < floors; fl++) {
        const nw = w > 7 ? 2 : 1;
        for (let k = 0; k < nw; k++) {
          const wz = z + (k + 0.5) * w / nw;
          if (fl === 0 && k === 0) { // door
            alley.add(box(0.06, 2.0, 0.9, bas(R() < 0.5 ? '#3a2e26' : '#6a5440'), fx, 0, wz - 0.6));
            const dl = glow('#ffd8a0', 1.2, 0.8); dl.position.set(fx - side * 0.25, 2.3, wz - 0.6); alley.add(dl);
            continue;
          }
          const lit = R() < 0.72; const c = lit ? pick(winCols) : '#1a1c24';
          const wm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), bas(c)); wm.rotation.y = -side * Math.PI / 2; wm.position.set(fx, fl * 2.9 + 1.5, wz); alley.add(wm);
          if (lit && R() < 0.5) { const cur = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.1), bas('#6a4a3a')); cur.rotation.y = -side * Math.PI / 2; cur.position.set(fx - side * 0.01, fl * 2.9 + 1.5, wz - 0.4); alley.add(cur); }
          if (lit) { const g = glow(c, 2.6, 0.18); g.position.set(fx - side * 0.4, fl * 2.9 + 1.5, wz); alley.add(g); }
        }
      }
      // balcony with laundry on the 2nd floor
      if (R() < 0.55) {
        const by = 2.9; const bx = x0 - side * 0.45;
        alley.add(box(0.9, 0.12, w - 1.4, lam('#5a5a5c'), bx, by, cz));
        alley.add(box(0.05, 0.95, w - 1.4, lam('#6a6a6e', 0.05), x0 - side * 0.88, by + 0.12, cz));
        alley.add(box(0.05, 0.05, w - 1.0, lam('#9a9a9a'), x0 - side * 0.6, by + 2.0, cz));
        const n = Math.floor(RR(3, 7));
        for (let k = 0; k < n; k++) {
          const cw = RR(0.35, 0.65), ch = RR(0.45, 0.85);
          const cl = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch).translate(0, -ch / 2, 0), new THREE.MeshLambertMaterial({ color: pick(clothCols), emissive: '#202020', side: THREE.DoubleSide }));
          cl.rotation.y = Math.PI / 2; const piv = new THREE.Group(); piv.position.set(x0 - side * 0.6, by + 1.98, z + 0.9 + (k + 0.5) * (w - 1.8) / n); piv.add(cl); alley.add(piv);
          alleyAnim.laundry.push({ piv, ph: R() * 6 });
        }
      }
      // AC units, plants
      if (R() < 0.5) alley.add(box(0.35, 0.55, 0.75, lam('#9a9890', 0.05), x0 - side * 0.2, RR(0.2, 4.2), z + w - 1.0));
      if (R() < 0.6) { alley.add(box(0.35, 0.35, 0.35, lam('#6a4030'), x0 - side * 0.35, 0, z + 1.6)); const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), lam('#2f5a2c', 0.1)); pl.position.set(x0 - side * 0.35, 0.55, z + 1.6); alley.add(pl); }
      z += w;
    }
  }
  // utility poles & wires
  const poleZ = [12, 48, 84, 122, 160, 198, 236];
  const tops = [];
  for (const pz of poleZ) {
    const px = (pz / 36) % 2 < 1 ? -2.15 : 2.15;
    alley.add(box(0.28, 9.5, 0.28, lam('#6a6862', 0.05), px, 0, pz));
    alley.add(box(1.6, 0.12, 0.12, lam('#55534e'), px, 8.6, pz));
    alley.add(box(0.5, 0.7, 0.5, lam('#5a5a58'), px, 7.2, pz));
    tops.push(V(px, 8.7, pz));
    // street lamp on pole
    const lx = px * 0.7; alley.add(box(0.06, 0.06, 0.06, lam('#333'), lx, 5.2, pz));
    const l = glow('#ffdcae', 1.4, 1); l.position.set(lx, 5.1, pz); alley.add(l);
    const hl = glow('#ffd09a', 7, 0.18); hl.position.set(lx, 5, pz); alley.add(hl);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ map: GLOW, color: '#ffcf96', transparent: true, opacity: 0.24, blending: THREE.AdditiveBlending, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(lx * 0.4, 0.1, pz); alley.add(pool);
  }
  const wireMat = new THREE.LineBasicMaterial({ color: '#0c0c10' });
  const sag = (a, b, s) => { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * s; pts.push(p); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat); };
  for (let i = 0; i < tops.length - 1; i++) for (const dy of [0, -0.35, -0.7]) for (const dx of [-0.6, 0.6]) alley.add(sag(tops[i].clone().add(V(dx, dy, 0)), tops[i + 1].clone().add(V(dx, dy, 0)), 0.9 + dy * 0.3));
  for (const tp of tops) { const other = V(-tp.x * 3.2, 6.8, tp.z + RR(-3, 3)); alley.add(sag(tp.clone(), other, 0.5)); }

  // ramen shop (right side, z 150..157)
  const rz = 152.5, rx = 2.62;
  alley.add(box(0.05, 2.4, 4.6, bas('#ffcf86'), rx, 0, rz));
  const noren = (() => { const c = document.createElement('canvas'); c.width = 384; c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#1e2c52'; g.fillRect(0, 0, 384, 128); g.fillStyle = '#f2ecdc'; g.font = 'bold 72px "Noto Sans CJK JP", "Meiryo", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('らーめん', 192, 70); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(1.2, 0.85); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / 3);
    const m = new THREE.Mesh(g.translate(0, -0.42, 0), new THREE.MeshLambertMaterial({ map: noren, side: THREE.DoubleSide, emissive: '#3a3a40', emissiveMap: noren }));
    m.rotation.y = -Math.PI / 2; const piv = new THREE.Group(); piv.position.set(rx - 0.15, 2.45, rz + 1.25 - k * 1.25); piv.add(m); alley.add(piv);
    alleyAnim.laundry.push({ piv, ph: k, small: true });
  }
  const lan = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), bas('#ff3a24')); lan.scale.set(1, 1.35, 1); lan.position.set(rx - 0.55, 2.9, rz - 2.6); alley.add(lan);
  const lg = glow('#ff4a2a', 4.5, 0.75); lg.position.copy(lan.position); alley.add(lg);
  alleyAnim.lantern = lg;
  alley.add(box(0.9, 0.8, 5.4, lam('#2a1c18', 0.05), rx + 0.1, 2.5, rz));
  const sign = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#f6efe0'; g.fillRect(0, 0, 128, 512); g.fillStyle = '#b81e14'; g.font = 'bold 84px "Noto Sans CJK JP", "Meiryo", sans-serif'; g.textAlign = 'center'; ['中', '華', 'そ', 'ば'].forEach((ch, i) => g.fillText(ch, 64, 104 + i * 112)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.0), new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide })); sg.position.set(rx - 0.55, 4.2, rz + 2.4); alley.add(sg);
  const sgl = glow('#fff2dc', 3, 0.3); sgl.position.copy(sg.position); alley.add(sgl);
  const steam = new THREE.Group(); steam.position.set(rx + 0.3, 3.4, rz - 1.5); alley.add(steam);
  const stm = new THREE.SpriteMaterial({ map: GLOW, color: '#c8c8cc', transparent: true, opacity: 0.16, depthWrite: false });
  for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(stm); s.userData.k = i / 16; steam.add(s); }
  alleyAnim.steam.push(steam);
  // vending machine (left)
  const vmx = -2.55, vmz = 176;
  alley.add(box(0.75, 1.85, 1.05, lam('#c8ccd4', 0.25), vmx - 0.1, 0, vmz));
  const vf = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#e8f0ff'; g.fillRect(0, 0, 128, 256); const cs = ['#d03030', '#3070d0', '#30a060', '#e0a020', '#f0f0f0', '#8040a0']; for (let r = 0; r < 4; r++) for (let k = 0; k < 5; k++) { g.fillStyle = cs[(r * 5 + k) % cs.length]; g.fillRect(8 + k * 23, 14 + r * 36, 16, 26); } g.fillStyle = '#20283a'; g.fillRect(0, 160, 128, 96); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const vfm = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.7), new THREE.MeshBasicMaterial({ map: vf })); vfm.rotation.y = Math.PI / 2; vfm.position.set(vmx + 0.29, 0.95, vmz); alley.add(vfm);
  const vg = glow('#dce8ff', 5, 0.35); vg.position.set(vmx + 0.8, 1.0, vmz); alley.add(vg);
  const vpool = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: GLOW, color: '#cfe0ff', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })); vpool.rotation.x = -Math.PI / 2; vpool.position.set(vmx + 1.4, 0.1, vmz); alley.add(vpool);
  // parked bicycles
  const pb = makeBike(null); pb.position.set(-1.85, 0, 168); pb.rotation.y = 0.1; alley.add(pb);
  const pb2 = makeBike(null); pb2.position.set(2.0, 0, 141); pb2.rotation.y = -0.15; alley.add(pb2);

  // ---- konbini (left side, z 180..193) ----
  {
    const kz = 186.5, kx = -2.7;
    alley.add(box(12, 4.3, 13.2, lam('#4a4a4e', 0.05), kx - 6, 0, kz));
    alley.add(box(12.4, 0.35, 13.6, lam('#3a3a3e'), kx - 6, 4.3, kz));
    const glass = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#f6f8ff'; g.fillRect(0, 0, 1024, 256);
      const cs = ['#e04a3a', '#3a78d8', '#3aa860', '#e8b030', '#f0f0f0', '#9a4ab8', '#e87a2a', '#2ab0c0'];
      for (let r = 0; r < 4; r++) { g.fillStyle = '#c8ccd6'; g.fillRect(40, 70 + r * 44, 700, 4); for (let k = 0; k < 46; k++) { g.fillStyle = cs[(k * 7 + r * 3) % cs.length]; g.fillRect(44 + k * 15, 46 + r * 44, 11, 24); } }
      g.fillStyle = '#dfe8f8'; g.fillRect(780, 30, 220, 220); for (let r = 0; r < 5; r++) for (let k = 0; k < 9; k++) { g.fillStyle = cs[(k + r * 2) % cs.length]; g.fillRect(792 + k * 23, 44 + r * 40, 14, 28); }
      g.fillStyle = '#5a6070'; for (let x = 0; x <= 1024; x += 128) g.fillRect(x, 0, 6, 256); g.fillRect(440, 0, 10, 256); g.fillRect(560, 0, 10, 256);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 2.75), new THREE.MeshBasicMaterial({ map: glass })); gl.rotation.y = Math.PI / 2; gl.position.set(kx + 0.03, 1.5, kz); alley.add(gl);
    const sign = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 96; const g = c.getContext('2d');
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 1024, 96); g.fillStyle = '#e8702a'; g.fillRect(0, 70, 1024, 12); g.fillStyle = '#3a8a5a'; g.fillRect(0, 82, 1024, 8);
      g.fillStyle = '#2a3550'; g.font = 'bold 52px "Noto Sans CJK JP", "Meiryo", sans-serif'; g.textAlign = 'center'; g.fillText('まちかどストア　24h', 512, 54);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 1.15), new THREE.MeshBasicMaterial({ map: sign })); sg.rotation.y = Math.PI / 2; sg.position.set(kx + 0.04, 3.55, kz); alley.add(sg);
    for (const dz of [-4, 0, 4]) { const gg = glow('#eef3ff', 6, 0.22); gg.position.set(kx + 1.0, 1.6, kz + dz); alley.add(gg); }
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 14), new THREE.MeshBasicMaterial({ map: GLOW, color: '#e8eeff', transparent: true, opacity: 0.38, blending: THREE.AdditiveBlending, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.set(kx + 2.2, 0.1, kz); alley.add(pool);
    alley.add(box(0.5, 0.9, 0.5, lam('#8a8c90', 0.1), kx + 0.5, 0, kz + 5.6));
    const pb3 = makeBike(null); pb3.position.set(kx + 0.7, 0, kz + 5.4); pb3.rotation.y = 0.15; alley.add(pb3);
  }
  // a few buildings beyond the alley's far end (so the tower peeks over them)
  
})();

// ============================================================
//  CAST & SCENES
// ============================================================
const HERO_SCARF = '#c4202a';

// ---- 1: street ----
const hero = new Person({ h: 1.62, coat: '#6a5a4c', pants: '#2a2b30', hair: '#1c1714', scarf: HERO_SCARF, coatLen: 0.32, longHair: true, skin: '#c49a80', ground: 0.12 });
scene.add(hero.root);
const heroCase = suitcase(); scene.add(heroCase);
const crowd = [];
for (let i = 0; i < 80; i++) {
  const side = i % 2 ? 1 : -1; const dir = R() < 0.5 ? 1 : -1;
  const z = side > 0 ? RR(9.0, 12.8) : -RR(11.4, 12.9);
  const p = new Person({ coatLen: R() < 0.3 ? RR(0.15, 0.35) : 0, hat: R() < 0.08 ? '#2a2420' : null, longHair: R() < 0.3, ground: 0.12 });
  if (R() < 0.35) { const bc = briefcase(); p.arms[1].hand.add(bc); }
  scene.add(p.root);
  crowd.push({ p, z, dir, v: RR(1.15, 1.6), x0: RR(880, 1186), ph: R() * 6 });
}
const cars = [];
for (let i = 0; i < 16; i++) { const dir = i % 2 ? 1 : -1; const c = makeCar(pick(['#2a2e36', '#d8d8d8', '#3a1e1e', '#1a1a1c', '#6a6e74', '#e8e6e0', '#24364a'])); scene.add(c); cars.push({ c, dir, x0: RR(600, 1500), v: RR(8, 12) }); }

// ---- 2: zojoji ----
const prayer = new Person({ h: 1.55, coat: '#6a5e52', coatLen: 0.35, hair: '#8a847c', ground: 0.12 }); scene.add(prayer.root);
const visitors = [];
for (let i = 0; i < 9; i++) { const p = new Person({ coatLen: R() < 0.4 ? 0.3 : 0, ground: 0.12 }); scene.add(p.root); visitors.push({ p, z: (i % 2 ? 1 : -1) * RR(2.6, 4.2), x0: RR(300, 405), dir: R() < 0.5 ? 1 : -1, v: RR(0.7, 1.05) }); }

// ---- 3: park ----
const benchA = new Person({ h: 1.7, coat: '#3a3f4a', ground: 0.05 }); const benchB = new Person({ h: 1.57, coat: '#8a7664', coatLen: 0.25, longHair: true, ground: 0.05 });
scene.add(benchA.root); scene.add(benchB.root);
const dogWalker = new Person({ h: 1.7, coat: '#4a4038', ground: 0.06 }); scene.add(dogWalker.root);
const dog = makeDog(); scene.add(dog);
const leashG = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, 0)]); const leash = new THREE.Line(leashG, new THREE.LineBasicMaterial({ color: '#111' })); scene.add(leash); leash.frustumCulled = false;
const jogger = new Person({ h: 1.74, coat: '#2c3a52', ground: 0.06 }); scene.add(jogger.root);
const parkWalkers = []; for (let i = 0; i < 4; i++) { const p = new Person({ ground: 0.06 }); scene.add(p.root); parkWalkers.push({ p, fw: RR(16, 50), off: RR(-18, 18), v: RR(0.9, 1.3), dir: R() < 0.5 ? 1 : -1 }); }

// ---- 4/5: alley ----
const mom = new Person({ h: 1.6, coat: '#8a7a6a', coatLen: 0.3, longHair: true, ground: 0.07 }); const kid = new Person({ h: 1.08, coat: '#d8b44a', headScale: 1.3, ground: 0.07 }); alley.add(mom.root); alley.add(kid.root);
const rider = new Person({ h: 1.7, coat: '#3a4048' }); const bike = makeBike(rider); alley.add(bike);
const balcony = new Person({ h: 1.58, coat: '#a89c8c' }); alley.add(balcony.root);
const alleyWalkers = []; for (let i = 0; i < 4; i++) { const p = new Person({ coatLen: R() < 0.4 ? 0.3 : 0, ground: 0.07 }); alley.add(p.root); alleyWalkers.push({ p, x: (i % 2 ? 1 : -1) * RR(0.7, 1.4), z0: i < 2 ? RR(120, 140) : RR(170, 178), dir: i < 2 ? 1 : -1, v: RR(1.0, 1.25) }); }
const ramenGuest = new Person({ h: 1.72, coat: '#2a2e36', pants: '#24262c', ground: 0.07 }); alley.add(ramenGuest.root);
const hero2 = new Person({ h: 1.62, coat: '#6a5a4c', pants: '#2a2b30', hair: '#1c1714', scarf: HERO_SCARF, coatLen: 0.32, longHair: true, skin: '#c49a80', ground: 0.07 }); alley.add(hero2.root); hero2.arms[0].hand.children[0].visible = false;
const kBag = (() => { const g = new THREE.Group(); const b = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: '#f2f2ee', emissive: '#3a3a3a', transparent: true, opacity: 0.92 })); b.scale.set(0.24, 0.26, 0.12); b.position.y = -0.17; g.add(b); const h = new THREE.Mesh(BOX, lam('#e8e8e4')); h.scale.set(0.12, 0.06, 0.02); h.position.y = -0.03; g.add(h); return g; })();
hero2.arms[1].hand.add(kBag);
const canG = (() => {
  const g = new THREE.Group();
  const lbl = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#f3e4b0'); gr.addColorStop(0.5, '#d9b864'); gr.addColorStop(1, '#b8923e'); x.fillStyle = gr; x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#9a2a20'; x.fillRect(0, 50, 256, 30); x.fillStyle = '#fff6e6'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.fillText('LAGER', 64, 73); x.fillText('LAGER', 192, 73);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 28), new THREE.MeshLambertMaterial({ map: lbl, emissive: '#3a3020' })); g.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 0.01, 28), lam('#c8ccd0', 0.3)); lid.position.y = 0.066; g.add(lid);
  const skin = lam('#c49a80', 0.12);
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin); palm.scale.set(0.022, 0.046, 0.038); palm.position.set(-0.042, -0.004, -0.008); g.add(palm);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.0105, 6, 14, Math.PI * 0.72), skin); f.rotation.x = Math.PI / 2; f.rotation.z = Math.PI * 0.62; f.position.y = 0.026 - i * 0.019; g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 8), skin); th.position.set(-0.026, 0.03, -0.034); th.rotation.set(0.5, 0, -0.4); g.add(th);
  return g;
})();
hero2.arms[0].hand.add(canG);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pv = new THREE.Vector3();


// ---- POV close-up: taking a beer out of the konbini bag ----
scene.add(camera);
const pov = new THREE.Group(); camera.add(pov); pov.visible = false;
const POV_SKIN = lam('#c49a80', 0.12), POV_SLEEVE = lam('#6a5a4c', 0.06);
function seg(a, b, r, mat, parent, seg = 10) { const d = b.clone().sub(a); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, d.length()), 4, seg), mat); m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); parent.add(m); return m; }
const povCan = (() => {
  const g = new THREE.Group();
  const lbl = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#f4efe2'; x.fillRect(0, 0, 1024, 512);
    const gb = x.createLinearGradient(0, 0, 0, 70); gb.addColorStop(0, '#c9a24a'); gb.addColorStop(1, '#e8cf8a'); x.fillStyle = gb; x.fillRect(0, 0, 1024, 64);
    x.fillStyle = '#c9a24a'; x.fillRect(0, 474, 1024, 38);
    const cx = 512;
    x.fillStyle = '#2f7a46'; x.font = '900 112px "Noto Sans CJK JP", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('LAGER', cx, 215);
    x.fillStyle = '#3a3a3a'; x.font = 'bold 40px "Noto Sans CJK JP", sans-serif'; x.fillText('まちかどビール', cx, 112);
    x.strokeStyle = '#e0702a'; x.lineWidth = 7; x.beginPath(); x.arc(cx, 375, 62, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#e0702a'; x.beginPath(); x.moveTo(cx, 325); x.lineTo(cx - 26, 418); x.lineTo(cx + 26, 418); x.closePath(); x.fill();
    x.fillStyle = '#f4efe2'; x.fillRect(cx - 30, 360, 60, 8); x.fillRect(cx - 30, 392, 60, 8);
    x.fillStyle = '#7a6a50'; x.font = '24px "Noto Sans CJK JP", sans-serif'; x.fillText('crisp & light   ALC.5%', cx, 455);
    for (let i = 0; i < 40; i++) { x.fillStyle = 'rgba(224,170,60,0.55)'; const px = cx + (i % 2 ? 1 : -1) * (190 + (i * 37) % 120), py = 120 + (i * 53) % 330; x.beginPath(); x.arc(px, py, 4 + (i % 4) * 2, 0, Math.PI * 2); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.106, 72, 1, true), new THREE.MeshLambertMaterial({ map: lbl, emissive: '#3a372e', side: THREE.DoubleSide }));
  body.rotation.y = Math.PI - 0.21; g.add(body);
  const metal = lam('#aeb4bb', 0.18);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.0275, 0.033, 0.01, 72, 1, true), metal); sh.position.y = 0.058; g.add(sh);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0272, 0.0016, 8, 64), metal); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0635; g.add(rim);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(0.0262, 64), lam('#9ca2aa', 0.15)); lid.rotation.x = -Math.PI / 2; lid.position.y = 0.0628; g.add(lid);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0015, 0.02), lam('#c8ccd2', 0.25)); tab.position.set(0, 0.0638, 0.006); g.add(tab);
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.027, 0.01, 72), metal); bot.position.y = -0.058; g.add(bot);
  // palm underneath (mostly out of frame) and a thumb along the left side
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), POV_SKIN); palm.scale.set(0.05, 0.017, 0.052); palm.position.set(0.004, -0.072, 0.006); g.add(palm);
  seg(V(-0.042, -0.068, 0.012), V(-0.044, -0.045, 0.014), 0.0125, POV_SKIN, g);
  seg(V(-0.044, -0.045, 0.014), V(-0.039, -0.026, 0.018), 0.0112, POV_SKIN, g);
  for (const [x, z] of [[0.03, -0.03], [0.012, -0.044], [-0.008, -0.046], [-0.026, -0.036]]) seg(V(x, -0.07, z), V(x * 1.15, -0.05, z * 1.2), 0.0105, POV_SKIN, g);
  seg(V(0.01, -0.08, 0.04), V(0.03, -0.12, 0.12), 0.027, POV_SKIN, g);
  seg(V(0.032, -0.125, 0.13), V(0.085, -0.25, 0.4), 0.043, POV_SLEEVE, g, 16);
  seg(V(0.03, -0.12, 0.122), V(0.034, -0.13, 0.14), 0.046, POV_SLEEVE, g, 16);
  return g;
})();
pov.add(povCan);
// ============================================================
//  TIMELINE   street 0-11 | zojoji 11-19 | park 19-27 | ramen 27-35 | konbini 35-44 | pull back 44-60
// ============================================================
const SC = { s1: [0, 11], s2: [11, 19], s3: [19, 27], s4: [27, 35], s5: [35, 44], s6: [44, 60] };
const inS = (t, s) => t >= SC[s][0] - 0.01 && t < SC[s][1] + 0.01;

const CAPS = [
  [2.0, 5.6, '人の流れのなかで、'],
  [6.0, 10.3, '立ち止まって、見上げる人がいる。'],
  [12.3, 18.2, '手を合わせる人の、うしろにも。'],
  [20.3, 26.2, 'いつものベンチに、いつもの塔。'],
  [28.3, 34.2, 'のれんをくぐる、いつもの夜。'],
  [39.95, 41.55, '缶ビールひとつ。', 'left', 0.45],
  [41.95, 44.55, 'ただいま…', 'left', 0.6],
  [46.3, 50.1, '近くで見れば、暮らしのとなり。'],
  [50.6, 54.7, '遠くから見れば、都会のまんなか。'],
];
const capEl = document.getElementById('cap');
const titleEl = document.getElementById('title');
const fadeEl = document.getElementById('fade');
let lastCap = null;

// hero (street)
const H1 = { stop: 4.9, v: 1.1, x0: 1170.6 };
const heroX = (t) => H1.x0 - H1.v * Math.min(t, H1.stop) - (t > H1.stop ? 0.3 * (1 - Math.exp(-(t - H1.stop) * 3)) : 0);
// hero (konbini) in alley-local coords
function hero2State(t) {
  const out = 35.5, turn = 37.6;
  if (t < out) return { x: -3.6, z: 186.2, h: Math.PI / 2, walk: 0, ph: 0 };
  if (t < turn) { const u = t - out; return { x: -3.6 + 1.2 * u, z: 186.2, h: Math.PI / 2, walk: 1, ph: walkerPhase(1.2 * u, 0.95) }; }
  const u = t - turn; const k = sstep(0, 0.9, u);
  return { x: -3.6 + 1.2 * (turn - out) + 0.25 * k, z: 186.2 - 0.35 * k, h: lerp(Math.PI / 2, Math.PI - 0.15, k), walk: 1 - sstep(0.2, 0.9, u), ph: walkerPhase(1.2 * (turn - out) + 0.4 * k, 0.95) };
}
// ramen guest (alley-local)
function guestState(t) {
  const arrive = 30.2;
  if (t < arrive) { const u = clamp((t - 27) / (arrive - 27), 0, 1); return { x: lerp(0.1, 1.45, u), z: lerp(158.6, 153.5, u), h: Math.PI - 0.26, walk: 1, ph: walkerPhase(5.3 * u, 1) }; }
  const k = sstep(arrive, arrive + 0.7, t);
  const inn = sstep(31.5, 33.4, t);
  return { x: 1.45 + 1.9 * inn, z: 153.5, h: lerp(Math.PI - 0.26, Math.PI / 2, k), walk: Math.max(1 - k, inn > 0 && inn < 1 ? 1 : 0), ph: walkerPhase(5.3 + 1.9 * inn, 1), push: sstep(30.7, 31.4, t), bow: sstep(31.3, 31.9, t) };
}

const CLOSE = { x: -0.3, y: 1.62, z: 189.3 };
const POV0 = 39.5, POV1 = 45;            // the close-up of her hand runs POV0..POV1
const TOWER_POINT = V(0, 215, 0);   // where fingers point: just under the top deck
function camAt(t) {
  const pos = V(0, 0, 0), look = V(0, 0, 0); let fov = 50;
  if (t < 11) {
    const hx = heroX(t);
    // once she stops, slide in behind her shoulder so she stays in the picture while the view lifts to the tower
    const sl = sstep(5, 10, t);
    pos.set(hx + lerp(4.1, 4.7, sl), lerp(1.56, 1.6, sl), lerp(-8.4, -9.35, sl));
    const k = sstep(5.9, 9.9, t);
    const lookHero = V(hx - 9, 1.25, -9.8);
    look.copy(lookHero).lerp(V(0, 165, -78), k); fov = lerp(50, 42, k);
  } else if (t < 19) {
    const u = (t - 11) / 8;
    pos.set(lerp(424.8, 423.8, u), 1.32, lerp(-0.15, -0.35, u)); look.set(0, lerp(106, 114, u), 0); fov = 52;
  } else if (t < 27) {
    const u = (t - 19) / 8;
    const p = S4.at(lerp(3.0, 3.7, u), lerp(3.9, 3.2, u)); pos.set(p.x, 1.1, p.z); look.set(0, lerp(98, 108, u), 0); fov = 55;
  } else if (t < 35) {
    const u = (t - 27) / 8;
    pos.copy(alleyToWorld(lerp(-0.95, -0.75, u), 1.42, lerp(161.6, 160.4, u)));
    look.copy(alleyToWorld(1.3, lerp(2.3, 2.9, u), 149));
    fov = 52;
  } else if (t < POV0) {
    const u = (t - 35) / 5; const m = easeIO(clamp((t - 37.0) / 1.7, 0, 1));
    const wideP = alleyToWorld(lerp(1.35, 1.2, u), 1.45, lerp(191.6, 191.0, u)), wideL = alleyToWorld(-1.4, 1.55, 182);
    const drift = Math.max(0, t - 38.7) * 0.06;
    const backP = alleyToWorld(-0.74, 1.52, 187.75 - drift), backL = alleyToWorld(-0.9, 1.92, 180);
    pos.copy(wideP).lerp(backP, m); look.copy(wideL).lerp(backL, m); fov = lerp(52, 46, m);
  } else if (t < POV1) {
    pos.copy(alleyToWorld(-0.82, 1.5, 185.82 - 0.05 * (t - POV0)));
    const k = sstep(POV0 + 0.3, POV0 + 2.0, t);
    look.set(0, lerp(18, 66, k), 0); fov = 50;
  } else {
    const u = clamp((t - POV1) / (55.5 - POV1), 0, 1); const drift = Math.max(0, t - 55.5);
    const ey = Math.pow(sstep(0, 1, u), 1.12), ez = Math.pow(sstep(0, 1, u), 1.3);
    pos.copy(alleyToWorld(lerp(CLOSE.x, 0, sstep(0, 0.3, u)), lerp(CLOSE.y, 225, ey) + drift * 1.5, lerp(CLOSE.z - 0.04, 450, ez) + drift * 4));
    look.set(0, lerp(96, 112, sstep(0, 0.45, u)), 0); fov = lerp(48, 42, sstep(0, 0.5, u));
  }
  return { pos, look, fov };
}

function walkerPhase(dist, s) { return dist / (0.72 * s) * Math.PI; }

function update(t) {
  const c = camAt(t); camera.position.copy(c.pos); camera.lookAt(c.look); camera.fov = c.fov;
  if (window.__cam) { const cv = (a) => window.__cam.alley ? alleyToWorld(a[0], a[1], a[2]) : V(a[0], a[1], a[2]); camera.position.copy(cv(window.__cam.pos)); camera.lookAt(cv(window.__cam.look)); camera.fov = window.__cam.fov || 40; }
  camera.near = (window.__cam || (t >= POV0 && t < POV1)) ? 0.04 : clamp(c.pos.y * 0.02, 0.25, 4); camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  skyU.uDark.value = sstep(0, 44, t) * 0.5;

  const blink = 0.25 + 0.75 * sstep(-0.15, 0.55, Math.sin(t * Math.PI * 1.4));
  tower.userData.avi.forEach((s, i) => { s.material.opacity = i < 2 ? blink : 0.4 + 0.6 * blink; });
  traffic.userData.update(t);

  // visibility per scene
  const v1 = inS(t, 's1');
  for (const cw of crowd) cw.p.root.visible = v1;
  hero.root.visible = heroCase.visible = v1;
  for (const cr of cars) cr.c.visible = v1;
  prayer.root.visible = inS(t, 's2'); visitors.forEach(v => v.p.root.visible = inS(t, 's2'));
  const vP = inS(t, 's3');
  [benchA, benchB, dogWalker, jogger].forEach(p => p.root.visible = vP); dog.visible = leash.visible = vP; parkWalkers.forEach(w => w.p.root.visible = vP);
  const vA = t >= 26.9;
  [mom, kid, balcony, ramenGuest, hero2].forEach(p => p.root.visible = vA); bike.visible = vA; alleyWalkers.forEach(w => w.p.root.visible = vA);

  // ---- 1 street ----
  if (v1) {
    for (const cw of crowd) {
      const span = 306; let x = cw.x0 + cw.dir * cw.v * t; x = ((x - 880) % span + span) % span + 880;
      placePerson(cw.p, x, cw.z, cw.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      cw.p.walk(walkerPhase(cw.v * t, cw.p.s) + cw.ph);
    }
    for (const cr of cars) { const span = 900; let x = cr.x0 + cr.dir * cr.v * t; x = ((x - 600) % span + span) % span + 600; cr.c.position.set(x, 0, cr.dir > 0 ? 3.6 : -2.4); cr.c.rotation.y = cr.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    const x = heroX(t);
    placePerson(hero, x, -10.3, -Math.PI / 2);
    const walkAmt = 1 - sstep(H1.stop - 0.3, H1.stop + 0.5, t);
    hero.walk(walkerPhase(H1.v * Math.min(t, H1.stop + 0.4), hero.s), walkAmt);
    const up = sstep(5.3, 6.5, t);
    hero.headG.rotation.x = -0.78 * up; hero.torsoG.rotation.x = 0.035 * walkAmt - 0.1 * up;
    hero.arms[1].sh.rotation.x = 0.42; hero.arms[1].sh.rotation.z = 0.12; hero.arms[1].el.rotation.x = -0.05;
    const hc = hero.root.position;
    heroCase.position.set(hc.x + 0.62, 0, hc.z + 0.3); heroCase.rotation.set(0, -Math.PI / 2, -0.38 * walkAmt - 0.04);
  }

  // ---- 2 増上寺 ----
  if (inS(t, 's2')) {
    placePerson(prayer, 420.5, -1.7, -Math.PI / 2);
    prayer.stand();
    const bow = sstep(12.6, 13.7, t) * (1 - sstep(16.6, 17.6, t));
    for (let i = 0; i < 2; i++) { const a = prayer.arms[i]; a.sh.rotation.x = -0.55; a.sh.rotation.z = (i ? -0.32 : 0.32); a.el.rotation.x = -1.35; a.el.rotation.z = (i ? -0.25 : 0.25); prayer.setHand(i, 'flat'); }
    prayer.torsoG.rotation.x = 0.08 + 0.42 * bow; prayer.headG.rotation.x = 0.25 * bow;
    for (const vi of visitors) {
      const span = 108; let x = vi.x0 + vi.dir * vi.v * t; x = ((x - 298) % span + span) % span + 298;
      placePerson(vi.p, x, vi.z, vi.dir > 0 ? Math.PI / 2 : -Math.PI / 2); vi.p.walk(walkerPhase(vi.v * t, vi.p.s));
    }
    const sm = zojo.userData.smoke;
    sm.children.forEach((s) => { const k = (s.userData.k + t * 0.12) % 1; s.position.set(Math.sin(k * 7 + t) * 0.6 * k, k * 9, Math.cos(k * 5) * 0.4 * k); const sz = 1.2 + k * 5; s.scale.set(sz, sz, 1); });
  }

  // ---- 3 芝公園 ----
  if (vP) {
    const tt = t - 19;
    const bp = S4.at(6.6, 2.1); const ra = S4.r;
    placePerson(benchA, bp.x - ra.x * 0.36, bp.z - ra.z * 0.36, S4.head);
    placePerson(benchB, bp.x + ra.x * 0.36, bp.z + ra.z * 0.36, S4.head);
    benchA.sit(0.47); benchB.sit(0.47);
    const pt = sstep(21.4, 22.6, t) * (1 - sstep(25.0, 26.0, t));
    benchA.torsoG.rotation.y = -0.12 * pt; benchA.torsoG.rotation.z = -0.05 * pt;
    aimArm(benchA, 1, TOWER_POINT, pt);
    benchA.headG.rotation.x = lerp(-0.2, -0.42, pt); benchA.headG.rotation.y = 0.25 * (1 - pt) + 0.1 * pt;
    benchB.headG.rotation.x = -0.2 - 0.35 * sstep(22.2, 23.2, t); benchB.headG.rotation.y = -0.3 * (1 - sstep(22.2, 23.2, t));
    benchB.torsoG.rotation.z = 0.14 * sstep(22.4, 23.6, t);
    benchB.arms[1].sh.rotation.x = -0.6; benchB.arms[1].sh.rotation.z = 0.35;
    const dw = lerp(-11, 11, tt / 8);
    const dp = S4.at(11.5, dw); placePerson(dogWalker, dp.x, dp.z, S4.head - Math.PI / 2); dogWalker.walk(walkerPhase(2.75 * tt, 1)); dogWalker.arms[0].sh.rotation.x = -0.6;
    const dgp = S4.at(11.0, dw + 1.6); dog.position.set(dgp.x, 0, dgp.z); dog.rotation.y = S4.head - Math.PI / 2; poseDog(dog, t * 11);
    const hand = new THREE.Vector3(); dogWalker.root.updateMatrixWorld(true); dogWalker.arms[0].hand.getWorldPosition(hand);
    const collar = dog.localToWorld(V(0, 0.48, 0.25));
    leashG.setFromPoints([hand, collar]);
    const jw = lerp(18, -18, tt / 8);
    const jp = S4.at(22, jw); placePerson(jogger, jp.x, jp.z, S4.head + Math.PI / 2); jogger.walk(walkerPhase(4.5 * tt, 1) * 0.75, 1.5); jogger.arms[0].el.rotation.x = jogger.arms[1].el.rotation.x = -1.3;
    for (const w of parkWalkers) { const lat = w.off + w.dir * w.v * tt; const p = S4.at(w.fw, lat); placePerson(w.p, p.x, p.z, S4.head - w.dir * Math.PI / 2); w.p.walk(walkerPhase(w.v * tt, w.p.s)); }
  }

  // ---- 4/5/6 路地 ----
  if (vA) {
    const kick = sstep(30.9, 31.5, t) * (1 - sstep(33.2, 34.5, t));
    for (const l of alleyAnim.laundry) { const a = l.small ? 0.08 + kick * 0.5 : 0.16; l.piv.rotation.x = Math.sin(t * (l.small ? 1.6 + kick * 3 : 1.1) + l.ph) * a; l.piv.rotation.z = Math.sin(t * 0.7 + l.ph * 2) * 0.05; }
    for (const st of alleyAnim.steam) st.children.forEach((s) => { const k = (s.userData.k + t * 0.18) % 1; s.position.set(Math.sin(k * 6 + t * 0.7) * 0.5 * k, k * 5.5, Math.cos(k * 4) * 0.3 * k); const sz = 0.6 + k * 3.2; s.scale.set(sz, sz, 1); });
    // ramen guest
    const g = guestState(t);
    placePerson(ramenGuest, g.x, g.z, g.h); ramenGuest.walk(g.ph, g.walk);
    if (g.push !== undefined) {
      ramenGuest.arms[0].sh.rotation.x = lerp(ramenGuest.arms[0].sh.rotation.x, -2.1, g.push); ramenGuest.arms[0].el.rotation.x = lerp(-0.2, -0.5, g.push);
      ramenGuest.torsoG.rotation.x += 0.28 * g.bow; ramenGuest.headG.rotation.x = 0.2 * g.bow;
    }
    ramenGuest.root.visible = g.x < 2.95 && t < 35.1;
    // mom & kid walk toward the tower, kid points
    const mt = clamp(Math.min(t, 31.6) - 27, 0, 9); const mz = 157.5 - 1.05 * mt;
    placePerson(mom, -1.25, mz, Math.PI); placePerson(kid, -0.45, mz + 0.05, Math.PI);
    const mw = 1 - sstep(31.3, 32.0, t);
    mom.walk(walkerPhase(1.05 * mt, mom.s), mw); kid.walk(walkerPhase(1.05 * mt, kid.s) * 1.2, mw);
    const hp = alleyToWorld(-0.9, 0.9 + (mom.hips.position.y - mom.baseHip) * 0.5, mz + 0.03 - 0.05 * mw);
    aimArm(mom, 0, hp, 1, 0.1, 'grip'); aimArm(kid, 1, hp, 1, 0.1, 'grip');
    const kp = sstep(32.1, 32.9, t);
    aimArm(kid, 0, TOWER_POINT, kp, 0.04);
    kid.headG.rotation.x = -0.7 * kp; mom.headG.rotation.x = -0.45 * sstep(33.0, 33.8, t);
    // bicycle riding away toward the tower
    const bz = lerp(156, 112, clamp((t - 27) / 9, 0, 1));
    bike.position.set(-1.25 + 0.0, 0.07, bz); bike.rotation.y = Math.PI; poseRider(rider, t * 5.2);
    bike.userData.wheels.forEach(w => w.rotation.x = t * 9);
    // balcony
    placePerson(balcony, -2.75, 128.6, Math.PI / 2); balcony.root.position.y = 2.95; balcony.stand();
    const reach = 0.5 + 0.5 * Math.sin(t * 1.3);
    for (const a of balcony.arms) { a.sh.rotation.x = -2.5 - 0.3 * reach; a.el.rotation.x = -0.3; }
    balcony.headG.rotation.x = -0.25;
    for (const w of alleyWalkers) { const z = w.z0 + w.dir * w.v * (t - 27); const wx = w.dir > 0 ? w.x : 1.0 + 0.5 * Math.abs(w.x); placePerson(w.p, wx, z, w.dir > 0 ? 0 : Math.PI); w.p.walk(walkerPhase(w.v * (t - 27), w.p.s)); w.p.root.visible = vA; }
    // hero, years later, out of the konbini
    const h = hero2State(t);
    placePerson(hero2, h.x, h.z, h.h); hero2.walk(h.ph, h.walk);
    hero2.root.visible = t > 35.45 && t < POV0; canG.visible = false;   // after the close-up of her hand, the film leaves her
    const up = sstep(38.0, 39.0, t);
    hero2.headG.rotation.x = -0.5 * up; hero2.torsoG.rotation.x = 0.035 * h.walk - 0.05 * up;
    hero2.arms[1].sh.rotation.x = 0.04 * h.walk; hero2.arms[1].sh.rotation.z = 0.12; hero2.arms[1].el.rotation.x = -0.1; hero2.setHand(1, 'grip');
    hero2.root.updateMatrixWorld(true); hero2.root.getWorldQuaternion(_q2);
    hero2.arms[1].hand.getWorldQuaternion(_q); kBag.quaternion.copy(_q.invert().multiply(_q2));   // the bag hangs straight down
  }

  // POV prop (Gogo's close-up: the can comes up into view beside the tower)
  pov.visible = t >= POV0 && t < POV1;
  if (pov.visible) {
    const lift = easeIO(clamp((t - (POV0 + 0.35)) / 1.15, 0, 1));
    const sway = Math.sin(t * 1.7) * 0.004;
    const show = sstep(POV0 + 1.5, POV0 + 2.4, t) * (1 - sstep(POV1 - 0.6, POV1, t) * 0.3);
    povCan.position.set(lerp(0.105, 0.074, lift), lerp(-0.34, -0.046, lift) + sway + show * 0.006, lerp(-0.24, -0.185, lift));
    povCan.rotation.set(lerp(0.35, 0.1, lift) + show * 0.06, lerp(0.25, -0.12, lift), lerp(-0.05, -0.17, lift) - show * 0.03);
  }
  // point lights per scene
  if (t < 11) setLights([[V(1162, 6.6, -11.6), '#ffd8a8', 120, 26], [V(1136, 6.6, -11.6), '#ffd8a8', 120, 26], [V(1170, 3.0, -13.2), '#ffe6c8', 70, 14], [V(1156, 3.0, -13.2), '#fff0e0', 70, 14], [V(1166, 6.6, 11.6), '#ffd8a8', 100, 24], [V(1110, 6.6, -11.6), '#ffd8a8', 120, 26]]);
  else if (t < 19) setLights([[V(421, 1.9, -8.5), '#ffbb70', 60, 14], [V(421, 1.9, 8.5), '#ffbb70', 60, 14], [V(403, 1.9, -8.5), '#ffbb70', 50, 14], [V(439, 1.9, 8.5), '#ffbb70', 50, 14], [V(458, 2, 0), '#ffa060', 260, 30], [V(276, 6, 0), '#ffc080', 300, 40]]);
  else if (t < 27) { const L = [S4.at(7.4, 4.6), S4.at(10, -6.5), S4.at(26, 7), S4.at(44, -8)]; setLights(L.map((p, i) => [V(p.x, 3.7, p.z), '#ffe0b0', i ? 70 : 110, 18])); }
  else { const a = (lx, ly, lz) => alleyToWorld(lx, ly, lz); setLights([t >= POV0 ? [a(-2.3, 2.6, 186.2), '#eef2ff', 55, 12] : [a(-1.3, 2.6, 186.5), '#eef2ff', 160, 16], [a(1.5, 5.0, 160), '#ffd8a8', 70, 18], [a(1.9, 2.4, 152.5), '#ffc888', 75, 12], [a(-1.4, 1.2, 176), '#d8e6ff', 40, 9], [a(-1.5, 5.0, 198), '#ffd8a8', 70, 18], [a(1.6, 2.9, 150), '#ff5a3a', 22, 7]]); }

  // overlays
  let f = 1 - sstep(0, 1.3, t);
  for (const b of [11, 19, 27, 35]) f = Math.max(f, 1 - sstep(0, 0.45, Math.abs(t - b)));
  // into her eyes and back out again: a short blink instead of a hard cut
  for (const b of [POV0, POV1]) f = Math.max(f, 1 - sstep(0, 0.32, Math.abs(t - b)));
  f = Math.max(f, sstep(58.6, 60, t) * 0.55);
  fadeEl.style.opacity = f.toFixed(3);
  let cap = null, ca = 0, side = '';
  for (const [a, b, txt, sd, fd] of CAPS) if (t >= a && t <= b) { const f = fd || 0.6; cap = txt; side = sd || ''; ca = Math.min(sstep(a, a + f, t), 1 - sstep(b - f, b, t)); }
  capEl.style.right = side === 'left' ? '30%' : '0';
  if (cap !== lastCap) { capEl.textContent = cap || ''; lastCap = cap; }
  capEl.style.opacity = ca.toFixed(3);
  titleEl.style.opacity = sstep(55.2, 56.6, t).toFixed(3);
  titleEl.querySelector('.t2').style.opacity = sstep(56.4, 57.6, t).toFixed(3);
}

// ============================================================
//  run
// ============================================================
resize();
window.addEventListener('resize', resize);
window.__renderAt = (t) => { update(t); renderer.render(scene, camera); return true; };
window.__ready = true;
window.__canLocal = () => { const v = new THREE.Vector3(); canG.getWorldPosition(v); alley.worldToLocal(v); return [v.x, v.y, v.z]; };

if (!RENDER) {
  const btn = document.getElementById('play'), bar = document.getElementById('bar');
  const startEl = document.getElementById('start'), muteBtn = document.getElementById('mute');
  const startAt = parseFloat(qs.get('t') || '0');
  const POSTER_T = 58.2;                       // what sits under the play button before the first click
  let playing = false, started = false, t0 = performance.now(), tPaused = startAt;

  // ---- music: decoded once from the embedded MP3, started/stopped with the picture ----
  let actx = null, abuf = null, asrc = null, again = null, muted = false;
  const now = () => playing ? (performance.now() - t0) / 1000 : tPaused;
  function stopAudio() { if (asrc) { try { asrc.stop(); } catch (e) { } try { asrc.disconnect(); } catch (e) { } asrc = null; } }
  function startAudio(t) {
    stopAudio(); if (!actx || !abuf || t >= abuf.duration) return;
    try { if (actx.state === 'suspended') actx.resume(); asrc = actx.createBufferSource(); asrc.buffer = abuf; asrc.connect(again); asrc.start(0, Math.max(0, t)); } catch (e) { asrc = null; }
  }
  (async () => {
    try {
      const b64 = window.__BGM || ''; if (b64.length < 100) return;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = new AC(); again = actx.createGain(); again.gain.value = 1; again.connect(actx.destination);
      const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      abuf = await new Promise((res, rej) => { const p = actx.decodeAudioData(u8.buffer, res, rej); if (p && p.catch) p.catch(rej); });
      if (playing) startAudio(now());
    } catch (e) { actx = null; abuf = null; muteBtn.style.display = 'none'; }
  })();

  const setPlaying = (p) => {
    playing = p; btn.textContent = p ? '❚❚' : '▶';
    if (p) { t0 = performance.now() - tPaused * 1000; started = true; startEl.classList.add('gone'); startAudio(tPaused); }
    else stopAudio();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (tPaused >= DUR) { tPaused = 0; setPlaying(true); return; } setPlaying(!playing); });
  stage.addEventListener('click', () => btn.click());
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); muted = !muted; if (again) again.gain.value = muted ? 0 : 1; muteBtn.style.opacity = muted ? 0.35 : 0.9; muteBtn.style.textDecoration = muted ? 'line-through' : 'none'; });
  document.getElementById('track').addEventListener('click', (e) => {
    e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect();
    tPaused = clamp((e.clientX - r.left) / r.width, 0, 0.999) * DUR; t0 = performance.now() - tPaused * 1000;
    started = true; startEl.classList.add('gone'); if (playing) startAudio(tPaused);
  });
  const loop = () => {
    let t = now();
    if (t >= DUR) { t = DUR - 0.001; if (playing) { playing = false; btn.textContent = '↻'; stopAudio(); } tPaused = DUR; }
    else if (playing) tPaused = t;
    update(started || qs.has('still') ? t : POSTER_T); renderer.render(scene, camera);
    bar.style.width = ((started ? t : 0) / DUR * 100) + '%';
    requestAnimationFrame(loop);
  };
  if (qs.has('still')) { started = true; startEl.classList.add('gone'); }
  requestAnimationFrame(loop);
}
