import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { RouteOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import { CONFIG_INVENTORY, loadConfig } from '../../src/config.js';
import { createAppContext } from '../../src/context.js';
import { createDbConnection } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { SCHEMA_STATEMENTS } from '../../src/db/schema.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pythonRoot = path.join(repoRoot, 'server');
const tsRoot = path.join(repoRoot, 'server-ts');
const EPHEMERAL_MIGRATION_TABLES = new Set(['wallet_links_next']);

function walk(root: string, predicate: (file: string) => boolean): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const candidate = path.join(root, entry);
    if (statSync(candidate).isDirectory()) files.push(...walk(candidate, predicate));
    else if (predicate(candidate)) files.push(candidate);
  }
  return files;
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

function normalizedRoutes(routes: Iterable<string>): string[] {
  return [...new Set(routes)]
    .filter(route => !route.startsWith('HEAD ') && !route.startsWith('OPTIONS '))
    .filter(route => route !== 'GET /web' && route !== 'GET /web/*')
    .map(route => route.replace(/\{([^}]+)\}/g, ':$1'))
    .sort();
}

function pythonRoutes(): string[] {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'tinyfrens-route-inventory-'));
  const database = path.join(tempRoot, 'inventory.db');
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(pythonRoot)})`,
    'from app import create_app',
    `app = create_app(${JSON.stringify(database)}, ['https://tinyfrens.lol'])`,
    "print(json.dumps(sorted({route.method + ' ' + route.resource.canonical for route in app.router.routes()})))",
  ].join('\n');
  const result = spawnSync('python', ['-c', script], { encoding: 'utf8' });
  try {
    assert.equal(result.status, 0, result.stderr || 'Python route inventory failed');
    return JSON.parse(result.stdout.trim()) as string[];
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('source-derived migration inventory', () => {
  test('TypeScript registers every Python HTTP route', async () => {
    const captured: string[] = [];
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const app = await buildApp({
      context: createAppContext(loadConfig({}), db),
      onRoute(route: RouteOptions) {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) captured.push(`${method} ${route.url}`);
      },
    });
    await app.ready();
    try {
      assert.deepEqual(normalizedRoutes(captured), normalizedRoutes(pythonRoutes()));
    } finally {
      await app.close();
    }
  });

  test('TypeScript registers every TinyFrens route referenced by clients', async () => {
    const clientFiles = [
      ...walk(path.join(repoRoot, 'web'), file => file.endsWith('.js')),
      path.join(repoRoot, 'desktop', 'turtle.cjs'),
      ...walk(path.join(repoRoot, 'android', 'app', 'src', 'main'), file => file.endsWith('.kt')),
      ...walk(path.join(repoRoot, 'ios'), file => file.endsWith('.swift')),
      ...walk(path.join(repoRoot, 'snap', 'src'), file => file.endsWith('.ts')),
      ...walk(path.join(repoRoot, 'scripts'), file => /\.(?:cjs|mjs|js|ps1)$/.test(file))
        .filter(file => !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}vendor${path.sep}`)),
    ];
    const externalApiPrefixes = ['/api/v10/activities/', '/api/v2'];
    const clientRoutes = new Set<string>();
    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\/(?:api\/[A-Za-z0-9_./:-]+|ws)(?=[?`'"${}\s)]|$)/g)) {
        const route = match[0];
        if (!externalApiPrefixes.some(prefix => route.startsWith(prefix))) clientRoutes.add(route);
      }
    }

    const serverRoutes = new Set<string>();
    const db = createDbConnection(':memory:');
    runMigrations(db);
    const app = await buildApp({
      context: createAppContext(loadConfig({}), db),
      onRoute(route: RouteOptions) {
        serverRoutes.add(route.url);
      },
    });
    await app.ready();
    try {
      const missing = [...clientRoutes].filter(route => {
        if (route.endsWith('/')) return ![...serverRoutes].some(candidate => candidate.startsWith(route));
        return !serverRoutes.has(route);
      });
      assert.deepEqual(missing.sort(), []);
    } finally {
      await app.close();
    }
  });

  test('TypeScript schema includes every production Python table', () => {
    const pythonTables = new Set<string>();
    for (const file of walk(pythonRoot, file => file.endsWith('.py') && !path.basename(file).startsWith('test_'))) {
      const source = readFileSync(file, 'utf8');
      for (const table of matches(source, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        if (!EPHEMERAL_MIGRATION_TABLES.has(table)) pythonTables.add(table);
      }
    }
    const tsTables = new Set(SCHEMA_STATEMENTS.map(statement => statement.table));
    assert.deepEqual([...pythonTables].filter(table => !tsTables.has(table)).sort(), []);
  });

  test('all Python and example environment keys are classified', () => {
    const discovered = new Set<string>();
    for (const file of walk(pythonRoot, file => file.endsWith('.py') && !path.basename(file).startsWith('test_'))) {
      const source = readFileSync(file, 'utf8');
      for (const key of matches(source, /os\.environ(?:\.get)?\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) discovered.add(key);
      for (const key of matches(source, /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) discovered.add(key);
      for (const key of matches(source, /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) discovered.add(key);
    }
    const example = readFileSync(path.join(pythonRoot, '.env.example'), 'utf8');
    for (const key of matches(example, /^([A-Z][A-Z0-9_]*)=/gm)) discovered.add(key);
    const classified = new Set(CONFIG_INVENTORY.map(item => item.key));
    assert.deepEqual([...discovered].filter(key => !classified.has(key)).sort(), []);
  });

  test('application source reads environment only through typed config', () => {
    const violations = walk(path.join(tsRoot, 'src'), file => file.endsWith('.ts'))
      .filter(file => path.basename(file) !== 'config.ts')
      .filter(file => readFileSync(file, 'utf8').includes('process.env'))
      .map(file => path.relative(tsRoot, file));
    assert.deepEqual(violations, []);
  });

  test('every Python test has a retained or TypeScript target', () => {
    const coverage: Record<string, string[]> = {
      'test_admin.py': ['test/domain/admin.test.ts', 'test/routes/admin.test.ts'],
      'test_app.py': ['test/health-parity.test.ts', 'test/routes/webhooks.test.ts', 'test/routes/websocket.test.ts'],
      'test_bankr_identity.py': ['test/integrations/bankr.test.ts', 'test/routes/bankr.test.ts'],
      'test_bots_computer_art.py': ['test/media/bots-computer-art.test.ts'],
      'test_collection_suggestions.py': ['test/routes/collections.test.ts'],
      'test_deposit_allocator.py': ['test/integrations/deposit-allocator.test.ts'],
      'test_device_sync.py': ['test/routes/account-sync.test.ts'],
      'test_economy.py': ['test/domain/economy.test.ts', 'test/routes/economy.test.ts'],
      'test_extra_companions.py': ['test/domain/extra-companions.test.ts'],
      'test_github_app.py': ['test/integrations/github-app.test.ts'],
      'test_hood_turtle_art.py': ['test/media/hood-turtle-art.test.ts'],
      'test_imported_gallery.py': ['test/routes/readonly.test.ts'],
      'test_indexer.py': ['test/domain/indexer.test.ts', 'test/workers.test.ts'],
      'test_market_quote.py': ['test/domain/market-quote.test.ts'],
      'test_nft_uri.py': ['test/routes/readonly.test.ts'],
      'test_nub_art.py': ['test/domain/extra-companions.test.ts'],
      'test_publish_web.py': ['../server/test_publish_web.py'],
      'test_robot_care.py': ['test/domain/robot-care.test.ts', 'test/routes/robot-care.test.ts'],
      'test_robot_companion.py': ['test/domain/robots-verifier.test.ts', 'test/media/robot-companion-art.test.ts'],
      'test_robot_gallery.py': ['test/routes/readonly.test.ts'],
      'test_telegram_interactive.py': ['test/domain/telegram-interactive.test.ts'],
      'test_telegram_media.py': ['test/domain/telegram-media.test.ts', 'test/routes/telegram-media.test.ts'],
      'test_telegram_moderation.py': ['test/domain/telegram-moderation.test.ts', 'test/routes/telegram-moderation.test.ts'],
      'test_turtle_connect.py': ['test/routes/wallet-link.test.ts'],
      'test_wallet_migration.py': ['test/domain/wallet-migration.test.ts'],
    };
    const pythonTests = readdirSync(pythonRoot).filter(file => /^test_.*\.py$/.test(file)).sort();
    assert.deepEqual(Object.keys(coverage).sort(), pythonTests);
    for (const [pythonTest, targets] of Object.entries(coverage)) {
      for (const target of targets) {
        assert.ok(statSync(path.resolve(tsRoot, target)).isFile(), `${pythonTest} target missing: ${target}`);
      }
    }
  });

  test('WebSocket input and output protocol remains inventoried', () => {
    const inputs = [
      'profile', 'party-join', 'party-leave', 'party-action', 'friend-request', 'friend-answer', 'friend-remove',
      'visit-request', 'visit-answer', 'visit-end', 'visit-action', 'battle-request', 'battle-answer', 'battle-action', 'battle-end',
    ];
    const outputs = [
      'state', 'notice', 'error', 'party-state', 'party-action', 'visit-request', 'visit-start', 'visit-profile', 'visit-action',
      'visit-ended', 'visit-request-ended', 'battle-request', 'battle-start', 'battle-action', 'battle-ended', 'battle-request-ended',
    ];
    const pythonSource = readFileSync(path.join(pythonRoot, 'app.py'), 'utf8');
    const realtimeSource = [
      readFileSync(path.join(tsRoot, 'src/domain/realtime.ts'), 'utf8'),
      readFileSync(path.join(tsRoot, 'src/routes/websocket.ts'), 'utf8'),
    ].join('\n');
    for (const type of inputs) {
      assert.match(pythonSource, new RegExp(`typ\\s*==\\s*['"]${type}['"]`), `Python input missing: ${type}`);
      assert.match(realtimeSource, new RegExp(`type\\s*===\\s*['"]${type}['"]`), `TypeScript input missing: ${type}`);
    }
    for (const type of outputs) {
      assert.match(pythonSource, new RegExp(`type\\s*=\\s*['"]${type}['"]`), `Python output missing: ${type}`);
      assert.match(realtimeSource, new RegExp(`type:\\s*['"]${type}['"]`), `TypeScript output missing: ${type}`);
    }
  });
});
