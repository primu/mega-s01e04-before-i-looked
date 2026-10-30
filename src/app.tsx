import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/digest/:night', async (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return c.notFound();

    const digest = await readNight(config.runsDir, night);
    if (digest === null) return c.notFound();

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <Digest night={night} digest={digest} />
      </Layout>,
    );
  });

  app.get('/api/digest/:night', async (c) => {
    const night = c.req.param('night');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return c.notFound();

    const digest = await readNight(config.runsDir, night);
    if (digest === null) return c.notFound();

    // Return NightDigest directly: rows (in reader order), badLines, and counts.
    return c.json(digest);
  });

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  return app;
}
