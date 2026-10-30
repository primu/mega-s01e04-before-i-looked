import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+02:00';
const lastAt = '2026-10-28T01:04:00+02:00';

function event(job: string, status: 'ok' | 'retry' | 'fail', at = firstAt,
  owner: string | null = 'rook', error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

// Keep the assertions on server-rendered table cells, without needing a browser or client JS.
function tableRows(html: string): string[][] {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td(?: class="[^"]*")?>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]),
  );
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  }

  async function requestBoth() {
    const instance = app();
    const htmlResponse = await instance.request(`/digest/${night}`);
    const jsonResponse = await instance.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    return {
      html: await htmlResponse.text(),
      digest: await jsonResponse.json() as NightDigest,
    };
  }

  it('serves matching sorted jobs, preserves offsets and errors, and marks retries and failures', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [
      event('zeta', 'ok'),
      event('beta', 'fail', firstAt, null, 'permission denied'),
      // Deliberately out of timestamp order; a successful last run keeps the latest error.
      event('alpha', 'ok', lastAt),
      event('alpha', 'retry', '2026-10-28T01:03:00+02:00', 'rook', 'latest error'),
      event('alpha', 'retry', firstAt, 'rook', 'old error'),
      event('alpha', 'retry', '2026-10-28T01:02:00+02:00', 'rook', ''),
    ].join('\n'));

    const { html, digest } = await requestBoth();
    expect(digest).toEqual({
      rows: [
        { job: 'alpha', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'latest error', firstAt, lastAt },
        { job: 'beta', owner: null, runs: 1, retries: 0, lastStatus: 'fail',
          lastError: 'permission denied', firstAt, lastAt: firstAt },
        { job: 'zeta', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok',
          lastError: null, firstAt, lastAt: firstAt },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
    });
    const rows = tableRows(html);
    expect(rows.map((row) => row[0])).toEqual(digest.rows.map((row) => row.job));
    expect(rows[0]).toEqual(['alpha', 'rook', '4', '3', 'ok', 'latest error', firstAt, lastAt]);
    expect(rows[1][1]).toBe('—');
    expect(rows[2][5]).toBe('—');
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">fail</td>');
    expect(html).not.toContain('<td class="warn">ok</td>');
    expect(html).not.toMatch(/<script\b/i);
  });

  it.each(['/digest/', '/api/digest/'])('returns 404 for a missing night at %s', async (route) => {
    expect((await app().request(`${route}${night}`)).status).toBe(404);
  });

  it.each(['/digest/', '/api/digest/'])('returns 404 for invalid date labels at %s', async (route) => {
    for (const label of ['not-a-night', '2026-02-30']) {
      expect((await app().request(`${route}${label}`)).status).toBe(404);
    }
  });

  it('renders an existing empty night as nothing ran and returns an empty JSON digest', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    const { html, digest } = await requestBoth();
    expect(html).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
    expect(digest).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed JSON and invalid schema without losing valid rows or echoing bad lines', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [
      event('survivor', 'ok'),
      '{bad-json-secret',
      JSON.stringify({ at: firstAt, job: 'invalid-schema-secret', status: 'unknown', owner: null }),
      '', '  ',
    ].join('\n'));
    const { html, digest } = await requestBoth();
    expect(digest.badLines).toBe(2);
    expect(digest.rows.map((row) => row.job)).toEqual(['survivor']);
    expect(digest.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(html).toContain('malformed lines: 2');
    expect(tableRows(html).map((row) => row[0])).toEqual(['survivor']);
    expect(html).not.toContain('secret');
    expect(JSON.stringify(digest)).not.toContain('secret');
  });

  it('escapes malicious job text in HTML while preserving the value in JSON', async () => {
    const job = '<script>alert("night")</script>&';
    await writeFile(join(runsDir, `${night}.jsonl`), event(job, 'ok'));
    const { html, digest } = await requestBoth();
    expect(digest.rows[0].job).toBe(job);
    expect(html).toContain('&lt;script&gt;alert(&quot;night&quot;)&lt;/script&gt;&amp;');
    expect(html).not.toMatch(/<script\b/i);
    expect(tableRows(html)).toHaveLength(1);
  });
});
