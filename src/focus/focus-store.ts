/** Runtime-only shared task state for the Kanban and Pomodoro systems. */

export const TODO = 0;
export const DOING = 1;
export const DONE = 2;
export type ColumnIndex = typeof TODO | typeof DOING | typeof DONE;

export const TASK_TITLES = ['Ship MVP', 'Test WebXR Input', 'Polish Shaders', 'Record Demo'];

export interface TaskState {
  readonly id: number;
  readonly title: string;
  column: ColumnIndex;
  /** Monotonic arrival order within its current column. */
  order: number;
}

export interface TaskMoveEvent {
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
  }));

  private sequence = TASK_TITLES.length;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The most recently started task in "Doing", or undefined. */
  activeTask(): TaskState | undefined {
    let active: TaskState | undefined;
    for (const task of this.tasks) {
      if (task.column === DOING && (active == null || task.order > active.order)) {
        active = task;
      }
    }
    return active;
  }

  /** To-Do -> Doing -> Done. Returns false when the task is already done. */
  advance(id: number): boolean {
    const task = this.tasks[id];
    if (task == null || task.column === DONE) {
      return false;
    }
    const from = task.column;
    task.column = (from + 1) as ColumnIndex;
    task.order = this.sequence++;
    this.emit({ task, from, to: task.column });
    return true;
  }

  reset(): void {
    this.tasks.forEach((task, id) => {
      task.column = TODO;
      task.order = id;
    });
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
