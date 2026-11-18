import { defineComponents } from '@iwsdk/core';
import { DemoCube } from './demo-cube-component.js';
import { TaskCard } from './focus/task-card-component.js';
import { ConsoleControl, EnergyOrb, StressTarget } from './focus/reward-components.js';

export default defineComponents([DemoCube, TaskCard, StressTarget, EnergyOrb, ConsoleControl]);
