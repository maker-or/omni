/**
 * Folds repeated incidents of one kind into a single row. An occurrence joins
 * the open group for its key when it arrives within `windowMs` of the group's
 * last occurrence and the group spans less than `maxSpanMs`; otherwise a new
 * incident starts. The first occurrence keeps its full context (pre-drop
 * ticks, telemetry); later ones add a count, the peak value and a short,
 * bounded list of recent occurrences.
 */
export interface CoalescedIncident {
  incidentId: number;
  firstAt: number;
  lastAt: number;
  occurrences: number;
  payload: Record<string, unknown>;
}

export interface IncidentOccurrence {
  at: number;
  value: number;
  threadId?: string | null;
}

export const MAX_RECENT_OCCURRENCES = 20;

export class IncidentCoalescer {
  private readonly groups = new Map<string, CoalescedIncident>();
  private readonly windowMs: number;
  private readonly maxSpanMs: number;
  private readonly maxGroups: number;

  constructor(options: { windowMs?: number; maxSpanMs?: number; maxGroups?: number } = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxSpanMs = options.maxSpanMs ?? 10 * 60_000;
    this.maxGroups = options.maxGroups ?? 64;
  }

  /** The open group this occurrence would join, if any. */
  find(key: string, now: number): CoalescedIncident | null {
    const group = this.groups.get(key);
    if (!group) return null;
    if (now - group.lastAt > this.windowMs || now - group.firstAt > this.maxSpanMs) {
      this.groups.delete(key);
      return null;
    }
    return group;
  }

  get(key: string): CoalescedIncident | null {
    return this.groups.get(key) ?? null;
  }

  open(
    key: string,
    incidentId: number,
    payload: Record<string, unknown>,
    now: number,
  ): CoalescedIncident {
    const group: CoalescedIncident = {
      incidentId,
      firstAt: now,
      lastAt: now,
      occurrences: 1,
      payload,
    };
    this.groups.delete(key);
    this.groups.set(key, group);
    while (this.groups.size > this.maxGroups) {
      const oldest = this.groups.keys().next().value;
      if (oldest === undefined) break;
      this.groups.delete(oldest);
    }
    return group;
  }
}

/** Payload for a group after another occurrence joined it. */
export function mergeOccurrence(
  group: CoalescedIncident,
  occurrence: IncidentOccurrence,
  valueField: string,
): Record<string, unknown> {
  group.occurrences += 1;
  group.lastAt = occurrence.at;
  const previous = group.payload;
  const recent = Array.isArray(previous.recentOccurrences)
    ? (previous.recentOccurrences as IncidentOccurrence[])
    : [];
  const peakField = `max${valueField.charAt(0).toUpperCase()}${valueField.slice(1)}`;
  const previousPeak = Number(previous[peakField] ?? previous[valueField] ?? 0);
  group.payload = {
    ...previous,
    occurrences: group.occurrences,
    lastOccurredAt: occurrence.at,
    [peakField]: Math.max(Number.isFinite(previousPeak) ? previousPeak : 0, occurrence.value),
    recentOccurrences: [...recent, occurrence].slice(-MAX_RECENT_OCCURRENCES),
  };
  return group.payload;
}
