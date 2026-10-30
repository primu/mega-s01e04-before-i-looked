import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = await realpath(fileURLToPath(new URL('../', import.meta.url)));

function insideCheckout(candidate) {
  const relative = path.relative(checkout, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Resolve existing ancestors before creating directories, including directory junctions.
async function resolvedDestination(destination) {
  let ancestor = path.dirname(destination);
  const missing = [];
  while (true) {
    try {
      return path.join(await realpath(ancestor), ...missing, path.basename(destination));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(ancestor));
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function validateHtml(html) {
  if (!/<!doctype html\s*>/i.test(html) || !/<html\b/i.test(html) || !/<\/html\s*>/i.test(html)) {
    throw new Error('Response is not a complete HTML document.');
  }
  // Conservative checks for this server-rendered layout, not a general HTML sanitizer.
  if (/<\s*(script|link|iframe|object|embed|base|form)\b/i.test(html)
      || /\s(?:src|srcset|poster|data|background|on[a-z]+)\s*=/i.test(html)
      || /(?:url\s*\(|@import\b|javascript\s*:|vbscript\s*:)/i.test(html)
      || /<meta\b[^>]*http-equiv\s*=/i.test(html)) {
    throw new Error('HTML contains scripts, embedded content, or asset references; expected a self-contained static page.');
  }
  if (!/<span\b[^>]*class=["']marker["'][^>]*>/i.test(html)) {
    throw new Error('Expected lane banner is missing.');
  }
}

async function main() {
  const options = new Map();
  const allowed = new Set(['--night', '--origin', '--output']);
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!allowed.has(key) || !value || value.startsWith('--') || options.has(key)) {
      throw new Error('Usage: node scripts/export-digest.mjs --output <absolute-path-outside-checkout> [--night YYYY-MM-DD] [--origin http://127.0.0.1:8787]');
    }
    options.set(key, value);
  }
  const night = options.get('--night') ?? '2026-10-28';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)
      || !Number.isFinite(Date.parse(night)) || new Date(night).toISOString().slice(0, 10) !== night) {
    throw new Error('Night must be a valid date in YYYY-MM-DD format.');
  }
  const origin = new URL(options.get('--origin') ?? 'http://127.0.0.1:8787');
  if (origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(origin.hostname)
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Origin must be plain HTTP on numeric loopback (127.0.0.1 or [::1]), with no credentials or path.');
  }
  const output = options.get('--output');
  if (!output || !path.isAbsolute(output)) throw new Error('An explicit absolute --output path is required.');
  const destination = await resolvedDestination(output);
  if (insideCheckout(path.resolve(output)) || insideCheckout(destination)) {
    throw new Error('Previews must be saved outside the Git checkout.');
  }
  try {
    await stat(destination);
    throw new Error('Output already exists; choose a new path or deliberately remove the old export first.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(new URL(`/digest/${night}`, origin), {
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== 200) throw new Error(`Expected HTTP 200; received ${response.status}.`);
  if (!/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('Expected Content-Type: text/html.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  validateHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.digest-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Saved ${bytes.length} bytes to ${destination}`);
}

main().catch((error) => {
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
});
