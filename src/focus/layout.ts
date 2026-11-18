/**
 * Shared, side-effect-free layout for the FocusForge seated workspace.
 * Imported by scene assets (editor + runtime) and by runtime systems, so the
 * static board geometry and the dynamic cards always agree.
 *
 * Angles are measured from straight ahead (-Z) toward +X, in radians.
 */

const DEG = Math.PI / 180;

export const WORKSPACE_Y = 1.25;

export const BOARD_RADIUS = 0.96;
export const BOARD_HEIGHT = 0.76;
export const BOARD_HALF_ARC = 50 * DEG;

export const CARD_RADIUS = 0.9;
export const CARD_WIDTH = 0.2;
export const CARD_HEIGHT = 0.11;
export const CARD_DEPTH = 0.014;

export const COLUMN_TITLES = ['To-Do', 'Doing', 'Done'] as const;
export const COLUMN_ANGLES = [-32 * DEG, 0, 32 * DEG] as const;
export const COLUMN_HALF_ARC = 11 * DEG;
export const COLUMN_HEADER_Y = WORKSPACE_Y + 0.295;
export const CARD_SLOT_TOP_Y = WORKSPACE_Y + 0.15;
export const CARD_SLOT_STEP = 0.13;

export const PEDESTAL_ANGLE = -64 * DEG;
export const PEDESTAL_RADIUS = 0.78;
export const PEDESTAL_TOP_Y = 0.98;
export const RING_Y = 1.36;
export const RING_RADIUS = 0.12;

/** Convert a workspace angle + radius to a world X/Z pair. */
export function polarX(angle: number, radius: number): number {
  return Math.sin(angle) * radius;
}

export function polarZ(angle: number, radius: number): number {
  return -Math.cos(angle) * radius;
}

/** CylinderGeometry measures theta from +Z toward +X; convert a workspace angle. */
export function cylinderTheta(angle: number): number {
  return Math.PI - angle;
}
