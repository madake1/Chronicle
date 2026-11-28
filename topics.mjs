import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { atomicWrite } from './atomic-write.mjs';
import { checkedRead, directory, NoteError, renderNoteMarkdown } from './note-files.mjs';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = (status, message) => { throw new NoteError(status, message); };
const isId = value => typeof value === 'string' && uuid.test(value);
const isKnowledgeId = value => typeof value === 'string' && /^[a-z0-9-]{36}$/.test(value);
const text = (value, limit, required = false) => typeof value === 'string' && value.length <= limit &&
  (!required || Boolean(value.trim()));
const unique = items => new Set(items).size === items.length;
const revisionPattern = /^[a-f0-9]{64}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const coverChoices = ['fern', 'stone', 'umber'];

function validBlocks(blocks, stored = false) {
  return Array.isArray(blocks) && blocks.length <= 500 && blocks.every(block => isId(block?.id) &&
    (block.type === 'markdown' ? (stored ?
      typeof block.revision === 'string' && revisionPattern.test(block.revision) : text(block.markdown, 128_000)) :
      block.type === 'knowledge' && isKnowledgeId(block.knowledgeId) && text(block.hint, 180))) &&
    unique(blocks.map(block => block.id));
}

function validTopic(topic) {
  return isId(topic?.id) && Number.isSafeInteger(topic.version) && topic.version > 0 &&
    text(topic.title, 180, true) && text(topic.overview, 128_000) && coverChoices.includes(topic.cover) &&
    Array.isArray(topic.workIds) && topic.workIds.every(id => text(id, 100, true)) && unique(topic.workIds) &&
    Array.isArray(topic.articles) && topic.articles.every(article => isId(article?.id) &&
      text(article.title, 180, true) && validBlocks(article.blocks, true)) && unique(topic.articles.map(item => item.id));
}

export function topicIndex(topics, notes) {
  const known = new Set(notes.map(note => note.id));
  const memberships = new Map();
  const byTopic = new Map();
  for (const topic of topics) {
    const topicKnowledge = new Set();
    byTopic.set(topic.id, topicKnowledge);
    for (const article of topic.articles) {
      for (const block of article.blocks) {
        if (block.type !== 'knowledge' || !known.has(block.knowledgeId)) continue;
        topicKnowledge.add(block.knowledgeId);
        if (!memberships.has(block.knowledgeId)) memberships.set(block.knowledgeId, []);
        memberships.get(block.knowledgeId).push({ topicId: topic.id, topicTitle: topic.title,
          articleId: article.id, articleTitle: article.title, blockId: block.id });
      }
    }
  }
  return { memberships, byTopic };
}

function topicImpact(references) {
  return {
    topics: new Set(references.map(item => item.topicId)).size,
    articles: new Set(references.map(item => item.articleId)).size,
    references: references.length,
    version: createHash('sha256').update(JSON.stringify(references.map(item => item.topicId + ':' + item.articleId + ':' + item.blockId).sort())).digest('hex'),
  };
}

export function createTopicService({ data, readKnowledge, readWorks, readJson, send, queueWrite }) {
  const file = new URL('topics.json', data);
  const bodyRoot = new URL('topics/', data);
  async function markdownFile(revision, create = false) {
    await directory(data, create);
    return new URL(revision + '.md', await directory(bodyRoot, create));
  }
  async function loadMarkdown(revision) {
    try {
      const bytes = await checkedRead(await markdownFile(revision));
      if (hash(bytes) !== revision) throw new Error('正文校验失败');
      return bytes.toString('utf8');
    } catch (error) {
      throw new Error('专题文章正文无法读取，请核对资料备份', { cause: error });
    }
  }
  async function read() {
    let raw;
    try { raw = await checkedRead(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('专题索引无法读取', { cause: error });
      const files = await readdir(bodyRoot).catch(failure => {
        if (failure.code === 'ENOENT') return [];
        throw failure;
      });
      if (files.some(name => /^[a-f0-9]{64}\.md$/.test(name))) {
        try { raw = await checkedRead(file); }
        catch (failure) { throw new Error('专题索引缺失，请从同一份备份恢复专题索引与文章正文', { cause: failure }); }
      } else return [];
    }
    const index = JSON.parse(raw);
    if (index?.schemaVersion !== 1 || !Array.isArray(index.topics) || !index.topics.every(validTopic) ||
        !unique(index.topics.map(item => item.id))) throw new Error('专题索引格式无效');
    return index.topics;
  }
  const write = topics => atomicWrite(file, JSON.stringify({ schemaVersion: 1, topics }, null, 2));
  const requireTopic = (topics, id) => topics.find(topic => topic.id === id) ?? fail(404, '专题不存在');
  const requireArticle = (topic, id) => topic.articles.find(article => article.id === id) ?? fail(404, '文章不存在');
  const version = (topic, expected) => {
    if (topic.version !== expected) fail(409, '专题已变更，请保留草稿并重新打开核对');
  };
  const summary = (topic, index) => ({
    id: topic.id, title: topic.title, cover: topic.cover, overview: topic.overview.slice(0, 160),
    articles: topic.articles.length, knowledge: index.byTopic.get(topic.id).size,
  });
  async function impact(id, notes, index = null) {
    index ??= topicIndex(await read(), notes);
    return topicImpact(index.memberships.get(id) ?? []);
  }
  async function scope(topicId, articleId, notes) {
    const topic = requireTopic(await read(), topicId);
    const article = articleId ? requireArticle(topic, articleId) : null;
    const selected = article ? { ...topic, articles: [article] } : topic;
    return { title: article ? topic.title + ' / ' + article.title : topic.title, workIds: topic.workIds,
      knowledgeIds: [...topicIndex([selected], notes).byTopic.get(topic.id)] };
  }
  function updateTopic(topic, input, works) {
    if (Object.hasOwn(input, 'title')) topic.title = input.title?.trim?.();
    if (Object.hasOwn(input, 'overview')) topic.overview = input.overview;
    if (Object.hasOwn(input, 'cover')) topic.cover = input.cover;
    if (Object.hasOwn(input, 'workIds')) {
      if (!Array.isArray(input.workIds)) fail(400, '作品关联无效');
      const allowed = new Set([...topic.workIds, ...works.map(work => work.id)]);
      if (input.workIds.some(id => !allowed.has(id))) fail(409, '关联作品已不存在，请刷新');
      topic.workIds = input.workIds;
    }
    if (!validTopic(topic)) fail(400, '专题名称、简介或作品关联无效');
  }
  async function updateArticle(article, input, notes) {
    if (Object.hasOwn(input, 'title')) {
      if (!text(input.title, 180, true)) fail(400, '请填写文章标题');
      article.title = input.title.trim();
    }
    if (!Object.hasOwn(input, 'blocks')) return;
    if (!validBlocks(input.blocks)) fail(400, '文章内容单元无效');
    const known = new Map(notes.map(note => [note.id, note]));
    const former = new Map(article.blocks.filter(block => block.type === 'knowledge').map(block => [block.id, block]));
    const pending = new Map();
    const blocks = input.blocks.map(block => {
      if (block.type === 'markdown') {
        const markdown = Buffer.from(block.markdown);
        const revision = hash(markdown);
        pending.set(revision, markdown);
        return { id: block.id, type: block.type, revision };
      }
      const existing = former.get(block.id);
      const note = known.get(block.knowledgeId);
      if (!note && existing?.knowledgeId !== block.knowledgeId) fail(409, '引用的知识已不存在，请重新选择');
      return { id: block.id, type: block.type, knowledgeId: block.knowledgeId, hint: note?.title ?? existing.hint };
    });
    const present = new Set(article.blocks.filter(block => block.type === 'markdown').map(block => block.revision));
    for (const [revision, markdown] of pending) {
      const file = await markdownFile(revision, true);
      if (present.has(revision)) await loadMarkdown(revision);
      else await atomicWrite(file, markdown);
    }
    article.blocks = blocks;
  }

  async function handle(request, response, url) {
    const match = /^\/api\/topics(?:\/([a-f0-9-]+)(?:\/(articles|order)(?:\/([a-f0-9-]+)(?:\/(references))?)?)?)?$/.exec(url.pathname);
    if (!match) fail(404, '专题接口不存在');
    const [, topicId, collection, articleId, action] = match;
    const method = request.method;
    if (method === 'GET' && !collection) {
      const [topics, { notes, tags }, works] = await queueWrite(() => Promise.all([read(), readKnowledge(), topicId ? readWorks() : []]));
      const index = topicIndex(topics, notes);
      if (!topicId) return send(response, 200, { topics: topics.map(topic => summary(topic, index)) });
      const topic = requireTopic(topics, topicId);
      const requested = url.searchParams.get('article');
      const article = requested ? requireArticle(topic, requested) : null;
      const known = new Map(notes.map(note => [note.id, note]));
      const worksById = new Map(works.map(work => [work.id, work.title]));
      const rendered = article && {
        ...article,
        blocks: await Promise.all(article.blocks.map(async block => {
          if (block.type !== 'markdown') return { ...block, deleted: !known.has(block.knowledgeId), title: known.get(block.knowledgeId)?.title };
          const markdown = await loadMarkdown(block.revision);
          return { id: block.id, type: block.type, markdown, html: renderNoteMarkdown(markdown) };
        })),
      };
      return send(response, 200, { ...topic, articles: topic.articles.map(({ id, title }) => ({ id, title })),
        overviewHtml: renderNoteMarkdown(topic.overview), article: rendered, tags,
        knowledge: [...index.byTopic.get(topic.id)].map(id => ({ id, title: known.get(id).title })),
        works: topic.workIds.map(id => ({ id, title: worksById.get(id), deleted: !worksById.has(id) })) });
    }
    if (!['POST', 'PUT', 'DELETE'].includes(method)) fail(405, '专题操作不支持');
    const input = await readJson(request, 4 * 1024 * 1024);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '专题请求无效');
    return queueWrite(async () => {
      const topics = await read();
      if (!topicId && method === 'POST') {
        const topic = { id: randomUUID(), version: 1, title: '', overview: '', cover: 'fern', workIds: [], articles: [] };
        updateTopic(topic, input, await readWorks());
        topics.push(topic);
        await write(topics);
        return send(response, 201, { id: topic.id, version: topic.version });
      }
      const topic = requireTopic(topics, topicId);
      version(topic, input.version);
      let article;
      if (!collection && method === 'DELETE') {
        await write(topics.filter(item => item.id !== topic.id));
        return send(response, 200, { deleted: true });
      }
      if (!collection && method === 'PUT') updateTopic(topic, input, await readWorks());
      else if (collection === 'order' && !articleId && method === 'PUT') {
        const order = input.articleIds;
        if (!Array.isArray(order) || order.length !== topic.articles.length || !unique(order)) fail(400, '文章顺序无效');
        topic.articles = order.map(id => requireArticle(topic, id));
      } else if (collection === 'articles' && !articleId && method === 'POST') {
        if (!text(input.title, 180, true)) fail(400, '请填写文章标题');
        article = { id: randomUUID(), title: input.title.trim(), blocks: [] };
        topic.articles.push(article);
      } else if (collection === 'articles' && articleId) {
        article = requireArticle(topic, articleId);
        if (!action && method === 'DELETE') topic.articles = topic.articles.filter(item => item.id !== articleId);
        else if (!action && method === 'PUT') await updateArticle(article, input, (await readKnowledge()).notes);
        else if (action === 'references' && method === 'POST') {
          const { notes } = await readKnowledge();
          const note = notes.find(item => item.id === input.knowledgeId);
          if (!note) fail(409, '引用的知识已不存在，请重新选择');
          if (article.blocks.length >= 500) fail(400, '每篇文章最多 500 个内容单元');
          const block = { id: randomUUID(), type: 'knowledge', knowledgeId: note.id, hint: note.title };
          article.blocks.push(block);
          topic.version++;
          await write(topics);
          return send(response, 201, { id: block.id, version: topic.version });
        } else fail(404, '文章接口不存在');
      } else fail(404, '专题接口不存在');
      topic.version++;
      await write(topics);
      return send(response, 200, { id: article?.id ?? topic.id, version: topic.version });
    });
  }
  return { read, impact, scope, handle };
}
