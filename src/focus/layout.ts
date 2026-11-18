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

/**
 * Side stations sit outside the board's 50 degree arc (its edge is at x = 0.74m) so they never
 * overlap the To-Do or Done columns, and each turns 35 degrees inward toward the user.
 */
export const STATION_X = 1.05;
export const STATION_Z = -0.75;
const STATION_YAW = 35 * DEG;

/** Point on a station, `inward` metres along its facing direction (toward the user). side: -1 left, +1 right. */
export function stationPoint(side: -1 | 1, inward: number): [number, number] {
  const yaw = side * STATION_YAW;
  return [side * STATION_X - Math.sin(yaw) * inward, STATION_Z + Math.cos(yaw) * inward];
}

/** Left Pomodoro pedestal. */
export const PEDESTAL_ANGLE = -STATION_YAW;
export const PEDESTAL_TOP_Y = 0.9;
export const PEDESTAL_PANEL_INWARD = 0.04;
export const RING_Y = 1.32;
export const RING_RADIUS = 0.12;

/** Spatial audio console, mirrored to the right of the board. */
export const CONSOLE_ANGLE = STATION_YAW;
export const CONSOLE_TOP_Y = PEDESTAL_TOP_Y;
export const CONSOLE_SWITCH_INWARD = 0.08;
export const CONSOLE_SLAB_INWARD = 0.045;
export const CONSOLE_ROW_Y = 1.05;
export const CONSOLE_SLOT_STEP = 0.118;

/**
 * Central Energy Core hangs behind the board, above its top rail. Sitting at 2.25m
 * (lowered from 2.3m) keeps its ring clear of the top HUD buttons in 360° mode,
 * while the readout disc stays just above the board's top rail line of sight.
 */
export const CORE_POSITION: readonly [number, number, number] = [0, 2.25, -1.75];
export const CORE_RING_RADIUS = 0.4;
/** Offset and diameter of the dark charge-readout disc in front of the core. */
export const CORE_READOUT_Y = -0.24;
export const CORE_READOUT_SIZE = 0.3;

/** Cards compress their slot spacing so a full column still fits on the board. */
export const CARD_COLUMN_SPAN = 0.45;

/** Stress targets orbit just outside the 3.2m platform edge. */
export const TARGET_ORBIT_RADII = [3.5, 3.9, 3.45, 4.0, 3.7] as const;
export const TARGET_HEIGHTS = [1.25, 1.75, 2.15, 1.5, 1.95] as const;
export const TARGET_SPEEDS = [0.16, -0.12, 0.2, -0.17, 0.14] as const;
export const TARGET_SIZE = 0.2;

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
