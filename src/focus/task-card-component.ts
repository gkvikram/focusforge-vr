import { createComponent, Types } from '@iwsdk/core';

/** An interactive Kanban task card; taskId indexes into focusStore.tasks. */
export const TaskCard = createComponent('TaskCard', {
  taskId: { type: Types.Int16, default: -1 },
});
