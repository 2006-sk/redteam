// ── The Swarm (5 jets, one per agent) ───────────────────────────────────
// Each agent owns a distinct orbit (different radius / tilt / phase) so they
// visibly attack "from different sides." State machine per jet:
//   idle   → patrol the orbit
//   dive   → an attack_started: fall in toward a surface point, leave a tracer
//   engage → hold/strafe near the tower waiting for the verdict
//   strike → a weakness_found: lunge into the surface; on contact fire onImpact
//   peel   → an attack_result (held): veer away, no impact
//   return → rejoin the orbit, then idle
// It never assumes ordering: a strike/peel with no preceding dive just runs
// from wherever the jet currently is.

import * as THREE from "three";
import { AGENTS } from "../config.js";

const smooth = (t) => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

export function createSwarm(scene, tower, effects, { onImpact } = {}) {
  const jets = AGENTS.map((a, i) => new Jet(scene, tower, effects, a, i, onImpact));
  const byId = Object.fromEntries(jets.map((j) => [j.agent.id, j]));

  return {
    jets,
    get(id) { return byId[id]; },
    launch(id, evt) { byId[id]?.dive(evt); },
    strike(id, evt) { byId[id]?.strike(evt); },
    peel(id, evt) { byId[id]?.peel(evt); },
    update(dt) { for (const j of jets) j.update(dt); },
    // status accessor for the HUD
    state(id) { return byId[id]?.stateLabel || "IDLE"; },
    // re-center orbits when the target object changes height
    recenter(y) { for (const j of jets) j.orbit.centerY = y; },
  };
}

class Jet {
  constructor(scene, tower, effects, agent, index, onImpact) {
    this.tower = tower;
    this.effects = effects;
    this.agent = agent;
    this.index = index;
    this.onImpact = onImpact;

    // Distinct orbit per agent → different sides of the tower.
    const spreadIncl = [-1.0, -0.5, 0.05, 0.55, 1.05][index] || 0; // radians tilt
    this.orbit = {
      radius: 20 + index * 1.8,
      incl: spreadIncl,
      yaw: (index / AGENTS.length) * TAU,
      speed: (0.28 + index * 0.03) * (index % 2 ? -1 : 1),
      centerY: Math.max(6, tower.bounds.height * 0.5),
    };
    this.t = Math.random() * TAU;

    // motion state
    this.pos = this.orbitPos(this.t);
    this.prev = this.pos.clone();
    this.state = "idle";
    this.stateLabel = "IDLE";
    this.timer = 0;
    this.move = null; // {from,to,dur,elapsed,then}
    this.strafe = 0;

    // mesh: a 4-sided dart (cone) rendered as wireframe, tip along +Z
    const cone = new THREE.ConeGeometry(0.55, 2.0, 4);
    cone.rotateX(Math.PI / 2);
    const edges = new THREE.EdgesGeometry(cone);
    cone.dispose();
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.LineSegments(edges, this.mat);
    scene.add(this.mesh);

    // a small orbit guide-ring (very faint) so "sides" read on screen
    scene.add(this.makeOrbitRing());

    // motion trail
    this.trailLen = 20;
    this.trailPts = new Float32Array(this.trailLen * 3);
    for (let i = 0; i < this.trailLen; i++) this.pos.toArray(this.trailPts, i * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPts, 3));
    this.trailGeo = tg;
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
    scene.add(this.trail);
  }

  orbitPos(t, radiusMul = 1) {
    const v = new THREE.Vector3(Math.cos(t) * this.orbit.radius * radiusMul, Math.sin(t) * this.orbit.radius * radiusMul, 0);
    v.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.orbit.incl);
    v.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbit.yaw);
    v.y += this.orbit.centerY;
    return v;
  }

  makeOrbitRing() {
    const seg = 96;
    const pos = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) this.orbitPos((i / seg) * TAU).toArray(pos, i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05 }));
  }

  // ── commands from the event feed ──
  dive(/* evt */) {
    const target = this.tower.randomAnchorWorld();
    this.aimPoint = target.clone();
    const standoff = target.clone().sub(this.centerVec()).setLength(this.tower.bounds.radius + 5).add(this.centerVec());
    this.effects.tracer(this.pos, target);
    this.startMove(this.pos.clone(), standoff, 0.7, () => { this.state = "engage"; this.timer = 0; });
    this.state = "dive";
    this.stateLabel = "ATTACKING";
  }

  strike(evt) {
    const point = (this.aimPoint || this.tower.randomAnchorWorld()).clone();
    const sev = evt?.severity || "medium";
    this.startMove(this.pos.clone(), point, 0.22, () => {
      this.onImpact?.(sev, point);
      // bounce back out to the orbit
      const out = point.clone().sub(this.centerVec()).setLength(this.tower.bounds.radius + 10).add(this.centerVec());
      this.startMove(this.pos.clone(), out, 0.4, () => this.beginReturn());
    });
    this.state = "strike";
    this.stateLabel = "STRIKE";
  }

  peel() {
    // veer away tangentially without hitting
    const away = this.pos.clone().sub(this.centerVec()).setLength(this.tower.bounds.radius + 14).add(this.centerVec());
    away.y += 4;
    this.startMove(this.pos.clone(), away, 0.5, () => this.beginReturn());
    this.state = "peel";
    this.stateLabel = "PEELED";
  }

  beginReturn() {
    const to = this.orbitPos(this.t);
    this.startMove(this.pos.clone(), to, 0.6, () => { this.state = "idle"; this.stateLabel = "IDLE"; });
    this.state = "return";
  }

  centerVec() { return new THREE.Vector3(0, this.orbit.centerY, 0); }

  startMove(from, to, dur, then) {
    this.move = { from, to, dur, elapsed: 0, then };
  }

  update(dt) {
    this.prev.copy(this.pos);
    this.timer += dt;

    if (this.state === "idle") {
      this.t += this.orbit.speed * dt;
      this.pos.copy(this.orbitPos(this.t));
      // gentle bob
      this.pos.y += Math.sin(performance.now() * 0.002 + this.index) * 0.4;
    } else if (this.state === "engage") {
      // strafe a tight circle around the aim point while awaiting the verdict
      this.strafe += dt * 2.4;
      const c = this.aimPoint || this.centerVec();
      const off = new THREE.Vector3(Math.cos(this.strafe) * 3.2, Math.sin(this.strafe * 0.7) * 2, Math.sin(this.strafe) * 3.2);
      this.pos.copy(c).add(off);
      // safety: don't hang forever if a verdict never arrives
      if (this.timer > 5) this.beginReturn();
    } else if (this.move) {
      const m = this.move;
      m.elapsed += dt;
      const k = Math.min(1, m.elapsed / m.dur);
      this.pos.lerpVectors(m.from, m.to, smooth(k));
      if (k >= 1) { const then = m.then; this.move = null; then?.(); }
    }

    // keep the orbit phase advancing slowly even while attacking, so the slot
    // the jet returns to has moved on (feels alive, not teleported).
    if (this.state !== "idle") this.t += this.orbit.speed * dt * 0.4;

    // orient nose along velocity
    const vel = this.pos.clone().sub(this.prev);
    if (vel.lengthSq() > 1e-6) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vel.normalize());
      this.mesh.quaternion.slerp(q, 0.4);
    }
    this.mesh.position.copy(this.pos);

    // brighten while active
    const active = this.state !== "idle";
    this.mat.opacity += ((active ? 1 : 0.8) - this.mat.opacity) * Math.min(1, dt * 6);

    // advance trail (shift + push current)
    this.trailPts.copyWithin(0, 3);
    this.pos.toArray(this.trailPts, (this.trailLen - 1) * 3);
    this.trailGeo.attributes.position.needsUpdate = true;
  }
}
