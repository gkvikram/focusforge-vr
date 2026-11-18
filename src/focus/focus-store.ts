/** Runtime-only shared task state for the Kanban and Pomodoro systems. */

export const TODO = 0;
export const DOING = 1;
export const DONE = 2;
export type ColumnIndex = typeof TODO | typeof DOING | typeof DONE;

export const TASK_TITLES = ['Ship MVP', 'Test WebXR Input', 'Polish Shaders', 'Record Demo'];

/** Titles cycled through by the "+ Add Task" button. */
export const PRESET_TITLES = [
  'Write Docs',
  'Fix Layout Bug',
  'Review Pull Request',
  'Plan Next Sprint',
  'Tune Performance',
  'Deploy Build',
];

/** Keeps a column of cards inside the curved board. */
export const MAX_LIVE_TASKS = 6;

export interface TaskState {
  readonly id: number;
  readonly title: string;
  column: ColumnIndex;
  /** Monotonic arrival order within its current column. */
  order: number;
  /** Permanently cleared (an energy orb was thrown). Kept in the array so ids stay stable. */
  removed: boolean;
}

export type TaskEventKind = 'move' | 'add' | 'remove';

export interface TaskMoveEvent {
  kind: TaskEventKind;
  task: TaskState;
  from: ColumnIndex;
  to: ColumnIndex;
}

type Listener = (event: TaskMoveEvent | null) => void;

class FocusStore {
  readonly tasks: TaskState[] = TASK_TITLES.map((title, id) => ({
    id,
    title,
    column: TODO,
    order: id,
    removed: false,
  }));

  private sequence = TASK_TITLES.length;
  private presetCursor = 0;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  liveTasks(): TaskState[] {
    return this.tasks.filter((task) => !task.removed);
  }

  /** The most recently started task in "Doing", or undefined. */
  activeTask(): TaskState | undefined {
    let active: TaskState | undefined;
    for (const task of this.tasks) {
      if (task.removed) continue;
      if (task.column === DOING && (active == null || task.order > active.order)) {
        active = task;
      }
    }
    return active;
  }

  /** To-Do -> Doing -> Done. Returns false when the task is already done or cleared. */
  advance(id: number): boolean {
    const task = this.tasks[id];
    if (task == null || task.removed || task.column === DONE) {
      return false;
    }
    const from = task.column;
    task.column = (from + 1) as ColumnIndex;
    task.order = this.sequence++;
    this.emit({ kind: 'move', task, from, to: task.column });
    return true;
  }

  /** Spawn a fresh preset task at the top of To-Do. Returns null when the board is full. */
  addPresetTask(): TaskState | null {
    if (this.liveTasks().length >= MAX_LIVE_TASKS) return null;
    const title = PRESET_TITLES[this.presetCursor++ % PRESET_TITLES.length];
    const task: TaskState = {
      id: this.tasks.length,
      title,
      column: TODO,
      order: this.sequence++,
      removed: false,
    };
    this.tasks.push(task);
    this.emit({ kind: 'add', task, from: TODO, to: TODO });
    return task;
  }

  /** Permanently clear a task from the board. */
  removeTask(id: number): void {
    const task = this.tasks[id];
    if (task == null || task.removed) return;
    task.removed = true;
    this.emit({ kind: 'remove', task, from: task.column, to: task.column });
  }

  /** Move every remaining task back to To-Do. Cleared tasks stay cleared. */
  reset(): void {
    let order = 0;
    for (const task of this.tasks) {
      if (task.removed) continue;
      task.column = TODO;
      task.order = order++;
    }
    this.sequence = this.tasks.length;
    this.emit(null);
  }

  private emit(event: TaskMoveEvent | null): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const focusStore = new FocusStore();
