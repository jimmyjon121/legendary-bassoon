import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// Three.js postprocessing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(!!mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

// MINIMAL BACKGROUND SHADER - DARK LUXURY
const BG_VS = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BG_FS = `
precision highp float;
varying vec2 vUv;
uniform vec2  uResolution;
uniform float uTime;
uniform float uProgress;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(in vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
}

void main(){
  vec2 uv = vUv;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / max(1.0, uResolution.y);

  // Very slow, subtle drift
  float t = uTime * 0.01;
  float n = noise(p * 2.0 + t);
  
  // Almost black background with a restrained indigo lift.
  vec3 col = vec3(0.006, 0.007, 0.011);
  
  // Very subtle radial gradient.
  float r = length(p);
  col += vec3(0.012, 0.016, 0.032) * (1.0 - r) * 0.24;

  // A faint aperture echo, visible mostly after scan begins.
  float ring = 1.0 - smoothstep(0.012, 0.028, abs(r - mix(0.36, 0.52, uProgress)));
  col += vec3(0.025, 0.028, 0.052) * ring * smoothstep(0.25, 0.85, uProgress) * 0.28;
  
  // Tiny bit of noise texture
  col += vec3(0.0014, 0.0015, 0.003) * n;
  
  // Fade in from pure black
  col *= smoothstep(0.0, 0.3, uProgress);
  
  gl_FragColor = vec4(col, 1.0);
}
`;

// MINIMAL NODES - FEWER, SUBTLER
const NODES_VS = `
precision highp float;
uniform float uTime;
uniform float uProgress;

attribute float aSeed;
attribute float aAppear;
attribute float aScale;

varying float vAlpha;
varying float vSeed;

void main(){
  vSeed = aSeed;
  
  float appear = smoothstep(max(0.24, aAppear) - 0.05, max(0.24, aAppear) + 0.05, uProgress);
  vAlpha = appear * 0.22; // Very faint
  
  vec3 pos = position;
  
  // Minimal drift
  float drift = 0.01;
  pos.x += sin(uTime*0.1 + aSeed*6.28) * drift;
  pos.y += cos(uTime*0.08 + aSeed*6.28) * drift;
  
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  
  float size = aScale * appear * 0.46; // Smaller, cleaner
  gl_PointSize = size * (200.0 / max(0.001, -mv.z));
  
  gl_Position = projectionMatrix * mv;
}
`;

const NODES_FS = `
precision highp float;
uniform float uProgress;

varying float vAlpha;
varying float vSeed;

void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p,p);
  
  if (r > 1.0) discard;
  
  float a = vAlpha * exp(-r * 3.0);
  
  // Very subtle blue-white dots
  vec3 col = mix(vec3(0.15, 0.20, 0.30), vec3(0.25, 0.30, 0.40), vSeed);
  
  gl_FragColor = vec4(col, a);
}
`;

// NO ARCS - TOO BUSY
// MINIMAL CORE
const CORE_VS = `
varying vec3 vN;
varying vec3 vV;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CORE_FS = `
precision highp float;
uniform float uTime;
uniform float uProgress;

varying vec3 vN;
varying vec3 vV;

void main(){
  float awaken = smoothstep(0.2, 0.7, uProgress);
  
  float fres = pow(1.0 - max(0.0, dot(vN, vV)), 2.0);
  
  // Very dark blue core
  vec3 col = vec3(0.032, 0.052, 0.105);
  col += vec3(0.065, 0.095, 0.16) * fres;
  
  float a = (0.16 + 0.42*fres) * awaken * 0.52; // Very translucent
  gl_FragColor = vec4(col, a);
}
`;

// MINIMAL FILM SHADER - NO GRAIN
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uProgress: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uProgress;
    varying vec2 vUv;
    
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      
      // Strong vignette for luxury feel
      vec2 centered = vUv - 0.5;
      float r = length(centered);
      float vig = smoothstep(0.7, 0.2, r);
      col *= (0.4 + 0.6*vig);
      
      // Keep it dark
      col *= 0.7;
      
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export default function StartupVisualUltra({
  progress = 0,
  quality,
  reportFrameTime,
  className,
  style,
}) {
  const containerRef = useRef(null);
  const canvasReadyRef = useRef(null);
  const progressRef = useRef(progress);
  const reportFrameTimeRef = useRef(reportFrameTime);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    progressRef.current = clamp01(progress);
  }, [progress]);

  // Keep reportFrameTime ref updated without triggering re-renders
  useEffect(() => {
    reportFrameTimeRef.current = reportFrameTime;
  }, [reportFrameTime]);

  const settings = useMemo(() => {
    if (quality) {
      return {
        nodes: Math.min(quality.nodes || 180, 180),
        maxDpr: quality.maxDpr || 1.5,
        renderScale: quality.renderScale || 0.9,
      };
    }
    // Default - minimal
    return {
      nodes: 140,
      maxDpr: 1.5,
      renderScale: 0.9,
    };
  }, [quality]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up any existing canvas first
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    let raf = 0;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({
      antialias: false, // Performance
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });

    renderer.setClearColor(0x000000, 0);

    // Canvas setup. Start fully transparent so any first-frame buffer flash
    // (bloom warm-up, swap-chain init, etc.) is hidden. We fade in on the
    // first successful composer.render() — see `markReady()` below.
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.opacity = "0";
    renderer.domElement.style.transition = "opacity 320ms cubic-bezier(0.4, 0, 0.2, 1)";
    canvasReadyRef.current = renderer.domElement;

    if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

    renderer.toneMapping = THREE.LinearToneMapping; // No tone mapping
    renderer.toneMappingExposure = 0.6; // Keep it dark

    const dpr = Math.min(window.devicePixelRatio || 1, settings.maxDpr);
    renderer.setPixelRatio(dpr);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    const root = new THREE.Group();
    scene.add(root);

    // Background shader quad
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: BG_VS,
      fragmentShader: BG_FS,
      depthTest: false,
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = -10;
    scene.add(bgMesh);

    // Minimal node field (200-300 nodes max)
    const N = settings.nodes;
    const positions = new Float32Array(N * 3);
    const aSeed = new Float32Array(N);
    const aAppear = new Float32Array(N);
    const aScale = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      // Sparse forge-field: nodes cluster around a broad aperture instead
      // of a bright star cloud competing with the progress ring.
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.72 + Math.pow(Math.random(), 0.85) * 2.25;
      
      positions[i * 3 + 0] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2;

      aSeed[i] = Math.random();
      aAppear[i] = Math.random();
      aScale[i] = 0.5 + Math.random() * 1.0; // Smaller
    }

    const nodesGeo = new THREE.BufferGeometry();
    nodesGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    nodesGeo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
    nodesGeo.setAttribute("aAppear", new THREE.BufferAttribute(aAppear, 1));
    nodesGeo.setAttribute("aScale", new THREE.BufferAttribute(aScale, 1));

    const nodesMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: NODES_VS,
      fragmentShader: NODES_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const nodes = new THREE.Points(nodesGeo, nodesMat);
    root.add(nodes);

    // Single central core (smaller)
    const coreGroup = new THREE.Group();
    root.add(coreGroup);

    const coreGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: CORE_VS,
      fragmentShader: CORE_FS,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const core = new THREE.Mesh(coreGeo, coreMat);
    coreGroup.add(core);

    // Very subtle point light
    const coreLight = new THREE.PointLight(0x1a2540, 0.5, 15);
    coreLight.position.set(0, 0, 0);
    coreGroup.add(coreLight);

    // Postprocessing - minimal bloom
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.75, 0.88);
    bloom.strength = 0.22; // Very subtle
    bloom.radius = 0.55;
    bloom.threshold = 0.62; // High threshold - only brightest parts bloom
    composer.addPass(bloom);

    const film = new ShaderPass(FilmShader);
    composer.addPass(film);

    // Resize handling
    const size = { w: 1, h: 1 };
    function resize() {
      const rect = container.getBoundingClientRect();
      size.w = Math.max(1, Math.floor(rect.width));
      size.h = Math.max(1, Math.floor(rect.height));

      const rw = Math.max(1, Math.floor(size.w * settings.renderScale));
      const rh = Math.max(1, Math.floor(size.h * settings.renderScale));

      renderer.setSize(rw, rh, false);
      composer.setSize(rw, rh);

      camera.aspect = size.w / size.h;
      camera.updateProjectionMatrix();

      bgMat.uniforms.uResolution.value.set(rw, rh);

      bloom.setSize(rw, rh);
    }
    resize();

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    // Render loop
    let last = performance.now();
    let framesRendered = 0;
    function tick(now) {
      if (disposed) return;

      const dt = now - last;
      last = now;

      // Report frame time to governor (using ref to avoid re-renders)
      if (reportFrameTimeRef.current) reportFrameTimeRef.current(dt);

      const p = clamp01(progressRef.current);

      // Very slow time for minimal motion
      const t = reducedMotion ? 0.0 : now * 0.0001;

      // Drive uniforms
      bgMat.uniforms.uTime.value = t;
      bgMat.uniforms.uProgress.value = p;

      nodesMat.uniforms.uTime.value = t;
      nodesMat.uniforms.uProgress.value = p;

      coreMat.uniforms.uTime.value = t;
      coreMat.uniforms.uProgress.value = p;

      film.uniforms.uProgress.value = p;

      // Phase choreography
      const awaken = smoothstep(0.1, 0.6, p);
      const seal = smoothstep(0.86, 1.0, p);

      // Very minimal camera drift
      if (!reducedMotion) {
        camera.position.x = Math.sin(t * 2.0) * 0.05;
        camera.position.y = Math.cos(t * 1.5) * 0.03;
      }
      camera.lookAt(0, 0, 0);

      // Very slow rotation
      root.rotation.y = reducedMotion ? 0 : t * 0.45;
      root.scale.setScalar(1.0 - seal * 0.045);

      // Core subtle pulse
      const pulse = 1.0 + Math.sin(t * 3.0) * 0.04;
      coreGroup.scale.setScalar(pulse * awaken * (1.0 - seal * 0.12));

      // Update light intensity
      coreLight.intensity = 0.22 + 0.16 * awaken + 0.12 * seal;
      bloom.strength = 0.2 + 0.08 * seal;
      bloom.radius = 0.52 + 0.08 * seal;

      composer.render();

      // Reveal the canvas only after the second frame, by which point the
      // bloom/post-process buffers have warmed and any first-frame artifact
      // is already overwritten with a clean image.
      framesRendered += 1;
      if (framesRendered === 2 && canvasReadyRef.current) {
        canvasReadyRef.current.style.opacity = "1";
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);

    // Warm compile
    try {
      renderer.compile(scene, camera);
    } catch (_) {}

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);

      // Dispose all Three.js resources
      try {
        composer?.dispose?.();
        bgGeo?.dispose();
        bgMat?.dispose();
        nodesGeo?.dispose();
        nodesMat?.dispose();
        coreGeo?.dispose();
        coreMat?.dispose();
        
        // Force lose WebGL context
        const gl = renderer.getContext();
        const loseContext = gl.getExtension('WEBGL_lose_context');
        if (loseContext) loseContext.loseContext();
        
        renderer.dispose();
        renderer.forceContextLoss();
        
        // Remove canvas from DOM
        if (renderer.domElement && renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      } catch (e) {
        console.warn('Cleanup error:', e);
      }
    };
  }, [reducedMotion, settings, quality]); // reportFrameTime excluded!

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        zIndex: 0,
        background: "#000", // Pure black fallback
        ...style,
      }}
    />
  );
}