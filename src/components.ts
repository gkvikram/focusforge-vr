import { defineComponents } from '@iwsdk/core';
import { DemoCube } from './demo-cube-component.js';
import { TaskCard } from './focus/task-card-component.js';
import { Robot } from './robot-component.js';

export default defineComponents([Robot, DemoCube, TaskCard]);
