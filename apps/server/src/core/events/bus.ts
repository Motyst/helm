import type { HelmEvent } from '@helm/shared';

export type EventListener = (event: HelmEvent) => void;

/**
 * In-process fan-out of committed events. Services publish after their transaction commits;
 * SSE connections and modules subscribe.
 */
export class EventBus {
  private listeners = new Set<EventListener>();

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(events: readonly HelmEvent[]): void {
    for (const e of events) {
      for (const fn of this.listeners) {
        try {
          fn(e);
        } catch (err) {
          console.error('[bus] listener failed', err);
        }
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
