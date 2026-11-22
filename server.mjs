import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const dataDirectory = new URL('./data/', import.meta.url);
const dataFile = new URL('chronicle.json', dataDirectory);
const temporaryFile = new URL('chronicle.tmp', dataDirectory);
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/chronology.mjs', ['chronology.mjs', 'text/javascript']],
]);
let pendingWrite = Promise.resolve();

function validWork(work) {
  return work && typeof work.id === 'string' && typeof work.title === 'string' &&
    work.id.length > 0 && work.title.trim().length > 0 &&
    ['游戏', '小说', '电影', '电视剧', '其他'].includes(work.type) &&
    ['未开始', '进行中', '已完成', '已放弃'].includes(work.status) &&
    ['region', 'period', 'basis', 'rating', 'notes', 'links'].every(key =>
      work[key] === undefined || typeof work[key] === 'string') &&
    Array.isArray(work.segments) && work.segments.every(segment =>
      segment && ['point', 'range', 'window'].includes(segment.kind) &&
      ['确定', '推测', '约略'].includes(segment.confidence) &&
      (segment.source === undefined || typeof segment.source === 'string') &&
      Number.isInteger(segment.start) && segment.start >= -99999 && segment.start <= 100000 &&
      (segment.kind === 'point' ||
        (Number.isInteger(segment.end) && segment.end > segment.start && segment.end <= 100000)));
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  try {
    if (request.url === '/api/works' && request.method === 'GET') {
      const saved = await readFile(dataFile, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      return send(response, 200, saved ? JSON.parse(saved).works :
        JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8')));
    }
    if (request.url === '/api/works' && request.method === 'PUT') {
      if (!request.headers['content-type']?.startsWith('application/json') ||
          (request.headers.origin && request.headers.origin !== `http://127.0.0.1:${port}` &&
           request.headers.origin !== `http://localhost:${port}`)) {
        return send(response, 403, { error: '请从 Chronicle 本机页面保存' });
      }
      let body = '';
      request.setEncoding('utf8');
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) return send(response, 413, { error: '资料库太大' });
      }
      let works;
      try { works = JSON.parse(body); } catch {
        return send(response, 400, { error: 'JSON 格式无效' });
      }
      if (!Array.isArray(works) || !works.every(validWork) ||
          new Set(works.map(work => work.id)).size !== works.length) {
        return send(response, 400, { error: '作品字段、年代或 ID 无效' });
      }
      const write = pendingWrite.then(async () => {
        await mkdir(dataDirectory, { recursive: true });
        await writeFile(temporaryFile, JSON.stringify({ schemaVersion: 1, works }, null, 2));
        await rename(temporaryFile, dataFile);
      });
      pendingWrite = write.catch(() => {});
      await write;
      return send(response, 200, { saved: true });
    }
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) return send(response, 404, { error: '页面不存在' });
    const content = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
    response.end(content);
  } catch (error) {
    console.error(error);
    send(response, 500, { error: '无法读取或保存本地资料库' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Chronicle · http://127.0.0.1:${port}`));
