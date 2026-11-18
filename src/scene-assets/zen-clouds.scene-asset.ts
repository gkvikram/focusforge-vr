import {
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from '@iwsdk/core';

/** Deterministic PRNG so the runtime and editor realms build identical clouds. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261118);
const CLUSTERS = 26;
const PUFFS_PER_CLUSTER = 7;

const material = new MeshStandardMaterial({
  color: 0xfff4ea,
  emissive: 0xffd9b8,
  emissiveIntensity: 0.28,
  roughness: 1,
  metalness: 0,
});

const clouds = new InstancedMesh(
  new IcosahedronGeometry(1, 2),
  material,
  CLUSTERS * PUFFS_PER_CLUSTER,
);
clouds.name = 'Procedural Clouds';

const matrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const euler = new Euler();

let index = 0;
for (let c = 0; c < CLUSTERS; c++) {
  const angle = (c / CLUSTERS) * Math.PI * 2 + random() * 0.4;
  const distant = c % 3 === 0;
  const radius = distant ? 38 + random() * 20 : 9 + random() * 22;
  const baseY = distant ? -1 - random() * 6 : -3.5 - random() * 6;
  const cx = Math.sin(angle) * radius;
  const cz = Math.cos(angle) * radius;
  const clusterScale = distant ? 3.2 : 1.6 + random() * 1.2;

  for (let p = 0; p < PUFFS_PER_CLUSTER; p++) {
    position.set(
      cx + (random() - 0.5) * clusterScale * 3.2,
      baseY + random() * clusterScale * 0.5,
      cz + (random() - 0.5) * clusterScale * 2,
    );
    euler.set(0, random() * Math.PI, 0);
    quaternion.setFromEuler(euler);
    const s = clusterScale * (0.55 + random() * 0.6);
    scale.set(s * 1.25, s * 0.62, s);
    matrix.compose(position, quaternion, scale);
    clouds.setMatrixAt(index++, matrix);
  }
}
clouds.instanceMatrix.needsUpdate = true;
clouds.computeBoundingSphere();

export default clouds;
