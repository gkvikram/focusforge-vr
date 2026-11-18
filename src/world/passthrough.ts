/**
 * Shared "world opacity" setting. 1 = fully virtual environment, 0 = only the
 * workstation (Kanban, Pomodoro, audio console, core, targets) remains and the
 * real room (MR passthrough) or the frosted grid backdrop (360° mode) shows.
 * Side-effect free apart from the singleton, so DOM handlers can import it.
 */

type Listener = (opacity: number) => void;

class PassthroughController {
  private value = 1;
  private readonly listeners = new Set<Listener>();

  get opacity(): number {
    return this.value;
  }

  set(next: number): void {
    const clamped = Math.min(1, Math.max(0, next));
    if (clamped === this.value) return;
    this.value = clamped;
    for (const listener of this.listeners) listener(clamped);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const passthrough = new PassthroughController();
