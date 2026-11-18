import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { PEDESTAL_TOP_Y } from '../focus/layout.js';

const stone = new MeshStandardMaterial({ color: 0xe8dccb, roughness: 0.8 });
const brass = new MeshStandardMaterial({
  color: 0xc9935a,
  roughness: 0.35,
  metalness: 0.6,
});

/** Pedestal authored around its own origin; the scene places it on the floor. */
const pedestal = new Group();
pedestal.name = 'Pomodoro Pedestal';

const base = new Mesh(new CylinderGeometry(0.17, 0.2, 0.06, 40), stone);
base.position.y = 0.03;
pedestal.add(base);

const columnHeight = PEDESTAL_TOP_Y - 0.1;
const column = new Mesh(new CylinderGeometry(0.075, 0.1, columnHeight, 32), stone);
column.position.y = 0.06 + columnHeight / 2;
pedestal.add(column);

const cap = new Mesh(new CylinderGeometry(0.15, 0.12, 0.04, 40), brass);
cap.position.y = PEDESTAL_TOP_Y - 0.02;
pedestal.add(cap);

export default pedestal;
