import { createComponent, Types } from '@iwsdk/core';

/** Crystalline target the player shatters with an Energy Orb. */
export const StressTarget = createComponent('StressTarget', {
  index: { type: Types.Int8, default: 0 },
});

/** The single pulsing Energy Orb morphed from a completed task card. */
export const EnergyOrb = createComponent('EnergyOrb', {});

/** The in-world button that ends the active WebXR session. */
export const ExitXRButton = createComponent('ExitXRButton', {});

/** A physical control on the spatial audio console (0-2 ambient loops, 3 mute). */
export const ConsoleControl = createComponent('ConsoleControl', {
  control: { type: Types.Int8, default: 0 },
});
