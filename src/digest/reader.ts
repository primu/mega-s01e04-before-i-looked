import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

interface RunEvent {
  at: string;
  instant: number;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
}

function isDateLabel(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value.at)
    || !isDateLabel(value.at.slice(0, 10))) return null;
  const instant = Date.parse(value.at);
  if (!Number.isFinite(instant)) return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value) || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  if ('error' in value && typeof value.error !== 'string') return null;
  return {
    at: value.at, instant, job: value.job, status: value.status, owner: value.owner,
    error: 'error' in value && typeof value.error === 'string' ? value.error : undefined,
  };
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!isDateLabel(night)) throw new TypeError('night must be a valid YYYY-MM-DD date label');
  let contents: string;
  try {
    contents = await readFile(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const events: RunEvent[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (event === null) digest.badLines++;
    else events.push(event);
  }
  // Stable sorting preserves file order when two events represent the same instant.
  events.sort((a, b) => a.instant - b.instant);
  const jobs = new Map<string, DigestRow>();
  for (const event of events) {
    digest.counts[event.status]++;
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job, owner: event.owner, runs: 0, retries: 0,
        lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    row.lastAt = event.at;
    if (event.error?.trim()) row.lastError = event.error;
  }
  digest.rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
