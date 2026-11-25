import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite } from './atomic-write.mjs';
import { checkedRead, directory, loadNoteImage, NoteError, renderNoteMarkdown, saveNoteImage } from './note-files.mjs';
import { exportNoteContent, imageLimit, noteLimit } from './note-storage.mjs';

const kinds = new Set(['knowledge', 'work', 'work-note']);
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const key = ({ type, id }) => `${type}:${id}`;
const fail = (status, message) => { throw new NoteError(status, message); };
const find = (items, id) => items.find(item => item.id === id) ?? fail(404, '找不到该条目');
const metadataVersion = (note, links) => createHash('sha256')
  .update(JSON.stringify([note.title, note.tagIds, links.map(key).sort()])).digest('hex');

function descendants(tags, id) {
  const result = new Set([id]);
  for (const parent of result) {
    for (const tag of tags) if (tag.parentId === parent) result.add(tag.id);
  }
  return result;
}

function tagPaths(tags) {
  const byId = new Map(tags.map(tag => [tag.id, tag]));
  return new Map(tags.map(tag => {
    const names = [tag.name];
    for (let parent = byId.get(tag.parentId); parent; parent = byId.get(parent.parentId)) names.unshift(parent.name);
    return [tag.id, names.join(' / ').toLowerCase()];
  }));
}

function countTags(state) {
  const byId = new Map(state.tags.map(tag => [tag.id, tag.parentId]));
  const counts = new Map();
  for (const note of state.notes) {
    const ancestors = new Set();
    for (const id of note.tagIds) {
      for (let tag = id; tag && !ancestors.has(tag); tag = byId.get(tag)) ancestors.add(tag);
    }
    for (const id of ancestors) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return state.tags.map(tag => ({ ...tag, count: counts.get(tag.id) ?? 0 }));
}

export function createKnowledgeService({ data, readWorks, readJson, readBody, send, queueWrite }) {
  const root = new URL('knowledge/', data);
  const index = new URL('index.json', root);
  const blank = () => ({ schemaVersion: 1, notes: [], tags: [], relations: [] });
  async function read() {
    try { return JSON.parse(await checkedRead(index)); }
    catch (error) { if (error.code === 'ENOENT') return blank(); throw error; }
  }
  async function write(state) {
    await directory(data, true);
    await directory(root, true);
    await atomicWrite(index, JSON.stringify(state, null, 2));
  }
  async function folder(id, create = false) {
    await directory(data, create);
    await directory(root, create);
    return directory(new URL(`note-${id}/`, root), create);
  }
  async function content(note) {
    return (await checkedRead(new URL(`${note.revision}.md`, await folder(note.id)))).toString('utf8');
  }
  function targets(state, works) {
    return new Map([
      ...state.notes.map(note => ({ type: 'knowledge', id: note.id, title: note.title || '无标题' })),
      ...works.flatMap(work => {
        const entry = { type: 'work', id: work.id, title: work.title };
        return work.notePath ? [entry, { ...entry, type: 'work-note' }] : [entry];
      }),
    ].map(item => [key(item), item]));
  }
  function related(state, catalogue, target) {
    return state.relations.flatMap(pair => {
      if (!pair.includes(target)) return [];
      const item = catalogue.get(pair.find(item => item !== target));
      return item ? [item] : [];
    });
  }
  function applyMetadata(state, catalogue, note, input, version) {
    if (typeof input?.title !== 'string' || input.title.length > 180 || !Array.isArray(input.tagIds) ||
        !input.tagIds.every(tagId => state.tags.some(tag => tag.id === tagId)) || !Array.isArray(input.related)) {
      fail(400, '标题、标签或关联无效，请刷新后重试');
    }
    const own = `knowledge:${note.id}`;
    if (input.version !== version) fail(409, '标题、标签或关联已变更，请复制草稿，重新打开后核对');
    const links = new Set();
    for (const item of input.related) {
      if (!kinds.has(item?.type) || typeof item.id !== 'string' || !idPattern.test(item.id) ||
          key(item) === own || !catalogue.has(key(item))) fail(400, '存在无效的关联目标');
      links.add(key(item));
    }
    state.relations = state.relations.filter(pair => !pair.includes(own));
    for (const link of links) state.relations.push([own, link].sort());
    Object.assign(note, { title: input.title.trim(), tagIds: [...new Set(input.tagIds)], updatedAt: new Date().toISOString() });
  }
  async function reconcile(works = null) {
    const state = await read();
    if (!state.relations.length) return;
    const catalogue = targets(state, works ?? await readWorks());
    const valid = state.relations.filter(pair => pair.every(item => catalogue.has(item)));
    if (valid.length !== state.relations.length) await write({ ...state, relations: valid });
  }
  async function list(response, url, state) {
    const catalogue = targets(state, await readWorks());
    const tag = url.searchParams.get('tag');
    const selected = tag && tag !== 'untagged' ? descendants(state.tags, tag) : null;
    const relatedTo = url.searchParams.get('related');
    const query = url.searchParams.get('q')?.trim().toLowerCase();
    const paths = query ? tagPaths(state.tags) : null;
    let notes = state.notes;
    if (tag === 'untagged') notes = notes.filter(note => !note.tagIds.length);
    if (selected) notes = notes.filter(note => note.tagIds.some(id => selected.has(id)));
    if (relatedTo) {
      const ids = new Set(related(state, catalogue, relatedTo).filter(item => item.type === 'knowledge').map(item => item.id));
      notes = notes.filter(note => ids.has(note.id));
    }
    const results = [];
    for (const note of notes) {
      const text = await content(note);
      if (query && !note.title.toLowerCase().includes(query) && !text.toLowerCase().includes(query) &&
          !note.tagIds.some(id => paths.get(id)?.includes(query))) continue;
      results.push({ ...note, excerpt: text.trim().slice(0, 120) });
    }
    results.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(response, 200, { notes: results, tags: countTags(state), targets: [...catalogue.values()] });
  }
  async function tagRequest(request, response, id) {
    const input = request.method === 'DELETE' ? {} : await readJson(request, 8192);
    return queueWrite(async () => {
      const state = await read();
      const existing = id ? find(state.tags, id) : null;
      if (request.method === 'DELETE') {
        for (const tag of state.tags) if (tag.parentId === id) tag.parentId = existing.parentId;
        state.tags = state.tags.filter(tag => tag.id !== id);
        for (const note of state.notes) note.tagIds = note.tagIds.filter(tagId => tagId !== id);
        await write(state);
        return send(response, 200, { deleted: true });
      }
      const name = typeof input?.name === 'string' ? input.name.trim() : '';
      const parentId = input?.parentId ?? null;
      if (!name || name.length > 100) fail(400, '请输入 1 至 100 个字符的标签名');
      if (parentId !== null) find(state.tags, parentId);
      if (id && descendants(state.tags, id).has(parentId)) fail(400, '标签不能移到自身或下级标签');
      if (state.tags.some(tag => tag.id !== id && tag.parentId === parentId && tag.name === name)) fail(409, '同级已有同名标签');
      const tag = { id: id ?? randomUUID(), name, parentId };
      if (existing) Object.assign(existing, tag);
      else state.tags.push(tag);
      await write(state);
      return send(response, id ? 200 : 201, tag);
    });
  }
  async function handle(request, response, url) {
    const { method } = request;
    const path = url.pathname;
    if (path === '/api/knowledge' && method === 'GET') return list(response, url, await read());
    const workLink = /^\/api\/knowledge\/works\/([a-zA-Z0-9_-]{1,100})(?:\/([a-z0-9-]{36}))?$/.exec(path);
    if (workLink) {
      const [, workId, noteId] = workLink;
      const work = `work:${workId}`;
      if (!noteId && method === 'GET') {
        const state = await read();
        const catalogue = targets(state, await readWorks());
        if (!catalogue.has(work)) fail(404, '找不到作品');
        return send(response, 200, { related: related(state, catalogue, work) });
      }
      if (noteId && ['PUT', 'DELETE'].includes(method)) {
        return queueWrite(async () => {
          const state = await read();
          const catalogue = targets(state, await readWorks());
          const note = `knowledge:${noteId}`;
          if (!catalogue.has(work) || !catalogue.has(note)) fail(404, '作品或知识已不存在');
          const exists = state.relations.some(pair => pair.includes(work) && pair.includes(note));
          if (method === 'PUT' && !exists) {
            state.relations.push([work, note].sort());
            await write(state);
          } else if (method === 'DELETE' && exists) {
            state.relations = state.relations.filter(pair => !(pair.includes(work) && pair.includes(note)));
            await write(state);
          }
          return send(response, 200, { related: related(state, catalogue, work) });
        });
      }
    }
    const tag = /^\/api\/knowledge\/tags(?:\/([a-z0-9-]+))?$/.exec(path);
    if (tag && ((!tag[1] && method === 'POST') || (tag[1] && ['PUT', 'DELETE'].includes(method)))) {
      return tagRequest(request, response, tag[1]);
    }
    const match = /^\/api\/knowledge\/([a-z0-9-]{36})(?:\/(assets|export\.md|export\.zip|metadata)(?:\/([a-z0-9.-]+))?)?$/.exec(path);
    if (!match) fail(404, '找不到知识库接口');
    const [, id, suffix, name] = match;
    const noteUrl = `/api/knowledge/${id}`;
    if (method === 'GET' && !suffix) {
      const state = await read();
      const note = find(state.notes, id);
      const text = await content(note);
      const catalogue = targets(state, await readWorks());
      const links = related(state, catalogue, `knowledge:${id}`);
      return send(response, 200, { ...note, content: text, metadataVersion: metadataVersion(note, links),
        html: renderNoteMarkdown(text, `${noteUrl}/assets`), related: links });
    }
    if (method === 'GET' && suffix === 'assets' && name) {
      find((await read()).notes, id);
      const { bytes, type } = await loadNoteImage(() => folder(id), name);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, no-store' });
      return response.end(bytes);
    }
    if (method === 'POST' && suffix === 'assets' && !name) {
      const bytes = await readBody(request, imageLimit);
      const asset = await queueWrite(() => saveNoteImage(() => folder(id, true), bytes, request.headers['content-type']));
      return send(response, 201, { path: asset });
    }
    if (method === 'GET' && !name && ['export.md', 'export.zip'].includes(suffix)) {
      const note = find((await read()).notes, id);
      const zip = suffix.endsWith('.zip');
      const bytes = await exportNoteContent(await content(note), asset => loadNoteImage(() => folder(id), asset), zip);
      response.writeHead(200, { 'Content-Type': zip ? 'application/zip' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="note.${zip ? 'zip' : 'md'}"` });
      return response.end(bytes);
    }
    if (method === 'PUT' && !suffix) {
      const input = await readJson(request, noteLimit * 6 + 512 * 1024);
      if (typeof input?.content !== 'string' || !input.content.trim()) fail(400, '请填写 Markdown 正文');
      if (Buffer.byteLength(input.content) > noteLimit) fail(413, '笔记不能超过 512 KB');
      return queueWrite(async () => {
        const state = await read();
        const previous = state.notes.find(item => item.id === id);
        if (input.revision !== (previous?.revision ?? null)) fail(409, '笔记已变更，请重新打开后核对');
        const revision = createHash('sha256').update(input.content).digest('hex');
        const now = new Date().toISOString();
        const note = { id, title: '', tagIds: [], createdAt: now, ...previous, revision, updatedAt: now };
        const catalogue = targets(state, await readWorks());
        const own = `knowledge:${id}`;
        if (input.metadata !== undefined) {
          const links = related(state, catalogue, own);
          applyMetadata(state, catalogue, note, input.metadata, previous ? metadataVersion(previous, links) : null);
        }
        await atomicWrite(new URL(`${revision}.md`, await folder(id, true)), input.content);
        if (previous) Object.assign(previous, note);
        else state.notes.push(note);
        await write(state);
        const links = related(state, catalogue, own);
        return send(response, 200, { ...note, content: input.content, related: links,
          metadataVersion: metadataVersion(note, links), html: renderNoteMarkdown(input.content, `${noteUrl}/assets`) });
      });
    }
    if (method === 'PUT' && suffix === 'metadata' && !name) {
      const input = await readJson(request, 512 * 1024);
      return queueWrite(async () => {
        const state = await read();
        const note = find(state.notes, id);
        const catalogue = targets(state, await readWorks());
        applyMetadata(state, catalogue, note, input, metadataVersion(note, related(state, catalogue, `knowledge:${id}`)));
        await write(state);
        return send(response, 200, note);
      });
    }
    if (method === 'DELETE' && !suffix) {
      return queueWrite(async () => {
        const state = await read();
        find(state.notes, id);
        state.notes = state.notes.filter(item => item.id !== id);
        state.relations = state.relations.filter(pair => !pair.includes(`knowledge:${id}`));
        await write(state);
        return send(response, 200, { deleted: true });
      });
    }
    fail(404, '找不到知识库接口');
  }
  return { handle, reconcile };
}
