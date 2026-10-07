// Read-only local hosting rehearsal. Never connects to the VPS or public DNS.
// node scripts/verify-alias-hosting.mjs /absolute/path/to/existing/portfolio/dist
import assert from 'node:assert/strict';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { log } from 'node:console';
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the existing portfolio dist directory');
const index = await readFile(path.join(dist, 'index.html'), 'utf8');
const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map((match) => match[1]);
assert.ok(assets.length > 0, 'Portfolio build must contain hashed assets');
const original = await readFile('deploy/spaceship/host-Caddyfile.fragment', 'utf8');
const scratch = await mkdtemp(path.join(tmpdir(), 'email-alias-hosting-'));
const name = `email-alias-hosting-${process.pid}`;
const gateway = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ forwarded: req.url }));
});
await new Promise((resolve) => gateway.listen(18881, '127.0.0.1', resolve));
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const get = (host, uri) =>
  new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: 18880, path: uri, headers: { Host: host } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
try {
  // Only the test listener/proxy change. Host matchers, static handling and
  // protected routes come directly from the reviewed deployment fragment.
  const offline =
    '{\n auto_https off\n admin off\n}\n' +
    original
      .replace(
        /^(sambhavpmtech\.com|www\.sambhavpmtech\.com|sambhavpmops\.com, www\.sambhavpmops\.com|unsubscribe\.sambhavpmtech\.com, unsubscribe\.sambhavpmops\.com) \{/gm,
        (line, hosts) =>
          `${hosts
            .split(', ')
            .map((host) => `http://${host}:8080`)
            .join(', ')} {`,
      )
      .replaceAll('127.0.0.1:18080', 'host.docker.internal:18881');
  await writeFile(path.join(scratch, 'Caddyfile'), offline);
  docker(
    'run',
    '--rm',
    '-v',
    `${scratch}:/etc/caddy:ro`,
    '-v',
    `${dist}:/var/www/sambhavbuilds/dist:ro`,
    'caddy:2',
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  );
  docker(
    'run',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1:18880:8080',
    '-v',
    `${scratch}:/etc/caddy:ro`,
    '-v',
    `${dist}:/var/www/sambhavbuilds/dist:ro`,
    'caddy:2',
  );
  // Bounded startup retry; no external DNS or automatic HTTPS issuance.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await get('sambhavpmtech.com', '/');
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  for (const host of [
    'sambhavpmtech.com',
    'www.sambhavpmtech.com',
    'sambhavpmops.com',
    'www.sambhavpmops.com',
  ]) {
    for (const uri of ['/', '/services', '/portfolio/client-navigation']) {
      const response = await get(host, uri);
      assert.equal(response.status, 200, `${host}${uri}`);
      assert.equal(
        response.headers.location,
        undefined,
        'Website must not redirect to the main domain',
      );
      assert.equal(response.body.toString(), index, 'Same website build and SPA fallback');
    }
    for (const asset of assets) {
      const response = await get(host, asset);
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'public, max-age=2592000, immutable');
      assert.deepEqual(response.body, await readFile(path.join(dist, asset)));
    }
  }
  for (const uri of [
    '/email-campaign/',
    '/email-campaign/api/v1/mailboxes',
    '/email-campaign/oauth/google/callback',
  ]) {
    const response = await get('sambhavpmtech.com', uri);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).forwarded, uri);
  }
  const bare = await get('sambhavpmtech.com', '/email-campaign');
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.location, '/email-campaign/');
  const wwwApp = await get('www.sambhavpmtech.com', '/email-campaign/campaigns');
  assert.equal(wwwApp.status, 308);
  assert.equal(wwwApp.headers.location, 'https://sambhavpmtech.com/email-campaign/campaigns');
  for (const host of ['unsubscribe.sambhavpmtech.com', 'unsubscribe.sambhavpmops.com']) {
    assert.equal((await get(host, '/')).status, 404);
    const response = await get(host, '/u/test');
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).forwarded, '/u/test');
  }
  log(
    `Alias hosting PASS: four hosts, SPA navigation, ${assets.length} assets per host, application/OAuth routing and two unsubscribe hosts`,
  );
} finally {
  try {
    docker('rm', '-f', name);
  } catch {
    /* Failed before container creation. */
  }
  await new Promise((resolve) => gateway.close(resolve));
  assert.equal(path.dirname(scratch), path.resolve(tmpdir()));
  assert.ok(path.basename(scratch).startsWith('email-alias-hosting-'));
  await rm(scratch, { recursive: true, force: true });
}
