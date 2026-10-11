import http from 'node:http';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './lib/store.mjs';
import { createGitHubClient, normalizeRepoName } from './lib/github.mjs';
import { AppError, publicError } from './lib/errors.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REFRESH_MINUTES = 60;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function queryValues(url, allowed) {
  const output = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(output, key)) throw new AppError('INVALID_QUERY', '查询参数重复或无效。');
    output[key] = value;
  }
  return output;
}

async function jsonBody(request) {
  if ((request.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError('INVALID_BODY', '请求需使用 application/json。', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new AppError('BODY_TOO_LARGE', '请求内容过大。', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_BODY', 'JSON 请求内容无效。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('INVALID_BODY', '请求内容必须为 JSON 对象。');
  return body;
}

function checkMutationOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('FORBIDDEN_ORIGIN', '已拒绝来自其他网站的写入请求。', 403);
  const expected = `http://127.0.0.1:${request.socket.localPort}`;
  const origin = request.headers.origin;
  if (origin && origin !== expected && origin !== `http://localhost:${request.socket.localPort}`) throw new AppError('FORBIDDEN_ORIGIN', '已拒绝来自其他网站的写入请求。', 403);
}

async function serveStatic(request, response, publicDir) {
  let pathname;
  try { pathname = decodeURIComponent(request.url.split('?')[0]); } catch { throw new AppError('INVALID_PATH', '无效文件路径。'); }
  if (pathname.includes('\u0000') || pathname.includes('\\') || pathname.split('/').some((part) => part === '..' || part.startsWith('.'))) throw new AppError('FORBIDDEN_PATH', '此文件路径不可访问。', 403);
  const target = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
  const within = relative(publicDir, target);
  if (within.startsWith(`..${sep}`) || within === '..' || resolve(target) === resolve(publicDir)) throw new AppError('FORBIDDEN_PATH', '此文件路径不可访问。', 403);
  let handle;
  try {
    const realRoot = await fs.realpath(publicDir);
    const realTarget = await fs.realpath(target);
    const realRelative = relative(realRoot, realTarget);
    if (realRelative.startsWith(`..${sep}`) || realRelative === '..') throw new AppError('FORBIDDEN_PATH', '此文件路径不可访问。', 403);
    let prefix = '';
    for (const part of within.split(sep)) {
      // Reject every symlink, even a symlink that currently points back inside public.
      prefix = join(prefix, part);
      if ((await fs.lstat(join(publicDir, prefix))).isSymbolicLink()) throw new AppError('FORBIDDEN_PATH', '此文件路径不可访问。', 403);
    }
    handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new AppError('NOT_FOUND', '文件不存在。', 404);
    response.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream', 'Content-Length': info.size,
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    if (request.method === 'HEAD') response.end();
    else response.end(await handle.readFile());
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new AppError('NOT_FOUND', '文件不存在。', 404);
    if (error.code === 'ELOOP') throw new AppError('FORBIDDEN_PATH', '此文件路径不可访问。', 403);
    throw error;
  } finally { if (handle) await handle.close(); }
}

export async function createApplication({ dataDir = join(ROOT, 'data'), publicDir = join(ROOT, 'public'), token = process.env.GITHUB_TOKEN || '', fetchImpl = fetch, now = Date.now,
  intervalMs = REFRESH_MINUTES * 60000, timeoutMs = 12000 } = {}) {
  const store = await openStore({ dataDir, now });
  const github = createGitHubClient({ store, token, fetchImpl, now, timeoutMs });
  let activeRefresh;
  function refresh() {
    if (activeRefresh) return activeRefresh;
    const operation = (async () => {
      const successes = [];
      const errors = [];
      const monitored = store.refreshTargets();
      let cursor = 0;
      async function worker() {
        while (cursor < monitored.length) {
          const repo = monitored[cursor++];
          try {
            const result = await github.repository(repo.fullName, { fresh: true });
            successes.push({ item: result.item, requestedFullName: repo.fullName, generation: repo.generation, fetchedAt: result.meta.fetchedAt });
          }
          catch (error) { errors.push({ repo: repo.fullName, generation: repo.generation, ...publicError(error) }); }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, monitored.length) }, () => worker()));
      const lastRefreshAt = await store.recordRefresh(successes, errors);
      return { items: store.monitors(), errors: store.refreshErrors(), lastRefreshAt };
    })();
    activeRefresh = operation;
    operation.finally(() => { activeRefresh = null; }).catch(() => {});
    return operation;
  }
  async function api(request, response, url) {
    const method = request.method;
    const routes = {
      '/api/status': ['GET'], '/api/rankings': ['GET'], '/api/monitors': ['GET', 'POST', 'DELETE'], '/api/refresh': ['POST'],
      '/api/repo': ['GET'], '/api/revenues': ['GET', 'POST', 'DELETE'], '/api/export': ['GET'],
    };
    const allowed = routes[url.pathname];
    if (!allowed) throw new AppError('NOT_FOUND', 'API 路径不存在。', 404);
    if (!allowed.includes(method)) throw new AppError('METHOD_NOT_ALLOWED', '此接口不支持该请求方法。', 405);
    if (method !== 'GET') checkMutationOrigin(request);
    if (url.pathname === '/api/status') {
      queryValues(url, []);
      return sendJson(response, 200, { tokenConfigured: Boolean(token), refreshMinutes: REFRESH_MINUTES, monitorCount: store.monitors().length, lastRefreshAt: store.lastRefreshAt(), now: new Date(now()).toISOString() });
    }
    if (url.pathname === '/api/rankings') return sendJson(response, 200, await github.rankings(queryValues(url, ['language', 'topic', 'q', 'new', 'fresh'])));
    if (url.pathname === '/api/repo') {
      const { name } = queryValues(url, ['name']);
      const canonical = normalizeRepoName(name);
      const detail = await github.repository(canonical);
      return sendJson(response, 200, { ...detail, growth: store.growth(detail.item.fullName), history: store.history(detail.item.fullName) });
    }
    if (url.pathname === '/api/export') {
      queryValues(url, []);
      return sendJson(response, 200, store.exportData());
    }
    if (url.pathname === '/api/refresh') {
      queryValues(url, []);
      await jsonBody(request);
      return sendJson(response, 200, await refresh());
    }
    if (url.pathname === '/api/monitors') {
      const params = queryValues(url, method === 'DELETE' ? ['repo'] : []);
      if (method === 'GET') return sendJson(response, 200, { items: store.monitors(), meta: { lastRefreshAt: store.lastRefreshAt(), refreshMinutes: REFRESH_MINUTES, errors: store.refreshErrors() } });
      if (method === 'DELETE') return sendJson(response, 200, await store.removeMonitor(params.repo));
      const body = await jsonBody(request);
      const name = normalizeRepoName(body.fullName);
      if (store.monitors().some((item) => item.fullName.toLowerCase() === name.toLowerCase())) throw new AppError('MONITOR_EXISTS', '该仓库已在监控列表中。', 409);
      if (store.monitors().length >= 30) throw new AppError('MONITOR_LIMIT', '最多监控 30 个仓库，请先移除部分项目。', 409);
      const result = await github.repository(name, { fresh: true });
      return sendJson(response, 201, { item: await store.addMonitor(result.item) });
    }
    if (url.pathname === '/api/revenues') {
      const params = queryValues(url, method === 'DELETE' ? ['id'] : []);
      if (method === 'GET') return sendJson(response, 200, { items: store.revenues() });
      if (method === 'DELETE') return sendJson(response, 200, await store.removeRevenue(params.id));
      return sendJson(response, 201, { item: await store.addRevenue(await jsonBody(request)) });
    }
  }
  const server = http.createServer((request, response) => {
    (async () => {
      if (!['127.0.0.1', `127.0.0.1:${request.socket.localPort}`, 'localhost', `localhost:${request.socket.localPort}`].includes(request.headers.host)) {
        throw new AppError('FORBIDDEN_HOST', '请通过本机回环地址访问此服务。', 403);
      }
      const url = new URL(request.url, `http://127.0.0.1:${request.socket.localPort}`);
      if (url.pathname.startsWith('/api/')) await api(request, response, url);
      else if (request.method === 'GET' || request.method === 'HEAD') await serveStatic(request, response, resolve(publicDir));
      else throw new AppError('METHOD_NOT_ALLOWED', '仅支持读取静态文件。', 405);
    })().catch((error) => {
      if (!response.headersSent) sendJson(response, error instanceof AppError ? error.status : 500, { error: publicError(error) });
      else response.destroy();
    });
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 15000;
  const timer = intervalMs > 0 ? setInterval(() => {
    if (store.monitors().length) refresh().catch(() => {});
  }, intervalMs) : null;
  timer?.unref();
  async function close() {
    if (timer) clearInterval(timer);
    if (activeRefresh) await activeRefresh.catch(() => {});
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { server, close, refresh };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const value = process.env.PORT || '4320';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    console.error('PORT 必须是 1–65535 的整数。');
    process.exitCode = 1;
  } else {
    try {
      const app = await createApplication();
      app.server.on('error', () => { console.error('本地服务无法启动，请检查端口是否已被使用。'); process.exitCode = 1; });
      app.server.listen(Number(value), '127.0.0.1', () => console.log(`StarScope: http://127.0.0.1:${value}`));
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
    } catch (error) {
      console.error(publicError(error).message);
      process.exitCode = 1;
    }
  }
}
