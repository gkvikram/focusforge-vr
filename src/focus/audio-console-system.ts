import {
  BoxGeometry,
  CanvasTexture,
  createSystem,
  CylinderGeometry,
  Entity,
  Group,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  VisibilityState,
} from '@iwsdk/core';
import { AMBIENT_CHANNELS, soundEngine } from '../audio/SoundEngine.js';
import { pointerGesture } from '../mobile/MobileControls.js';
import { createGlow, Glow, setGlow } from './effects.js';
import { focusStore } from './focus-store.js';
import { pulseHaptics } from './haptics.js';
import {
  CONSOLE_ANGLE,
  CONSOLE_ROW_Y,
  CONSOLE_SLOT_STEP,
  CONSOLE_SWITCH_INWARD,
  consolePoint,
} from './layout.js';
import { ConsoleControl, ExitXRButton } from './reward-components.js';

const MUTE_INDEX = AMBIENT_CHANNELS.length;
const QUICK_TAP_MS = 350;
const TOGGLE_COOLDOWN_MS = 220;

const CONTROLS = [
  { label: 'RAIN', color: 0x7fc4ee },
  { label: 'LO-FI', color: 0xf2b866 },
  { label: 'SYNTHWAVE', color: 0xff6ec7 },
  { label: 'MUTE', color: 0xe86a5a },
] as const;

const housingMaterial = new MeshStandardMaterial({ color: 0x3a2b24, roughness: 0.6 });
const slotMaterial = new MeshStandardMaterial({ color: 0x1b1310, roughness: 0.9 });
const brassMaterial = new MeshStandardMaterial({ color: 0xc9935a, roughness: 0.3, metalness: 0.7 });

interface ControlView {
  entity: Entity;
  index: number;
  pivot: Group | null;
  cap: Mesh | null;
  capMaterial: MeshStandardMaterial | null;
  ledMaterial: MeshStandardMaterial;
  glow: Glow;
  lever: number;
  led: number;
  kick: number;
  pressStartedAt: number;
  lastToggleAt: number;
}

interface ExitView {
  entity: Entity;
  housing: Mesh;
  material: MeshStandardMaterial;
  kick: number;
  pressStartedAt: number;
  lastActivatedAt: number;
}

function createLabel(text: string): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context != null) {
    let size = 40;
    context.font = `700 ${size}px "DM Sans", system-ui, sans-serif`;
    while (context.measureText(text).width > 236 && size > 18) {
      size -= 2;
      context.font = `700 ${size}px "DM Sans", system-ui, sans-serif`;
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f4e6d0';
    context.fillText(text, 128, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(0.092, 0.023),
    new MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }),
  );
  mesh.raycast = () => undefined;
  return mesh;
}

export class AudioConsoleSystem extends createSystem({
  controls: { required: [ConsoleControl] },
  pressedControls: { required: [ConsoleControl, Pressed] },
  pressedExit: { required: [ExitXRButton, Pressed] },
}) {
  private views = new Map<Entity, ControlView>();
  private viewList: ControlView[] = [];
  private exitView: ExitView | null = null;
  private elapsed = 0;

  init(): void {
    soundEngine.installUnlock();
    CONTROLS.forEach((_, index) => this.createControl(index));
    this.createExitButton();

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive) {
          soundEngine.attachXRSession(this.world.renderer.xr.getSession());
        }
      }),
      focusStore.subscribe((event) => {
        if (event != null && event.kind !== 'blocked') soundEngine.cardMove();
      }),
      this.queries.pressedControls.subscribe('qualify', (entity) => {
        const view = this.views.get(entity);
        if (view) view.pressStartedAt = performance.now();
      }),
      this.queries.pressedControls.subscribe('disqualify', (entity) => {
        const view = this.views.get(entity);
        if (view == null || pointerGesture.dragged) return;
        const quickTap = performance.now() - view.pressStartedAt < QUICK_TAP_MS;
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        this.activate(view);
      }),
      this.queries.pressedExit.subscribe('qualify', () => {
        if (this.exitView) this.exitView.pressStartedAt = performance.now();
      }),
      this.queries.pressedExit.subscribe('disqualify', (entity) => {
        const view = this.exitView;
        if (view == null) return;
        const quickTap = performance.now() - view.pressStartedAt < QUICK_TAP_MS;
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        this.exitSession(view);
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    const blend = 1 - Math.exp(-delta * 14);

    const exit = this.exitView;
    if (exit != null) {
      exit.housing.visible = this.world.renderer.xr.isPresenting;
      exit.kick = Math.max(0, exit.kick - delta * 5);
      exit.material.emissiveIntensity = 0.25 + exit.kick * 1.8;
    }
    for (const view of this.viewList) {
      const on = view.index === MUTE_INDEX ? soundEngine.muted : soundEngine.isChannelOn(AMBIENT_CHANNELS[view.index]);
      view.led += ((on ? 1 : 0) - view.led) * blend;
      view.kick = Math.max(0, view.kick - delta * 6);
      const shimmer = on ? 0.85 + 0.15 * Math.sin(this.elapsed * 3 + view.index) : 1;
      view.ledMaterial.emissiveIntensity = view.led * 2.2 * shimmer;
      setGlow(view.glow, 0.075, view.led * 0.85 * shimmer);

      if (view.pivot != null) {
        const target = on ? -0.55 : 0.55;
        view.lever += (target - view.lever) * blend;
        view.pivot.rotation.x = view.lever;
      }
      if (view.cap != null && view.capMaterial != null) {
        view.cap.position.z = 0.02 - view.kick * 0.008;
        view.capMaterial.emissiveIntensity = 0.15 + view.led * 1.6;
      }
    }
  }

  private activate(view: ControlView): void {
    const now = performance.now();
    if (now - view.lastToggleAt < TOGGLE_COOLDOWN_MS) return;
    view.lastToggleAt = now;
    view.kick = 1;
    if (view.index === MUTE_INDEX) {
      soundEngine.toggleMuted();
    } else {
      soundEngine.toggleChannel(AMBIENT_CHANNELS[view.index]);
    }
    pulseHaptics(this.world, null, 0.25, 18);
  }

  private exitSession(view: ExitView): void {
    const xr = this.world.renderer.xr;
    if (!xr.isPresenting) return;
    const now = performance.now();
    if (now - view.lastActivatedAt < TOGGLE_COOLDOWN_MS) return;
    view.lastActivatedAt = now;
    view.kick = 1;
    pulseHaptics(this.world, null, 0.3, 20);
    void xr.getSession()?.end();
  }

  private createExitButton(): void {
    const material = new MeshStandardMaterial({
      color: 0x7a2f26,
      emissive: 0xe86a5a,
      emissiveIntensity: 0.25,
      roughness: 0.4,
    });
    const housing = new Mesh(new BoxGeometry(0.16, 0.046, 0.03), material);
    housing.name = 'Exit XR Button';

    // Sits directly under MUTE, hanging off the lower edge of the console slab.
    const offset = 1.5 * CONSOLE_SLOT_STEP;
    const [baseX, baseZ] = consolePoint(CONSOLE_SWITCH_INWARD);
    housing.position.set(
      baseX + Math.cos(CONSOLE_ANGLE) * offset,
      CONSOLE_ROW_Y - 0.141,
      baseZ + Math.sin(CONSOLE_ANGLE) * offset,
    );
    housing.rotation.y = -CONSOLE_ANGLE;

    const trim = new Mesh(new BoxGeometry(0.168, 0.006, 0.032), brassMaterial);
    trim.position.y = 0.026;
    trim.raycast = () => undefined;
    housing.add(trim);

    const label = createLabel('EXIT XR');
    label.scale.setScalar(1.45);
    label.position.set(0, 0, 0.0155);
    housing.add(label);

    housing.visible = false;

    const entity = this.world.createTransformEntity(housing, { persistent: true });
    entity.addComponent(ExitXRButton);
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);

    this.exitView = { entity, housing, material, kick: 0, pressStartedAt: 0, lastActivatedAt: 0 };
  }

  private createControl(index: number): void {
    const definition = CONTROLS[index];
    const offset = (index - 1.5) * CONSOLE_SLOT_STEP;
    const tangentX = Math.cos(CONSOLE_ANGLE) * offset;
    const tangentZ = Math.sin(CONSOLE_ANGLE) * offset;

    const housing = new Mesh(new BoxGeometry(0.1, 0.15, 0.03), housingMaterial);
    housing.name = `Audio Control: ${definition.label}`;
    const [baseX, baseZ] = consolePoint(CONSOLE_SWITCH_INWARD);
    housing.position.set(baseX + tangentX, CONSOLE_ROW_Y, baseZ + tangentZ);
    housing.rotation.y = -CONSOLE_ANGLE;

    const label = createLabel(definition.label);
    label.position.set(0, 0.056, 0.0155);
    housing.add(label);

    const ledMaterial = new MeshStandardMaterial({
      color: 0x241a16,
      emissive: definition.color,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    const led = new Mesh(new SphereGeometry(0.008, 16, 12), ledMaterial);
    led.position.set(0, 0.034, 0.016);
    led.raycast = () => undefined;
    housing.add(led);

    const glow = createGlow(definition.color, 0.075, 0);
    glow.mesh.position.copy(led.position);
    housing.add(glow.mesh);

    let pivot: Group | null = null;
    let cap: Mesh | null = null;
    let capMaterial: MeshStandardMaterial | null = null;

    if (index < MUTE_INDEX) {
      const slot = new Mesh(new BoxGeometry(0.03, 0.07, 0.004), slotMaterial);
      slot.position.set(0, -0.02, 0.0155);
      slot.raycast = () => undefined;
      housing.add(slot);

      pivot = new Group();
      pivot.position.set(0, -0.02, 0.018);
      const stem = new Mesh(
        new CylinderGeometry(0.006, 0.008, 0.05, 12).rotateX(Math.PI / 2).translate(0, 0, 0.025),
        brassMaterial,
      );
      const knob = new Mesh(new SphereGeometry(0.013, 16, 12), brassMaterial);
      knob.position.z = 0.054;
      stem.raycast = () => undefined;
      knob.raycast = () => undefined;
      pivot.add(stem, knob);
      pivot.rotation.x = 0.55;
      housing.add(pivot);
    } else {
      const ring = new Mesh(new TorusGeometry(0.036, 0.004, 10, 40), brassMaterial);
      ring.position.set(0, -0.015, 0.017);
      ring.raycast = () => undefined;
      housing.add(ring);

      capMaterial = new MeshStandardMaterial({
        color: 0x5a2b24,
        emissive: definition.color,
        emissiveIntensity: 0.15,
        roughness: 0.35,
      });
      cap = new Mesh(new CylinderGeometry(0.03, 0.03, 0.014, 28).rotateX(Math.PI / 2), capMaterial);
      cap.position.set(0, -0.015, 0.02);
      cap.raycast = () => undefined;
      housing.add(cap);
    }

    const entity = this.world.createTransformEntity(housing, { persistent: true });
    entity.addComponent(ConsoleControl, { control: index });
    entity.addComponent(RayInteractable);

    const view: ControlView = {
      entity,
      index,
      pivot,
      cap,
      capMaterial,
      ledMaterial,
      glow,
      lever: 0.55,
      led: 0,
      kick: 0,
      pressStartedAt: 0,
      lastToggleAt: 0,
    };
    this.views.set(entity, view);
    this.viewList.push(view);
  }
}
