import { AssetType, defineAssets } from '@iwsdk/core';
import demoCube from './scene-assets/demo-cube.scene-asset.js';
import kanbanBoard from './scene-assets/kanban-board.scene-asset.js';
import pomodoroPedestal from './scene-assets/pomodoro-pedestal.scene-asset.js';
import zenClouds from './scene-assets/zen-clouds.scene-asset.js';
import zenPlatform from './scene-assets/zen-platform.scene-asset.js';

// Build every public URL from BASE_URL so the runtime, the managed editor, and
// subpath builds all resolve the same file.
const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'environment-desk': {
    url: publicAssetUrl('gltf/environmentDesk/environmentDesk.gltf'),
    type: AssetType.GLTF,
    name: 'Environment Desk',
    priority: 'lazy',
  },
  'plant-sansevieria': {
    url: publicAssetUrl('gltf/plantSansevieria/plantSansevieria.gltf'),
    type: AssetType.GLTF,
    name: 'Plant Sansevieria',
    priority: 'lazy',
  },
  robot: {
    url: publicAssetUrl('gltf/robot/robot.gltf'),
    type: AssetType.GLTF,
    name: 'Robot',
    priority: 'lazy',
  },
  'webxr-banner': {
    url: publicAssetUrl('gltf/webxr-banner/banner.gltf'),
    type: AssetType.GLTF,
    name: 'WebXR Banner',
    priority: 'lazy',
  },
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
  'input-hud': {
    url: publicAssetUrl('ui/input-hud.uikitml'),
    type: AssetType.UIKitML,
    name: 'Controller Input HUD',
  },
  'kanban-column': {
    url: publicAssetUrl('ui/kanban-column.uikitml'),
    type: AssetType.UIKitML,
    name: 'Kanban Column Header',
  },
  'pomodoro-panel': {
    url: publicAssetUrl('ui/pomodoro.uikitml'),
    type: AssetType.UIKitML,
    name: 'Pomodoro Controls',
  },
  'demo-cube': demoCube,
  'zen-platform': zenPlatform,
  'zen-clouds': zenClouds,
  'kanban-board': kanbanBoard,
  'pomodoro-pedestal': pomodoroPedestal,
});
