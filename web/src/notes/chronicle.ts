// Pure helper functions for the chronicle/timeline feature.
// No DOM, no Supabase — pure data transformations, fully testable.

import type { ChronicleEvent } from "../layers/features";

export type { ChronicleEvent };

export interface FilterOptions {
  tag?: string | undefined;
  targetType?: string | undefined;
  query?: string | undefined;
}

/** Sort events by year ascending, then by title for a stable order. */
export function sortEvents(events: ChronicleEvent[]): ChronicleEvent[] {
  return [...events].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.title.localeCompare(b.title);
  });
}

/** Filter events by tag, targetType, and/or a free-text query (title/body). */
export function filterEvents(events: ChronicleEvent[], opts: FilterOptions): ChronicleEvent[] {
  let result = events;
  if (opts.tag !== undefined && opts.tag !== "") {
    const tag = opts.tag;
    result = result.filter((e) => e.tags.includes(tag));
  }
  if (opts.targetType !== undefined && opts.targetType !== "") {
    const tt = opts.targetType;
    result = result.filter((e) => e.targetType === tt);
  }
  if (opts.query !== undefined && opts.query.trim() !== "") {
    const q = opts.query.trim().toLowerCase();
    result = result.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.body != null && e.body.toLowerCase().includes(q)),
    );
  }
  return result;
}

/** Return [min, max] year from a non-empty event list, or [0, 0] when empty. */
export function yearRange(events: ChronicleEvent[]): [number, number] {
  if (events.length === 0) return [0, 0];
  let min = events[0].year;
  let max = events[0].year;
  for (const e of events) {
    if (e.year < min) min = e.year;
    if (e.year > max) max = e.year;
  }
  return [min, max];
}
