// ── Transient effects ───────────────────────────────────────────────────
// Expanding shockwave spheres, spark bursts, and dive tracers — all white,
// all short-lived. A generic pool advances each and disposes it when dead.

import * as THREE from "three";
import { SEVERITY } from "../config.js";

export function createEffects(scene) {
  const live = [];

  function add(obj, update) {
    scene.add(obj);
    live.push({ obj, update, done: false });
  }

  // Expanding wireframe sphere from the impact point.
  function shockwave(point, severity = "medium") {
    const sev = SEVERITY[severity] || SEVERITY.medium;
    const maxR = 3 + sev.rank * 3.2;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const ring = new THREE.LineSegments(edges, mat);
    ring.position.copy(point);
    geo.dispose();
    let t = 0;
    const dur = 0.5 + sev.rank * 0.12;
    add(ring, (dt) => {
      t += dt / dur;
      const r = 0.2 + t * maxR;
      ring.scale.setScalar(r);
      mat.opacity = Math.max(0, 1 - t) * 0.9;
      if (t >= 1) { edges.dispose(); mat.dispose(); return false; }
      return true;
    });

    // a second, flat ground ripple for critical hits
    if (sev.rank >= 4) shockwave2(point, maxR * 1.6);
  }

  function shockwave2(point, maxR) {
    const seg = 64;
    const pos = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos[i * 3] = Math.cos(a); pos[i * 3 + 1] = 0; pos[i * 3 + 2] = Math.sin(a);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    const ring = new THREE.LineLoop(g, mat);
    ring.position.set(point.x, 0.05, point.z);
    let t = 0;
    add(ring, (dt) => {
      t += dt / 0.9;
      ring.scale.setScalar(0.2 + t * maxR);
      mat.opacity = Math.max(0, 1 - t) * 0.7;
      if (t >= 1) { g.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  // A quick outward burst of point sparks.
  function spark(point, severity = "medium") {
    const sev = SEVERITY[severity] || SEVERITY.medium;
    const N = 14 + sev.rank * 10;
    const pos = new Float32Array(N * 3);
    const vel = [];
    for (let i = 0; i < N; i++) {
      pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z;
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      vel.push(dir.multiplyScalar((6 + Math.random() * 8) * (0.6 + sev.rank * 0.2)));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 1 });
    const pts = new THREE.Points(g, mat);
    let t = 0;
    add(pts, (dt) => {
      t += dt / 0.7;
      const arr = g.attributes.position.array;
      for (let i = 0; i < N; i++) {
        vel[i].y -= dt * 5;
        arr[i * 3] += vel[i].x * dt;
        arr[i * 3 + 1] += vel[i].y * dt;
        arr[i * 3 + 2] += vel[i].z * dt;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - t);
      if (t >= 1) { g.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  // A fast fading tracer line from a jet to its target as it dives.
  function tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const line = new THREE.Line(g, mat);
    let t = 0;
    add(line, (dt) => {
      t += dt / 0.35;
      mat.opacity = Math.max(0, 0.6 * (1 - t));
      if (t >= 1) { g.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const alive = live[i].update(dt);
      if (!alive) { scene.remove(live[i].obj); live.splice(i, 1); }
    }
  }

  return { shockwave, spark, tracer, update };
}
