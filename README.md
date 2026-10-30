# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Export a digest for review

Start rig locally first. It binds to `127.0.0.1`; the exporter only fetches numeric
loopback HTTP origins, rejects redirects, and preserves the response bytes and lane banner.
From this checkout, save one self-contained HTML file to an explicit path outside Git:

```powershell
node scripts/export-digest.mjs --night 2026-10-28 --output 'E:/Sync/PRZEMEK/KURSY/2026-09-03 - MEGA.DEV/dist/index.html'
```

Use `--origin http://127.0.0.1:8788` if rig runs on another port. The command requires
HTTP 200 and `text/html`, checks for scripts and asset references, and refuses paths
inside this checkout (including junctions). It creates parent directories and saves via
a temporary file beside the destination. An existing destination must be deliberately
removed before recapturing. This is a conservative check for rig's layout, not a general
HTML security audit. The command never uploads anything.

The human uploads the workspace `dist` directory to Cloudflare Pages. Keep previews out
of Git and chat attachments (ADR 0003). Issue #7 remains open until the public HTTPS URL
and issue list reach the reviewer. After review and separate approval to replace the
published preview, restart rig with `LANE_MARKER` unset, recapture the same digest URL,
verify the banner reads `no marker set`, and replace the page at the same public URL.
Changing the environment of the export command does not change an already running rig.
