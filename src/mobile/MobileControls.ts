import {
  createSystem,
  Euler,
  MathUtils,
  Quaternion,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { WORKSPACE_Y } from '../focus/layout.js';
import { passthrough } from '../world/passthrough.js';
import { worldTheme } from '../world/world-theme.js';

/**
 * 360° Touch & Gyro fallback for phones without immersive WebXR
 * (tuned for Android Chrome on a Samsung Galaxy A14 5G).
 *
 * - touch/mouse drag rotates yaw (free) and pitch (clamped to ±75°)
 * - optional smoothed DeviceOrientation look, toggled from the HUD
 * - taps fall through to IWSDK's canvas pointer forwarding, so every
 *   RayInteractable object and UIKit button stays one-tap interactive
 */

/** Read by interaction systems so a look-drag never counts as a tap. */
export const pointerGesture = { dragged: false };

const PITCH_LIMIT = MathUtils.degToRad(75);
const DRAG_THRESHOLD_PX = 8;
const MAX_PIXEL_RATIO = 1.5;
const GYRO_SMOOTHING = 10;
const TOUCH_SMOOTHING = 22;

type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function clampPixelRatio(renderer: { setPixelRatio(value: number): void }): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
}

export class MobileControlsSystem extends createSystem({}) {
  private active = false;
  private gyroEnabled = false;
  private hasOrientation = false;

  private yaw = 0;
  private pitch = 0;
  private gyroYawOffset = 0;

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;

  private alpha = 0;
  private beta = 0;
  private gamma = 0;

  private readonly target = new Quaternion();
  private readonly deviceQuat = new Quaternion();
  private readonly screenQuat = new Quaternion();
  private readonly yawQuat = new Quaternion();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly cameraFix = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  private readonly zAxis = new Vector3(0, 0, 1);
  private readonly yAxis = new Vector3(0, 1, 0);

  private saved = { position: new Vector3(), quaternion: new Quaternion(), fov: 50 };
  private hud: HTMLElement | null = null;
  private gyroButton: HTMLButtonElement | null = null;
  private toast: HTMLElement | null = null;
  private toastTimer = 0;
  private gyroProbe = 0;
  private exitListeners = new Set<() => void>();

  init(): void {
    const canvas = this.world.renderer.domElement;
    canvas.style.touchAction = 'none';
    if (window.matchMedia('(pointer: coarse)').matches) {
      clampPixelRatio(this.world.renderer);
    }

    this.hud = document.getElementById('mobile-hud');
    this.gyroButton = document.getElementById('gyro-toggle') as HTMLButtonElement | null;
    this.toast = document.getElementById('hud-toast');
    const exitButton = document.getElementById('exit-360');

    const themeButton = document.getElementById('cycle-theme');
    const onGyro = () => void this.setGyro(!this.gyroEnabled);
    const onExit = () => this.exit();
    const onTheme = () => this.showToast(`Theme: ${worldTheme.cycle().label}`);
    this.gyroButton?.addEventListener('click', onGyro);
    exitButton?.addEventListener('click', onExit);
    themeButton?.addEventListener('click', onTheme);

    const slider = document.getElementById('opacity-slider') as HTMLInputElement | null;
    const sliderValue = document.getElementById('opacity-value');
    const syncSlider = (opacity: number) => {
      const percent = Math.round(opacity * 100);
      if (slider != null && slider.value !== String(percent)) slider.value = String(percent);
      slider?.setAttribute('aria-valuetext', `${percent} percent`);
      if (sliderValue != null) sliderValue.textContent = `${percent}%`;
    };
    const onSlider = () => passthrough.set(Number(slider?.value ?? 100) / 100);
    slider?.addEventListener('input', onSlider);
    syncSlider(passthrough.opacity);
    this.cleanupFuncs.push(
      () => slider?.removeEventListener('input', onSlider),
      passthrough.subscribe(syncSlider),
    );

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    this.cleanupFuncs.push(
      () => this.gyroButton?.removeEventListener('click', onGyro),
      () => exitButton?.removeEventListener('click', onExit),
      () => themeButton?.removeEventListener('click', onTheme),
      () => canvas.removeEventListener('pointerdown', this.onPointerDown),
      () => window.removeEventListener('pointermove', this.onPointerMove),
      () => window.removeEventListener('pointerup', this.onPointerUp),
      () => window.removeEventListener('pointercancel', this.onPointerUp),
      () => window.removeEventListener('resize', this.onResize),
      () => window.removeEventListener('deviceorientation', this.onOrientation),
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive && this.active) {
          this.deactivate(false);
        }
      }),
    );
  }

  get isActive(): boolean {
    return this.active;
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  enter(): void {
    if (this.active) return;
    const camera = this.world.camera;
    this.saved.position.copy(camera.position);
    this.saved.quaternion.copy(camera.quaternion);
    this.saved.fov = camera.fov;

    this.active = true;
    this.yaw = 0;
    this.pitch = 0;
    clampPixelRatio(this.world.renderer);
    camera.position.set(0, WORKSPACE_Y + 0.04, 0.45);
    this.applyFov();
    this.composeTouchTarget();
    camera.quaternion.copy(this.target);
    this.hud?.removeAttribute('hidden');
    this.showToast('Drag to look around - tap a card to move it');
  }

  exit(): void {
    this.deactivate(true);
  }

  update(delta: number): void {
    if (!this.active || this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      return;
    }
    if (this.gyroEnabled && this.hasOrientation) {
      this.composeGyroTarget();
    } else {
      this.composeTouchTarget();
    }
    const smoothing = this.gyroEnabled ? GYRO_SMOOTHING : TOUCH_SMOOTHING;
    this.world.camera.quaternion.slerp(this.target, 1 - Math.exp(-delta * smoothing));
  }

  private deactivate(restoreCamera: boolean): void {
    if (!this.active) return;
    this.active = false;
    void this.setGyro(false);
    this.hud?.setAttribute('hidden', '');
    if (restoreCamera) {
      const camera = this.world.camera;
      camera.position.copy(this.saved.position);
      camera.quaternion.copy(this.saved.quaternion);
      camera.fov = this.saved.fov;
      camera.updateProjectionMatrix();
    }
    for (const listener of this.exitListeners) listener();
  }

  private composeTouchTarget(): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.target.setFromEuler(this.euler);
  }

  /** Standard DeviceOrientation -> camera quaternion, then clamp pitch. */
  private composeGyroTarget(): void {
    const orient = MathUtils.degToRad(screen.orientation?.angle ?? 0);
    this.euler.set(
      MathUtils.degToRad(this.beta),
      MathUtils.degToRad(this.alpha),
      -MathUtils.degToRad(this.gamma),
      'YXZ',
    );
    this.deviceQuat.setFromEuler(this.euler);
    this.deviceQuat.multiply(this.cameraFix);
    this.deviceQuat.multiply(this.screenQuat.setFromAxisAngle(this.zAxis, -orient));

    this.yawQuat.setFromAxisAngle(this.yAxis, this.gyroYawOffset);
    this.target.multiplyQuaternions(this.yawQuat, this.deviceQuat);

    this.euler.setFromQuaternion(this.target, 'YXZ');
    this.euler.x = MathUtils.clamp(this.euler.x, -PITCH_LIMIT, PITCH_LIMIT);
    this.target.setFromEuler(this.euler);
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  }

  private async setGyro(enabled: boolean): Promise<void> {
    if (enabled === this.gyroEnabled) return;
    if (!enabled) {
      this.gyroEnabled = false;
      window.removeEventListener('deviceorientation', this.onOrientation);
      window.clearTimeout(this.gyroProbe);
      this.syncGyroButton();
      return;
    }

    if (typeof DeviceOrientationEvent === 'undefined') {
      this.showToast('Gyroscope not supported on this device');
      return;
    }
    const permissionApi = DeviceOrientationEvent as unknown as OrientationPermission;
    if (typeof permissionApi.requestPermission === 'function') {
      try {
        if ((await permissionApi.requestPermission()) !== 'granted') {
          this.showToast('Motion access was denied');
          return;
        }
      } catch {
        this.showToast('Motion access was denied');
        return;
      }
    }

    this.gyroEnabled = true;
    this.hasOrientation = false;
    window.addEventListener('deviceorientation', this.onOrientation);
    this.syncGyroButton();
    this.showToast('Gyro look on - drag to re-center');

    this.gyroProbe = window.setTimeout(() => {
      if (this.gyroEnabled && !this.hasOrientation) {
        void this.setGyro(false);
        this.showToast('No gyroscope data - using touch look');
      }
    }, 1500);
  }

  private syncGyroButton(): void {
    if (this.gyroButton == null) return;
    this.gyroButton.setAttribute('aria-pressed', String(this.gyroEnabled));
    this.gyroButton.textContent = this.gyroEnabled ? 'Gyro: On' : 'Gyro: Off';
  }

  private applyFov(): void {
    const camera = this.world.camera;
    if (window.innerHeight > window.innerWidth) {
      camera.fov = 74;
    } else {
      // Aim for ~118° horizontal so the Pomodoro, Kanban and audio stations share one view.
      const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
      const targetHorizontal = MathUtils.degToRad(118);
      const vertical = 2 * Math.atan(Math.tan(targetHorizontal / 2) / aspect);
      camera.fov = MathUtils.clamp(MathUtils.radToDeg(vertical), 58, 78);
    }
    camera.updateProjectionMatrix();
  }

  private showToast(message: string): void {
    if (this.toast == null) return;
    this.toast.textContent = message;
    this.toast.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast?.classList.remove('visible'), 2600);
  }

  private onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.alpha == null || event.beta == null || event.gamma == null) return;
    this.alpha = event.alpha;
    this.beta = event.beta;
    this.gamma = event.gamma;
    if (!this.hasOrientation) {
      this.hasOrientation = true;
      // Keep the current heading when gyro takes over.
      const currentYaw = this.yaw;
      this.gyroYawOffset = 0;
      this.composeGyroTarget();
      this.gyroYawOffset = currentYaw - this.yaw;
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    pointerGesture.dragged = false;
    if (!this.active || this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.startX = this.lastX = event.clientX;
    this.startY = this.lastY = event.clientY;
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    if (!pointerGesture.dragged) {
      const distance = Math.hypot(event.clientX - this.startX, event.clientY - this.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      pointerGesture.dragged = true;
    }
    const radiansPerPixel = MathUtils.degToRad(this.world.camera.fov) / window.innerHeight;
    const dx = (event.clientX - this.lastX) * radiansPerPixel;
    const dy = (event.clientY - this.lastY) * radiansPerPixel;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    if (this.gyroEnabled && this.hasOrientation) {
      this.gyroYawOffset += dx;
    } else {
      this.yaw += dx;
      this.pitch = MathUtils.clamp(this.pitch + dy, -PITCH_LIMIT, PITCH_LIMIT);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    // Clear after IWSDK's own pointerup handlers have read the flag.
    window.setTimeout(() => {
      if (this.pointerId === null) pointerGesture.dragged = false;
    }, 0);
  };

  private onResize = (): void => {
    if (!this.active) return;
    clampPixelRatio(this.world.renderer);
    this.applyFov();
  };
}
