import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import {
  CONSOLE_ANGLE,
  CONSOLE_ROW_Y,
  CONSOLE_SLAB_INWARD,
  CONSOLE_TOP_Y,
  consolePoint,
} from '../focus/layout.js';

const stone = new MeshStandardMaterial({ color: 0xe8dccb, roughness: 0.8 });
const brass = new MeshStandardMaterial({ color: 0xc9935a, roughness: 0.35, metalness: 0.6 });
const walnut = new MeshStandardMaterial({ color: 0x4a362b, roughness: 0.65 });

/** Static stand for the audio console, authored in workspace coordinates (node sits at the origin). */
const console_ = new Group();
console_.name = 'Spatial Audio Console';

const stand = new Group();
const [standX, standZ] = consolePoint(0);
stand.position.set(standX, 0, standZ);

const base = new Mesh(new CylinderGeometry(0.17, 0.2, 0.06, 40), stone);
base.position.y = 0.03;
stand.add(base);

const columnHeight = CONSOLE_TOP_Y - 0.1;
const column = new Mesh(new CylinderGeometry(0.075, 0.1, columnHeight, 32), stone);
column.position.y = 0.06 + columnHeight / 2;
stand.add(column);

const cap = new Mesh(new CylinderGeometry(0.15, 0.12, 0.04, 40), brass);
cap.position.y = CONSOLE_TOP_Y - 0.02;
stand.add(cap);
console_.add(stand);

// Housings are 0.03 deep; the slab is flush behind them.
const [slabX, slabZ] = consolePoint(CONSOLE_SLAB_INWARD);
const slab = new Mesh(new BoxGeometry(0.56, 0.23, 0.04), walnut);
slab.position.set(slabX, CONSOLE_ROW_Y, slabZ);
slab.rotation.y = -CONSOLE_ANGLE;
console_.add(slab);

const trim = new Mesh(new BoxGeometry(0.58, 0.014, 0.05), brass);
trim.position.set(slabX, CONSOLE_ROW_Y + 0.122, slabZ);
trim.rotation.y = -CONSOLE_ANGLE;
console_.add(trim);

export default console_;
