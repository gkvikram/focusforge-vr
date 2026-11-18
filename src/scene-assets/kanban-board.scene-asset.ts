import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
} from '@iwsdk/core';
import {
  BOARD_HALF_ARC,
  BOARD_HEIGHT,
  BOARD_RADIUS,
  COLUMN_ANGLES,
  COLUMN_HALF_ARC,
  cylinderTheta,
  WORKSPACE_Y,
} from '../focus/layout.js';

const panelMaterial = new MeshStandardMaterial({
  color: 0xfbf3e6,
  emissive: 0xfff1de,
  emissiveIntensity: 0.18,
  roughness: 0.9,
  side: DoubleSide,
});
const columnMaterial = new MeshStandardMaterial({
  color: 0xf1e2cc,
  emissive: 0xf6e3c8,
  emissiveIntensity: 0.12,
  roughness: 0.95,
  side: DoubleSide,
});
const railMaterial = new MeshStandardMaterial({
  color: 0xb8865a,
  roughness: 0.6,
  metalness: 0.1,
  side: DoubleSide,
});

function arc(radius: number, height: number, center: number, halfArc: number, segments: number) {
  return new CylinderGeometry(
    radius,
    radius,
    height,
    segments,
    1,
    true,
    cylinderTheta(center) - halfArc,
    halfArc * 2,
  );
}

const board = new Group();
board.name = 'Curved Kanban Board';

const backing = new Mesh(arc(BOARD_RADIUS, BOARD_HEIGHT, 0, BOARD_HALF_ARC, 64), panelMaterial);
backing.position.y = WORKSPACE_Y;
board.add(backing);

for (const angle of COLUMN_ANGLES) {
  const column = new Mesh(
    arc(BOARD_RADIUS - 0.006, BOARD_HEIGHT - 0.06, angle, COLUMN_HALF_ARC, 20),
    columnMaterial,
  );
  column.position.y = WORKSPACE_Y - 0.01;
  board.add(column);
}

for (const offset of [BOARD_HEIGHT / 2, -BOARD_HEIGHT / 2]) {
  const rail = new Mesh(arc(BOARD_RADIUS - 0.004, 0.022, 0, BOARD_HALF_ARC + 0.01, 64), railMaterial);
  rail.position.y = WORKSPACE_Y + offset;
  board.add(rail);
}

export default board;
