import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  createSystem,
  DistanceGrabbable,
  Entity,
  Grabbed,
  GrabSystem,
  Group,
  Hovered,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PhysicsSystem,
  PlaneGeometry,
  Pressed,
  Quaternion,
  RayInteractable,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { soundEngine } from '../audio/SoundEngine.js';
import { MobileControlsSystem, pointerGesture } from '../mobile/MobileControls.js';
import {
  BEAM_TRAVEL,
  BeamPool,
  createGlow,
  FlashPool,
  FragmentBurst,
  Glow,
  ParticleTrail,
  setGlow,
} from './effects.js';
import { DONE, focusStore } from './focus-store.js';
import { Hand, pulseHaptics } from './haptics.js';
import { worldTheme } from '../world/world-theme.js';
import {
  CORE_POSITION,
  CORE_READOUT_SIZE,
  CORE_READOUT_Y,
  CORE_RING_RADIUS,
  TARGET_HEIGHTS,
  TARGET_ORBIT_RADII,
  TARGET_SIZE,
  TARGET_SPEEDS,
} from './layout.js';
import { EnergyOrb, StressTarget } from './reward-components.js';
import { TaskCard } from './task-card-component.js';

const ORB_RADIUS = 0.07;
const HOVER_DISTANCE = 0.58;
const MORPH_SECONDS = 0.55;
const MIN_LAUNCH_AGE = 0.2;
const TAP_SPEED = 9;
const HIT_RADIUS = 0.3;
const MAX_FLIGHT_SECONDS = 5;
const RELEASE_SETTLE_FRAMES = 3;
const SAMPLE_COUNT = 6;
const RESPAWN_SECONDS = 3.2;
const CHARGE_STEP = 0.25;
const OVERCHARGE_SECONDS = 8;
const QUICK_TAP_MS = 350;
const RECENT_MOVE_MS = 900;

const TARGET_COLORS = [0xffb86b, 0xff7fa5, 0x6fe0cf, 0xb396ff, 0x7cc7ff];
const CORE_COLOR = 0xffa94d;
const noRaycast = () => undefined;

type OrbPhase = 'morphing' | 'floating' | 'held' | 'releasing' | 'flying';

interface OrbState {
  entity: Entity;
  object: Mesh;
  material: MeshStandardMaterial;
  shell: Mesh;
  halo: Glow;
  phase: OrbPhase;
  age: number;
  morphT: number;
  flightTime: number;
  releaseFrames: number;
  from: Vector3;
  hover: Vector3;
  prev: Vector3;
  /** True once thrown or tapped at a target; the source card is cleared when the orb ends. */
  launched: boolean;
  /** Target the orb steers toward in flight so a tap always lands. */
  homing: TargetView | null;
  /** Target requested before the physics body was ready. */
  queued: TargetView | null;
  heading: Vector3;
  speed: number;
}

interface TargetView {
  entity: Entity;
  object: Mesh;
  material: MeshStandardMaterial;
  glow: Glow;
  index: number;
  color: number;
  orbitRadius: number;
  height: number;
  speed: number;
  angle: number;
  bobPhase: number;
  alive: boolean;
  respawnIn: number;
  appear: number;
  pressStartedAt: number;
}

const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ringFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float on = step(vUv.x, uProgress);
  float edge = smoothstep(uProgress - 0.03, uProgress, vUv.x) * on * step(0.001, uProgress);
  vec3 col = mix(vec3(0.2, 0.15, 0.12), uColor * uIntensity, on);
  col += edge * vec3(1.0, 0.9, 0.7) * 0.7;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class RewardSystem extends createSystem({
  cards: { required: [TaskCard] },
  pressedCards: { required: [TaskCard, Pressed] },
  grabbedCards: { required: [TaskCard, Grabbed] },
  targets: { required: [StressTarget] },
  pressedTargets: { required: [StressTarget, Pressed] },
  pressedOrbs: { required: [EnergyOrb, Pressed] },
  grabbedOrbs: { required: [EnergyOrb, Grabbed] },
}) {
  private elapsed = 0;
  private orb: OrbState | null = null;
  private targetViews: TargetView[] = [];
  private cardPressStart = new Map<Entity, number>();
  private recentMoves = new Map<number, number>();
  private hiddenCard: Entity | null = null;
  private restoring: Mesh | null = null;
  private lastHand: Hand | null = null;

  private fragments = new FragmentBurst();
  private flashes = new FlashPool();
  private beams = new BeamPool();
  private trail = new ParticleTrail();

  private core!: Group;
  private coreMesh!: Mesh;
  private coreMaterial!: MeshStandardMaterial;
  private coreHalo!: Glow;
  private gimbals: Mesh[] = [];
  private ringMaterial!: ShaderMaterial;
  private labelContext: CanvasRenderingContext2D | null = null;
  private labelTexture!: CanvasTexture;
  private labelKey = '';
  private charge = 0;
  private shownCharge = 0;
  private corePulse = 0;
  private celebrate = 0;
  private arrivals: number[] = [];

  private releaseSamplePos = new Float32Array(SAMPLE_COUNT * 3);
  private releaseSampleTime = new Float64Array(SAMPLE_COUNT);
  private sampleHead = 0;
  private sampleCount = 0;

  private camPos = new Vector3();
  private camQuat = new Quaternion();
  private camDir = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();
  private tmpDir = new Vector3();
  private tmpStep = new Vector3();
  private releaseVelocity = new Vector3();
  private launchVelocity = new Vector3();
  private corePosition = new Vector3(...CORE_POSITION);
  private identity = new Quaternion();
  private physics: PhysicsSystem | undefined;

  init(): void {
    this.physics = this.world.getSystem(PhysicsSystem);
    this.createEffects();
    this.createTargets();
    this.createCore();

    this.cleanupFuncs.push(
      focusStore.subscribe((event) => {
        if (event == null) {
          this.endOrb();
          return;
        }
        if (event.kind === 'blocked') return;
      this.recentMoves.set(event.task.id, performance.now());
      }),
      this.queries.pressedCards.subscribe('qualify', (entity) => {
        this.cardPressStart.set(entity, performance.now());
      }),
      this.queries.pressedCards.subscribe('disqualify', (entity) => {
        if (pointerGesture.dragged) return;
        const started = this.cardPressStart.get(entity) ?? 0;
        const quickTap = performance.now() - started < QUICK_TAP_MS;
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        this.activateCard(entity);
      }),
      this.queries.grabbedCards.subscribe('qualify', (entity) => {
        this.activateCard(entity);
      }),
      this.queries.pressedTargets.subscribe('qualify', (entity) => {
        const view = this.targetViews[entity.getValue(StressTarget, 'index') ?? 0];
        if (view) view.pressStartedAt = performance.now();
      }),
      this.queries.pressedTargets.subscribe('disqualify', (entity) => {
        const view = this.targetViews[entity.getValue(StressTarget, 'index') ?? 0];
        if (view == null || pointerGesture.dragged) return;
        const quickTap = performance.now() - view.pressStartedAt < QUICK_TAP_MS;
        if (!entity.hasComponent(Hovered) && !quickTap) return;
        this.launchAtTarget(view);
      }),
      this.queries.pressedOrbs.subscribe('disqualify', (entity) => {
        const orb = this.orb;
        if (orb == null || orb.entity !== entity || pointerGesture.dragged) return;
        if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) return;
        this.world.camera.getWorldDirection(this.camDir);
        const target = this.pickTarget(orb.object.position, this.camDir, 90);
        if (target) this.launchAtTarget(target);
      }),
      this.queries.grabbedOrbs.subscribe('qualify', (entity) => {
        const orb = this.orb;
        if (orb == null || orb.entity !== entity) return;
        orb.phase = 'held';
        this.sampleCount = 0;
        this.sampleHead = 0;
        entity.setValue(PhysicsBody, 'gravityFactor', 0);
        entity.setValue(PhysicsBody, 'linearDamping', 4);
        this.lastHand = this.world.getSystem(GrabSystem)?.getHolderHand(entity) ?? this.lastHand;
        pulseHaptics(this.world, this.lastHand, 0.35, 30);
      }),
      this.queries.grabbedOrbs.subscribe('disqualify', (entity) => {
        const orb = this.orb;
        if (orb == null || orb.entity !== entity || orb.phase !== 'held') return;
        this.estimateReleaseVelocity(this.releaseVelocity);
        orb.phase = 'releasing';
        orb.releaseFrames = RELEASE_SETTLE_FRAMES;
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.updateTargets(delta);
    this.updateCore(delta);
    this.updateRestore(delta);
    this.updateArrivals(delta);

    const orb = this.orb;
    if (orb != null) {
      this.updateOrb(orb, delta);
    }
    const trailRate = orb == null ? 0 : orb.phase === 'flying' ? 110 : 26;
    this.trail.update(delta, this.orb == null ? null : this.orb.object.position, trailRate);
    this.fragments.update(delta);
    this.flashes.update(delta);
    this.beams.update(delta);
  }

  private get mobileActive(): boolean {
    return this.world.getSystem(MobileControlsSystem)?.isActive ?? false;
  }

  // ---------------------------------------------------------------- cards ---

  private activateCard(entity: Entity): void {
    if (this.orb != null || this.hiddenCard != null) return;
    const taskId = entity.getValue(TaskCard, 'taskId');
    if (taskId == null) return;
    const task = focusStore.tasks[taskId];
    if (task == null || task.removed || task.column !== DONE) return;
    const movedAt = this.recentMoves.get(taskId) ?? 0;
    if (performance.now() - movedAt < RECENT_MOVE_MS) return;
    this.spawnOrb(entity);
  }

  private hideCard(entity: Entity): void {
    const object = entity.object3D as Mesh | null;
    if (object == null) return;
    object.visible = false;
    object.raycast = noRaycast;
    this.hiddenCard = entity;
    this.world.getSystem(GrabSystem)?.forceRelease(entity);
  }

  private restoreCard(): void {
    const entity = this.hiddenCard;
    this.hiddenCard = null;
    const object = entity?.object3D as Mesh | null | undefined;
    if (object == null) return;
    object.visible = true;
    object.raycast = Mesh.prototype.raycast;
    object.scale.setScalar(0.2);
    this.restoring = object;
  }

  private updateRestore(delta: number): void {
    const object = this.restoring;
    if (object == null) return;
    const next = MathUtils.lerp(object.scale.x, 1, 1 - Math.exp(-delta * 9));
    if (next > 0.995) {
      object.scale.setScalar(1);
      this.restoring = null;
    } else {
      object.scale.setScalar(next);
    }
  }

  // ------------------------------------------------------------------ orb ---

  private spawnOrb(cardEntity: Entity): void {
    const cardObject = cardEntity.object3D;
    if (cardObject == null) return;
    const from = cardObject.getWorldPosition(new Vector3());
    this.hideCard(cardEntity);

    const material = new MeshStandardMaterial({
      color: 0xfff0d0,
      emissive: CORE_COLOR,
      emissiveIntensity: 1.8,
      flatShading: true,
      roughness: 0.25,
      metalness: 0.1,
    });
    const object = new Mesh(new IcosahedronGeometry(ORB_RADIUS, 1), material);
    object.name = 'Energy Orb';
    object.position.copy(from);

    const shell = new Mesh(
      new IcosahedronGeometry(ORB_RADIUS * 1.55, 1),
      new MeshBasicMaterial({
        color: 0xffd08a,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    shell.raycast = noRaycast;
    object.add(shell);
    const halo = createGlow(CORE_COLOR, 0.42, 0.9);
    object.add(halo.mesh);

    const entity = this.world.createTransformEntity(object, { persistent: true });
    entity.addComponent(EnergyOrb);
    entity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.Sphere,
      dimensions: [ORB_RADIUS * 1.2, 0, 0],
      density: 0.5,
      restitution: 0,
      friction: 0.5,
    });
    entity.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      gravityFactor: 0,
      linearDamping: 4,
      angularDamping: 2,
    });
    entity.addComponent(RayInteractable);
    entity.addComponent(DistanceGrabbable);

    this.orb = {
      entity,
      object,
      material,
      shell,
      halo,
      phase: 'morphing',
      age: 0,
      morphT: 0,
      flightTime: 0,
      releaseFrames: 0,
      from,
      hover: new Vector3(),
      prev: from.clone(),
      launched: false,
      homing: null,
      queued: null,
      heading: new Vector3(),
      speed: TAP_SPEED,
    };
    this.sampleCount = 0;
    this.sampleHead = 0;
    this.flashes.fire(from, CORE_COLOR, 0.5, 0.5);
    soundEngine.orbSpawn();
    pulseHaptics(this.world, this.lastHand, 0.3, 40);
  }

  private endOrb(): void {
    const orb = this.orb;
    this.orb = null;
    const launched = orb?.launched ?? false;
    if (orb != null) orb.entity.dispose();
    if (launched) {
      this.clearHiddenCard();
    } else {
      this.restoreCard();
    }
  }

  /** The thrown orb consumed its card: remove the task from the board for good. */
  private clearHiddenCard(): void {
    const entity = this.hiddenCard;
    this.hiddenCard = null;
    this.restoring = null;
    const taskId = entity?.getValue(TaskCard, 'taskId');
    if (taskId != null && taskId >= 0) focusStore.removeTask(taskId);
  }

  private computeHover(out: Vector3, followCamera: boolean): void {
    const camera = this.world.camera;
    camera.getWorldPosition(this.camPos);
    if (followCamera) {
      camera.getWorldQuaternion(this.camQuat);
      out.set(0, -0.17, -HOVER_DISTANCE).applyQuaternion(this.camQuat).add(this.camPos);
      return;
    }
    camera.getWorldDirection(this.tmpDir);
    this.tmpDir.y = 0;
    if (this.tmpDir.lengthSq() < 1e-4) this.tmpDir.set(0, 0, -1);
    this.tmpDir.normalize();
    out.copy(this.camPos).addScaledVector(this.tmpDir, 0.55);
    out.y = this.camPos.y - 0.18;
  }

  private bodyReady(orb: OrbState): boolean {
    return orb.entity.getValue(PhysicsBody, '_engineBody') !== 0;
  }

  private moveOrb(orb: OrbState, position: Vector3): void {
    if (this.physics != null && this.bodyReady(orb)) {
      this.physics.setBodyTransform(orb.entity, { position, quaternion: this.identity });
    } else {
      orb.object.position.copy(position);
    }
  }

  private updateOrb(orb: OrbState, delta: number): void {
    orb.age += delta;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 6);
    orb.material.emissiveIntensity = 1.2 + pulse * 1.5;
    setGlow(orb.halo, 0.36 + pulse * 0.14, 0.7 + pulse * 0.3);
    orb.shell.rotation.y += delta * 1.6;
    orb.shell.rotation.x += delta * 0.9;
    orb.shell.scale.setScalar(1 + pulse * 0.12);

    switch (orb.phase) {
      case 'morphing': {
        orb.morphT = Math.min(1, orb.morphT + delta / MORPH_SECONDS);
        const eased = orb.morphT * orb.morphT * (3 - 2 * orb.morphT);
        this.computeHover(orb.hover, this.mobileActive);
        this.tmpA.lerpVectors(orb.from, orb.hover, eased);
        this.moveOrb(orb, this.tmpA);
        if (orb.morphT >= 1) orb.phase = 'floating';
        break;
      }
      case 'floating': {
        if (this.mobileActive) {
          this.computeHover(orb.hover, true);
          this.tmpA.copy(orb.object.position).lerp(orb.hover, 1 - Math.exp(-delta * 10));
          this.moveOrb(orb, this.tmpA);
        }
        break;
      }
      case 'held': {
        this.recordSample(orb.object.position);
        break;
      }
      case 'releasing': {
        orb.releaseFrames--;
        if (orb.releaseFrames <= 0) this.performThrow(orb);
        break;
      }
      case 'flying': {
        this.updateFlight(orb, delta);
        break;
      }
    }

    const queued = orb.queued;
    if (queued != null && (orb.phase === 'floating' || orb.phase === 'morphing')) {
      orb.queued = null;
      this.launchAtTarget(queued);
    }
  }

  private recordSample(position: Vector3): void {
    const i = this.sampleHead;
    this.releaseSamplePos[i * 3] = position.x;
    this.releaseSamplePos[i * 3 + 1] = position.y;
    this.releaseSamplePos[i * 3 + 2] = position.z;
    this.releaseSampleTime[i] = performance.now();
    this.sampleHead = (i + 1) % SAMPLE_COUNT;
    this.sampleCount = Math.min(SAMPLE_COUNT, this.sampleCount + 1);
  }

  private estimateReleaseVelocity(out: Vector3): void {
    out.set(0, 0, 0);
    if (this.sampleCount < 2) return;
    const newest = (this.sampleHead + SAMPLE_COUNT - 1) % SAMPLE_COUNT;
    const oldest = this.sampleCount < SAMPLE_COUNT ? 0 : this.sampleHead;
    const seconds = (this.releaseSampleTime[newest] - this.releaseSampleTime[oldest]) / 1000;
    if (seconds < 0.016) return;
    out.set(
      this.releaseSamplePos[newest * 3] - this.releaseSamplePos[oldest * 3],
      this.releaseSamplePos[newest * 3 + 1] - this.releaseSamplePos[oldest * 3 + 1],
      this.releaseSamplePos[newest * 3 + 2] - this.releaseSamplePos[oldest * 3 + 2],
    ).divideScalar(seconds);
  }

  /** Releasing in VR: throw along the hand's motion, bending toward a target in the cone. */
  private performThrow(orb: OrbState): void {
    const speed = this.releaseVelocity.length();
    const origin = orb.object.position;
    let target: TargetView | null;
    if (speed > 1) {
      this.tmpDir.copy(this.releaseVelocity).normalize();
      target = this.pickTarget(origin, this.tmpDir, 28);
    } else {
      this.world.camera.getWorldDirection(this.camDir);
      target = this.pickTarget(origin, this.camDir, 70);
    }

    if (target != null) {
      const launchSpeed = MathUtils.clamp(speed * 1.6, 7, 11);
      this.aimAt(target, origin, launchSpeed, this.launchVelocity);
      this.launch(orb, this.launchVelocity, 0, target);
    } else if (speed > 1) {
      const launchSpeed = MathUtils.clamp(speed * 1.6, 5, 11);
      this.launchVelocity.copy(this.tmpDir).multiplyScalar(launchSpeed);
      this.launch(orb, this.launchVelocity, 0.3);
    } else {
      orb.from.copy(origin);
      orb.morphT = 0;
      orb.phase = 'morphing';
    }
  }

  private launchAtTarget(target: TargetView): void {
    const orb = this.orb;
    if (orb == null || !target.alive) return;
    if (orb.phase !== 'floating' && orb.phase !== 'morphing') return;
    if (orb.age < MIN_LAUNCH_AGE || !this.bodyReady(orb)) {
      // Remember the tap instead of dropping it; updateOrb fires it once the body is ready.
      orb.queued = target;
      return;
    }
    this.aimAt(target, orb.object.position, TAP_SPEED, this.launchVelocity);
    this.launch(orb, this.launchVelocity, 0, target);
  }

  private launch(orb: OrbState, velocity: Vector3, gravity: number, homing: TargetView | null = null): void {
    orb.entity.setValue(PhysicsBody, 'gravityFactor', gravity);
    orb.entity.setValue(PhysicsBody, 'linearDamping', 0);
    orb.launched = true;
    orb.queued = null;
    orb.homing = homing;
    orb.speed = homing != null ? MathUtils.clamp(velocity.length(), 8, 12) : velocity.length();
    if (homing != null) {
      // Homing flights are driven by steerHoming each frame, so Havok starts at rest.
      orb.heading.copy(velocity).normalize();
      orb.entity.addComponent(PhysicsManipulation, { linearVelocity: [0, 0, 0] });
    } else {
      orb.entity.addComponent(PhysicsManipulation, {
        linearVelocity: [velocity.x, velocity.y, velocity.z],
      });
    }
    orb.phase = 'flying';
    orb.flightTime = 0;
    orb.prev.copy(orb.object.position);
    soundEngine.launch();
    pulseHaptics(this.world, this.lastHand, 0.5, 55);
  }

  private updateFlight(orb: OrbState, delta: number): void {
    orb.flightTime += delta;
    const position = orb.object.position;
    if (orb.homing != null && this.steerHoming(orb, delta)) return;
    for (const view of this.targetViews) {
      if (!view.alive || view.appear < 0.6) continue;
      if (this.segmentHitsSphere(orb.prev, position, view.object.position, HIT_RADIUS)) {
        this.hitTarget(view);
        return;
      }
    }
    orb.prev.copy(position);

    if (orb.flightTime > MAX_FLIGHT_SECONDS || position.lengthSq() > 196 || position.y < -3) {
      this.flashes.fire(position, CORE_COLOR, 0.35, 0.4);
      soundEngine.cardMove();
      this.endOrb();
    }
  }

  /**
   * Curve the orb toward its target's predicted position. The turn rate grows with
   * flight time, so the orb always converges on the crystal. Returns true on impact.
   */
  private steerHoming(orb: OrbState, delta: number): boolean {
    let target = orb.homing;
    if (target == null) return false;
    const position = orb.object.position;
    if (!target.alive) {
      target = this.pickTarget(position, orb.heading, 60);
      orb.homing = target;
      if (target == null) {
        this.launchVelocity.copy(orb.heading).multiplyScalar(orb.speed);
        orb.entity.addComponent(PhysicsManipulation, {
          linearVelocity: [this.launchVelocity.x, this.launchVelocity.y, this.launchVelocity.z],
        });
        return false;
      }
    }

    const distance = position.distanceTo(target.object.position);
    if (distance <= HIT_RADIUS) {
      this.hitTarget(target);
      return true;
    }

    this.targetPosition(target, distance / orb.speed, this.tmpC);
    this.tmpDir.subVectors(this.tmpC, position).normalize();
    const turn = 1 - Math.exp(-delta * (5 + orb.flightTime * 10));
    orb.heading.lerp(this.tmpDir, turn).normalize();

    this.tmpStep.copy(position).addScaledVector(orb.heading, orb.speed * delta);
    this.moveOrb(orb, this.tmpStep);
    position.copy(this.tmpStep);
    return false;
  }

  private segmentHitsSphere(a: Vector3, b: Vector3, center: Vector3, radius: number): boolean {
    this.tmpA.subVectors(b, a);
    const lengthSq = this.tmpA.lengthSq();
    let t = 0;
    if (lengthSq > 1e-8) {
      t = MathUtils.clamp(this.tmpB.subVectors(center, a).dot(this.tmpA) / lengthSq, 0, 1);
    }
    this.tmpB.copy(a).addScaledVector(this.tmpA, t);
    return this.tmpB.distanceToSquared(center) <= radius * radius;
  }

  // -------------------------------------------------------------- targets ---

  private createTargets(): void {
    for (let index = 0; index < TARGET_COLORS.length; index++) {
      const color = TARGET_COLORS[index];
      const geometry = new OctahedronGeometry(TARGET_SIZE, 0);
      geometry.scale(0.8, 1.4, 0.8);
      const material = new MeshStandardMaterial({
        color,
        flatShading: true,
        metalness: 0.25,
        roughness: 0.15,
        emissive: color,
        emissiveIntensity: 0.45,
      });
      const object = new Mesh(geometry, material);
      object.name = `Stress Target ${index + 1}`;
      const glow = createGlow(color, 0.95, 0.3);
      object.add(glow.mesh);

      const angle = (index - 2) * ((38 * Math.PI) / 180);
      const view: TargetView = {
        entity: null as unknown as Entity,
        object,
        material,
        glow,
        index,
        color,
        orbitRadius: TARGET_ORBIT_RADII[index],
        height: TARGET_HEIGHTS[index],
        speed: TARGET_SPEEDS[index],
        angle,
        bobPhase: index * 1.7,
        alive: true,
        respawnIn: 0,
        appear: 1,
        pressStartedAt: 0,
      };
      this.targetPosition(view, 0, object.position);

      view.entity = this.world.createTransformEntity(object, { persistent: true });
      view.entity.addComponent(StressTarget, { index });
      view.entity.addComponent(RayInteractable);
      this.targetViews.push(view);
    }
  }

  private targetPosition(view: TargetView, seconds: number, out: Vector3): Vector3 {
    const angle = view.angle + view.speed * seconds;
    const bob = Math.sin((this.elapsed + seconds) * 0.9 + view.bobPhase) * 0.08;
    return out.set(
      Math.sin(angle) * view.orbitRadius,
      view.height + bob,
      -Math.cos(angle) * view.orbitRadius,
    );
  }

  private updateTargets(delta: number): void {
    for (const view of this.targetViews) {
      view.angle += view.speed * delta;
      this.targetPosition(view, 0, view.object.position);
      if (!view.alive) {
        view.respawnIn -= delta;
        if (view.respawnIn <= 0) {
          view.alive = true;
          view.appear = 0;
          view.object.visible = true;
          this.flashes.fire(view.object.position, view.color, 0.6, 0.5);
        }
        continue;
      }
      view.appear = Math.min(1, view.appear + delta * 2);
      const eased = view.appear * view.appear * (3 - 2 * view.appear);
      view.object.scale.setScalar(Math.max(0.001, eased));
      view.object.rotation.y += delta * 0.9;
      view.object.rotation.z = Math.sin(this.elapsed * 0.7 + view.bobPhase) * 0.15;
      view.material.emissiveIntensity = 0.4 + 0.2 * Math.sin(this.elapsed * 2.2 + view.bobPhase);
    }
  }

  private pickTarget(origin: Vector3, direction: Vector3, maxDegrees: number): TargetView | null {
    let best: TargetView | null = null;
    let bestCos = Math.cos((maxDegrees * Math.PI) / 180);
    for (const view of this.targetViews) {
      if (!view.alive || view.appear < 0.6) continue;
      this.tmpC.subVectors(view.object.position, origin).normalize();
      const cos = this.tmpC.dot(direction);
      if (cos > bestCos) {
        bestCos = cos;
        best = view;
      }
    }
    return best;
  }

  /** Lead the target along its orbit so a straight Havok velocity intercepts it. */
  private aimAt(view: TargetView, from: Vector3, speed: number, out: Vector3): void {
    let time = from.distanceTo(view.object.position) / speed;
    for (let i = 0; i < 3; i++) {
      this.targetPosition(view, time, this.tmpC);
      time = from.distanceTo(this.tmpC) / speed;
    }
    this.targetPosition(view, time, this.tmpC);
    out.subVectors(this.tmpC, from).normalize().multiplyScalar(speed);
  }

  private hitTarget(view: TargetView): void {
    const position = this.tmpB.copy(view.object.position);
    view.alive = false;
    view.respawnIn = RESPAWN_SECONDS;
    view.object.visible = false;

    this.fragments.emit(position, view.color, 42, 2.6);
    this.fragments.emit(position, 0xffffff, 10, 1.6);
    this.flashes.fire(position, view.color, 0.9, 0.55);
    this.beams.fire(position, this.corePosition, view.color);
    this.arrivals.push(BEAM_TRAVEL);

    soundEngine.shatter(view.index);
    soundEngine.beam();
    pulseHaptics(this.world, this.lastHand, 0.7, 90);
    this.endOrb();
  }

  // ----------------------------------------------------------------- core ---

  private createEffects(): void {
    for (const object of [
      this.fragments.mesh,
      this.flashes.group,
      this.beams.group,
      this.trail.mesh,
    ]) {
      this.world.createTransformEntity(object, { persistent: true });
    }
  }

  private createCore(): void {
    this.core = new Group();
    this.core.name = 'Central Energy Core';
    this.core.position.copy(this.corePosition);

    this.coreMaterial = new MeshStandardMaterial({
      color: 0xfff0d6,
      emissive: CORE_COLOR,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    this.coreMesh = new Mesh(new IcosahedronGeometry(0.15, 2), this.coreMaterial);
    this.coreMesh.raycast = noRaycast;
    this.core.add(this.coreMesh);

    this.coreHalo = createGlow(CORE_COLOR, 0.95, 0.5);
    this.core.add(this.coreHalo.mesh);

    const gimbalMaterial = new MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.6,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 2; i++) {
      const gimbal = new Mesh(new TorusGeometry(0.24 + i * 0.03, 0.004, 8, 64), gimbalMaterial);
      gimbal.rotation.x = i === 0 ? Math.PI / 2.4 : -Math.PI / 3;
      gimbal.raycast = noRaycast;
      this.gimbals.push(gimbal);
      this.core.add(gimbal);
    }

    this.ringMaterial = new ShaderMaterial({
      vertexShader: ringVertex,
      fragmentShader: ringFragment,
      uniforms: {
        uColor: { value: new Color(CORE_COLOR) },
        uProgress: { value: 0 },
        uIntensity: { value: 1.6 },
      },
    });
    const ring = new Mesh(new TorusGeometry(CORE_RING_RADIUS, 0.014, 12, 128), this.ringMaterial);
    ring.rotation.z = -Math.PI / 2;
    ring.scale.x = -1;
    ring.raycast = noRaycast;
    this.core.add(ring);

    const notchMaterial = new MeshStandardMaterial({ color: 0xffe2b8, emissive: 0xffb15c, emissiveIntensity: 0.8 });
    for (let i = 0; i < 4; i++) {
      const theta = (i + 1) * (Math.PI / 2);
      const notch = new Mesh(new BoxGeometry(0.014, 0.05, 0.014), notchMaterial);
      notch.position.set(Math.sin(theta) * CORE_RING_RADIUS, Math.cos(theta) * CORE_RING_RADIUS, 0);
      notch.rotation.z = -theta;
      notch.raycast = noRaycast;
      this.core.add(notch);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    this.labelContext = canvas.getContext('2d');
    this.labelTexture = new CanvasTexture(canvas);
    this.labelTexture.colorSpace = SRGBColorSpace;
    const label = new Mesh(
      new PlaneGeometry(CORE_READOUT_SIZE, CORE_READOUT_SIZE),
      new MeshBasicMaterial({
        map: this.labelTexture,
        transparent: true,
        toneMapped: false,
        depthWrite: false,
        // Always drawn over the core's glow so the readout never washes out.
        depthTest: false,
      }),
    );
    label.position.set(0, CORE_READOUT_Y, 0.2);
    label.renderOrder = 20;
    label.raycast = noRaycast;
    this.core.add(label);
    this.drawLabel();

    this.world.createTransformEntity(this.core, { persistent: true });
  }

  private drawLabel(): void {
    const context = this.labelContext;
    if (context == null) return;
    const percent = Math.round(this.shownCharge * 100);
    const celebrating = this.celebrate > 0;
    const key = `${percent}:${celebrating}`;
    if (key === this.labelKey) return;
    this.labelKey = key;

    context.clearRect(0, 0, 256, 256);
    context.beginPath();
    context.arc(128, 128, 122, 0, Math.PI * 2);
    context.fillStyle = 'rgba(12, 8, 22, 0.94)';
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = celebrating ? '#ffffff' : '#ffa94d';
    context.stroke();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#ffc98a';
    context.font = '700 26px "DM Sans", system-ui, sans-serif';
    context.fillText(celebrating ? 'OVERCHARGE' : 'CHARGE', 128, 78);
    context.fillStyle = '#ffffff';
    context.font = '700 76px "DM Sans", system-ui, sans-serif';
    context.fillText(`${percent}%`, 128, 142);
    this.labelTexture.needsUpdate = true;
  }

  private updateArrivals(delta: number): void {
    if (this.arrivals.length === 0) return;
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      this.arrivals[i] -= delta;
      if (this.arrivals[i] <= 0) {
        this.arrivals.splice(i, 1);
        this.onBeamArrive();
      }
    }
  }

  private onBeamArrive(): void {
    if (this.celebrate > 0) return;
    this.charge = Math.min(1, this.charge + CHARGE_STEP);
    this.corePulse = 1;
    this.flashes.fire(this.corePosition, CORE_COLOR, 1.1, 0.6);
    soundEngine.charge(this.charge);
    pulseHaptics(this.world, this.lastHand, 0.35, 45);
    if (this.charge >= 1) {
      this.celebrate = OVERCHARGE_SECONDS;
      soundEngine.overcharge();
      this.fragments.emit(this.corePosition, 0xffd9a0, 50, 3.2);
      this.flashes.fire(this.corePosition, 0xffffff, 1.8, 0.9);
      pulseHaptics(this.world, null, 0.8, 160);
    }
  }

  private updateCore(delta: number): void {
    if (this.celebrate > 0) {
      this.celebrate -= delta;
      if (this.celebrate <= 0) this.charge = 0;
    }
    worldTheme.setCharge(this.charge);
    this.shownCharge += (this.charge - this.shownCharge) * (1 - Math.exp(-delta * (this.charge === 0 ? 3 : 6)));
    if (Math.abs(this.shownCharge - this.charge) < 0.002) this.shownCharge = this.charge;
    this.corePulse = Math.max(0, this.corePulse - delta * 2.2);

    const breathe = 0.5 + 0.5 * Math.sin(this.elapsed * 1.6);
    const flicker = this.celebrate > 0 ? 0.6 + 0.4 * Math.sin(this.elapsed * 18) : 1;
    this.coreMesh.rotation.y += delta * (0.4 + this.shownCharge * 1.4);
    this.coreMesh.scale.setScalar(1 + this.corePulse * 0.4 + breathe * 0.05);
    this.coreMaterial.emissiveIntensity = (0.9 + this.shownCharge * 1.8 + this.corePulse * 2) * flicker;
    setGlow(this.coreHalo, 0.8 + this.shownCharge * 0.9 + this.corePulse * 0.5, 0.45 + this.shownCharge * 0.4);
    this.gimbals[0].rotation.z += delta * (0.5 + this.shownCharge);
    this.gimbals[1].rotation.z -= delta * (0.35 + this.shownCharge);
    this.ringMaterial.uniforms.uProgress.value = this.shownCharge;
    this.ringMaterial.uniforms.uIntensity.value = (1.4 + this.corePulse * 1.2) * flicker;
    this.drawLabel();
  }
}
