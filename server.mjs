import { createServer } from 'node:http';
import { createKnowledgeService } from './knowledge.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import { atomicWrite } from './atomic-write.mjs';
import { NoteError } from './note-files.mjs';
import { exportNote, exportNotes, imageLimit, loadImage, loadNote, noteLimit,
  notePath, saveImage, saveNote } from './note-storage.mjs';
import { atlasYears } from './atlas-sources.mjs';
import { experienceError } from './public/experience.mjs';

const dataDirectory = new URL('./data/', import.meta.url);
const dataFile = new URL('chronicle.json', dataDirectory);
const assets = new Map([
  ['/knowledge', ['knowledge.html', 'text/html']],
  ['/knowledge.mjs', ['knowledge.mjs', 'text/javascript']],
  ['/knowledge.css', ['knowledge.css', 'text/css']],
  ['/tag-manager.mjs', ['tag-manager.mjs', 'text/javascript']],
  ['/work-knowledge.mjs', ['work-knowledge.mjs', 'text/javascript']],
  ['/', ['index.html', 'text/html']],
  ['/styles.css', ['styles.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/notes.mjs', ['notes.mjs', 'text/javascript']],
  ['/note-dialog.mjs', ['note-dialog.mjs', 'text/javascript']],
  ['/batch-notes.mjs', ['batch-notes.mjs', 'text/javascript']],
  ['/notes.css', ['notes.css', 'text/css']],
  ['/chronology.mjs', ['chronology.mjs', 'text/javascript']],
  ['/experience.mjs', ['experience.mjs', 'text/javascript']],
  ['/atlas', ['atlas/index.html', 'text/html']],
  ['/atlas/atlas.mjs', ['atlas/atlas.mjs', 'text/javascript']],
  ['/atlas/years.mjs', ['atlas/years.mjs', 'text/javascript']],
  ['/atlas/place-api.mjs', ['atlas/place-api.mjs', 'text/javascript']],
  ['/atlas/event-data.mjs', ['atlas/event-data.mjs', 'text/javascript']],
  ['/atlas/events.mjs', ['atlas/events.mjs', 'text/javascript']],
  ['/atlas/events.json', ['atlas/events.json', 'application/json']],
  ['/atlas/events-wikidata.json', ['atlas/events-wikidata.json', 'application/json']],
  ['/atlas/events-noaa.json', ['atlas/events-noaa.json', 'application/json']],
  ['/atlas/events-milestones.json', ['atlas/events-milestones.json', 'application/json']],
  ['/atlas/events-regional.json', ['atlas/events-regional.json', 'application/json']],
  ['/atlas/places.mjs', ['atlas/places.mjs', 'text/javascript']],
  ['/atlas/data.mjs', ['atlas/data.mjs', 'text/javascript']],
  ['/atlas/comparison.mjs', ['atlas/comparison.mjs', 'text/javascript']],
  ['/atlas/data/historical-basemaps-LICENSE.txt', ['../atlas-data/historical-basemaps-LICENSE.txt', 'text/plain']],
  ['/atlas/geography.mjs', ['atlas/geography.mjs', 'text/javascript']],
  ['/atlas/northern-song-places.json', ['atlas/northern-song-places.json', 'application/json']],
  ['/atlas/atlas.css', ['atlas/atlas.css', 'text/css']],
]);
for (const name of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css']) {
  assets.set(`/atlas/vendor/${name}`, [`../node_modules/maplibre-gl/dist/${name}`,
    name.endsWith('.css') ? 'text/css' : 'text/javascript']);
}
for (const name of ['manifest.json', 'chronology.json', 'land.geojson', 'lakes.geojson', 'rivers.geojson', 'geography-50.json', 'geography-10.json', 'mountains.json', 'places.json', 'comparison.json', 'comparison--2000.geojson',
  'comparison--500.geojson', 'comparison-1200.geojson', ...atlasYears.map(year => `year-${year}.geojson`)]) {
  assets.set(`/atlas/data/${name}`, [`../atlas-data/${name}`, 'application/json']);
}
let pendingWrite = Promise.resolve();

function queueWrite(action) {
  const result = pendingWrite.then(action);
  pendingWrite = result.catch(() => {});
  return result;
}

async function readWorks() {
  const saved = await readFile(dataFile, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  return saved === null ? JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8')) :
    JSON.parse(saved).works;
}

async function writeWorks(works) {
  await mkdir(dataDirectory, { recursive: true });
  await atomicWrite(dataFile, JSON.stringify({ schemaVersion: 1, works }, null, 2));
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  // Leaving early lets the HTTP handler send a useful error before the socket closes.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new NoteError(413, '上传内容超过大小限制');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new NoteError(415, '需要 JSON 格式');
  }
  const body = await readBody(request, limit);
  try { return JSON.parse(body); } catch {
    throw new NoteError(400, 'JSON 格式无效');
  }
}

function validWork(work) {
  return work && typeof work.id === 'string' && typeof work.title === 'string' &&
    work.id.length > 0 && work.title.trim().length > 0 &&
    ['游戏', '小说', '电影', '电视剧', '其他'].includes(work.type) &&
    ['未开始', '进行中', '已完成', '已放弃'].includes(work.status) &&
    ['region', 'period', 'basis', 'rating', 'synopsis', 'notes', 'links'].every(key =>
      work[key] === undefined || typeof work[key] === 'string') &&
    (work.experience === undefined || !experienceError(work.experience)) &&
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
const allowedOrigins = new Set();
const knowledge = createKnowledgeService({ data: dataDirectory, readWorks, readJson, readBody, send, queueWrite });
await knowledge.reconcile().catch(error => console.error('知识库关联恢复失败', error.message));

async function handleNote(request, response, id, suffix, name) {
  const findWork = works => {
    const work = works.find(item => item.id === id);
    if (!work) throw new NoteError(404, '找不到作品');
    return work;
  };
  if (request.method === 'GET') {
    const work = findWork(await readWorks());
    if (!suffix) return send(response, 200, await loadNote(dataDirectory, work));
    if (suffix === 'assets' && name) {
      const { bytes, type } = await loadImage(dataDirectory, id, name);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, no-store' });
      return response.end(bytes);
    }
    if (!name && (suffix === 'export.md' || suffix === 'export.zip')) {
      const zip = suffix.endsWith('.zip');
      const bytes = await exportNote(dataDirectory, work, zip);
      response.writeHead(200, {
        'Content-Type': zip ? 'application/zip' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="note.${zip ? 'zip' : 'md'}"`,
        'Cache-Control': 'no-store',
      });
      return response.end(bytes);
    }
  }
  if (request.method === 'PUT' && !suffix) {
    const note = await readJson(request, noteLimit * 6 + 4096);
    if (typeof note?.content !== 'string' || (note.revision !== null &&
        (typeof note.revision !== 'string' || !/^[a-f0-9]{64}$/.test(note.revision)))) {
      throw new NoteError(400, '笔记内容或版本无效');
    }
    if (Buffer.byteLength(note.content) > noteLimit) throw new NoteError(413, '笔记不能超过 512 KB');
    const saved = await queueWrite(async () => {
      const works = await readWorks();
      const work = findWork(works);
      const path = notePath(id);
      await saveNote(dataDirectory, work, note.content, note.revision);
      if (work.notePath !== path) {
        work.notePath = path;
        await writeWorks(works);
      }
      return { ...await loadNote(dataDirectory, work), notePath: path };
    });
    return send(response, 200, saved);
  }
  if (request.method === 'POST' && suffix === 'assets' && !name) {
    const bytes = await readBody(request, imageLimit);
    const path = await queueWrite(async () => {
      findWork(await readWorks());
      return saveImage(dataDirectory, id, bytes, request.headers['content-type']);
    });
    return send(response, 201, { path });
  }
  if (request.method === 'DELETE' && !suffix) {
    await queueWrite(async () => {
      const works = await readWorks();
      const work = findWork(works);
      if (!work.notePath) throw new NoteError(404, '找不到已保存的作品笔记');
      delete work.notePath;
      await writeWorks(works);
      await knowledge.reconcile(works);
    });
    return send(response, 200, { deleted: true });
  }
  throw new NoteError(404, '找不到笔记接口');
}

createServer(async (request, response) => {
  try {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (request.method !== 'GET' && (request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && !allowedOrigins.has(request.headers.origin)))) {
      return send(response, 403, { error: '请从 Chronicle 本机页面保存' });
    }
    if (request.method === 'GET' && /^\/api\/atlas\/places\/(meta|detail|search|viewport)(?:\?|$)/.test(request.url)) {
      const { handlePlaceQuery } = await import('./atlas-place-index.mjs');
      const [code, result] = await handlePlaceQuery(new URL(request.url, 'http://localhost'));
      return send(response, code, result);
    }
    if (request.method === 'GET' && /^\/api\/atlas\/events(?:\?|$)/.test(request.url)) {
      const value = new URL(request.url, 'http://localhost').searchParams.get('year');
      const year = Number(value);
      if (!/^-?\d+$/.test(value ?? '') || !Number.isInteger(year) || year < -3399 || year > 2024) {
        return send(response, 400, { error: '无效的事件时间轴年份' });
      }
      const { readCatalogueYear } = await import('./atlas-event-catalog.mjs');
      return send(response, 200, await readCatalogueYear(year));
    }
    const noteRoute = /^\/api\/works\/([a-zA-Z0-9_-]{1,100})\/note(?:\/(assets|export\.md|export\.zip)(?:\/([a-zA-Z0-9.-]+))?)?$/.exec(request.url);
    if (noteRoute) return await handleNote(request, response, ...noteRoute.slice(1));
    if (request.url === '/api/notes/export.zip' && request.method === 'POST') {
      const { ids } = (await readJson(request, 2_000_000)) ?? {};
      if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string') ||
          new Set(ids).size !== ids.length) {
        throw new NoteError(400, '请选择要导出的作品');
      }
      const byId = new Map((await readWorks()).map(work => [work.id, work]));
      const works = ids.map(id => byId.get(id));
      if (works.some(work => !work?.notePath)) {
        throw new NoteError(409, '部分作品的笔记已不可用，请刷新作品库后重试');
      }
      const zip = await exportNotes(dataDirectory, works);
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="chronicle-notes.zip"',
        'Cache-Control': 'no-store',
      });
      return response.end(zip);
    }
    if (/^\/api\/knowledge(?:[/?]|$)/.test(request.url)) {
      return await knowledge.handle(request, response, new URL(request.url, 'http://localhost'));
    }
    if (request.url === '/api/works' && request.method === 'GET') {
      return send(response, 200, await readWorks());
    }
    if (request.url === '/api/works' && request.method === 'PUT') {
      const works = await readJson(request, 2_000_000);
      if (!Array.isArray(works) || !works.every(validWork) ||
          new Set(works.map(work => work.id)).size !== works.length) {
        return send(response, 400, { error: '作品字段、年代或 ID 无效' });
      }
      await queueWrite(async () => {
        const notes = new Map((await readWorks()).map(work => [work.id, work.notePath]));
        await writeWorks(works.map(work => ({ ...work, notePath: notes.get(work.id) })));
        if ([...notes.keys()].some(id => !works.some(work => work.id === id))) await knowledge.reconcile();
      });
      return send(response, 200, { saved: true });
    }
    const shard = /^\/atlas\/data\/(geometry-\d{1,4}\.json)$/.exec(request.url);
    const asset = request.method === 'GET' && (assets.get(request.url.split('?')[0]) ??
      (shard && [`../atlas-data/${shard[1]}`, 'application/json']));
    if (!asset) return send(response, 404, { error: '页面不存在' });
    const url = new URL(`./public/${asset[0]}`, import.meta.url);
    const geography = /\/geography-(?:10|50)\.json$/.test(url.pathname);
    const acceptsGzip = request.headers['accept-encoding']?.split(',').some(encoding => {
      const [name, quality] = encoding.trim().split(/\s*;\s*/);
      return name.toLowerCase() === 'gzip' && (quality === undefined || Number(quality.slice(2)) > 0);
    });
    const compressed = geography && acceptsGzip
      ? await readFile(new URL(`${url.href}.gz`)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      })
      : null;
    const content = compressed ?? await readFile(url).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      throw new NoteError(404, '资源尚未准备');
    });
    response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`,
      ...(geography ? { Vary: 'Accept-Encoding' } : {}),
      ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    });
    response.end(content);
  } catch (error) {
    if (error instanceof NoteError) return send(response, error.status, { error: error.message });
    console.error(error);
    send(response, 500, { error: '无法读取或保存本地资料库' });
  }
}).listen(port, '127.0.0.1', function () {
  allowedOrigins.add(`http://127.0.0.1:${this.address().port}`);
  allowedOrigins.add(`http://localhost:${this.address().port}`);
  console.log(`Chronicle · http://127.0.0.1:${this.address().port}`);
});
