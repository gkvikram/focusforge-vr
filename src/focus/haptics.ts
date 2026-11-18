import type { World } from '@iwsdk/core';

interface PulseActuator {
  pulse?(intensity: number, duration: number): unknown;
}

interface HapticGamepad {
  hapticActuators?: PulseActuator[];
}

export type Hand = 'left' | 'right';

/**
 * Subtle haptic tick. In XR it pulses the given hand's controller (or both when
 * `hand` is null); on a phone in 360 mode it falls back to the Vibration API.
 */
export function pulseHaptics(
  world: World,
  hand: Hand | null,
  intensity: number,
  durationMs: number,
): void {
  const session = world.renderer.xr.getSession();
  if (session != null) {
    for (const source of session.inputSources) {
      if (hand != null && source.handedness !== hand) continue;
      const gamepad = source.gamepad as unknown as HapticGamepad | null;
      gamepad?.hapticActuators?.[0]?.pulse?.(intensity, durationMs);
    }
    return;
  }
  navigator.vibrate?.(Math.round(durationMs));
}
