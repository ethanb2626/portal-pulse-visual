import * as THREE from "three";

/* ======================
   Renderer + Scene
====================== */
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});

renderer.setClearColor(0x02060b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.width = "100%";
document.body.style.height = "100%";

document.body.appendChild(renderer.domElement);

// Make canvas truly fill the screen (important for iOS rotation)
renderer.domElement.style.width = "100%";
renderer.domElement.style.height = "100%";
renderer.domElement.style.display = "block";

const scene = new THREE.Scene();

/* ======================
   Ortho Camera
====================== */
const viewH = 10;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
camera.position.z = 10;

/* ======================
   FX
====================== */
let viewW = viewH * (window.innerWidth / window.innerHeight);
const fx = createPortalPulseFX({ scene, viewW, viewH });

/* ======================
   Robust Resize (mobile-safe)
====================== */
function resizeToDisplaySize() {
  const canvas = renderer.domElement;

  // Use actual on-screen size (fixes iOS Safari landscape/URL bar issues)
  const width = Math.floor(canvas.clientWidth || window.innerWidth);
  const height = Math.floor(canvas.clientHeight || window.innerHeight);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  const aspect = width / height;
  viewW = viewH * aspect;

  camera.left = -viewW / 2;
  camera.right = viewW / 2;
  camera.top = viewH / 2;
  camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();

  fx.setView(viewW, viewH);
}

function onResize() {
  resizeToDisplaySize();
}

window.addEventListener("resize", onResize);

// iOS Safari rotation can lag; do a second pass
window.addEventListener("orientationchange", () => {
  setTimeout(onResize, 50);
  setTimeout(onResize, 250);
});

// Run once on load so Vercel/mobile starts correct
onResize();

/* ======================
   Animate
====================== */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  fx.update(clock.getElapsedTime());
  renderer.render(scene, camera);
}
animate();


/* ============================================================
   FX IMPLEMENTATION: global pulse (burst -> drift -> suck -> hold)
   - Burst is smooth and global
   - Absorption is randomized per particle
   - Anti-blob: shrink + early fade + micro-spiral near portal
============================================================ */
function createPortalPulseFX({ scene, viewW, viewH }) {
  const leftCenter = new THREE.Vector2(-viewW * 0.38, 0);
  const rightCenter = new THREE.Vector2(viewW * 0.38, 0);

  const u = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(viewW, viewH) },
    uLeft: { value: leftCenter.clone() },
    uRight: { value: rightCenter.clone() },
    uPortalR: { value: Math.min(viewH, viewW) * 0.22 },

    // GLOBAL PHASE TIMINGS (seconds)
    uBurstT: { value: 0.75 }, // one smooth burst
    uDriftT: { value: 1.10 }, // brief float
    uSuckT: { value: 4.20 },  // MUCH slower inhale
    uHoldT: { value: 0.45 },  // tight hold before next burst
    uRate:  { value: 1.00 },  // global speed multiplier

    // FEEL
    uBand: { value: 3.0 },        // free-flow width
    uBurstRadius: { value: 3.8 }, // how far the burst expands (world units)
    uSuckWide: { value: 2.2 },    // capture width for inhale
    uDotGain: { value: 1.15 },    // dot size gain
  };

  /* ======================
     Portal glow background (same vibe)
  ====================== */
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(viewW, viewH),
    new THREE.ShaderMaterial({
      uniforms: u,
      depthWrite: false,
      depthTest: false,
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;

        uniform float uTime;
        uniform vec2  uRes;
        uniform vec2  uLeft;
        uniform vec2  uRight;
        uniform float uPortalR;

        float hash(vec2 p){
          return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123);
        }
        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0,0.0));
          float c = hash(i + vec2(0.0,1.0));
          float d = hash(i + vec2(1.0,1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
        }

        float glow(vec2 p, vec2 c, float r){
          float d = length(p - c);
          float core = exp(-d*d/(r*r*0.35));
          float halo = exp(-d*d/(r*r*1.25));
          return 0.75*halo + 0.35*core;
        }

        void main(){
          vec2 p = (vUv - 0.5) * uRes;

          float n = noise(p*0.15 + vec2(uTime*0.05, -uTime*0.03));
          float vign = smoothstep(0.95, 0.25, length(vUv - 0.5));
          vec3 base = vec3(0.01, 0.03, 0.05) + 0.02*n;
          base *= (0.55 + 0.45*vign);

          vec3 leftCol  = vec3(0.05, 0.95, 0.85);
          vec3 rightCol = vec3(0.20, 0.55, 1.00);

          float pL = 0.85 + 0.15*sin(uTime*1.15);
          float pR = 0.85 + 0.15*sin(uTime*1.05 + 1.2);

          vec3 col = base;
          col += leftCol  * glow(p, uLeft,  uPortalR) * pL;
          col += rightCol * glow(p, uRight, uPortalR) * pR;

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `,
    })
  );
  bg.position.z = -2;
  scene.add(bg);

  /* ======================
     DOTS
  ====================== */
  const COUNT = 260;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));

  const aSeed = new Float32Array(COUNT);
  const aSize = new Float32Array(COUNT);
  const aEnergy = new Float32Array(COUNT);
  const aHueMix = new Float32Array(COUNT);

  const hash11 = (x) => {
    const s = Math.sin(x * 127.1) * 43758.5453123;
    return s - Math.floor(s);
  };
  const mix = (a, b, t) => a * (1 - t) + b * t;

  for (let i = 0; i < COUNT; i++) {
    const r1 = hash11(i * 12.9898);
    const r2 = hash11(i * 78.233);
    const r3 = hash11(i * 0.9182);
    aSeed[i] = r1;
    aEnergy[i] = mix(0.85, 1.15, r2);
    aSize[i] = mix(7.0, 18.0, Math.pow(r3, 0.55));
    aHueMix[i] = hash11(i * 5.123);
  }

  geo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  geo.setAttribute("aEnergy", new THREE.BufferAttribute(aEnergy, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute("aHueMix", new THREE.BufferAttribute(aHueMix, 1));

  const dotsMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: u,
    vertexShader: `
  precision highp float;

  uniform float uTime;
  uniform vec2  uLeft;
  uniform vec2  uRight;
  uniform float uPortalR;

  uniform float uBurstT;
  uniform float uDriftT;
  uniform float uSuckT;
  uniform float uHoldT;
  uniform float uRate;

  uniform float uBand;
  uniform float uBurstRadius;
  uniform float uSuckWide;
  uniform float uDotGain;

  attribute float aSeed;
  attribute float aEnergy;
  attribute float aSize;
  attribute float aHueMix;

  varying float vAlpha;
  varying float vHueMix;

  float clamp01(float x){ return clamp(x, 0.0, 1.0); }
  float smooth01(float t){ return t*t*(3.0 - 2.0*t); }
  float easeOutCubic(float t){ return 1.0 - pow(1.0 - t, 3.0); }
  float easeInOutCubic(float t){
    return (t < 0.5) ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0)/2.0;
  }
  float hash(float n){ return fract(sin(n)*43758.5453123); }

  vec2 wobble(vec2 p, float t){
    float k = 2.0;
    float n1 = sin(p.y*k + t*1.2) + sin(p.x*k*0.7 - t*1.1);
    float n2 = sin(p.x*k + t*1.0) - sin(p.y*k*0.9 + t*1.3);
    return vec2(n1, n2);
  }

  vec2 bezier(vec2 a, vec2 b, vec2 c, vec2 d, float t){
    float s = 1.0 - t;
    return s*s*s*a + 3.0*s*s*t*b + 3.0*s*t*t*c + t*t*t*d;
  }

  void main(){
    vHueMix = aHueMix;

    // GLOBAL PHASE
    float T = uTime * uRate;
    float cycle = uBurstT + uDriftT + uSuckT + uHoldT;
    float ph = mod(T, cycle);

    float burstEnd = uBurstT;
    float driftEnd = uBurstT + uDriftT;
    float suckEnd  = uBurstT + uDriftT + uSuckT;

    // radial direction
    float ang = hash(aSeed*91.7) * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));

    // super tight spawn
    float rad0 = pow(hash(aSeed*37.3), 6.0) * (uPortalR * 0.035);
    vec2 packed = uLeft + dir * rad0;

    // scatter to avoid perfect ring -> cloud
    float rx = hash(aSeed*201.3) * 2.0 - 1.0;
    float ry = hash(aSeed*413.7) * 2.0 - 1.0;
    vec2 scatter = vec2(rx, ry) * (0.55 + 0.65*hash(aSeed*88.2));

    vec2 p = packed;
    float alpha = 1.0;
    float sizeMul = 1.0;

    if (ph < burstEnd) {
      // ---- BURST ----
      float t = clamp01(ph / uBurstT);
      float e = easeOutCubic(t);

      float r = uBurstRadius * aEnergy * e;
      vec2 cloud = scatter * (0.10 + 0.55*e);

      p = packed + dir * r + cloud;
      alpha = 1.0;

    } else if (ph < driftEnd) {
      // ---- DRIFT ----
      float t = clamp01((ph - burstEnd) / uDriftT);
      float e = smooth01(t);

      float r = uBurstRadius * aEnergy;
      vec2 base = packed + dir * r + scatter * 0.65;

      vec2 w = wobble(base * 0.55, uTime + aSeed*10.0) * (0.28 * e);
      p = base + w;

      float yBand = uBand;
      p.y = mix(p.y, clamp(p.y, -yBand, yBand), 0.22 * e);

      alpha = 1.0;

    } else if (ph < suckEnd) {
  // ---- SUCK (random absorption, anti-blob) ----
  float tS = clamp01((ph - driftEnd) / uSuckT);

  // time at the exact DRIFT->SUCK boundary (freezes wobble for start)
  float tBoundary = uTime - (ph - driftEnd) / max(1e-3, uRate);

  // staggered "commit" times
  float delay = 0.05 + 0.55 * hash(aSeed*999.1);

  // local progress per dot AFTER it commits
  float local = clamp01((tS - delay) / max(1e-3, (1.0 - delay)));
  float e = easeInOutCubic(local);

  // starting cloud position (MATCH DRIFT endpoint to remove cut)
  float r = uBurstRadius * aEnergy;
  vec2 base = packed + dir * r + scatter * 0.65;

  // match DRIFT wobble at its end (e=1 => amp = 0.28)
  vec2 w = wobble(base * 0.55, tBoundary + aSeed*10.0) * 0.28;
  vec2 start = base + w;

  // match DRIFT band clamp at its end (mix = 0.22)
  float yBand = uBand;
  start.y = mix(start.y, clamp(start.y, -yBand, yBand), 0.22);





      // wide capture pull (even before commit)
      vec2 toR = (uRight - start);
      float prePull = smooth01(tS);
      vec2 capture = start + normalize(toR) * (length(toR) * 0.06) * uSuckWide * prePull;

      // curve into portal with per-dot bend variance
      vec2 a = capture;
      vec2 d = uRight;

      float bend = (hash(aSeed*321.7) * 2.0 - 1.0);
      vec2 b = (a + d) * 0.5 + vec2(0.0, 1.15 + 0.55*bend);
      vec2 c = (a + d) * 0.5 + vec2(0.0, -1.05 - 0.45*bend);

      vec2 curvePos = bezier(a, b, c, d, e);

      // blend into curve once it starts committing
      p = mix(capture, curvePos, smoothstep(0.0, 0.08, local));

      // micro-spiral (RAMP IN to avoid a phase cut)
float spin = (hash(aSeed*777.7) * 2.0 - 1.0);

// only start spiraling after suction has actually begun
float spiralIn = smoothstep(0.06, 0.22, tS);

// also wait until the particle has started "committing" a bit
float commitIn = smoothstep(0.02, 0.20, local);

// spiral fades out near the end of absorption
float spiralOut = 1.0 - smoothstep(0.60, 1.0, local);

float spiralAmt = 0.22 * spiralIn * commitIn * spiralOut;

vec2 radial = (uRight - p);
vec2 tangent = normalize(vec2(-radial.y, radial.x) + 1e-4);
p += tangent * spiralAmt * spin;


      // fade earlier (per-dot) so they don't brighten into a clump
      alpha = 1.0 - smoothstep(0.35, 0.80, local);

      // extra fade when close to portal (prevents bright pile-up)
      float distToPortal = length(p - uRight);
      float nearFade = smoothstep(0.70, 0.08, distToPortal); // 0 far -> 1 near
      alpha *= (1.0 - 0.92 * nearFade);

      // shrink dots as they approach portal (anti-blob)
      float shrink = smoothstep(0.18, 0.85, distToPortal);
      shrink = mix(0.20, 1.0, shrink);
      sizeMul = shrink;

    } else {
      // ---- HOLD ----
      p = uRight;
      alpha = 0.0;
      sizeMul = 0.0;
    }

    vAlpha = alpha;

    float pulse = 0.92 + 0.18*sin(uTime*1.25 + aSeed*12.0);
    gl_PointSize = aSize * uDotGain * pulse * sizeMul;

    vec4 mv = modelViewMatrix * vec4(p, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`,

    fragmentShader: `
      precision highp float;

      varying float vAlpha;
      varying float vHueMix;

      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);

        float core = smoothstep(0.22, 0.0, d);
        float halo = smoothstep(0.55, 0.14, d);

        vec3 teal = vec3(0.05, 0.95, 0.85);
        vec3 blue = vec3(0.20, 0.55, 1.00);
        vec3 col = mix(teal, blue, vHueMix);

        float a = (0.90*core + 0.35*halo) * vAlpha;
        a *= smoothstep(0.66, 0.0, d);

        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const dots = new THREE.Points(geo, dotsMat);
  scene.add(dots);

  function setView(w, h) {
    u.uRes.value.set(w, h);
    u.uLeft.value.set(-w * 0.38, 0);
    u.uRight.value.set(w * 0.38, 0);
    u.uPortalR.value = Math.min(h, w) * 0.22;

    // keep feel consistent
    u.uBurstRadius.value = Math.min(4.4, Math.max(3.2, w * 0.18));
    u.uBand.value = Math.max(2.6, Math.min(3.6, h * 0.30));
  }

  function update(t) {
    u.uTime.value = t;
  }

  return { setView, update };
}
