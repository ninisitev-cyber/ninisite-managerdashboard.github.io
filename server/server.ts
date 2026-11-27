// @ts-nocheck -- Node's built-in SQLite is available in Node 22; this package has no Node typings.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { constants as fsConstants } from 'node:fs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(project, '..');
const dist = path.join(project, 'dist');
const database = path.resolve(process.env.CRAWL_DB_PATH || path.join(repoRoot, 'data', 'crawler_database.sqlite'));
const moderationDb = path.resolve(process.env.MODERATION_DB_PATH || path.join(repoRoot, 'data', 'content_moderation.sqlite'));
const topicsFile = path.resolve(process.env.TOPIC_COVERAGE_PATH || path.join(repoRoot, 'data', 'topic_coverage.json'));
const lexicon = path.resolve(process.env.BAD_KEYWORDS_PATH || path.join(repoRoot, 'config', 'bad_content_keywords.json'));
const scanExport = path.join(project, 'public', 'data', 'bad-content-review.json');
const pythonBin = process.env.CRAWLER_PYTHON || path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function openDb(readOnly = true) {
  // Prefer URI read-only so a live crawler WAL writer does not block the dashboard forever.
  const uri = pathToFileURL(database).href + (readOnly ? '?mode=ro' : '');
  try {
    return new DatabaseSync(readOnly ? uri : database, { readOnly });
  } catch {
    return new DatabaseSync(database, { readOnly });
  }
}

function runPythonJson(args, timeoutMs = 120_000) {
  return new Promise(async (resolve, reject) => {
    try { await access(pythonBin, fsConstants.F_OK); } catch {
      return reject(new Error(`Python not found at ${pythonBin}`));
    }
    const child = spawn(pythonBin, args, { cwd: repoRoot, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Python helper timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || stdout || `exit ${code}`));
      try { resolve(JSON.parse(stdout)); }
      catch (error) { reject(error); }
    });
  });
}

async function loadCachedCrawl() {
  try {
    return JSON.parse(await readFile(path.join(project, 'public', 'data', 'crawl-review.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function analyzeCrawl() {
  const fresh = await runPythonJson([
    path.join(repoRoot, 'scripts', 'dashboard_crawl_stats.py'),
    database,
    topicsFile,
  ], 45_000);
  try {
    await writeFile(path.join(project, 'public', 'data', 'crawl-review.json'), JSON.stringify(fresh, null, 2) + '\n');
  } catch { /* cache write is best-effort */ }
  return fresh;
}

function readScanSummary() {
  try {
    const db = new DatabaseSync(moderationDb, { readOnly: true });
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_flag_runs'").get();
      if (!exists) return { run: null, flags: [], by_category: {}, by_severity: {} };
      const run = db.prepare('SELECT * FROM content_flag_runs ORDER BY started_at DESC LIMIT 1').get();
      if (!run) return { run: null, flags: [], by_category: {}, by_severity: {} };
      const flags = db.prepare(`SELECT f.topic_id,f.page_number,f.category,f.term,f.severity,f.policy_hint,f.title,f.snippet,f.flagged_at,COALESCE(u.url,'') AS url
        FROM content_flags f LEFT JOIN flag_urls u ON u.url_id=f.url_id
        WHERE f.run_id=?
        ORDER BY CASE f.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.id DESC
        LIMIT 80`).all(run.id);
      const byCategory = Object.fromEntries(db.prepare('SELECT category, COUNT(*) AS n FROM content_flags WHERE run_id=? GROUP BY category ORDER BY n DESC').all(run.id).map(r => [r.category, r.n]));
      const bySeverity = Object.fromEntries(db.prepare('SELECT severity, COUNT(*) AS n FROM content_flags WHERE run_id=? GROUP BY severity').all(run.id).map(r => [r.severity, r.n]));
      let stats = {};
      try { stats = JSON.parse(run.statistics || '{}'); } catch { stats = {}; }
      return {
        run: {
          id: run.id,
          started_at: run.started_at,
          finished_at: run.finished_at,
          page_depth: run.page_depth,
          lexicon_version: run.lexicon_version,
          statistics: stats,
        },
        flags,
        by_category: byCategory,
        by_severity: bySeverity,
      };
    } finally { db.close(); }
  } catch {
    return { run: null, flags: [], by_category: {}, by_severity: {} };
  }
}

async function lexiconInfo() {
  const raw = JSON.parse(await readFile(lexicon, 'utf8'));
  const categories = Object.fromEntries(Object.entries(raw.categories || {}).map(([k, v]) => [k, {
    severity: v.severity,
    policy_hint: v.policy_hint,
    terms: (v.terms || []).length,
  }]));
  return { version: raw.version, purpose: raw.purpose, categories, path: lexicon };
}

function runPythonScan(pages) {
  return new Promise(async (resolve, reject) => {
    try { await access(pythonBin, fsConstants.X_OK); } catch {
      try { await access(pythonBin, fsConstants.F_OK); } catch {
        return reject(new Error(`Python not found at ${pythonBin}`));
      }
    }
    const args = [
      path.join(repoRoot, 'scripts', 'scan_bad_content.py'),
      '--database', database,
      '--results-db', moderationDb,
      '--lexicon', lexicon,
      '--pages', String(pages),
      '--export', scanExport,
    ];
    const child = spawn(pythonBin, args, { cwd: repoRoot, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || stdout || `scan exited ${code}`));
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ ok: true, stdout, summary: readScanSummary() }); }
    });
  });
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

if (process.argv.includes('--export')) {
  const crawl = await analyzeCrawl();
  await writeFile(path.join(project, 'public', 'data', 'crawl-review.json'), JSON.stringify(crawl, null, 2) + '\n');
  const scan = readScanSummary();
  await writeFile(scanExport, JSON.stringify(scan, null, 2) + '\n');
  console.log('Wrote crawl-review.json and bad-content-review.json');
} else {
  let current = await loadCachedCrawl();
  let refreshing = null;
  let scanning = null;

  async function refresh() {
    if (!refreshing) {
      refreshing = analyzeCrawl()
        .then(value => (current = value))
        .catch(error => {
          console.error('analysis refresh failed:', error);
          if (!current) {
            current = {
              schemaVersion: 1,
              analyzedAt: new Date().toISOString(),
              source: 'SQLite unavailable',
              databaseUpdatedAt: null,
              discovered: 0,
              inScope: 0,
              successfulPages: 0,
              topicPages: 0,
              statuses: { completed: 0, pending: 0, processing: 0, failed: 0, skipped: 0, blocked: 0 },
              coveragePercent: 0,
              pagination: { total: 0, completed: 0 },
              run: { id: null, status: 'unavailable', startedAt: null, endedAt: null, notes: String(error), lastRequestAt: null, requestRecentlyObserved: false },
              adsSkipped: 0,
              topics: null,
              topicsUpdatedAt: null,
              history: [],
              failures: [],
              exclusions: [],
              complete: false,
              error: error instanceof Error ? error.message : String(error),
            };
          } else {
            current = { ...current, refreshError: error instanceof Error ? error.message : String(error) };
          }
          return current;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (url.pathname === '/api/crawl-review' && req.method === 'GET') {
        if (!current) void refresh();
        return json(res, 200, current || { status: 'warming' });
      }
      if (url.pathname === '/api/crawl-review/refresh' && req.method === 'POST') return json(res, 200, await refresh());

      if (url.pathname === '/api/control/status' && req.method === 'GET') {
        if (!current) void refresh();
        else if (!refreshing) void refresh();
        return json(res, 200, {
          crawl: current || { status: 'warming', source: 'cache miss' },
          scan: readScanSummary(),
          lexicon: await lexiconInfo(),
          autoAnalysisSeconds: 30,
          options: { pageDepths: [3, 10] },
        });
      }
      if (url.pathname === '/api/control/analysis/refresh' && req.method === 'POST') {
        const crawl = await refresh();
        return json(res, 200, { crawl, scan: readScanSummary(), refreshedAt: new Date().toISOString() });
      }
      if (url.pathname === '/api/control/scan/latest' && req.method === 'GET') {
        return json(res, 200, readScanSummary());
      }
      if (url.pathname === '/api/control/scan' && req.method === 'POST') {
        if (scanning) return json(res, 409, { error: 'Scan already running' });
        const body = await readBody(req);
        const pages = Number(body.pages || 3);
        if (![3, 10].includes(pages)) return json(res, 400, { error: 'pages must be 3 or 10' });
        scanning = runPythonScan(pages)
          .then(async result => {
            await refresh();
            return { scanRequest: result, summary: readScanSummary(), crawl: current };
          })
          .finally(() => { scanning = null; });
        return json(res, 200, await scanning);
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      const name = decodeURIComponent(url.pathname);
      let file = path.resolve(dist, '.' + name);
      if (file !== dist && !file.startsWith(dist + path.sep)) return json(res, 403, { error: 'Forbidden' });
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error?.code === 'ENOENT') return json(res, 404, { error: 'Not found' });
      console.error(error);
      json(res, 500, { error: error instanceof Error ? error.message : 'Server error' });
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`Control dashboard: http://127.0.0.1:${port}/control.html`);
    console.log(`Crawl review:      http://127.0.0.1:${port}/crawl-review.html`);
    // Start after listen so a blocked SQLite open cannot prevent binding the port.
    setImmediate(() => { void refresh(); });
  });
}
