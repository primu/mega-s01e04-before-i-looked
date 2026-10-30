export type DigestStatus = 'ok' | 'retry' | 'fail';

/** One job's valid events, ordered by instant; equal times use file order. */
export interface DigestRow {
  job: string;
  /** Owner on the last event, including null (render null as an em dash). */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  /** Number of events whose status is retry. */
  retries: number;
  lastStatus: DigestStatus;
  /** Latest nonempty error, or null; a later success does not erase it. */
  lastError: string | null;
  /** Earliest event's timestamp, preserving its original offset. */
  firstAt: string;
  /** Latest event's timestamp, preserving its original offset. */
  lastAt: string;
}

/** Totals of valid events by status, not counts of jobs' last statuses. */
export interface DigestCounts {
  ok: number;
  retry: number;
  fail: number;
}

/** A file that exists, including an empty or entirely invalid file. */
export interface NightDigest {
  /** One row per job, sorted by job in ascending code-unit order. */
  rows: DigestRow[];
  /** Nonblank lines rejected by JSON parsing or event validation. */
  badLines: number;
  counts: DigestCounts;
}

/**
 * Contract for the named readNight export in src/digest/reader.ts.
 * Reads runsDir/<night>.jsonl; night is a YYYY-MM-DD date label.
 * Returns null only when the file is absent. Other I/O errors reject.
 * Validate events at the file edge: at is an ISO timestamp with an explicit
 * offset (or Z), job is a nonempty string, status is a DigestStatus, owner is
 * string | null, and optional error is a string. Extra fields are ignored.
 * Blank lines are ignored; invalid nonblank lines increment badLines.
 * Rejected line contents must not be returned or logged.
 * An empty file returns { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } }.
 */
export type ReadNight = (
  runsDir: string,
  night: string,
) => Promise<NightDigest | null>;
