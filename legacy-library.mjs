import { createHash } from 'node:crypto';
import { link, mkdtemp, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createKnowledgeService } from './knowledge.mjs';
import { checkedRead, directory, referencedImages } from './note-files.mjs';
import { notePath } from './note-storage.mjs';
import { createTopicService } from './topics.mjs';
import { openLibrary, checkLibrary, transaction } from './personal-library.mjs';
import { documentFormatVersion, documentMarkdown, markdownDocument } from './personal-document.mjs';

const revisionPattern = /^[a-f0-9]{64}$/;
const knowledgeId = /^[a-z0-9-]{36}$/;
const imageName = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = new TextDecoder('utf-8', { fatal: true });
const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

async function entries(path) {
  try {
    await directory(path, false);
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function content(file, expected) {
  const bytes = await checkedRead(file);
  if (expected && hash(bytes) !== expected) throw new Error('旧资料正文校验失败');
  return { source: decode.decode(bytes), revision: hash(bytes) };
}

export async function inspectLegacyLibrary(data) {
  await directory(data, false);
  const worksIndex = JSON.parse(await checkedRead(new URL('chronicle.json', data)));
  if (worksIndex?.schemaVersion !== 1 || !Array.isArray(worksIndex.works) ||
      new Set(worksIndex.works.map(work => work?.id)).size !== worksIndex.works.length) {
    throw new Error('作品索引格式无效');
  }
  const knowledge = await createKnowledgeService({ data }).read();
  const topics = await createTopicService({ data }).read();
  const documents = [];
  const images = new Map();
  const report = {
    works: worksIndex.works.length, knowledge: knowledge.notes.length, tags: knowledge.tags.length,
    relations: knowledge.relations.length, topics: topics.length, articles: 0, blocks: 0,
    oldKnowledgeBodies: 0, oldTopicBodies: 0, orphanImages: 0,
  };

  async function collect(owner, record, folder) {
    const references = new Set(referencedImages(record.source));
    const aliases = new Map();
    if (folder) {
      const assets = new URL('assets/', folder);
      for (const entry of await entries(assets)) {
        if (!imageName.test(entry.name)) continue;
        const bytes = await checkedRead(new URL(entry.name, assets));
        const id = hash(bytes);
        images.set(id, { id, mime: mime[entry.name.split('.').at(-1)], bytes });
        aliases.set(entry.name, id);
        if (!references.has(entry.name)) report.orphanImages++;
      }
    }
    const resolve = name => aliases.get(name);
    try {
      const body = markdownDocument(record.source, resolve);
      documentMarkdown(body, resolve);
      documents.push({ owner, revision: record.revision, body, aliases });
    } catch (cause) {
      throw new Error(`正文无法迁移：${owner.join('/')}`, { cause });
    }
  }

  for (const work of worksIndex.works) {
    const expected = notePath(work.id);
    if (!work.notePath) continue;
    if (work.notePath !== expected) throw new Error('作品笔记路径与索引不匹配');
    const base = await directory(new URL('works/', data), false);
    const folder = await directory(new URL(`work-${work.id}/`, base), false);
    await collect(['work', work.id], await content(new URL('note.md', folder)), folder);
  }
  for (const note of knowledge.notes) {
    if (!knowledgeId.test(note.id) || !revisionPattern.test(note.revision)) throw new Error('知识正文索引格式无效');
    const base = await directory(new URL('knowledge/', data), false);
    const folder = await directory(new URL(`note-${note.id}/`, base), false);
    report.oldKnowledgeBodies += (await entries(folder)).filter(entry =>
      revisionPattern.test(entry.name.slice(0, -3)) && entry.name.endsWith('.md') && entry.name !== note.revision + '.md').length;
    await collect(['knowledge', note.id], await content(new URL(note.revision + '.md', folder), note.revision), folder);
  }
  const usedTopicRevisions = new Set();
  const topicBodyFolder = new URL('topics/', data);
  for (const topic of topics) {
    await collect(['topic', topic.id], { source: topic.overview, revision: hash(topic.overview) });
    report.articles += topic.articles.length;
    for (const article of topic.articles) {
      report.blocks += article.blocks.length;
      for (const block of article.blocks) {
        if (block.type !== 'markdown') continue;
        usedTopicRevisions.add(block.revision);
        const folder = await directory(topicBodyFolder, false);
        await collect(['block', topic.id, article.id, block.id],
          await content(new URL(block.revision + '.md', folder), block.revision));
      }
    }
  }
  report.oldTopicBodies = (await entries(topicBodyFolder)).filter(entry =>
    entry.name.endsWith('.md') && revisionPattern.test(entry.name.slice(0, -3)) &&
    !usedTopicRevisions.has(entry.name.slice(0, -3))).length;
  report.documents = documents.length;
  report.uniqueImages = images.size;
  return { worksIndex, knowledge, topics, documents, images, report };
}

async function buildLegacySnapshot(source, destination, mode) {
  const { worksIndex, knowledge, topics, documents, images, report } = await inspectLegacyLibrary(source);
  const db = await openLibrary(destination, { mode, initialize: true });
  try {
    transaction(db, () => {
      db.prepare('UPDATE library SET versioned_writes = ? WHERE singleton = 1')
        .run(Number(Boolean(worksIndex.versionedWrites)));
      const workRow = db.prepare('INSERT INTO works VALUES (?, ?, ?)');
      const knowledgeRow = db.prepare('INSERT INTO knowledge VALUES (?, ?)');
      const tagRow = db.prepare('INSERT INTO tags VALUES (?, ?, ?)');
      const tagLink = db.prepare('INSERT INTO knowledge_tags VALUES (?, ?, ?)');
      const topicRow = db.prepare('INSERT INTO topics VALUES (?, ?, ?)');
      const topicWork = db.prepare('INSERT INTO topic_works VALUES (?, ?, ?)');
      const articleRow = db.prepare('INSERT INTO articles VALUES (?, ?, ?, ?)');
      const blockRow = db.prepare('INSERT INTO article_blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const docRow = db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const target = db.prepare('INSERT INTO relation_targets VALUES (?, ?, ?, ?)');
      const imageRow = db.prepare('INSERT INTO images VALUES (?, ?, ?)');
      const imageLink = db.prepare('INSERT INTO document_images VALUES (?, ?, ?)');
      const relation = db.prepare('INSERT INTO relations VALUES (?, ?)');
      for (const [position, work] of worksIndex.works.entries()) {
        workRow.run(work.id, position, JSON.stringify(work));
        target.run('work:' + work.id, null, work.id, null);
      }
      for (const tag of knowledge.tags) tagRow.run(tag.id, tag.parentId ?? null, tag.name);
      for (const { tagIds, revision, ...note } of knowledge.notes) {
        knowledgeRow.run(note.id, JSON.stringify(note));
        target.run('knowledge:' + note.id, note.id, null, null);
        for (const [position, id] of tagIds.entries()) tagLink.run(note.id, id, position);
      }
      const known = new Set(knowledge.notes.map(note => note.id));
      const works = new Set(worksIndex.works.map(work => work.id));
      for (const [position, { articles, workIds, overview, ...topic }] of topics.entries()) {
        topicRow.run(topic.id, position, JSON.stringify(topic));
        for (const [ordinal, workId] of workIds.entries()) {
          if (works.has(workId)) topicWork.run(topic.id, workId, ordinal);
        }
        for (const [ordinal, article] of articles.entries()) {
          articleRow.run(topic.id, article.id, ordinal, article.title);
          for (const [position, block] of article.blocks.entries()) {
            const original = block.knowledgeId ?? null;
            blockRow.run(topic.id, article.id, block.id, position, block.type, original,
              known.has(original) ? original : null, block.hint ?? null);
          }
        }
      }
      for (const { id, mime, bytes } of images.values()) imageRow.run(id, mime, bytes);
      for (const { owner, revision, body, aliases } of documents) {
        const [kind, entity, article = null, block = null] = owner;
        const id = owner.join(':');
        docRow.run(id, kind === 'knowledge' ? entity : null, kind === 'work' ? entity : null,
          kind === 'topic' || kind === 'block' ? entity : null, article, block, revision,
          documentFormatVersion, JSON.stringify(body));
        if (kind === 'work') target.run('work-note:' + entity, null, null, id);
        for (const [name, image] of aliases) imageLink.run(id, name, image);
      }
      for (const [first, second] of knowledge.relations) relation.run(first, second);
      checkLibrary(db);
    });
    return report;
  } finally {
    db.close();
  }
}

export async function migrateLegacyLibrary(source, destination, mode) {
  const staging = await mkdtemp(join(dirname(destination), '.chronicle-migration-'));
  const candidate = join(staging, 'chronicle.sqlite');
  try {
    const report = await buildLegacySnapshot(source, candidate, mode);
    // The connection has closed and SQLite has checkpointed. Linking publishes
    // atomically on the same volume and fails if the target already exists.
    await link(candidate, destination);
    return report;
  } finally {
    for (const suffix of ['', '-wal', '-shm', '-journal']) await rm(candidate + suffix, { force: true });
    await rmdir(staging);
  }
}
