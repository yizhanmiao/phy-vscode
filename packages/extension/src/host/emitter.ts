import type { Event } from '@phy-vscode/api';

export class Emitter<T> {
  private readonly listeners = new Set<(e: T) => void>();
  readonly event: Event<T> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error('phy-vscode: event listener threw', err);
      }
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}
