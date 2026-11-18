import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  TetrahedronGeometry,
  Vector3,
} from '@iwsdk/core';

const UP = new Vector3(0, 1, 0);

const billboardVertex = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;

const glowFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
  gl_FragColor = vec4(uColor, a * uOpacity);
  #include <colorspace_fragment>
}
`;

export interface Glow {
  mesh: Mesh;
  material: ShaderMaterial;
}

/** Camera-facing additive glow disc. `size` is its world diameter in meters. */
export function createGlow(color: number, size: number, opacity = 1): Glow {
  const material = new ShaderMaterial({
    vertexShader: billboardVertex,
    fragmentShader: glowFragment,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uSize: { value: size },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  // The billboard is displaced in the shader, so its local quad must never catch pointer rays.
  mesh.raycast = () => undefined;
  return { mesh, material };
}

export function setGlow(glow: Glow, size: number, opacity: number): void {
  glow.material.uniforms.uSize.value = size;
  glow.material.uniforms.uOpacity.value = opacity;
}

interface Flash {
  glow: Glow;
  t: number;
  duration: number;
  size: number;
  active: boolean;
}

/** Short expanding glow bursts for impacts, spawns and overcharge. */
export class FlashPool {
  readonly group = new Group();
  private flashes: Flash[] = [];
  private cursor = 0;

  constructor(count = 6) {
    this.group.name = 'Impact Flashes';
    for (let i = 0; i < count; i++) {
      const glow = createGlow(0xffffff, 0.01, 0);
      glow.mesh.visible = false;
      this.group.add(glow.mesh);
      this.flashes.push({ glow, t: 0, duration: 1, size: 1, active: false });
    }
  }

  fire(position: Vector3, color: number, size: number, duration: number): void {
    let flash = this.flashes.find((candidate) => !candidate.active);
    if (flash == null) {
      flash = this.flashes[this.cursor];
      this.cursor = (this.cursor + 1) % this.flashes.length;
    }
    flash.active = true;
    flash.t = 0;
    flash.duration = duration;
    flash.size = size;
    flash.glow.mesh.position.copy(position);
    flash.glow.mesh.visible = true;
    flash.glow.material.uniforms.uColor.value.setHex(color);
  }

  update(delta: number): void {
    for (const flash of this.flashes) {
      if (!flash.active) continue;
      flash.t += delta;
      const progress = flash.t / flash.duration;
      if (progress >= 1) {
        flash.active = false;
        flash.glow.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - progress) * (1 - progress);
      setGlow(flash.glow, flash.size * (0.25 + 0.9 * eased), (1 - progress) ** 2);
    }
  }
}

const fragmentVertex = /* glsl */ `
varying vec3 vColor;
varying vec3 vPos;
void main() {
  vColor = instanceColor;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentFragment = /* glsl */ `
varying vec3 vColor;
varying vec3 vPos;
void main() {
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  float facet = 0.5 + 0.5 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
  gl_FragColor = vec4(vColor * facet, 1.0);
  #include <colorspace_fragment>
}
`;

const MAX_FRAGMENTS = 240;

/** One instanced draw call of glowing, flat-shaded crystal shards. */
export class FragmentBurst {
  readonly mesh: InstancedMesh;
  private position = new Float32Array(MAX_FRAGMENTS * 3);
  private velocity = new Float32Array(MAX_FRAGMENTS * 3);
  private axis = new Float32Array(MAX_FRAGMENTS * 3);
  private baseColor = new Float32Array(MAX_FRAGMENTS * 3);
  private spin = new Float32Array(MAX_FRAGMENTS);
  private angle = new Float32Array(MAX_FRAGMENTS);
  private life = new Float32Array(MAX_FRAGMENTS);
  private maxLife = new Float32Array(MAX_FRAGMENTS);
  private size = new Float32Array(MAX_FRAGMENTS);
  private cursor = 0;
  private alive = 0;

  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly axisVector = new Vector3();
  private readonly positionVector = new Vector3();
  private readonly scaleVector = new Vector3();
  private readonly color = new Color();
  private readonly zeroMatrix = new Matrix4().makeScale(0, 0, 0);

  constructor() {
    const material = new ShaderMaterial({
      vertexShader: fragmentVertex,
      fragmentShader: fragmentFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(new TetrahedronGeometry(1, 0), material, MAX_FRAGMENTS);
    this.mesh.name = 'Shatter Fragments';
    this.mesh.frustumCulled = false;
    this.color.setRGB(0, 0, 0);
    for (let i = 0; i < MAX_FRAGMENTS; i++) {
      this.mesh.setMatrixAt(i, this.zeroMatrix);
      this.mesh.setColorAt(i, this.color);
    }
  }

  emit(origin: Vector3, colorHex: number, count = 40, speed = 2.4): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_FRAGMENTS;
      if (this.life[i] <= 0) this.alive++;

      const theta = Math.acos(2 * Math.random() - 1);
      const phi = Math.random() * Math.PI * 2;
      const dx = Math.sin(theta) * Math.cos(phi);
      const dy = Math.cos(theta);
      const dz = Math.sin(theta) * Math.sin(phi);
      const v = speed * (0.35 + Math.random() * 0.95);
      const o = i * 3;
      this.position[o] = origin.x + dx * 0.03;
      this.position[o + 1] = origin.y + dy * 0.03;
      this.position[o + 2] = origin.z + dz * 0.03;
      this.velocity[o] = dx * v;
      this.velocity[o + 1] = dy * v + 0.6;
      this.velocity[o + 2] = dz * v;

      this.axisVector.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.axis[o] = this.axisVector.x;
      this.axis[o + 1] = this.axisVector.y;
      this.axis[o + 2] = this.axisVector.z;

      this.color.setHex(colorHex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18);
      this.baseColor[o] = this.color.r;
      this.baseColor[o + 1] = this.color.g;
      this.baseColor[o + 2] = this.color.b;

      this.spin[i] = 4 + Math.random() * 10;
      this.angle[i] = Math.random() * Math.PI * 2;
      this.maxLife[i] = 0.9 + Math.random() * 0.9;
      this.life[i] = this.maxLife[i];
      this.size[i] = 0.02 + Math.random() * 0.035;
    }
  }

  update(delta: number): void {
    if (this.alive === 0) return;
    for (let i = 0; i < MAX_FRAGMENTS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= delta;
      if (this.life[i] <= 0) {
        this.alive--;
        this.mesh.setMatrixAt(i, this.zeroMatrix);
        this.color.setRGB(0, 0, 0);
        this.mesh.setColorAt(i, this.color);
        continue;
      }
      const o = i * 3;
      const drag = Math.max(0, 1 - 1.4 * delta);
      this.velocity[o] *= drag;
      this.velocity[o + 1] = this.velocity[o + 1] * drag - 1.6 * delta;
      this.velocity[o + 2] *= drag;
      this.position[o] += this.velocity[o] * delta;
      this.position[o + 1] += this.velocity[o + 1] * delta;
      this.position[o + 2] += this.velocity[o + 2] * delta;
      this.angle[i] += this.spin[i] * delta;

      const ratio = this.life[i] / this.maxLife[i];
      this.positionVector.set(this.position[o], this.position[o + 1], this.position[o + 2]);
      this.axisVector.set(this.axis[o], this.axis[o + 1], this.axis[o + 2]);
      this.quaternion.setFromAxisAngle(this.axisVector, this.angle[i]);
      this.scaleVector.setScalar(this.size[i] * (0.35 + 0.65 * ratio));
      this.matrix.compose(this.positionVector, this.quaternion, this.scaleVector);
      this.mesh.setMatrixAt(i, this.matrix);

      const glow = 1.5 * ratio ** 0.6;
      this.color.setRGB(this.baseColor[o] * glow, this.baseColor[o + 1] * glow, this.baseColor[o + 2] * glow);
      this.mesh.setColorAt(i, this.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const beamVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uHead;
uniform float uOpacity;
uniform float uSharp;
varying vec2 vUv;
void main() {
  float behind = uHead - vUv.y;
  if (behind < 0.0) discard;
  float a = exp(-behind * uSharp);
  vec3 col = mix(uColor, vec3(1.0), smoothstep(0.14, 0.0, behind));
  gl_FragColor = vec4(col * (0.9 + a), a * uOpacity);
  #include <colorspace_fragment>
}
`;

/** Seconds for a beam head to travel from a target into the core. */
export const BEAM_TRAVEL = 0.42;
const BEAM_FADE = 0.3;

interface Beam {
  group: Group;
  core: ShaderMaterial;
  halo: ShaderMaterial;
  t: number;
  active: boolean;
}

/** Pooled energy beams that streak from a shattered target into the core. */
export class BeamPool {
  readonly group = new Group();
  private beams: Beam[] = [];
  private cursor = 0;
  private readonly direction = new Vector3();
  private readonly quaternion = new Quaternion();

  constructor(count = 4) {
    this.group.name = 'Energy Beams';
    const geometry = new CylinderGeometry(1, 1, 1, 10, 1, true);
    geometry.translate(0, 0.5, 0);
    for (let i = 0; i < count; i++) {
      const make = (opacity: number, sharp: number) =>
        new ShaderMaterial({
          vertexShader: beamVertex,
          fragmentShader: beamFragment,
          uniforms: {
            uColor: { value: new Color(0xffc477) },
            uHead: { value: 0 },
            uOpacity: { value: opacity },
            uSharp: { value: sharp },
          },
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        });
      const core = make(1, 3.2);
      const halo = make(0.35, 2.2);
      const group = new Group();
      const coreMesh = new Mesh(geometry, core);
      const haloMesh = new Mesh(geometry, halo);
      coreMesh.userData.radius = 0.012;
      haloMesh.userData.radius = 0.05;
      coreMesh.frustumCulled = false;
      haloMesh.frustumCulled = false;
      group.add(coreMesh, haloMesh);
      group.visible = false;
      this.group.add(group);
      this.beams.push({ group, core, halo, t: 0, active: false });
    }
  }

  fire(from: Vector3, to: Vector3, color: number): void {
    let beam = this.beams.find((candidate) => !candidate.active);
    if (beam == null) {
      beam = this.beams[this.cursor];
      this.cursor = (this.cursor + 1) % this.beams.length;
    }
    this.direction.subVectors(to, from);
    const length = this.direction.length();
    this.direction.divideScalar(Math.max(length, 1e-4));
    this.quaternion.setFromUnitVectors(UP, this.direction);

    beam.group.position.copy(from);
    beam.group.quaternion.copy(this.quaternion);
    for (const child of beam.group.children) {
      const radius = child.userData.radius as number;
      child.scale.set(radius, length, radius);
    }
    beam.core.uniforms.uColor.value.setHex(color);
    beam.halo.uniforms.uColor.value.setHex(color);
    beam.t = 0;
    beam.active = true;
    beam.group.visible = true;
  }

  update(delta: number): void {
    for (const beam of this.beams) {
      if (!beam.active) continue;
      beam.t += delta;
      const head = Math.min(beam.t / BEAM_TRAVEL, 1);
      const fade = beam.t < BEAM_TRAVEL ? 1 : Math.max(0, 1 - (beam.t - BEAM_TRAVEL) / BEAM_FADE);
      if (fade <= 0) {
        beam.active = false;
        beam.group.visible = false;
        continue;
      }
      beam.core.uniforms.uHead.value = head;
      beam.halo.uniforms.uHead.value = head;
      beam.core.uniforms.uOpacity.value = fade;
      beam.halo.uniforms.uOpacity.value = fade * 0.35;
    }
  }
}

const trailVertex = /* glsl */ `
attribute float aAge;
uniform float uLife;
uniform float uSize;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float t = clamp(aAge / uLife, 0.0, 1.0);
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 viewCenter = viewMatrix * center;
  viewCenter.xy += position.xy * uSize * (1.0 - t);
  vAlpha = (1.0 - t) * (1.0 - t) * step(t, 0.999);
  vUv = uv;
  gl_Position = projectionMatrix * viewCenter;
}
`;

const trailFragment = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.8);
  gl_FragColor = vec4(uColor, a * vAlpha);
  #include <colorspace_fragment>
}
`;

const TRAIL_COUNT = 96;
const TRAIL_LIFE = 0.9;

/** Ring buffer of billboarded sparks that fade behind the Energy Orb. */
export class ParticleTrail {
  readonly mesh: InstancedMesh;
  private ages = new Float32Array(TRAIL_COUNT).fill(TRAIL_LIFE);
  private ageAttribute: InstancedBufferAttribute;
  private cursor = 0;
  private carry = 0;
  private readonly matrix = new Matrix4();

  constructor(color = 0xffb85c) {
    const material = new ShaderMaterial({
      vertexShader: trailVertex,
      fragmentShader: trailFragment,
      uniforms: {
        uColor: { value: new Color(color) },
        uLife: { value: TRAIL_LIFE },
        uSize: { value: 0.045 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), material, TRAIL_COUNT);
    this.mesh.name = 'Energy Orb Trail';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < TRAIL_COUNT; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.ageAttribute = new InstancedBufferAttribute(this.ages, 1);
    this.mesh.geometry.setAttribute('aAge', this.ageAttribute);
  }

  /** Age all sparks, then emit `rate` new ones per second at `at` (when given). */
  update(delta: number, at: Vector3 | null, rate: number): void {
    for (let i = 0; i < TRAIL_COUNT; i++) {
      if (this.ages[i] < TRAIL_LIFE) this.ages[i] += delta;
    }
    if (at != null) {
      this.carry += delta * rate;
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % TRAIL_COUNT;
        this.ages[i] = 0;
        this.matrix.makeTranslation(
          at.x + (Math.random() - 0.5) * 0.03,
          at.y + (Math.random() - 0.5) * 0.03,
          at.z + (Math.random() - 0.5) * 0.03,
        );
        this.mesh.setMatrixAt(i, this.matrix);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.ageAttribute.needsUpdate = true;
  }
}
