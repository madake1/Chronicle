import { randomBytes, randomUUID } from 'node:crypto';
import { NoteError, validateImage } from './note-files.mjs';
import { documentFormatVersion, documentMarkdown, markdownDocument } from './personal-document.mjs';
import { collectUnreferencedImages, stageImage, syncDocumentImages, transaction } from './personal-library.mjs';

const imageAlias = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
const leaseDuration = 24 * 60 * 60 * 1000;
const parse = row => JSON.parse(row.metadata);
export const workDocument = id => 'work-note:' + id;
export const knowledgeDocument = id => 'knowledge:' + id;
const overviewDocument = id => 'topic:' + id;
const blockDocument = (topic, article, block) => ['block', topic, article, block].join(':');

export function personalStore(db) {
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const mutate = operation => transaction(db, () => {
    const result = operation();
    collectUnreferencedImages(db, Date.now(), false);
    return result;
  });

  function image(owner, name, draft = false) {
    if (!imageAlias.test(name)) return null;
    const committed = get('SELECT image_id FROM document_images WHERE document_id = ? AND name = ?', owner, name);
    return committed?.image_id ?? (draft
      ? get('SELECT image_id FROM draft_images WHERE owner_key = ? AND name = ? AND expires_at > ?', owner, name, Date.now())?.image_id
      : null);
  }

  function upload(owner, bytes, type) {
    const extension = validateImage(bytes, type);
    const name = randomUUID() + '.' + extension;
    stageImage(db, { owner, name, mime: type, bytes, expiresAt: Date.now() + leaseDuration });
    return 'assets/' + name;
  }

  function loadImage(owner, name, draft = true) {
    const id = image(owner, name, draft);
    const row = id && get('SELECT bytes, mime FROM images WHERE id = ?', id);
    if (!row) throw new NoteError(404, '找不到图片');
    return { bytes: Buffer.from(row.bytes), type: row.mime };
  }

  function readDocument(id) {
    const row = get('SELECT body, revision, format_version FROM documents WHERE id = ?', id);
    if (!row) return null;
    if (row.format_version !== documentFormatVersion) throw new Error('正文格式版本无法读取');
    return { revision: row.revision, content: documentMarkdown(JSON.parse(row.body), name => image(id, name)) };
  }

  function writeDocument(id, owners, source, revision = randomBytes(32).toString('hex')) {
    const names = new Set();
    const resolve = name => {
      names.add(name);
      return image(id, name, true);
    };
    let body;
    try {
      body = markdownDocument(source, resolve);
      documentMarkdown(body, resolve);
    } catch (cause) {
      throw new NoteError(400, '正文无法保存：' + cause.message);
    }
    run(`
      INSERT INTO documents (id, knowledge_id, work_id, topic_id, article_id, block_id, revision, format_version, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, format_version = excluded.format_version, body = excluded.body
    `, id, owners.knowledge ?? null, owners.work ?? null, owners.topic ?? null,
    owners.article ?? null, owners.block ?? null, revision, documentFormatVersion, JSON.stringify(body));
    syncDocumentImages(db, id, names);
    return revision;
  }

  function readWorks() {
    return all(`
      SELECT works.metadata, documents.id AS note FROM works
      LEFT JOIN documents ON documents.work_id = works.id ORDER BY works.position
    `).map(row => {
      const work = parse(row);
      if (row.note) work.hasNote = true;
      return work;
    });
  }

  function writeWorks(works, versioned) {
    mutate(() => {
      const ids = new Set(works.map(work => work.id));
      for (const { id } of all('SELECT id FROM works')) {
        if (!ids.has(id)) {
          run('DELETE FROM draft_images WHERE owner_key = ?', workDocument(id));
          run('DELETE FROM works WHERE id = ?', id);
        }
      }
      run('UPDATE works SET position = -position - 1');
      for (const [position, { hasNote, ...work }] of works.entries()) {
        run(`INSERT INTO works VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET position = excluded.position, metadata = excluded.metadata`,
        work.id, position, JSON.stringify(work));
        run('INSERT OR IGNORE INTO relation_targets VALUES (?, NULL, ?, NULL)', 'work:' + work.id, work.id);
      }
      run('UPDATE library SET versioned_writes = ? WHERE singleton = 1', Number(versioned));
    });
  }

  function saveWorkNote(id, source, expected) {
    return mutate(() => {
      const owner = workDocument(id);
      const current = get('SELECT revision FROM documents WHERE id = ?', owner)?.revision ?? null;
      if (current !== expected) throw new NoteError(409, '笔记已在其他页面更新，请重新打开笔记核对');
      const revision = writeDocument(owner, { work: id }, source);
      run('INSERT OR IGNORE INTO relation_targets VALUES (?, NULL, NULL, ?)', owner, owner);
      return revision;
    });
  }

  function deleteWorkNote(id) {
    return mutate(() => {
      const owner = workDocument(id);
      run('DELETE FROM draft_images WHERE owner_key = ?', owner);
      return run('DELETE FROM documents WHERE id = ?', owner).changes > 0;
    });
  }

  function readKnowledge() {
    const tags = all('SELECT id, name, parent_id AS parentId FROM tags ORDER BY rowid');
    const tagIds = new Map();
    for (const row of all('SELECT knowledge_id, tag_id FROM knowledge_tags ORDER BY knowledge_id, position')) {
      if (!tagIds.has(row.knowledge_id)) tagIds.set(row.knowledge_id, []);
      tagIds.get(row.knowledge_id).push(row.tag_id);
    }
    const notes = all(`
      SELECT knowledge.id, knowledge.metadata, documents.revision FROM knowledge
      LEFT JOIN documents ON documents.knowledge_id = knowledge.id ORDER BY knowledge.rowid
    `).map(row => {
      if (!row.revision) throw new Error('知识条目缺少正文');
      return { ...parse(row), id: row.id, revision: row.revision, tagIds: tagIds.get(row.id) ?? [] };
    });
    const relations = all('SELECT first, second FROM relations').map(row => [row.first, row.second]);
    return { notes, tags, relations };
  }

  function writeKnowledge(state, change) {
    mutate(() => {
      const known = new Set(state.notes.map(note => note.id));
      for (const { id } of all('SELECT id FROM knowledge')) {
        if (!known.has(id)) {
          run('DELETE FROM draft_images WHERE owner_key = ?', knowledgeDocument(id));
          run('DELETE FROM knowledge WHERE id = ?', id);
        }
      }
      const tags = new Set(state.tags.map(tag => tag.id));
      for (const tag of state.tags) {
        run(`INSERT INTO tags VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name`, tag.id, tag.parentId, tag.name);
      }
      for (const { id } of all('SELECT id FROM tags')) if (!tags.has(id)) run('DELETE FROM tags WHERE id = ?', id);
      run('DELETE FROM knowledge_tags');
      for (const { id, revision, tagIds, ...metadata } of state.notes) {
        run('INSERT INTO knowledge VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata',
          id, JSON.stringify(metadata));
        run('INSERT OR IGNORE INTO relation_targets VALUES (?, ?, NULL, NULL)', knowledgeDocument(id), id);
        tagIds.forEach((tag, position) => run('INSERT INTO knowledge_tags VALUES (?, ?, ?)', id, tag, position));
      }
      if (change) writeDocument(knowledgeDocument(change.id), { knowledge: change.id }, change.source, change.revision);
      run('DELETE FROM relations');
      for (const pair of state.relations) run('INSERT INTO relations VALUES (?, ?)', ...pair);
    });
  }

  function readTopics({ bodies = false, overviews = false } = {}) {
    return all('SELECT * FROM topics ORDER BY position').map(row => {
      const overview = overviews || bodies ? readDocument(overviewDocument(row.id)) : null;
      if ((overviews || bodies) && !overview) throw new Error('专题缺少简介正文');
      return {
        ...parse(row), id: row.id, overview: overview?.content,
        workIds: all('SELECT original_work_id FROM topic_works WHERE topic_id = ? ORDER BY position', row.id).map(work => work.original_work_id),
        articles: all('SELECT id, title FROM articles WHERE topic_id = ? ORDER BY position', row.id).map(article => ({
          id: article.id, title: article.title,
          blocks: all('SELECT * FROM article_blocks WHERE topic_id = ? AND article_id = ? ORDER BY position', row.id, article.id)
            .map(block => {
              if (block.kind === 'knowledge') return { id: block.id, type: block.kind, knowledgeId: block.original_knowledge_id,
                hint: block.hint, ...(block.knowledge_id === null ? { deleted: true } : {}) };
              const owner = blockDocument(row.id, article.id, block.id);
              const document = bodies ? readDocument(owner) : get('SELECT revision FROM documents WHERE id = ?', owner);
              if (!document) throw new Error('文章内容块缺少正文');
              return { id: block.id, type: block.kind, revision: document.revision,
                ...(bodies ? { markdown: document.content } : {}) };
            }),
        })),
      };
    });
  }

  function writeTopics(topics, changedId) {
    mutate(() => {
      const topic = topics.find(item => item.id === changedId);
      if (!topic) {
        run('DELETE FROM topics WHERE id = ?', changedId);
        return;
      }
      const { id, overview, workIds, articles, ...metadata } = topic;
      run(`INSERT INTO topics VALUES (?, COALESCE((SELECT MAX(position) + 1 FROM topics), 0), ?)
           ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata`, id, JSON.stringify(metadata));
      if (overview !== undefined) writeDocument(overviewDocument(id), { topic: id }, overview);
      run('DELETE FROM topic_works WHERE topic_id = ?', id);
      workIds.forEach((work, position) => run('INSERT INTO topic_works VALUES (?, ?, ?, ?)',
        id, work, get('SELECT id FROM works WHERE id = ?', work)?.id ?? null, position));
      const articleIds = new Set(articles.map(article => article.id));
      for (const row of all('SELECT id FROM articles WHERE topic_id = ?', id)) {
        if (!articleIds.has(row.id)) run('DELETE FROM articles WHERE topic_id = ? AND id = ?', id, row.id);
      }
      run('UPDATE articles SET position = -position - 1 WHERE topic_id = ?', id);
      for (const [position, article] of articles.entries()) {
        run(`INSERT INTO articles VALUES (?, ?, ?, ?)
             ON CONFLICT(topic_id, id) DO UPDATE SET position = excluded.position, title = excluded.title`,
          id, article.id, position, article.title);
        const previous = new Map(all('SELECT * FROM article_blocks WHERE topic_id = ? AND article_id = ?', id, article.id)
          .map(row => [row.id, row]));
        const byId = new Map(article.blocks.map(block => [block.id, block]));
        for (const [blockId, row] of previous) {
          if (byId.get(blockId)?.type !== row.kind) run('DELETE FROM article_blocks WHERE topic_id = ? AND article_id = ? AND id = ?', id, article.id, blockId);
        }
        run('UPDATE article_blocks SET position = -position - 1 WHERE topic_id = ? AND article_id = ?', id, article.id);
        for (const [ordinal, block] of article.blocks.entries()) {
          const original = block.knowledgeId ?? null;
          const active = original && !block.deleted && get('SELECT id FROM knowledge WHERE id = ?', original) ? original : null;
          run(`INSERT INTO article_blocks VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(topic_id, article_id, id) DO UPDATE SET position = excluded.position,
                 original_knowledge_id = excluded.original_knowledge_id, knowledge_id = excluded.knowledge_id, hint = excluded.hint`,
            id, article.id, block.id, ordinal, block.type, original, active, block.hint ?? null);
          if (block.type === 'markdown' && block.markdown !== undefined) {
            writeDocument(blockDocument(id, article.id, block.id), { topic: id, article: article.id, block: block.id },
              block.markdown, block.revision);
          }
        }
      }
    });
  }

  return {
    upload, loadImage, readDocument, readWorks, writeWorks, saveWorkNote, deleteWorkNote,
    readKnowledge, writeKnowledge, readTopics, writeTopics,
    versionedWrites: () => Boolean(get('SELECT versioned_writes FROM library').versioned_writes),
  };
}
