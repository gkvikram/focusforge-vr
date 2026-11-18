import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { AudioConsoleSystem } from './focus/audio-console-system.js';
import { KanbanSystem } from './focus/kanban-system.js';
import { PomodoroSystem } from './focus/pomodoro-system.js';
import { RewardSystem } from './focus/reward-system.js';
import { SanctuarySystem } from './focus/sanctuary-system.js';
import { ControllerInputSystem } from './input.js';
import { setupLanding } from './landing.js';
import { MobileControlsSystem } from './mobile/MobileControls.js';
import { PanelSystem } from './panel.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(PanelSystem);
  world.registerSystem(ControllerInputSystem);
  world.registerSystem(SanctuarySystem);
  world.registerSystem(KanbanSystem);
  world.registerSystem(PomodoroSystem);
  world.registerSystem(AudioConsoleSystem);
  world.registerSystem(RewardSystem);
  world.registerSystem(MobileControlsSystem);

  const mobile = world.getSystem(MobileControlsSystem);
  if (mobile) {
    setupLanding(world, mobile);
  }
});
