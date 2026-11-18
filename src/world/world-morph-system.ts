import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  createSystem,
  DoubleSide,
  FogExp2,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  type IUniform,
} from '@iwsdk/core';
import { CORE_POSITION } from '../focus/layout.js';
import { THEMES, worldTheme, type ThemeParams } from './world-theme.js';

/*
 * Procedural world morph. Everything here is generated in code: one sky dome
 * shader, one wave shell, and three InstancedMesh batches (petals, rain, rim
 * lamps). No .glb, .hdr or audio files are loaded, and the whole system adds
 * 5 draw calls on top of the existing scene.
 */

const WAVE_SECONDS = 3;
/** Angular front (in units of pi) that sweeps the sky from the core direction. */
const FRONT_END = 1.2;
const PETAL_COUNT = 90;
const RAIN_COUNT = 360;
const LAMP_COUNT = 28;
const DRAW_CALL_BUDGET = 100;

const noRaycast = (): void => {};

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p;
}
`;

const skyFragment = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uFront;
uniform float uGlow;
uniform vec3 uCoreDir;
uniform vec3 uSunDir;
uniform vec3 uTopA;
uniform vec3 uHorA;
uniform vec3 uBotA;
uniform vec3 uTopB;
uniform vec3 uHorB;
uniform vec3 uBotB;
uniform vec4 uFeatA;
uniform vec4 uFeatB;
uniform float uSunGlowA;
uniform float uSunGlowB;
uniform vec3 uAccentB;
varying vec3 vDir;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise3(p);
    p = p * 2.07 + 1.7;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float ang = acos(clamp(dot(d, uCoreDir), -1.0, 1.0)) / 3.14159265;
  float m = 1.0 - smoothstep(uFront - 0.16, uFront, ang);

  vec3 top = mix(uTopA, uTopB, m);
  vec3 hor = mix(uHorA, uHorB, m);
  vec3 bot = mix(uBotA, uBotB, m);
  vec4 feat = mix(uFeatA, uFeatB, m);
  float sunGlow = mix(uSunGlowA, uSunGlowB, m);
  float h = d.y;

  vec3 col = h >= 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, bot, smoothstep(0.0, -0.45, h));
  col += hor * exp(-abs(h) * 9.0) * 0.35;

  float s = max(dot(d, uSunDir), 0.0);
  col += mix(vec3(1.0, 0.8, 0.55), hor, 0.3) * (pow(s, 28.0) * 0.55 + pow(s, 6.0) * 0.18) * sunGlow;

  if (feat.y > 0.01) {
    float n = fbm(d * 2.4 + vec3(0.0, uTime * 0.01, 0.0));
    float n2 = fbm(d * 5.0 + 7.1);
    vec3 neb = mix(vec3(0.38, 0.12, 0.62), vec3(0.08, 0.45, 0.78), n2) * smoothstep(0.32, 0.8, n);
    col += neb * 0.95 * feat.y;
  }

  if (feat.x > 0.01) {
    vec3 sp = d * 140.0;
    vec3 id = floor(sp);
    vec3 fp = fract(sp) - 0.5;
    float r = hash31(id);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0);
    float star = step(0.975, r) * smoothstep(0.35, 0.0, length(fp)) * twinkle;
    col += vec3(0.85, 0.9, 1.0) * star * feat.x;
  }

  if (feat.w > 0.01) {
    vec3 rs = normalize(vec3(0.25, 0.1, -0.96));
    float sd = acos(clamp(dot(d, rs), -1.0, 1.0));
    float disc = smoothstep(0.31, 0.295, sd);
    float band = step(0.5, fract((h - rs.y) * 38.0)) + step(h, rs.y - 0.14) * 0.0;
    float bands = h > rs.y - 0.02 ? 1.0 : clamp(band, 0.0, 1.0);
    vec3 sunCol = mix(vec3(1.0, 0.15, 0.55), vec3(1.0, 0.82, 0.25), clamp((h - rs.y + 0.3) / 0.6, 0.0, 1.0));
    col = mix(col, sunCol * 1.15, disc * bands * feat.w);

    if (h < -0.002) {
      col = mix(col, vec3(0.025, 0.01, 0.06), 0.85 * feat.w);
      vec2 uv = d.xz / -h;
      float dist = length(uv);
      vec2 g = uv * 0.4 + vec2(0.0, uTime * 0.25);
      vec2 lineDist = 0.5 - abs(fract(g) - 0.5);
      vec2 wd = fwidth(g);
      vec2 l = 1.0 - smoothstep(vec2(0.02), vec2(0.02) + wd * 1.3, lineDist);
      float line = max(l.x, l.y);
      float fade = exp(-dist * 0.045);
      vec3 gridCol = mix(vec3(1.0, 0.1, 0.62), vec3(0.0, 0.9, 1.0), clamp(dist * 0.06, 0.0, 1.0));
      col += gridCol * line * fade * 1.5 * feat.w;
    } else {
      float az = atan(d.x, d.z);
      float cell = floor(az * 24.0);
      float height = 0.012 + 0.1 * hash11(cell) * (0.35 + 0.65 * hash11(cell + 13.0));
      if (h < height) {
        vec3 b = vec3(0.02, 0.01, 0.05);
        float win = step(0.82, hash21(floor(vec2(az * 24.0 * 7.0, h * 170.0))));
        vec3 winCol = hash11(cell + 3.0) > 0.5 ? vec3(0.0, 0.85, 1.0) : vec3(1.0, 0.2, 0.7);
        b += winCol * win * 0.55;
        col = mix(col, b, feat.w);
      }
    }
  }

  if (feat.z > 0.01) {
    vec3 c = vec3(0.0, -1.12, 0.0);
    float b = dot(d, c);
    float disc = b * b - (dot(c, c) - 1.0);
    vec3 earth = vec3(0.0);
    float cover = 0.0;
    if (b > 0.0) {
      if (disc > 0.0) {
        float t = b - sqrt(disc);
        vec3 n = normalize(d * t - c);
        float a = uTime * 0.01;
        vec3 q = n;
        q.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * q.xz;
        float land = smoothstep(0.52, 0.58, fbm(q * 2.6));
        vec3 ocean = vec3(0.015, 0.1, 0.36);
        vec3 ground = mix(vec3(0.06, 0.28, 0.1), vec3(0.42, 0.34, 0.18), fbm(q * 7.0));
        vec3 surf = mix(ocean, ground, land);
        float cl = smoothstep(0.5, 0.78, fbm(q * 4.5 + vec3(uTime * 0.01, 0.0, 0.0)));
        surf = mix(surf, vec3(0.95), cl * 0.85);
        float lit = clamp(dot(n, normalize(vec3(-0.35, 0.8, -0.5))) * 1.1 + 0.25, 0.08, 1.0);
        float fres = pow(1.0 - clamp(dot(n, -d), 0.0, 1.0), 3.0);
        earth = surf * lit + vec3(0.25, 0.55, 1.0) * fres * 0.9;
        cover = smoothstep(0.0, 0.015, disc);
      }
      float closest = sqrt(max(dot(c, c) - b * b, 0.0));
      float glow = exp(-max(closest - 1.0, 0.0) * 26.0);
      col += vec3(0.22, 0.52, 1.0) * glow * 0.85 * feat.z;
    }
    col = mix(col, earth, cover * feat.z);
  }

  float ring = exp(-pow((ang - (uFront - 0.05)) / 0.035, 2.0));
  col += uAccentB * ring * uGlow * 1.7;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const shellVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * mv;
}
`;

const shellFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec2 vUv;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
  float bands = 0.65 + 0.35 * step(0.5, fract(vUv.y * 22.0 - uTime * 0.6));
  gl_FragColor = vec4(uColor, (rim * 0.9 + 0.04) * bands * uAlpha);
  #include <colorspace_fragment>
}
`;

const petalVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float fall = 0.3 + 0.25 * fract(aSeed * 5.7);
  float y = mod(base.y - uTime * fall, 5.0) - 0.4;
  vec3 c = vec3(
    base.x + sin(uTime * 0.6 + aSeed * 30.0) * 0.35,
    y,
    base.z + cos(uTime * 0.45 + aSeed * 17.0) * 0.35
  );
  vec4 vc = viewMatrix * vec4(c, 1.0);
  float size = (0.05 + 0.035 * fract(aSeed * 3.3)) * uAmount;
  float a = uTime * 1.4 + aSeed * 20.0;
  vec2 q = vec2(cos(a) * position.x - sin(a) * position.y, sin(a) * position.x + cos(a) * position.y);
  vc.xy += q * size;
  vUv = uv;
  vA = smoothstep(0.0, 0.5, y + 0.4) * smoothstep(5.0, 4.3, y + 0.4);
  gl_Position = projectionMatrix * vc;
}
`;

const petalFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = length(p * vec2(1.0, 1.7));
  float a = smoothstep(1.0, 0.55, d);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.25 * (1.0 - d)), a * vA * 0.9 * step(0.01, uAmount));
  #include <colorspace_fragment>
}
`;

const rainVertex = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float speed = 9.0 + 3.0 * fract(aSeed * 7.1);
  float y = mod(base.y - uTime * speed, 6.0) - 0.5;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 wp = vec3(base.x, y, base.z)
    + right * position.x * 0.014 * uAmount
    + vec3(0.0, 1.0, 0.0) * position.y * 0.6 * uAmount
    + vec3(0.12, 0.0, 0.0) * position.y * 0.3 * uAmount;
  vUv = uv;
  vA = smoothstep(-0.5, 0.2, y) * (0.5 + 0.5 * fract(aSeed * 11.3));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const rainFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
varying float vA;
void main() {
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float along = smoothstep(0.0, 1.0, vUv.y);
  gl_FragColor = vec4(uColor, across * along * vA * 0.6 * step(0.01, uAmount));
  #include <colorspace_fragment>
}
`;

const lampVertex = /* glsl */ `
attribute float aParity;
varying float vParity;
varying float vHeight;
void main() {
  vParity = aParity;
  vHeight = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const lampFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
varying float vParity;
varying float vHeight;
void main() {
  vec3 c = mix(uColorA, uColorB, vParity) * (0.75 + 0.25 * sin(uTime * 2.2 + vParity * 6.0));
  c *= 0.55 + (vHeight + 0.14) * 1.6;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

type Uniforms = Record<string, IUniform>;

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Drives lighting, fog, sky, platform accents and particles from the active
 * theme, and plays the expanding energy wave whenever the theme changes.
 */
export class WorldMorphSystem extends createSystem({}) {
  private from: ThemeParams = THEMES[0];
  private to: ThemeParams = THEMES[0];
  private progress = 1;
  private active = false;
  private time = 0;

  private sky!: ShaderMaterial;
  private shell!: Mesh;
  private shellMaterial!: ShaderMaterial;
  private petals!: InstancedMesh;
  private rain!: InstancedMesh;
  private lamps!: InstancedMesh;
  private fog = new FogExp2(0xf7d9b5, 0.012);

  private platformMaterials = new Map<string, MeshStandardMaterial>();
  private platformBound = false;
  private cloudsMaterial: MeshStandardMaterial | null = null;
  private cloudsObject: Object3D | null = null;

  private readonly coreWorld = new Vector3(...CORE_POSITION);
  private readonly cameraWorld = new Vector3();
  private readonly coreDir = new Vector3();
  private readonly colorA = new Color();
  private readonly colorB = new Color();
  private readonly mixed = new Color();

  private statsTimer = 0;

  init(): void {
    this.world.scene.fog = this.fog;
    this.createSky();
    this.createShell();
    this.createPetals();
    this.createRain();
    this.createLamps();

    this.begin(worldTheme.index, true);
    this.cleanupFuncs.push(
      worldTheme.subscribe((request) => this.begin(request.index, request.instant)),
    );
  }

  update(delta: number): void {
    this.time += delta;
    this.sky.uniforms.uTime.value = this.time;
    this.shellMaterial.uniforms.uTime.value = this.time;
    for (const mesh of [this.petals, this.rain]) {
      (mesh.material as ShaderMaterial).uniforms.uTime.value = this.time;
    }
    (this.lamps.material as ShaderMaterial).uniforms.uTime.value = this.time;

    this.world.camera.getWorldPosition(this.cameraWorld);
    this.coreDir.subVectors(this.coreWorld, this.cameraWorld).normalize();
    this.sky.uniforms.uCoreDir.value.copy(this.coreDir);

    if (!this.platformBound) this.bindPlatform();

    if (this.active) {
      this.progress = Math.min(1, this.progress + delta / WAVE_SECONDS);
      const eased = easeInOut(this.progress);
      this.sky.uniforms.uFront.value = eased * FRONT_END;
      this.sky.uniforms.uGlow.value = Math.sin(Math.PI * this.progress);
      this.updateShell(eased);
      this.apply(eased);
      if (this.progress >= 1) this.finish();
    }

    this.trackDrawCalls(delta);
  }

  /** Start a wave from the core towards `index`, or snap there when `instant`. */
  private begin(index: number, instant: boolean): void {
    const target = THEMES[index];
    if (instant) {
      this.from = this.to = target;
      this.finish();
      return;
    }
    if (this.active && this.progress > 0.5) this.from = this.to;
    else if (!this.active) this.from = this.to;
    this.to = target;
    this.progress = 0;
    this.active = true;

    this.writeSkyTheme('A', this.from);
    this.writeSkyTheme('B', this.to);
    this.sky.uniforms.uFront.value = 0;
    this.sky.uniforms.uGlow.value = 0;
    (this.sky.uniforms.uAccentB.value as Color).setHex(this.to.accent);
    (this.shellMaterial.uniforms.uColor.value as Color).setHex(this.to.accent);
    this.shell.visible = true;
    this.updateShell(0);
  }

  private finish(): void {
    this.active = false;
    this.progress = 1;
    this.from = this.to;
    this.writeSkyTheme('A', this.to);
    this.writeSkyTheme('B', this.to);
    this.sky.uniforms.uFront.value = 2;
    this.sky.uniforms.uGlow.value = 0;
    this.shell.visible = false;
    this.apply(1);
  }

  private updateShell(eased: number): void {
    this.shell.scale.setScalar(0.2 + eased * 16);
    this.shellMaterial.uniforms.uAlpha.value = Math.sin(Math.PI * this.progress) * 0.9;
  }

  private mixHex(out: Color, a: number, b: number, t: number): Color {
    return out.copy(this.colorA.setHex(a)).lerp(this.colorB.setHex(b), t);
  }

  /** Blend lighting, fog, platform accents and particle amounts at `t` (0 = from, 1 = to). */
  private apply(t: number): void {
    const a = this.from;
    const b = this.to;
    const lerp = MathUtils.lerp;

    this.fog.color.copy(this.mixHex(this.mixed, a.fogColor, b.fogColor, t));
    this.fog.density = lerp(a.fogDensity, b.fogDensity, t);
    this.world.scene.environmentIntensity = lerp(a.envIntensity, b.envIntensity, t);

    const { sun, sunDisc, motes } = worldTheme.bindings;
    if (sun) {
      sun.color.copy(this.mixHex(this.mixed, a.sunColor, b.sunColor, t));
      sun.intensity = lerp(a.sunIntensity, b.sunIntensity, t);
    }
    if (sunDisc) {
      (sunDisc.uniforms.uColor.value as Color).copy(
        this.mixHex(this.mixed, a.sunDiscColor, b.sunDiscColor, t),
      );
      sunDisc.uniforms.uOpacity.value = lerp(a.sunDiscOpacity, b.sunDiscOpacity, t);
    }
    if (motes) {
      (motes.uniforms.uColor.value as Color).copy(
        this.mixHex(this.mixed, a.moteColor, b.moteColor, t),
      );
    }

    const deck = this.platformMaterials.get('zen-deck');
    if (deck) deck.color.copy(this.mixHex(this.mixed, a.deck, b.deck, t));
    const rock = this.platformMaterials.get('zen-rock');
    if (rock) rock.color.copy(this.mixHex(this.mixed, a.rock, b.rock, t));
    const stone = this.platformMaterials.get('zen-stone');
    if (stone) stone.color.copy(this.mixHex(this.mixed, a.stone, b.stone, t));
    const inlay = this.platformMaterials.get('zen-inlay');
    if (inlay) {
      inlay.emissive.copy(this.mixHex(this.mixed, a.inlayEmissive, b.inlayEmissive, t));
      inlay.emissiveIntensity = lerp(a.inlayIntensity, b.inlayIntensity, t);
    }

    if (this.cloudsMaterial && this.cloudsObject) {
      const opacity = lerp(a.cloudOpacity, b.cloudOpacity, t);
      const transparent = opacity < 0.999;
      if (this.cloudsMaterial.transparent !== transparent) {
        this.cloudsMaterial.transparent = transparent;
        this.cloudsMaterial.needsUpdate = true;
      }
      this.cloudsMaterial.opacity = opacity;
      this.cloudsMaterial.depthWrite = !transparent;
      this.cloudsObject.visible = opacity > 0.01;
    }

    const petalAmount = lerp(a.petals, b.petals, t);
    const rainAmount = lerp(a.rain, b.rain, t);
    (this.petals.material as ShaderMaterial).uniforms.uAmount.value = petalAmount;
    (this.rain.material as ShaderMaterial).uniforms.uAmount.value = rainAmount;
    this.petals.visible = petalAmount > 0.01;
    this.rain.visible = rainAmount > 0.01;

    const lamp = this.lamps.material as ShaderMaterial;
    (lamp.uniforms.uColorA.value as Color).copy(this.mixHex(this.mixed, a.accent, b.accent, t));
    (lamp.uniforms.uColorB.value as Color).copy(
      this.mixHex(this.mixed, a.accentAlt, b.accentAlt, t),
    );
  }

  private writeSkyTheme(slot: 'A' | 'B', theme: ThemeParams): void {
    const u = this.sky.uniforms;
    (u[`uTop${slot}`].value as Color).setHex(theme.top);
    (u[`uHor${slot}`].value as Color).setHex(theme.horizon);
    (u[`uBot${slot}`].value as Color).setHex(theme.bottom);
    u[`uFeat${slot}`].value.set(theme.stars, theme.nebula, theme.earth, theme.grid);
    u[`uSunGlow${slot}`].value = theme.sunGlow;
    if (slot === 'B') (u.uAccentB.value as Color).setHex(theme.accent);
  }

  /** Platform and clouds load asynchronously from the scene file. */
  private bindPlatform(): void {
    const platform = this.world.getSceneObject('zen-platform');
    if (platform == null) return;
    platform.traverse((object) => {
      const material = (object as Mesh).material as MeshStandardMaterial | undefined;
      if (material?.name?.startsWith('zen-')) this.platformMaterials.set(material.name, material);
    });
    const clouds = this.world.getSceneObject('clouds') as InstancedMesh | undefined;
    if (clouds != null) {
      this.cloudsObject = clouds;
      this.cloudsMaterial = clouds.material as MeshStandardMaterial;
    }
    this.platformBound = this.platformMaterials.size > 0;
    if (this.platformBound) this.apply(this.active ? easeInOut(this.progress) : 1);
  }

  private trackDrawCalls(delta: number): void {
    this.statsTimer += delta;
    if (this.statsTimer < 1) return;
    this.statsTimer = 0;
    const info = this.world.renderer.info.render;
    (window as unknown as { __focusforge?: object }).__focusforge = {
      drawCalls: info.calls,
      triangles: info.triangles,
      pixelRatio: this.world.renderer.getPixelRatio(),
      theme: worldTheme.theme.label,
    };
    if (info.calls > DRAW_CALL_BUDGET) {
      console.warn(`FocusForge draw calls ${info.calls} exceed budget ${DRAW_CALL_BUDGET}`);
    }
  }

  // --------------------------------------------------------------- objects ---

  private createSky(): void {
    const color = () => ({ value: new Color() });
    this.sky = new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: {
        uTime: { value: 0 },
        uFront: { value: 2 },
        uGlow: { value: 0 },
        uCoreDir: { value: new Vector3(0, 0.4, -1) },
        uSunDir: { value: new Vector3(-0.5, 0.3, -0.81).normalize() },
        uTopA: color(),
        uHorA: color(),
        uBotA: color(),
        uTopB: color(),
        uHorB: color(),
        uBotB: color(),
        uFeatA: { value: new Vector4() },
        uFeatB: { value: new Vector4() },
        uSunGlowA: { value: 1 },
        uSunGlowB: { value: 1 },
        uAccentB: color(),
      } as Uniforms,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const dome = new Mesh(new SphereGeometry(1, 32, 16), this.sky);
    dome.name = 'Morphing Sky';
    dome.renderOrder = -1e8;
    dome.frustumCulled = false;
    dome.raycast = noRaycast;
    this.world.createTransformEntity(dome, { persistent: true });
  }

  private createShell(): void {
    this.shellMaterial = new ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: shellFragment,
      uniforms: {
        uColor: { value: new Color(0x00e5ff) },
        uAlpha: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.shell = new Mesh(new SphereGeometry(1, 40, 24), this.shellMaterial);
    this.shell.name = 'Energy Wave';
    this.shell.position.copy(this.coreWorld);
    this.shell.frustumCulled = false;
    this.shell.visible = false;
    this.shell.renderOrder = 5;
    this.shell.raycast = noRaycast;
    this.world.createTransformEntity(this.shell, { persistent: true });
  }

  private createBillboards(
    name: string,
    count: number,
    vertexShader: string,
    fragmentShader: string,
    color: number,
    spread: [number, number],
    yRange: [number, number],
    seed: number,
  ): InstancedMesh {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uColor: { value: new Color(color) },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.raycast = noRaycast;

    const random = seededRandom(seed);
    const seeds = new Float32Array(count);
    const matrix = new Matrix4();
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const radius = spread[0] + Math.sqrt(random()) * (spread[1] - spread[0]);
      matrix.makeTranslation(
        Math.sin(angle) * radius,
        yRange[0] + random() * (yRange[1] - yRange[0]),
        Math.cos(angle) * radius,
      );
      mesh.setMatrixAt(i, matrix);
      seeds[i] = random();
    }
    mesh.geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = false;

    const holder = new Object3D();
    holder.add(mesh);
    this.world.createTransformEntity(holder, { persistent: true });
    return mesh;
  }

  private createPetals(): void {
    this.petals = this.createBillboards(
      'Blossom Petals',
      PETAL_COUNT,
      petalVertex,
      petalFragment,
      0xffb7c9,
      [0.8, 5.5],
      [0, 5],
      7741,
    );
  }

  private createRain(): void {
    this.rain = this.createBillboards(
      'Rain Streaks',
      RAIN_COUNT,
      rainVertex,
      rainFragment,
      0xaef3ff,
      [0.4, 5.5],
      [-0.5, 5.5],
      9127,
    );
  }

  private createLamps(): void {
    const material = new ShaderMaterial({
      vertexShader: lampVertex,
      fragmentShader: lampFragment,
      uniforms: {
        uColorA: { value: new Color(0xffd08a) },
        uColorB: { value: new Color(0xffb7c9) },
        uTime: { value: 0 },
      },
    });
    this.lamps = new InstancedMesh(new BoxGeometry(0.05, 0.28, 0.05), material, LAMP_COUNT);
    this.lamps.name = 'Rim Lamps';
    this.lamps.frustumCulled = false;
    this.lamps.raycast = noRaycast;

    const parity = new Float32Array(LAMP_COUNT);
    const matrix = new Matrix4();
    for (let i = 0; i < LAMP_COUNT; i++) {
      const angle = (i / LAMP_COUNT) * Math.PI * 2;
      matrix.makeTranslation(Math.sin(angle) * 3.08, 0.14, Math.cos(angle) * 3.08);
      this.lamps.setMatrixAt(i, matrix);
      parity[i] = i % 2;
    }
    this.lamps.geometry.setAttribute('aParity', new InstancedBufferAttribute(parity, 1));
    this.lamps.instanceMatrix.needsUpdate = true;

    const holder = new Object3D();
    holder.add(this.lamps);
    this.world.createTransformEntity(holder, { persistent: true });
  }
}
