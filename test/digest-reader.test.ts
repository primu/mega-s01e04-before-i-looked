import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const temporaryDirs: string[] = [];
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' };

async function fixture(lines: unknown[] | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rig-digest-reader-'));
  temporaryDirs.push(dir);
  const contents = typeof lines === 'string' ? lines : lines.map(line => JSON.stringify(line)).join('\n');
  await writeFile(join(dir, `${night}.jsonl`), contents);
  return dir;
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('readNight', () => {
  it('aggregates the supplied read-only night without changing its bytes', async () => {
    const path = join('runs', `${night}.jsonl`);
    const before = await readFile(path);
    const beforeHash = createHash('sha256').update(before).digest('hex');
    const result = await readNight('runs', night);
    expect(result).toEqual({
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
    expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(beforeHash);
  });

  it('orders by instant, retains offsets and uses file order to resolve equal times', async () => {
    const dir = await fixture([
      { ...event, at: '2026-10-28T01:30:00+01:00', status: 'fail', owner: 'later', error: 'latest error' },
      { ...event, at: '2026-10-28T02:00:00+02:00', status: 'retry', error: 'earlier error' },
      { ...event, at: '2026-10-28T00:30:00Z', status: 'ok', owner: null, error: '' },
      { ...event, at: '2026-10-27T20:00:00-04:00', status: 'retry', error: 'tie error' },
      { ...event, at: '2026-10-28T01:00:00Z', error: '   ', owner: null },
    ]);
    expect(await readNight(dir, night)).toEqual({
      badLines: 0, counts: { ok: 2, retry: 2, fail: 1 },
      rows: [{ job: 'job', owner: null, runs: 5, retries: 2, lastStatus: 'ok', lastError: 'latest error', firstAt: '2026-10-28T02:00:00+02:00', lastAt: '2026-10-28T01:00:00Z' }],
    });
  });

  it('uses the last file event for last status, owner, error and timestamp on ties', async () => {
    const dir = await fixture([
      { ...event, at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'retry', owner: null, error: 'last' },
    ]);
    expect((await readNight(dir, night))?.rows[0]).toEqual({
      job: 'job', owner: null, runs: 2, retries: 1, lastStatus: 'retry', lastError: 'last',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T22:00:00Z',
    });
  });

  it('counts malformed JSON and invalid schemas while ignoring blank lines and extra fields', async () => {
    const invalid = [null, [], 7, 'text', {},
      { ...event, at: '2026-10-28T22:00:00' },
      { ...event, at: '2026-02-30T22:00:00Z' },
      { ...event, at: 'not a date' },
      { ...event, at: '2026-10-28T24:00:00Z' },
      { ...event, job: '' }, { ...event, job: '  ' }, { ...event, job: 5 },
      { ...event, status: 'pending' }, { ...event, owner: 5 },
      { at: event.at, job: event.job, status: event.status },
      { ...event, error: null }, { ...event, error: 5 },
    ];
    const dir = await fixture([
      '\r\n  \t\r\n', '{bad json', ...invalid.map(value => JSON.stringify(value)),
      JSON.stringify({ ...event, owner: null, extra: { ignored: true } }), '',
    ].join('\n'));
    const result = await readNight(dir, night);
    expect(result?.badLines).toBe(invalid.length + 1);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
  });

  it('sorts jobs in code-unit order and keeps prototype-like job names', async () => {
    const dir = await fixture(['a', '__proto__', 'z', 'Z', 'A'].map(job => ({ ...event, job })));
    expect((await readNight(dir, night))?.rows.map(row => row.job)).toEqual(['A', 'Z', '__proto__', 'a', 'z']);
  });

  it.each(['', '\r\n \t\n'])('returns an empty digest for an empty or blank file', async contents => {
    expect(await readNight(await fixture(contents), night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('returns a digest for an entirely invalid file', async () => {
    expect(await readNight(await fixture('broken\nnull'), night)).toEqual({ rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('returns null for a missing file', async () => {
    const dir = await fixture('');
    expect(await readNight(dir, '2026-10-29')).toBeNull();
  });

  it('rejects non-ENOENT I/O errors', async () => {
    const dir = await fixture('');
    await mkdir(join(dir, '2026-10-29.jsonl'));
    await expect(readNight(dir, '2026-10-29')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it.each(['../2026-10-28', '..\\2026-10-28', '/2026-10-28', '2026-10-28/other', '2026-2-3', '2026-02-30', '2026-13-01', ''])('rejects invalid date label %s before accessing files', async label => {
    await expect(readNight('does-not-exist', label)).rejects.toBeInstanceOf(TypeError);
  });
});
