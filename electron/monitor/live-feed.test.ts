import { describe, expect, it, vi } from "vitest";
import {
  applyMonitorLiveMessage,
  MONITOR_LIVE_CAPACITY,
  type MonitorLiveMessage,
  type MonitorLiveScalars,
  type MonitorLiveState,
  type MonitorSampleTick,
} from "../../contracts/monitor.ts";
import {
  buildLiveSnapshot,
  createMonitorLiveRings,
  MonitorLiveFeed,
  SequencedRing,
} from "./live-feed.ts";

function scalars(): MonitorLiveScalars {
  return {
    timestamp: 1,
    recording: false,
    recordingSessionId: null,
    recordingStartedAt: null,
    systemCpuCount: 8,
    aggregate: {
      processCount: 0,
      totalCpuPercent: 0,
      totalCpuPercentOfSystem: 0,
      totalMemoryBytes: 0,
      osThreadCount: 0,
      busyThreads: 0,
      idleThreads: 0,
      streamingThreadCount: 0,
    },
    runningThreadIds: [],
    rendererTelemetry: null,
    pipelineTelemetry: {
      timestamp: 1,
      queueDepth: 0,
      queueCapacity: 256,
      droppedWrites: 0,
      writeFailures: 0,
      workerFailures: 0,
      workerMode: "worker",
      lastWriteLatencyMs: 0,
      maxWriteLatencyMs: 0,
      lastFlushMs: 0,
      lastError: null,
    },
  };
}

const tick = (timestamp: number): MonitorSampleTick => ({ timestamp, processes: [] });

function setup(maxInFlight = 4) {
  const rings = createMonitorLiveRings();
  const scalarCalls = vi.fn(scalars);
  const feed = new MonitorLiveFeed({ rings, scalars: scalarCalls, maxInFlight, minIntervalMs: 0 });
  const received: MonitorLiveMessage[] = [];
  let state: MonitorLiveState | null = null;
  const client = (message: MonitorLiveMessage) => {
    received.push(message);
    state = applyMonitorLiveMessage(state, message);
  };
  return { rings, feed, received, scalarCalls, client, state: () => state };
}

describe("SequencedRing", () => {
  it("keeps the newest items and reports gaps", () => {
    const ring = new SequencedRing<number>(3);
    for (let i = 1; i <= 5; i++) ring.push(i);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.at(-1)).toBe(5);
    expect(ring.since(4)).toEqual([5]);
    expect(ring.since(2)).toEqual([3, 4, 5]);
    expect(ring.since(1)).toBeNull();
  });
});

describe("MonitorLiveFeed", () => {
  it("builds nothing without subscribers", () => {
    const { rings, feed, scalarCalls } = setup();
    rings.ticks.push(tick(1));
    feed.schedule();
    feed.publish();
    expect(scalarCalls).not.toHaveBeenCalled();
  });

  it("sends a full snapshot on attach, then deltas that reproduce the snapshot", () => {
    const { rings, feed, received, client, state } = setup();
    rings.ticks.push(tick(1));
    feed.subscribe("monitor", client);
    expect(received[0].kind).toBe("full");
    for (let i = 2; i <= 5; i++) {
      rings.ticks.push(tick(i));
      rings.acpUpdates.push({ timestamp: i } as never);
      feed.publish();
      feed.acknowledge("monitor", state()!.revision);
    }
    expect(received.slice(1).every((message) => message.kind === "delta")).toBe(true);
    const deltas = received.slice(1) as Extract<MonitorLiveMessage, { kind: "delta" }>[];
    expect(deltas.every((message) => message.delta.appendedTicks.length === 1)).toBe(true);
    expect(state()!.snapshot).toEqual(buildLiveSnapshot(scalars(), rings));
  });

  it("stops sending to a subscriber that does not acknowledge", () => {
    const { rings, feed, received, client } = setup(2);
    feed.subscribe("slow", client);
    for (let i = 0; i < 50; i++) {
      rings.ticks.push(tick(i));
      feed.publish();
    }
    expect(received).toHaveLength(2);
    expect(feed.getStats().skippedForBackpressure).toBe(49);
  });

  it("catches a lagging subscriber up with one delta, or a full snapshot after a gap", () => {
    const { rings, feed, received, client, state } = setup(1);
    feed.subscribe("lagging", client);
    for (let i = 0; i < 10; i++) {
      rings.ticks.push(tick(i));
      feed.publish();
    }
    feed.acknowledge("lagging", state()!.revision);
    feed.publish();
    const catchUp = received.at(-1)!;
    expect(catchUp.kind).toBe("delta");
    if (catchUp.kind === "delta") expect(catchUp.delta.appendedTicks).toHaveLength(10);

    for (let i = 0; i < MONITOR_LIVE_CAPACITY.ticks + 5; i++) {
      rings.ticks.push(tick(100 + i));
      feed.publish();
    }
    feed.acknowledge("lagging", state()!.revision);
    feed.publish();
    expect(received.at(-1)!.kind).toBe("full");
    expect(state()!.snapshot.recentTicks).toHaveLength(MONITOR_LIVE_CAPACITY.ticks);
    expect(state()!.snapshot).toEqual(buildLiveSnapshot(scalars(), rings));
  });

  it("does not publish again just because a subscriber acknowledged", () => {
    vi.useFakeTimers();
    const { feed, received, client, state } = setup();
    feed.subscribe("monitor", client);
    for (let i = 0; i < 5; i++) {
      feed.acknowledge("monitor", state()!.revision);
      vi.advanceTimersByTime(1000);
    }
    expect(received).toHaveLength(1);
    feed.dispose();
    vi.useRealTimers();
  });

  it("rejects a delta that skips a revision", () => {
    const { feed, client, state } = setup();
    feed.subscribe("monitor", client);
    const current = state()!;
    const skipped = applyMonitorLiveMessage(current, {
      kind: "delta",
      revision: current.revision + 2,
      baseRevision: current.revision + 1,
      delta: {
        ...scalars(),
        appendedTicks: [],
        appendedRendererTelemetry: [],
        appendedAcpUpdates: [],
        appendedBridgeEvents: [],
      },
    });
    expect(skipped).toBeNull();
  });

  it("reports subscriber count changes", () => {
    const onSubscribersChanged = vi.fn();
    const feed = new MonitorLiveFeed({
      rings: createMonitorLiveRings(),
      scalars,
      onSubscribersChanged,
    });
    feed.subscribe(1, () => {});
    feed.subscribe(1, () => {});
    feed.unsubscribe(1);
    expect(onSubscribersChanged.mock.calls).toEqual([[1], [0]]);
    feed.dispose();
  });
});
