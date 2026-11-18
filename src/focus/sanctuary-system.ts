import {
  AdditiveBlending,
  Color,
  createSystem,
  DirectionalLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { worldTheme } from '../world/world-theme.js';

const MOTE_COUNT = 180;
const SUN_DIRECTION = new Vector3(-0.5, 0.3, -0.81).normalize();

const moteVertexShader = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float phase = aPhase * 6.2831;
  center.y += sin(uTime * 0.35 + phase) * 0.25;
  center.x += sin(uTime * 0.21 + phase * 2.0) * 0.18;
  center.z += cos(uTime * 0.17 + phase * 3.0) * 0.18;
  vec4 viewCenter = viewMatrix * center;
  float size = 0.018 + 0.022 * fract(aPhase * 7.31);
  viewCenter.xy += position.xy * size;
  vAlpha = 0.45 + 0.55 * sin(uTime * 1.3 + phase * 3.0);
  vUv = uv;
  gl_Position = projectionMatrix * viewCenter;
}
`;

const glowFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}
`;

const sunVertexShader = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Warm sunlight, a sun disc, drifting light motes and slow cloud drift. */
export class SanctuarySystem extends createSystem({}) {
  private moteMaterial!: ShaderMaterial;
  private time = 0;

  init(): void {
    const sun = new DirectionalLight(0xffd29c, 1.8);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(12);
    this.world.createTransformEntity(sun, { persistent: true });

    const sunDisc = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: sunVertexShader,
        fragmentShader: glowFragmentShader,
        uniforms: {
          uColor: { value: new Color(0xfff0c8) },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    sunDisc.position.copy(SUN_DIRECTION).multiplyScalar(150);
    sunDisc.scale.setScalar(42);
    sunDisc.lookAt(0, 0, 0);
    sunDisc.renderOrder = -1;
    this.world.createTransformEntity(sunDisc, { persistent: true });
    worldTheme.bindings.sun = sun;
    worldTheme.bindings.sunDisc = sunDisc.material as ShaderMaterial;

    this.createMotes();
  }

  update(delta: number): void {
    this.time += delta;
    this.moteMaterial.uniforms.uTime.value = this.time;
    const clouds = this.world.getSceneObject('clouds');
    if (clouds) {
      clouds.rotation.y += delta * 0.006;
    }
  }

  private createMotes(): void {
    this.moteMaterial = new ShaderMaterial({
      vertexShader: moteVertexShader,
      fragmentShader: glowFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color(0xffd08a) },
        uOpacity: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    worldTheme.bindings.motes = this.moteMaterial;
    const motes = new InstancedMesh(new PlaneGeometry(1, 1), this.moteMaterial, MOTE_COUNT);
    motes.name = 'Ambient Light Motes';
    motes.frustumCulled = false;

    const phases = new Float32Array(MOTE_COUNT);
    const matrix = new Matrix4();
    for (let i = 0; i < MOTE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.7 + Math.pow(Math.random(), 0.7) * 5;
      matrix.makeTranslation(
        Math.sin(angle) * radius,
        0.25 + Math.random() * 3,
        Math.cos(angle) * radius,
      );
      motes.setMatrixAt(i, matrix);
      phases[i] = Math.random();
    }
    motes.geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));
    motes.instanceMatrix.needsUpdate = true;

    const holder = new Object3D();
    holder.add(motes);
    this.world.createTransformEntity(holder, { persistent: true });
  }
}
