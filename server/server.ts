// @ts-nocheck -- Node's built-in SQLite is available in Node 22; this package has no Node typings.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(project, 'dist');
const database = path.resolve(process.env.CRAWL_DB_PATH || path.join(project, '..', 'data', 'crawler_database.sqlite'));
const topicsFile = path.resolve(process.env.TOPIC_COVERAGE_PATH || path.join(project, '..', 'data', 'topic_coverage.json'));
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

async function analyze() {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const counts = db.prepare(`SELECT count(*) AS discovered,
      sum(u.in_scope) AS inScope,
      sum(u.in_scope=1 AND q.status='completed') AS completed,
      sum(u.in_scope=1 AND q.status='pending') AS pending,
      sum(u.in_scope=1 AND q.status='processing') AS processing,
      sum(u.in_scope=1 AND q.status='failed') AS failed,
      sum(u.in_scope=1 AND q.status='skipped') AS skipped,
      sum(u.in_scope=1 AND q.status='blocked') AS blocked
      FROM urls u JOIN crawl_queue q ON q.url_id=u.id`).get();
    const pages = db.prepare('SELECT count(*) AS total FROM pages WHERE is_page=1 AND http_status BETWEEN 200 AND 299 AND historical_out_of_policy=0').get().total;
    const sequences = db.prepare("SELECT count(*) AS total, sum(status='completed') AS completed FROM pagination_sequences").get();
    const run = db.prepare('SELECT status,started_at,ended_at FROM crawl_runs ORDER BY started_at DESC LIMIT 1').get() || null;
    const lastRequest = db.prepare('SELECT requested_at,http_status,error FROM http_requests ORDER BY id DESC LIMIT 1').get() || null;
    const history = db.prepare("SELECT substr(fetched_at,1,10) AS day,count(*) AS pages FROM pages WHERE is_page=1 AND http_status BETWEEN 200 AND 299 AND historical_out_of_policy=0 GROUP BY day ORDER BY day").all();
    const failures = db.prepare("SELECT q.reason AS reason,count(*) AS count FROM crawl_queue q JOIN urls u ON u.id=q.url_id WHERE u.in_scope=1 AND q.status='failed' GROUP BY q.reason ORDER BY count DESC LIMIT 6").all();
    const exclusions = db.prepare("SELECT q.reason AS reason,count(*) AS count FROM crawl_queue q JOIN urls u ON u.id=q.url_id WHERE u.in_scope=1 AND q.status='skipped' GROUP BY q.reason ORDER BY count DESC LIMIT 6").all();
    let topics = null;
    let topicsUpdatedAt = null;
    try { topics = JSON.parse(await readFile(topicsFile, 'utf8')); topicsUpdatedAt = (await stat(topicsFile)).mtime.toISOString(); } catch { /* Optional checkpoint */ }
    const statuses = Object.fromEntries(['completed','pending','processing','failed','skipped','blocked'].map(key => [key, counts[key] || 0]));
    const lastRequestAt = lastRequest?.requested_at || null;
    const recentRequest = lastRequestAt && Date.now() - new Date(lastRequestAt).getTime() < 5 * 60_000;
    return { schemaVersion:1, analyzedAt:new Date().toISOString(), source:'SQLite read-only', databaseUpdatedAt:(await stat(database)).mtime.toISOString(),
      discovered:counts.discovered, inScope:counts.inScope, successfulPages:pages, statuses,
      coveragePercent:counts.inScope ? 100 * statuses.completed / counts.inScope : 0,
      pagination:{total:sequences.total,completed:sequences.completed || 0},
      run:{status:run?.status || 'unknown',startedAt:run?.started_at || null,lastRequestAt,requestRecentlyObserved:Boolean(recentRequest)},
      topics,topicsUpdatedAt,history,failures,exclusions,
      complete:statuses.pending === 0 && statuses.processing === 0 && statuses.failed === 0 && sequences.total === (sequences.completed || 0) && (topics?.topics_pending || 0) === 0 };
  } finally { db.close(); }
}

function json(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

if (process.argv.includes('--export')) {
  const output = path.join(project,'public','data','crawl-review.json');
  await writeFile(output, JSON.stringify(await analyze(),null,2)+'\n');
  console.log(`Wrote aggregate review snapshot: ${output}`);
} else {
  let current = null;
  let refreshing = null;
  async function refresh() {
    if (!refreshing) refreshing = analyze().then(value => (current = value)).finally(() => { refreshing = null; });
    return refreshing;
  }
  await refresh();
  http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (url.pathname === '/api/crawl-review' && req.method === 'GET') return json(res,200,current);
      if (url.pathname === '/api/crawl-review/refresh' && req.method === 'POST') return json(res,200,await refresh());
      if (url.pathname.startsWith('/api/')) return json(res,404,{error:'Unknown API route'});
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed'});
      const name = decodeURIComponent(url.pathname);
      let file = path.resolve(dist,'.'+name);
      if (file !== dist && !file.startsWith(dist+path.sep)) return json(res,403,{error:'Forbidden'});
      if ((await stat(file)).isDirectory()) file = path.join(file,'index.html');
      const bytes = await readFile(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (error?.code === 'ENOENT') return json(res,404,{error:'Not found'});
      console.error(error);
      json(res,500,{error:'Could not refresh analysis from SQLite'});
    }
  }).listen(port,'127.0.0.1',()=>console.log(`Crawl review: http://127.0.0.1:${port}/crawl-review.html`));
}
