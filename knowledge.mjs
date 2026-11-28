import { topicIndex } from './topics.mjs';
import { saveAnnotations } from './spacetime.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { markdownExcerpt, NoteError, renderNoteMarkdown } from './note-files.mjs';
import { knowledgeDocument } from './personal-store.mjs';
import { exportNoteContent, imageLimit, noteLimit } from './note-storage.mjs';

const kinds = new Set(['knowledge', 'work', 'work-note']);
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const key = ({ type, id }) => `${type}:${id}`;
const fail = (status, message) => { throw new NoteError(status, message); };
const find = (items, id) => items.find(item => item.id === id) ?? fail(404, '找不到该条目');
const metadataVersion = (note, links) => createHash('sha256')
  .update(JSON.stringify([note.title, note.tagIds, links.map(key).sort(), ...(note.annotations ? [note.annotations] : [])])).digest('hex');

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
  const direct = new Map();
  for (const note of state.notes) {
    const ancestors = new Set();
    for (const id of note.tagIds) {
      direct.set(id, (direct.get(id) ?? 0) + 1);
      for (let tag = id; tag && !ancestors.has(tag); tag = byId.get(tag)) ancestors.add(tag);
    }
    for (const id of ancestors) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return state.tags.map(tag => ({ ...tag, count: counts.get(tag.id) ?? 0, directCount: direct.get(tag.id) ?? 0 }));
}

export function createKnowledgeService({ store, readWorks, readJson, readBody, send, queueWrite, readTopics, topicImpact }) {
  const read = store.readKnowledge;
  const write = store.writeKnowledge;
  function content(note) {
    const document = store.readDocument(knowledgeDocument(note.id));
    if (!document) throw new Error('知识条目缺少正文');
    return document.content;
  }
  function targets(state, works) {
    return new Map([
      ...state.notes.map(note => ({ type: 'knowledge', id: note.id, title: note.title })),
      ...works.flatMap(work => {
        const entry = { type: 'work', id: work.id, title: work.title };
        return work.hasNote ? [entry, { ...entry, type: 'work-note' }] : [entry];
      }),
    ].map(item => [key(item), item]));
  }
  async function describeTargets(state, entries, query = '', limit = Infinity) {
    const notes = new Map(state.notes.map(note => [note.id, note]));
    const results = [];
    for (const entry of entries) {
      if (results.length >= limit) break;
      const titleMatches = entry.title.toLowerCase().includes(query);
      if (entry.type !== 'knowledge' || (entry.title && titleMatches)) {
        if (titleMatches) results.push(entry);
        continue;
      }
      const text = await content(notes.get(entry.id));
      if (titleMatches || text.toLowerCase().includes(query)) {
        results.push({ ...entry, excerpt: markdownExcerpt(text) });
      }
    }
    return results;
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
    if (input.version !== version) fail(409, '知识元数据已变更，请复制草稿，重新打开后核对');
    const links = new Set();
    for (const item of input.related) {
      if (!kinds.has(item?.type) || typeof item.id !== 'string' || !idPattern.test(item.id) ||
          key(item) === own || !catalogue.has(key(item))) fail(400, '存在无效的关联目标');
      links.add(key(item));
    }
    if (Object.hasOwn(input, 'annotations')) note.annotations = saveAnnotations(input.annotations);
    state.relations = state.relations.filter(pair => !pair.includes(own));
    for (const link of links) state.relations.push([own, link].sort());
    Object.assign(note, { title: input.title.trim(), tagIds: [...new Set(input.tagIds)], updatedAt: new Date().toISOString() });
  }

  async function list(response, url, state, topics = []) {
    const catalogue = targets(state, await readWorks());
    const tag = url.searchParams.get('tag');
    const selected = tag && tag !== 'untagged' ? descendants(state.tags, tag) : null;
    const relatedTo = url.searchParams.get('related');
    const query = url.searchParams.get('q')?.trim().toLowerCase();
    const paths = query ? tagPaths(state.tags) : null;
    let notes = state.notes;
    const topic = url.searchParams.get('topic');
    const collection = url.searchParams.get('collection') || (topic === 'unfiled' ? 'unfiled' : '');
    const topicScope = topic && topic !== 'unfiled' ? topics.find(entry => entry.id === topic) : null;
    if (topic || collection) {
      const index = topicIndex(topics, notes);
      if (topic && topic !== 'unfiled') notes = notes.filter(note => index.byTopic.get(topic)?.has(note.id));
      if (collection) notes = notes.filter(note => index.memberships.has(note.id) === (collection === 'filed'));
    }
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
      results.push({ ...note, excerpt: markdownExcerpt(text) });
    }
    results.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const target = catalogue.get(relatedTo);
    const [relatedTarget] = target ? await describeTargets(state, [target]) : [];
    return send(response, 200, { notes: results, tags: countTags(topic || collection ? { ...state, notes: results } : state), relatedTarget, topicTitle: topicScope?.title });
  }
  async function tagRequest(request, response, id) {
    const input = request.method === 'DELETE' ? {} : await readJson(request, 8192);
    return queueWrite(async () => {
      const state = await read();
      const existing = id ? find(state.tags, id) : null;
      if (request.method === 'DELETE') {
        const children = state.tags.filter(tag => tag.parentId === id);
        const names = new Set(state.tags.filter(tag => tag.id !== id && tag.parentId === existing.parentId).map(tag => tag.name));
        for (const child of children) {
          if (names.has(child.name)) fail(409, `提升「${child.name}」会造成同级重名，请先重命名或移动标签`);
          names.add(child.name);
        }
        for (const child of children) child.parentId = existing.parentId;
        state.tags = state.tags.filter(tag => tag.id !== id);
        for (const note of state.notes) {
          if (!note.tagIds.includes(id)) continue;
          note.tagIds = [...new Set(note.tagIds.flatMap(tagId => tagId === id ? existing.parentId ?? [] : tagId))];
          note.updatedAt = new Date().toISOString();
        }
        await write(state);
        return send(response, 200, { deleted: true, parentId: existing.parentId });
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '标签内容无效');
      const name = Object.hasOwn(input, 'name') ? (typeof input.name === 'string' ? input.name.trim() : '') : existing?.name;
      const parentId = Object.hasOwn(input, 'parentId') ? input.parentId : existing?.parentId ?? null;
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
    if (path === '/api/knowledge' && method === 'GET') {
      const collection = url.searchParams.get('collection');
      if (collection && !['filed', 'unfiled'].includes(collection)) fail(400, '收录状态无效');
      const [state, topics] = url.searchParams.get('topic') || collection ?
        await queueWrite(() => Promise.all([read(), readTopics()])) : [await read(), []];
      return list(response, url, state, topics);
    }
    if (path === '/api/knowledge/tags' && method === 'GET') return send(response, 200, { tags: countTags(await read()) });
    if (path === '/api/knowledge/targets' && method === 'GET') {
      const state = await read();
      const catalogue = targets(state, await readWorks());
      const query = url.searchParams.get('q')?.trim().toLowerCase();
      const type = url.searchParams.get('type');
      const limit = type ? 40 : Infinity;
      const entries = type ? [...catalogue.values()].filter(item => item.type === type) : catalogue.values();
      return send(response, 200, await describeTargets(state, entries, query, limit));
    }
    const workLink = /^\/api\/knowledge\/works\/([a-zA-Z0-9_-]{1,100})(?:\/([a-z0-9-]{36}))?$/.exec(path);
    if (workLink) {
      const [, workId, noteId] = workLink;
      const work = `work:${workId}`;
      if (!noteId && method === 'GET') {
        const state = await read();
        const catalogue = targets(state, await readWorks());
        if (!catalogue.has(work)) fail(404, '找不到作品');
        return send(response, 200, { related: await describeTargets(state, related(state, catalogue, work)) });
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
          return send(response, 200, { related: await describeTargets(state, related(state, catalogue, work)) });
        });
      }
    }
    const tag = /^\/api\/knowledge\/tags(?:\/([a-z0-9-]+))?$/.exec(path);
    if (tag && ((!tag[1] && method === 'POST') || (tag[1] && ['PUT', 'DELETE'].includes(method)))) {
      return tagRequest(request, response, tag[1]);
    }
    const membership = /^\/api\/knowledge\/([a-z0-9-]{36})\/topics$/.exec(path);
    if (membership && method === 'GET') return queueWrite(async () => {
      const state = await read();
      find(state.notes, membership[1]);
      const index = topicIndex(await readTopics(), state.notes);
      return send(response, 200, { references: index.memberships.get(membership[1]) ?? [],
        impact: await topicImpact(membership[1], state.notes, index) });
    });
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
        html: renderNoteMarkdown(text, `${noteUrl}/assets`), related: await describeTargets(state, links) });
    }
    if (method === 'GET' && suffix === 'assets' && name) {
      const { bytes, type } = store.loadImage(knowledgeDocument(id), name);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, no-store' });
      return response.end(bytes);
    }
    if (method === 'POST' && suffix === 'assets' && !name) {
      const bytes = await readBody(request, imageLimit);
      const asset = await queueWrite(() => store.upload(knowledgeDocument(id), bytes, request.headers['content-type']));
      return send(response, 201, { path: asset });
    }
    if (method === 'GET' && !name && ['export.md', 'export.zip'].includes(suffix)) {
      const note = find((await read()).notes, id);
      const zip = suffix.endsWith('.zip');
      const bytes = await exportNoteContent(await content(note), asset => store.loadImage(knowledgeDocument(id), asset, false), zip);
      response.writeHead(200, { 'Content-Type': zip ? 'application/zip' : 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="knowledge.${zip ? 'zip' : 'md'}"; filename*=UTF-8''${encodeURIComponent('知识条目')}.${zip ? 'zip' : 'md'}` });
      return response.end(bytes);
    }
    if (method === 'PUT' && !suffix) {
      const input = await readJson(request, noteLimit * 6 + 512 * 1024);
      if (typeof input?.content !== 'string' || !input.content.trim()) fail(400, '请填写 Markdown 正文');
      if (Buffer.byteLength(input.content) > noteLimit) fail(413, '知识正文不能超过 512 KB');
      return queueWrite(async () => {
        const state = await read();
        const previous = state.notes.find(item => item.id === id);
        if (input.revision !== (previous?.revision ?? null)) fail(409, '知识已变更，请重新打开后核对');
        const revision = randomBytes(32).toString('hex');
        const now = new Date().toISOString();
        const note = { id, title: '', tagIds: [], createdAt: now, ...previous, revision, updatedAt: now };
        const catalogue = targets(state, await readWorks());
        const own = `knowledge:${id}`;
        if (input.metadata !== undefined) {
          const links = related(state, catalogue, own);
          applyMetadata(state, catalogue, note, input.metadata, previous ? metadataVersion(previous, links) : null);
        }
        const links = await describeTargets(state, related(state, catalogue, own));
        if (previous) Object.assign(previous, note);
        else state.notes.push(note);
        write(state, { id, revision, source: input.content });
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
        if (url.searchParams.has('topicImpact') &&
            (await topicImpact(id, state.notes)).version !== url.searchParams.get('topicImpact')) {
          fail(409, '专题引用已变更，请重新确认删除影响');
        }
        state.notes = state.notes.filter(item => item.id !== id);
        state.relations = state.relations.filter(pair => !pair.includes(`knowledge:${id}`));
        await write(state);
        return send(response, 200, { deleted: true });
      });
    }
    fail(404, '找不到知识库接口');
  }
  return { read, handle };
}
