import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { StatusBoard } from '../src/views/status.js';

describe('board digest links', () => {
  let runsDir: string;
  const config = { adapter: 'board-test', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('links every night newest first and shows valid event totals beside each link', async () => {
    const event = (status: string) => JSON.stringify({
      at: '2026-10-28T23:00:02+01:00', job: 'same-job', owner: null, status,
    });
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      event('retry'), event('retry'), event('fail'), event('ok'), event('ok'),
      event('unknown'), '{bad json', '',
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'ignored');
    vi.stubEnv('LANE_MARKER', 'BOARD-TEST-MARKER');
    vi.stubEnv('LANE_ID', 'board-lane');

    const app = createApp({ ...config, runsDir });
    const response = await app.request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<li><a href="/digest/2026-10-28">2026-10-28</a> · ok 2 / retry 2 / fail 1</li>');
    expect(html).toContain('<li><a href="/digest/2026-10-27">2026-10-27</a> · ok 0 / retry 0 / fail 0</li>');
    expect(html.indexOf('/digest/2026-10-28')).toBeLessThan(html.indexOf('/digest/2026-10-27'));
    expect(html).not.toContain('notes.txt');
    expect(html).toContain('BOARD-TEST-MARKER');
    expect(html).toContain('board-lane');
    expect(html).toContain('board-test');
    expect(html).toContain(config.installed);
    expect(html).toContain('last beat');
    for (const night of ['2026-10-28', '2026-10-27']) {
      expect((await app.request(`/digest/${night}`)).status).toBe(200);
    }
  });

  it('keeps the existing message when no nights are on disk', async () => {
    const response = await createApp({ ...config, runsDir }).request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('nothing in runs/');
  });

  it('links both supplied nights with their valid event counts', async () => {
    const app = createApp({ ...config, runsDir: 'runs' });
    const html = await (await app.request('/')).text();
    expect(html).toContain('<li><a href="/digest/2026-10-28">2026-10-28</a> · ok 10 / retry 4 / fail 1</li>');
    expect(html).toContain('<li><a href="/digest/2026-10-27">2026-10-27</a> · ok 7 / retry 0 / fail 0</li>');
    for (const night of ['2026-10-28', '2026-10-27']) {
      const response = await app.request(`/digest/${night}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`digest · ${night}`);
    }
  });

  it('shows missing counts as dashes while retaining the night link', () => {
    const html = StatusBoard({ status: {
      ...config, lastBeat: null, nights: ['2026-10-28'], nightCounts: {},
    } }).toString();
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok — / retry — / fail —');
    expect(html).toContain('<span class="warn">none</span>');
  });
});
