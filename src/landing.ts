import { SessionMode, VisibilityState, World } from '@iwsdk/core';
import { MobileControlsSystem } from './mobile/MobileControls.js';
import { passthrough } from './world/passthrough.js';

/** Wires the 2D landing overlay: Enter VR and the 360° Touch & Gyro fallback. */
export function setupLanding(world: World, mobile: MobileControlsSystem): void {
  const landing = document.getElementById('landing');
  const vrButton = document.getElementById('enter-vr') as HTMLButtonElement | null;
  const touchButton = document.getElementById('enter-360') as HTMLButtonElement | null;
  const mrButton = document.getElementById('enter-mr') as HTMLButtonElement | null;
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

  const startTouchMode = () => {
    hide();
    mobile.enter();
    document.documentElement.requestFullscreen?.().catch(() => undefined);
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
      world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
    } catch {
      setVrUnavailable('Could not start a VR session. Use 360° mode instead.');
    }
  });

  if (mrButton != null) {
    mrButton.disabled = true;
    if (world.xrEnabled && navigator.xr != null) {
      navigator.xr
        .isSessionSupported(SessionMode.ImmersiveAR)
        .then((supported) => {
          mrButton.disabled = !supported;
          if (!supported) mrButton.title = 'Mixed reality passthrough is not supported here';
        })
        .catch(() => undefined);
    }
    mrButton.addEventListener('click', () => {
      // Start with the environment partly faded so the real room is visible immediately.
      if (passthrough.opacity > 0.5) passthrough.set(0.3);
      try {
        world.launchXR({ sessionMode: SessionMode.ImmersiveAR });
      } catch {
        mrButton.disabled = true;
        if (vrNote) vrNote.textContent = 'Could not start a mixed reality session.';
      }
    });
  }

  touchButton.addEventListener('click', startTouchMode);

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
