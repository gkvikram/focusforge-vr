import {
  AdditiveBlending,
  Color,
  createSystem,
  Group,
  Mesh,
  MeshStandardMaterial,
  RayInteractable,
  ShaderMaterial,
  TorusGeometry,
  UIKitMLAsset,
} from '@iwsdk/core';
import { soundEngine } from '../audio/SoundEngine.js';
import { DOING, DONE, focusStore } from './focus-store.js';
import {
  PEDESTAL_ANGLE,
  PEDESTAL_RADIUS,
  PEDESTAL_TOP_Y,
  polarX,
  polarZ,
  RING_RADIUS,
  RING_Y,
} from './layout.js';

const FOCUS_SECONDS = 25 * 60;
const DEMO_SECONDS = 10;

const ringVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ringFragmentShader = /* glsl */ `
uniform float uProgress;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  if (vUv.x > uProgress) discard;
  float head = smoothstep(uProgress - 0.05, uProgress, vUv.x);
  gl_FragColor = vec4(uColor * uIntensity * (1.0 + head * 0.9), uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface TextElement {
  setProperties(props: { text: string }): void;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

export class PomodoroSystem extends createSystem({}) {
  private duration = FOCUS_SECONDS;
  private remaining = FOCUS_SECONDS;
  private running = false;
  private shownSecond = -1;
  private flash = 0;
  private elapsed = 0;

  private ringMaterial!: ShaderMaterial;
  private glowMaterial!: ShaderMaterial;
  private timeText: TextElement | null = null;
  private statusText: TextElement | null = null;
  private startLabel: TextElement | null = null;

  init(): void {
    this.createRing();
    void this.createPanel();

    this.cleanupFuncs.push(
      focusStore.subscribe((event) => {
        if (event == null) {
          this.resetTimer(FOCUS_SECONDS);
          this.setStatus('Board reset - pick a task');
          return;
        }
        if (event.to === DOING) {
          if (!this.running) {
            if (this.remaining <= 0) this.remaining = this.duration;
            this.running = true;
          }
          this.setStatus(`Focusing: ${event.task.title}`);
        } else if (event.from === DOING && event.to === DONE) {
          const next = focusStore.activeTask();
          if (next == null) {
            this.resetTimer(FOCUS_SECONDS);
            this.setStatus(`Done: ${event.task.title}`);
          } else {
            this.setStatus(`Focusing: ${next.title}`);
          }
        }
        this.syncLabels();
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.running) {
      this.remaining -= delta;
      if (this.remaining <= 0) {
        this.complete();
      }
    }

    const second = Math.ceil(this.remaining);
    if (second !== this.shownSecond) {
      this.shownSecond = second;
      this.timeText?.setProperties({ text: formatTime(this.remaining) });
    }

    this.flash = Math.max(0, this.flash - delta * 0.8);
    const progress = this.duration > 0 ? Math.max(0, this.remaining / this.duration) : 0;
    const breathe = this.running ? 0.15 * Math.sin(this.elapsed * 2.4) : 0;
    const intensity = (this.running ? 1.25 : 0.75) + breathe + this.flash * 2;

    this.ringMaterial.uniforms.uProgress.value = this.flash > 0 ? 1 : progress;
    this.ringMaterial.uniforms.uIntensity.value = intensity;
    this.glowMaterial.uniforms.uProgress.value = this.flash > 0 ? 1 : progress;
    this.glowMaterial.uniforms.uIntensity.value = intensity * 0.6;
  }

  private toggle(): void {
    if (this.running) {
      this.running = false;
      this.setStatus('Paused');
    } else {
      if (this.remaining <= 0) this.remaining = this.duration;
      this.running = true;
      const active = focusStore.activeTask();
      this.setStatus(active ? `Focusing: ${active.title}` : 'Focus session');
    }
    this.syncLabels();
  }

  private startDemo(): void {
    this.duration = DEMO_SECONDS;
    this.remaining = DEMO_SECONDS;
    this.running = true;
    const active = focusStore.activeTask();
    this.setStatus(active ? `Demo: ${active.title}` : 'Demo - start a task');
    this.syncLabels();
  }

  private complete(): void {
    const finished = focusStore.activeTask();
    this.resetTimer(FOCUS_SECONDS);
    this.flash = 1;
    soundEngine.timerBell();
    if (finished) {
      focusStore.advance(finished.id);
    }
    this.setStatus(finished ? `Completed: ${finished.title}` : 'Session complete');
    this.syncLabels();
  }

  private resetTimer(nextDuration: number): void {
    this.running = false;
    this.duration = nextDuration;
    this.remaining = nextDuration;
  }

  private setStatus(text: string): void {
    this.statusText?.setProperties({ text });
  }

  private syncLabels(): void {
    this.startLabel?.setProperties({ text: this.running ? 'Pause' : 'Start' });
  }

  private createRing(): void {
    const group = new Group();
    group.name = 'Pomodoro Ring';
    const x = polarX(PEDESTAL_ANGLE, PEDESTAL_RADIUS);
    const z = polarZ(PEDESTAL_ANGLE, PEDESTAL_RADIUS);
    group.position.set(x, RING_Y, z);
    group.lookAt(0, RING_Y, 0);

    const track = new Mesh(
      new TorusGeometry(RING_RADIUS, 0.009, 12, 96),
      new MeshStandardMaterial({ color: 0x5a4334, roughness: 0.5, metalness: 0.4 }),
    );
    group.add(track);

    const makeMaterial = (opacity: number, additive: boolean) =>
      new ShaderMaterial({
        vertexShader: ringVertexShader,
        fragmentShader: ringFragmentShader,
        uniforms: {
          uProgress: { value: 1 },
          uColor: { value: new Color(0xf2b866) },
          uIntensity: { value: 1 },
          uOpacity: { value: opacity },
        },
        transparent: additive,
        depthWrite: !additive,
        blending: additive ? AdditiveBlending : undefined,
      });

    this.ringMaterial = makeMaterial(1, false);
    this.glowMaterial = makeMaterial(0.35, true);

    // Start at 12 o'clock and deplete clockwise.
    for (const [material, tube] of [
      [this.ringMaterial, 0.012],
      [this.glowMaterial, 0.03],
    ] as const) {
      const ring = new Mesh(new TorusGeometry(RING_RADIUS, tube, 16, 128), material);
      ring.rotation.z = Math.PI / 2;
      ring.scale.x = -1;
      group.add(ring);
    }

    this.world.createTransformEntity(group, { persistent: true });
  }

  private async createPanel(): Promise<void> {
    const panel = await this.world.assets.instantiate<UIKitMLAsset>('pomodoro-panel');
    const radius = PEDESTAL_RADIUS - 0.04;
    const y = PEDESTAL_TOP_Y + 0.115;
    panel.position.set(polarX(PEDESTAL_ANGLE, radius), y, polarZ(PEDESTAL_ANGLE, radius));
    panel.lookAt(0, y, 0);
    panel.rotateX(-0.3);
    panel.scale.setScalar(0.1);
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable);

    this.timeText = panel.getElementById('time') as TextElement | null;
    this.statusText = panel.getElementById('status') as TextElement | null;
    this.startLabel = panel.getElementById('start-label') as TextElement | null;

    const startButton = panel.getElementById('start-button');
    const demoButton = panel.getElementById('demo-button');
    const resetButton = panel.getElementById('reset-button');
    const onStart = () => this.toggle();
    const onDemo = () => this.startDemo();
    const onReset = () => focusStore.reset();
    startButton?.addEventListener('click', onStart);
    demoButton?.addEventListener('click', onDemo);
    resetButton?.addEventListener('click', onReset);
    this.cleanupFuncs.push(
      () => startButton?.removeEventListener('click', onStart),
      () => demoButton?.removeEventListener('click', onDemo),
      () => resetButton?.removeEventListener('click', onReset),
    );

    this.shownSecond = -1;
    this.syncLabels();
  }
}
