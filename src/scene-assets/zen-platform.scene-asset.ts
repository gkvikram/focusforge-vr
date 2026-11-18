import {
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from '@iwsdk/core';

const PLATFORM_RADIUS = 3.2;
const DECK_THICKNESS = 0.14;

const deckMaterial = new MeshStandardMaterial({
  color: 0xefe4d2,
  roughness: 0.85,
  metalness: 0,
});
const rockMaterial = new MeshStandardMaterial({
  color: 0xc9a27e,
  roughness: 0.95,
  flatShading: true,
});
const inlayMaterial = new MeshStandardMaterial({
  color: 0xd9a55b,
  emissive: 0xf2b866,
  emissiveIntensity: 0.35,
  roughness: 0.4,
  metalness: 0.3,
});
const stoneMaterial = new MeshStandardMaterial({
  color: 0x8f8579,
  roughness: 0.9,
  flatShading: true,
});

deckMaterial.name = 'zen-deck';
rockMaterial.name = 'zen-rock';
inlayMaterial.name = 'zen-inlay';
stoneMaterial.name = 'zen-stone';

const platform = new Group();
platform.name = 'Zen Platform';

const deck = new Mesh(
  new CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS * 0.97, DECK_THICKNESS, 72),
  deckMaterial,
);
deck.position.y = -DECK_THICKNESS / 2;
platform.add(deck);

const underside = new Mesh(new ConeGeometry(PLATFORM_RADIUS * 0.95, 2.6, 9, 2), rockMaterial);
underside.rotation.x = Math.PI;
underside.position.y = -DECK_THICKNESS - 1.3;
platform.add(underside);

for (const radius of [PLATFORM_RADIUS - 0.25, 1.35]) {
  const inlay = new Mesh(new TorusGeometry(radius, 0.012, 6, 96), inlayMaterial);
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.004;
  platform.add(inlay);
}

// A small balanced cairn off to the right for composition.
const cairnSizes = [0.16, 0.12, 0.09, 0.06];
let cairnY = 0;
cairnSizes.forEach((size, index) => {
  const stone = new Mesh(new DodecahedronGeometry(size, 0), stoneMaterial);
  stone.scale.set(1, 0.55, 1);
  cairnY += size * 0.55;
  stone.position.set(1.7, cairnY, -1.4);
  stone.rotation.y = index * 0.7;
  cairnY += size * 0.45;
  platform.add(stone);
});

export default platform;
