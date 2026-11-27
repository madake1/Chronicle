import { projectSpacetime, saveAnnotations, validAnnotations, workAnnotations, worksVersion } from './spacetime.mjs';
import { createServer } from 'node:http';
import { createKnowledgeService } from './knowledge.mjs';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from './atomic-write.mjs';
import { NoteError } from './note-files.mjs';
import { exportNote, exportNotes, imageLimit, loadImage, loadNote, noteLimit,
  notePath, saveImage, saveNote } from './note-storage.mjs';
import { atlasYears } from './atlas-sources.mjs';
import { experienceError } from './public/experience.mjs';
import { asDirectory, configure, locateData, lockData, loopback } from './runtime-config.mjs';

const config = configure();
let paths;
try {
  paths = await locateData(config, config.initialize || config.mode === 'development' && !process.env.CHRONICLE_DATA_DIR);
} catch (error) {
  throw new Error('无法打开指定的资料目录。请核对配置或从备份恢复；全新安装需要显式初始化。', { cause: error });
}
const guard = await lockData(paths.identity);
const dataDirectory = asDirectory(paths.canonical);
const atlasDirectory = asDirectory(config.atlas);
const dataFile = new URL('chronicle.json', dataDirectory);
const modeFile = new URL('.chronicle-mode', dataDirectory);
const assets = new Map([
  ['/app-shell.mjs', ['app-shell.mjs', 'text/javascript']],
  ['/map-reference.mjs', ['map-reference.mjs', 'text/javascript']],
  ['/timeline-layout.mjs', ['timeline-layout.mjs', 'text/javascript']],
  ['/spacetime', ['spacetime.html', 'text/html']],
  ['/spacetime.mjs', ['spacetime.mjs', 'text/javascript']],
  ['/spacetime-query.mjs', ['spacetime-query.mjs', 'text/javascript']],
  ['/spacetime.css', ['spacetime.css', 'text/css']],
  ['/annotation-editor.mjs', ['annotation-editor.mjs', 'text/javascript']],
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

async function readWorksIndex() {
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  if (saved?.schemaVersion !== 1 || !Array.isArray(saved.works) ||
      !saved.works.every(validWork) || new Set(saved.works.map(work => work.id)).size !== saved.works.length) {
    throw new Error('作品索引格式无效');
  }
  return saved;
}

async function readWorks() {
  return (await readWorksIndex()).works;
}

let versionedWrites = false;

async function writeWorks(works, versioned = versionedWrites) {
  await atomicWrite(dataFile, JSON.stringify({ schemaVersion: 1, versionedWrites: versioned || undefined, works }, null, 2));
  versionedWrites = versioned;
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
    validAnnotations(work.segments);
}

function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

try {
  if (paths.newDirectory) {
    await mkdir(paths.canonical);
    const works = config.mode === 'demo' ? JSON.parse(await readFile(new URL('./fixtures.json', import.meta.url), 'utf8')) : [];
    await atomicWrite(modeFile, config.mode);
    await writeWorks(works);
  } else {
    const prior = await readFile(modeFile, 'utf8').catch(error => {
      if (error.code === 'ENOENT' && config.mode === 'formal') return 'formal';
      throw error;
    });
    if (prior.trim() !== config.mode) throw new Error('资料库运行模式不匹配');
  }
  versionedWrites = Boolean((await readWorksIndex()).versionedWrites);
} catch (error) {
  throw new Error('资料库无法验证。请核对运行模式和资料目录，并从备份恢复缺失或损坏的索引。', { cause: error });
}
const allowedOrigins = new Set();
const token = randomBytes(32).toString('hex');
let stopping = false;
let address;
const knowledge = createKnowledgeService({ data: dataDirectory, readWorks, readJson, readBody, send, queueWrite });
await knowledge.reconcile().catch(error => {
  throw new Error('知识库索引无法读取，请从同一份资料备份恢复。', { cause: error });
});

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

const server = createServer(async (request, response) => {
  try {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!allowedOrigins.has(`http://${request.headers.host}`)) return send(response, 403, { error: '仅允许本机访问' });
    if (request.url === '/_chronicle/instance' && paths.state && !request.headers.origin &&
        request.headers['sec-fetch-site'] !== 'cross-site') {
      const challenge = request.headers['x-chronicle-challenge'];
      if (request.method === 'GET' && /^[a-f0-9]{64}$/.test(challenge ?? '')) {
        const instance = { app: 'Chronicle', mode: config.mode, identity: paths.identity, pid: process.pid, address };
        const proof = createHmac('sha256', token).update(challenge + JSON.stringify(instance)).digest('hex');
        return send(response, 200, { instance, proof });
      }
      if (request.method === 'POST' && request.headers.authorization === `Bearer ${token}`) {
        send(response, 200, { stopping: true });
        return void stop();
      }
    }
    if (stopping) return send(response, 503, { error: 'Chronicle 正在停止' });
    if (request.method !== 'GET' && (request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin && !allowedOrigins.has(request.headers.origin)))) {
      return send(response, 403, { error: '请从 Chronicle 本机页面保存' });
    }
    if (request.method === 'GET' && /^\/api\/atlas\/places\/(meta|detail|search|viewport)(?:\?|$)/.test(request.url)) {
      const { handlePlaceQuery } = await import('./atlas-place-index.mjs');
      const [code, result] = await handlePlaceQuery(new URL(request.url, 'http://localhost'), atlasDirectory);
      return send(response, code, result);
    }
    if (request.method === 'GET' && /^\/api\/atlas\/events(?:\?|$)/.test(request.url)) {
      const value = new URL(request.url, 'http://localhost').searchParams.get('year');
      const year = Number(value);
      if (!/^-?\d+$/.test(value ?? '') || !Number.isInteger(year) || year < -3399 || year > 2024) {
        return send(response, 400, { error: '无效的事件时间轴年份' });
      }
      const { readCatalogueYear } = await import('./atlas-event-catalog.mjs');
      return send(response, 200, await readCatalogueYear(year, new URL('events-catalog/', atlasDirectory)));
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
    if (/^\/api\/spacetime(?:\?|$)/.test(request.url) && request.method === 'GET') {
      const layer = new URL(request.url, 'http://localhost').searchParams.get('layer');
      if (layer !== null && !['work', 'knowledge', 'both'].includes(layer)) {
        return send(response, 400, { error: '未知的个人时空图层' });
      }
      const [works, { notes, tags }] = await queueWrite(() => Promise.all([
        layer === 'knowledge' ? [] : readWorks(),
        layer === 'work' ? { notes: [], tags: [] } : knowledge.read(),
      ]));
      return send(response, 200, projectSpacetime(works, notes, tags));
    }
    if (['/api/works', '/api/works?annotations=1'].includes(request.url) && request.method === 'GET') {
      const works = await readWorks();
      response.setHeader('ETag', worksVersion(works));
      const result = request.url.endsWith('?annotations=1') ?
        works.map(work => ({ ...work, segments: workAnnotations(work) })) : works;
      return send(response, 200, result);
    }
    if (request.url === '/api/works' && request.method === 'PUT') {
      const works = await readJson(request, 2_000_000);
      if (!Array.isArray(works) || !works.every(validWork) ||
          new Set(works.map(work => work.id)).size !== works.length) {
        return send(response, 400, { error: '作品字段、年代或 ID 无效' });
      }
      await queueWrite(async () => {
        const current = await readWorks();
        const version = request.headers['if-match'];
        const protectedLibrary = versionedWrites || [...current, ...works].some(work =>
          work.segments.some(segment => segment.id || segment.place || segment.description || segment.longitude !== undefined));
        if ((version !== undefined && version !== worksVersion(current)) ||
            (version === undefined && protectedLibrary)) {
          throw new NoteError(409, '作品库已变更，请刷新后重新编辑');
        }
        const notes = new Map(current.map(work => [work.id, work.notePath]));
        const next = works.map(work => ({ ...work, notePath: notes.get(work.id),
          segments: version === undefined ? work.segments : saveAnnotations(work.segments) }));
        await writeWorks(next, version !== undefined);
        response.setHeader('ETag', worksVersion(next));
        if ([...notes.keys()].some(id => !works.some(work => work.id === id))) await knowledge.reconcile(next);
      });
      return send(response, 200, { saved: true });
    }
    if (request.method === 'GET') {
      const legacy = new URL(request.url, 'http://localhost');
      if (legacy.pathname === '/' && legacy.searchParams.get('page') === 'timeline' && !legacy.searchParams.has('note')) {
        const work = legacy.searchParams.get('work');
        response.writeHead(302, { Location: work ? '/spacetime?work=' + encodeURIComponent(work) : '/spacetime' });
        return response.end();
      }
    }
    const shard = /^\/atlas\/data\/(geometry-\d{1,4}\.json)$/.exec(request.url);
    const asset = request.method === 'GET' && (assets.get(request.url.split('?')[0]) ??
      (shard && [`../atlas-data/${shard[1]}`, 'application/json']));
    if (!asset) return send(response, 404, { error: '页面不存在' });
    const url = asset[0].startsWith('../atlas-data/')
      ? new URL(asset[0].slice('../atlas-data/'.length), atlasDirectory)
      : new URL(`./public/${asset[0]}`, import.meta.url);
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
});

let stateWritten = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await new Promise(resolve => server.close(resolve));
    await pendingWrite;
    if (stateWritten) await rm(paths.state, { force: true });
  } catch (error) {
    console.error('关闭 Chronicle 时出现错误', error);
    process.exitCode = 1;
  } finally {
    guard.close();
  }
}

server.listen({ host: loopback, port: config.port, exclusive: true });
try { await once(server, 'listening'); }
catch (error) { throw new Error(`Chronicle 端口 ${config.port} 不可用，未切换到其他端口。`, { cause: error }); }
address = `http://${loopback}:${server.address().port}`;
allowedOrigins.add(address);
allowedOrigins.add(`http://localhost:${server.address().port}`);
if (paths.state) {
  await mkdir(config.logs, { recursive: true });
  if (config.mode === 'formal') {
    await atomicWrite(new URL('installation.json', asDirectory(config.logs)), JSON.stringify({ initialized: true }));
  }
  await atomicWrite(pathToFileURL(paths.state), JSON.stringify({ address, pid: process.pid, token }));
  stateWritten = true;
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
console.log(`Chronicle · ${address}`);
