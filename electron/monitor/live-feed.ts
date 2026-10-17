import type {
  MonitorAcpUpdate,
  MonitorBridgeEvent,
  MonitorLiveMessage,
  MonitorLiveScalars,
  MonitorLiveSnapshot,
  MonitorRendererTelemetry,
  MonitorSampleTick,
} from "../../contracts/monitor.ts";
import { MONITOR_LIVE_CAPACITY } from "../../contracts/monitor.ts";

/**
 * Fixed-capacity ring that also counts every push, so a reader can ask for
 * "everything appended since total N" without copying the whole ring.
 */
export class SequencedRing<T> {
  private readonly items: T[] = [];
  private start = 0;
  private pushed = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Number of items ever pushed. */
  get total(): number {
    return this.pushed;
  }

  get length(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.pushed += 1;
    if (this.items.length < this.capacity) {
      this.items.push(item);
      return;
    }
    this.items[this.start] = item;
    this.start = (this.start + 1) % this.capacity;
  }

  at(index: number): T | undefined {
    const length = this.items.length;
    const normalized = index < 0 ? length + index : index;
    if (normalized < 0 || normalized >= length) return undefined;
    return this.items[(this.start + normalized) % length];
  }

  /** Oldest-to-newest copy of the last `count` items (all by default). */
  toArray(count = this.items.length): T[] {
    const length = this.items.length;
    const take = Math.max(0, Math.min(count, length));
    const result: T[] = Array.from({ length: take });
    for (let i = 0; i < take; i++)
      result[i] = this.items[(this.start + length - take + i) % length];
    return result;
  }

  /** Items pushed after `total`, or null when some of them were overwritten. */
  since(total: number): T[] | null {
    const missing = this.pushed - total;
    if (missing < 0 || missing > this.items.length) return null;
    return this.toArray(missing);
  }
}

export interface MonitorLiveRings {
  ticks: SequencedRing<MonitorSampleTick>;
  rendererTelemetry: SequencedRing<MonitorRendererTelemetry>;
  acpUpdates: SequencedRing<MonitorAcpUpdate>;
  bridgeEvents: SequencedRing<MonitorBridgeEvent>;
}

export function createMonitorLiveRings(): MonitorLiveRings {
  return {
    ticks: new SequencedRing(MONITOR_LIVE_CAPACITY.ticks),
    rendererTelemetry: new SequencedRing(MONITOR_LIVE_CAPACITY.rendererTelemetry),
    acpUpdates: new SequencedRing(MONITOR_LIVE_CAPACITY.acpUpdates),
    bridgeEvents: new SequencedRing(MONITOR_LIVE_CAPACITY.bridgeEvents),
  };
}

export function buildLiveSnapshot(
  scalars: MonitorLiveScalars,
  rings: MonitorLiveRings,
): MonitorLiveSnapshot {
  return {
    ...scalars,
    recentTicks: rings.ticks.toArray(),
    recentRendererTelemetry: rings.rendererTelemetry.toArray(),
    recentAcpUpdates: rings.acpUpdates.toArray(),
    recentBridgeEvents: rings.bridgeEvents.toArray(),
  };
}

type RingTotals = Record<keyof MonitorLiveRings, number>;

interface Subscriber {
  send: (message: MonitorLiveMessage) => void;
  revision: number;
  ackedRevision: number;
  /** Ring totals included in the last message; null until the first full snapshot. */
  sentTotals: RingTotals | null;
  /** A publish skipped this subscriber for backpressure; deliver on its next ack. */
  missed: boolean;
}

export interface MonitorLiveFeedOptions {
  rings: MonitorLiveRings;
  scalars: () => MonitorLiveScalars;
  /**
   * Messages a subscriber may have unacknowledged. Further publishes skip it
   * until it acknowledges; the next message then carries everything it missed
   * (or a full snapshot when the rings have moved past it).
   */
  maxInFlight?: number;
  /** Minimum spacing between coalesced publishes. */
  minIntervalMs?: number;
  onSubscribersChanged?: (count: number) => void;
}

export interface MonitorLiveFeedStats {
  subscribers: number;
  fullMessages: number;
  deltaMessages: number;
  skippedForBackpressure: number;
}

/**
 * Delivers live monitor state to subscribed windows. Nothing is built or
 * serialized while there are no subscribers; a new subscriber gets a full
 * snapshot, then deltas. Slow subscribers are bounded by `maxInFlight`.
 */
export class MonitorLiveFeed {
  private readonly rings: MonitorLiveRings;
  private readonly scalars: () => MonitorLiveScalars;
  private readonly maxInFlight: number;
  private readonly minIntervalMs: number;
  private readonly onSubscribersChanged?: (count: number) => void;
  private readonly subscribers = new Map<string | number, Subscriber>();
  private timer: NodeJS.Timeout | null = null;
  private lastPublishedAt = 0;
  private readonly stats = { fullMessages: 0, deltaMessages: 0, skippedForBackpressure: 0 };

  constructor(options: MonitorLiveFeedOptions) {
    this.rings = options.rings;
    this.scalars = options.scalars;
    this.maxInFlight = options.maxInFlight ?? 4;
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.onSubscribersChanged = options.onSubscribersChanged;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  getStats(): MonitorLiveFeedStats {
    return { subscribers: this.subscribers.size, ...this.stats };
  }

  subscribe(id: string | number, send: (message: MonitorLiveMessage) => void): void {
    const existed = this.subscribers.has(id);
    const subscriber: Subscriber = {
      send,
      revision: 0,
      ackedRevision: 0,
      sentTotals: null,
      missed: false,
    };
    this.subscribers.set(id, subscriber);
    this.deliver(subscriber, this.scalars());
    if (!existed) this.onSubscribersChanged?.(this.subscribers.size);
  }

  unsubscribe(id: string | number): void {
    if (!this.subscribers.delete(id)) return;
    if (this.subscribers.size === 0) this.cancelTimer();
    this.onSubscribersChanged?.(this.subscribers.size);
  }

  acknowledge(id: string | number, revision: number): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber || !Number.isSafeInteger(revision)) return;
    const caughtUp = revision >= subscriber.revision;
    subscriber.ackedRevision = Math.min(
      Math.max(subscriber.ackedRevision, revision),
      subscriber.revision,
    );
    // Anything skipped while it was behind is delivered once it catches up.
    if (caughtUp && subscriber.missed) this.schedule();
  }

  /** Asks for a full snapshot on the next message (e.g. after a gap). */
  resync(id: string | number): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;
    subscriber.sentTotals = null;
    subscriber.ackedRevision = subscriber.revision;
    this.schedule();
  }

  /** Coalesces state changes into at most one publish per `minIntervalMs`. */
  schedule(): void {
    if (this.subscribers.size === 0 || this.timer) return;
    const wait = Math.max(0, this.lastPublishedAt + this.minIntervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish();
    }, wait);
    this.timer.unref?.();
  }

  publish(): void {
    this.cancelTimer();
    if (this.subscribers.size === 0) return;
    this.lastPublishedAt = Date.now();
    // Scalars are shared by every subscriber in this publish.
    let scalars: MonitorLiveScalars | null = null;
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.revision - subscriber.ackedRevision >= this.maxInFlight) {
        this.stats.skippedForBackpressure += 1;
        subscriber.missed = true;
        continue;
      }
      scalars ??= this.scalars();
      this.deliver(subscriber, scalars);
    }
  }

  dispose(): void {
    this.cancelTimer();
    this.subscribers.clear();
  }

  private totals(): RingTotals {
    return {
      ticks: this.rings.ticks.total,
      rendererTelemetry: this.rings.rendererTelemetry.total,
      acpUpdates: this.rings.acpUpdates.total,
      bridgeEvents: this.rings.bridgeEvents.total,
    };
  }

  private deliver(subscriber: Subscriber, scalars: MonitorLiveScalars): void {
    const totals = this.totals();
    const sent = subscriber.sentTotals;
    const appended = sent
      ? {
          ticks: this.rings.ticks.since(sent.ticks),
          rendererTelemetry: this.rings.rendererTelemetry.since(sent.rendererTelemetry),
          acpUpdates: this.rings.acpUpdates.since(sent.acpUpdates),
          bridgeEvents: this.rings.bridgeEvents.since(sent.bridgeEvents),
        }
      : null;
    const baseRevision = subscriber.revision;
    subscriber.revision += 1;
    subscriber.missed = false;
    subscriber.sentTotals = totals;
    if (
      !appended ||
      !appended.ticks ||
      !appended.rendererTelemetry ||
      !appended.acpUpdates ||
      !appended.bridgeEvents
    ) {
      this.stats.fullMessages += 1;
      subscriber.send({
        kind: "full",
        revision: subscriber.revision,
        snapshot: buildLiveSnapshot(scalars, this.rings),
      });
      return;
    }
    this.stats.deltaMessages += 1;
    subscriber.send({
      kind: "delta",
      revision: subscriber.revision,
      baseRevision,
      delta: {
        ...scalars,
        appendedTicks: appended.ticks,
        appendedRendererTelemetry: appended.rendererTelemetry,
        appendedAcpUpdates: appended.acpUpdates,
        appendedBridgeEvents: appended.bridgeEvents,
      },
    });
  }

  private cancelTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
