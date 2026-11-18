import { SessionMode, VisibilityState, World } from '@iwsdk/core';
import { MobileControlsSystem } from './mobile/MobileControls.js';

/** Wires the 2D landing overlay: Enter VR and the 360° Touch & Gyro fallback. */
export function setupLanding(world: World, mobile: MobileControlsSystem): void {
  const landing = document.getElementById('landing');
  const vrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;
  const touchButton = document.getElementById('enter-360') as HTMLButtonElement | null;
  const vrNote = document.getElementById('vr-note');
  if (landing == null || vrButton == null || touchButton == null) return;

  const show = () => landing.removeAttribute('hidden');
  const hide = () => landing.setAttribute('hidden', '');

  const setVrUnavailable = (message: string) => {
    vrButton.disabled = true;
    vrButton.textContent = 'VR not available';
    if (vrNote) vrNote.textContent = message;
    touchButton.classList.add('recommended');
  };

  if (!world.xrEnabled || !('xr' in navigator) || navigator.xr == null) {
    setVrUnavailable('No WebXR headset found. 360° mode works on any phone or desktop.');
  } else {
    navigator.xr
      .isSessionSupported(SessionMode.ImmersiveVR)
      .then((supported) => {
        if (!supported) {
          setVrUnavailable('This browser cannot start immersive VR. Use 360° mode instead.');
        }
      })
      .catch(() => setVrUnavailable('Unable to check VR support. Use 360° mode instead.'));
  }

  vrButton.addEventListener('click', () => {
    try {
      world.launchXR();
    } catch {
      setVrUnavailable('Could not start a VR session. Use 360° mode instead.');
    }
  });

  touchButton.addEventListener('click', () => {
    hide();
    mobile.enter();
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  });

  mobile.onExit(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (world.visibilityState.peek() === VisibilityState.NonImmersive) show();
  });

  world.visibilityState.subscribe((state) => {
    if (state === VisibilityState.NonImmersive) {
      if (!mobile.isActive) show();
    } else {
      hide();
    }
  });
}
