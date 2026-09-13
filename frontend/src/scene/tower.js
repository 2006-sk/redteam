// ── The Tower (the target) ──────────────────────────────────────────────
// "The tower can be any object" — it's just a white wireframe. Six presets
// build from primitives; all render as glowing line-art. The object reacts to
// the live feed: weakness_found → fracture + shudder + shed shards, scaled by
// severity; critical → a big crack. Health drives dimming + flicker; at zero
// it reads as breached.

import * as THREE from "three";
import { SEVERITY } from "../config.js";

const WHITE = 0xffffff;

export function createTower(scene, preset = "tower") {
  const group = new THREE.Group();
  scene.add(group);

  const frameMat = new THREE.LineBasicMaterial({ color: WHITE, transparent: true, opacity: 0.9 });
  const shards = new THREE.Group();
  group.add(shards);
  const liveShards = [];

  let anchors = []; // local-space surface points jets aim at
  let bounds = { radius: 6, height: 14 };
  let health = 100;
  let shudder = 0;
  let breathe = 0;
  let flicker = 1;

  build(preset);

  function clearFrame() {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      if (c !== shards) { group.remove(c); c.geometry?.dispose?.(); }
    }
  }

  function addWire(geo, thresholdDeg = 1) {
    const edges = new THREE.EdgesGeometry(geo, thresholdDeg);
    const seg = new THREE.LineSegments(edges, frameMat);
    group.add(seg);
    geo.dispose();
    return seg;
  }

  function build(name) {
    clearFrame();
    preset = name;
    if (name === "core") buildCore();
    else if (name === "server") buildServer();
    else if (name === "reactor") buildReactor();
    else if (name === "pyramid") buildPyramid();
    else if (name === "citadel") buildCitadel();
    else buildTower();
    computeAnchors();
  }

  // ── presets ──
  function buildTower() {
    // tapered stack of boxes + antenna → a spire/skyscraper
    const tiers = 7;
    let y = 0;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers;
      const w = 8 * (1 - t * 0.7);
      const h = 2.4;
      const box = new THREE.BoxGeometry(w, h, w);
      const seg = addWire(box);
      seg.position.y = y + h / 2;
      y += h + 0.15;
    }
    // antenna
    const mast = new THREE.CylinderGeometry(0.06, 0.06, 5, 6, 1, true);
    const m = addWire(mast, 30);
    m.position.y = y + 2.5;
    bounds = { radius: 5.5, height: y + 5 };
    group.position.y = 0;
  }

  function buildCore() {
    const ico = new THREE.IcosahedronGeometry(7, 1);
    addWire(ico, 1).position.y = 8;
    const cage = new THREE.IcosahedronGeometry(9.5, 0);
    const c = addWire(cage, 1); c.position.y = 8;
    bounds = { radius: 9.5, height: 17 };
  }

  function buildServer() {
    let y = 0;
    for (let i = 0; i < 9; i++) {
      const box = new THREE.BoxGeometry(9, 1.1, 6);
      const seg = addWire(box);
      seg.position.y = y + 0.55;
      y += 1.55;
    }
    bounds = { radius: 6, height: y };
  }

  function buildReactor() {
    const knot = new THREE.TorusKnotGeometry(5, 1.4, 120, 12, 2, 3);
    addWire(knot, 8).position.y = 9;
    bounds = { radius: 7, height: 18 };
  }

  function buildPyramid() {
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const r = 9 * (1 - t);
      const cone = new THREE.ConeGeometry(r, 3.2, 4, 1, true);
      const seg = addWire(cone, 30);
      seg.rotation.y = Math.PI / 4;
      seg.position.y = y + 1.6;
      y += 3.0;
    }
    bounds = { radius: 8, height: y };
  }

  function buildCitadel() {
    const spots = [[0, 0, 12], [-9, 0, -4], [9, 0, -4], [0, 0, -10]];
    let maxH = 0;
    spots.forEach(([x, , z], idx) => {
      const tiers = 4 + (idx % 3);
      let y = 0;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const w = 4.5 * (1 - t * 0.6);
        const box = new THREE.BoxGeometry(w, 2, w);
        const seg = addWire(box);
        seg.position.set(x, y + 1, z);
        y += 2.1;
      }
      maxH = Math.max(maxH, y);
    });
    bounds = { radius: 15, height: maxH };
  }

  function computeAnchors() {
    anchors = [];
    const rings = 6;
    for (let i = 0; i < rings; i++) {
      const y = (i / (rings - 1)) * bounds.height;
      const rr = bounds.radius * (0.7 + Math.random() * 0.5);
      const count = 5;
      for (let j = 0; j < count; j++) {
        const a = (j / count) * Math.PI * 2 + Math.random();
        anchors.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
      }
    }
  }

  // ── public: a fresh world-space strike point ──
  function randomAnchorWorld() {
    const a = anchors[Math.floor(Math.random() * anchors.length)] || new THREE.Vector3(0, bounds.height / 2, 0);
    return group.localToWorld(a.clone());
  }

  function topWorld() {
    return group.localToWorld(new THREE.Vector3(0, bounds.height * 0.6, 0));
  }

  // ── reactions ──
  function setHealth(h) { health = Math.max(0, Math.min(100, h)); }

  function hit(severity, worldPoint) {
    const sev = SEVERITY[severity] || SEVERITY.info;
    const mag = 0.2 + sev.rank * 0.22;
    shudder = Math.min(1.4, shudder + mag);
    const local = worldPoint ? group.worldToLocal(worldPoint.clone()) : new THREE.Vector3(0, bounds.height / 2, 0);
    const n = 3 + sev.rank * 4;
    for (let i = 0; i < n; i++) spawnShard(local, 0.6 + sev.rank * 0.5);
    // critical leaves a lingering scorch: dim the whole frame briefly
    if (sev.rank >= 4) { flicker = 0.2; shudder = 1.4; }
  }

  function pulse() { breathe = 1; }

  function spawnShard(origin, speed) {
    const size = 0.4 + Math.random() * 0.9;
    const tetra = new THREE.TetrahedronGeometry(size);
    const edges = new THREE.EdgesGeometry(tetra);
    const mat = frameMat.clone();
    mat.opacity = 1;
    const seg = new THREE.LineSegments(edges, mat);
    seg.position.copy(origin);
    tetra.dispose();
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.4 + 0.2, Math.random() * 2 - 1).normalize();
    seg.userData.vel = dir.multiplyScalar(speed * (4 + Math.random() * 4));
    seg.userData.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3);
    seg.userData.life = 1;
    shards.add(seg);
    liveShards.push(seg);
  }

  function update(dt) {
    // self spin — slow shimmer of the wireframe
    group.rotation.y += dt * 0.12;

    // shudder decay + apply as jitter
    if (shudder > 0.001) {
      group.position.x = (Math.random() * 2 - 1) * shudder * 0.3;
      group.position.z = (Math.random() * 2 - 1) * shudder * 0.3;
      shudder *= Math.pow(0.02, dt);
    } else {
      group.position.x = 0; group.position.z = 0;
    }

    // heartbeat breathe
    if (breathe > 0.001) {
      const s = 1 + Math.sin((1 - breathe) * Math.PI) * 0.02;
      group.scale.setScalar(s);
      breathe *= Math.pow(0.02, dt);
    } else {
      group.scale.setScalar(1);
    }

    // health → opacity + flicker. Low health flickers like failing neon.
    flicker += (1 - flicker) * Math.min(1, dt * 4); // recover toward 1
    const base = 0.25 + (health / 100) * 0.65;
    let op = base * flicker;
    if (health < 35) op *= 0.6 + 0.4 * Math.abs(Math.sin(performance.now() * 0.02));
    if (health <= 0) op *= 0.35 + 0.2 * Math.random(); // breached: broken flicker
    frameMat.opacity = op;

    // sag/tilt as it dies
    const tilt = (1 - health / 100) * 0.12;
    group.rotation.z = tilt * Math.sin(performance.now() * 0.0006);

    // advance shards
    for (let i = liveShards.length - 1; i >= 0; i--) {
      const s = liveShards[i];
      s.userData.vel.y -= dt * 6; // gravity
      s.position.addScaledVector(s.userData.vel, dt);
      s.rotation.x += s.userData.spin.x * dt;
      s.rotation.y += s.userData.spin.y * dt;
      s.userData.life -= dt * 0.7;
      s.material.opacity = Math.max(0, s.userData.life);
      if (s.userData.life <= 0) {
        shards.remove(s); s.geometry.dispose(); s.material.dispose();
        liveShards.splice(i, 1);
      }
    }
  }

  return {
    group,
    build,
    setHealth,
    hit,
    pulse,
    update,
    randomAnchorWorld,
    topWorld,
    get preset() { return preset; },
    get bounds() { return bounds; },
  };
}
