// ── The WebGL siege stage ───────────────────────────────────────────────
// Pure white line-art on black. Bloom gives the 1px wireframe its neon glow
// (line width is unreliable across GPUs, so glow does the visual weight).
// Everything here is unlit — LineBasic / MeshBasic — so there's no light rig
// to fuss with and the look stays graphic.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export function createStage(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.018);

  const camera = new THREE.PerspectiveCamera(52, aspect(), 0.1, 400);
  camera.position.set(0, 6, 46);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 24;
  controls.maxDistance = 80;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 4, 0);

  // Bloom composer (guarded — if postprocessing ever fails, or ?nobloom is set
  // for a weak GPU, we fall back to a plain render so the demo never goes black).
  let composer = null;
  let bloom = null;
  const noBloom = new URLSearchParams(location.search).has("nobloom");
  if (!noBloom) {
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.6, 0.15);
      composer.addPass(bloom);
    } catch (err) {
      console.warn("[stage] bloom unavailable, falling back to plain render", err);
      composer = null;
    }
  }

  // A faint starfield / dust so the void isn't dead-flat black.
  scene.add(makeDust());

  // A ground grid the tower stands on — reads as a "site" without adding color.
  const grid = new THREE.GridHelper(160, 40, 0xffffff, 0xffffff);
  grid.material.transparent = true;
  grid.material.opacity = 0.06;
  grid.position.y = -0.01;
  scene.add(grid);

  // Camera shake state
  let shakeMag = 0;
  const shakeOffset = new THREE.Vector3();

  function aspect() { return window.innerWidth / Math.max(1, window.innerHeight); }

  function resize() {
    camera.aspect = aspect();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", resize);

  function shake(mag) { shakeMag = Math.min(2.2, shakeMag + mag); }

  function render(dt) {
    controls.update();

    // apply + decay shake as a temporary camera offset
    if (shakeMag > 0.001) {
      shakeOffset.set(
        (Math.random() * 2 - 1) * shakeMag,
        (Math.random() * 2 - 1) * shakeMag,
        (Math.random() * 2 - 1) * shakeMag * 0.5
      );
      camera.position.add(shakeOffset);
      shakeMag *= Math.pow(0.0025, dt); // fast decay
      if (composer) composer.render(); else renderer.render(scene, camera);
      camera.position.sub(shakeOffset); // restore so controls stay stable
    } else {
      if (composer) composer.render(); else renderer.render(scene, camera);
    }
  }

  function setBloom(strength) { if (bloom) bloom.strength = strength; }

  return { scene, camera, renderer, controls, render, shake, setBloom, resize, THREE };
}

function makeDust() {
  const N = 900;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 60 + Math.random() * 120;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * 60;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, transparent: true, opacity: 0.35, sizeAttenuation: true });
  return new THREE.Points(g, m);
}
