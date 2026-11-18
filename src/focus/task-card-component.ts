import { createComponent, Types } from '@iwsdk/core';

/** Marks the "+ Add Task" button above the To-Do column. */
export const AddTaskButton = createComponent('AddTaskButton', {});

/** An interactive Kanban task card; taskId indexes into focusStore.tasks. */
export const TaskCard = createComponent('TaskCard', {
  taskId: { type: Types.Int16, default: -1 },
});
