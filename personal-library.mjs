import { createHash } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

const applicationId = 0x4348524e;
export const librarySchemaVersion = 1;

const migrations = [`
  CREATE TABLE library (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    mode TEXT NOT NULL CHECK (mode IN ('formal', 'development', 'demo')),
    versioned_writes INTEGER NOT NULL DEFAULT 0 CHECK (versioned_writes IN (0, 1))
  ) STRICT;
  CREATE TABLE works (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT;
  CREATE TABLE knowledge (
    id TEXT PRIMARY KEY, metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT;
  CREATE TABLE tags (
    id TEXT PRIMARY KEY, parent_id TEXT REFERENCES tags(id) DEFERRABLE INITIALLY DEFERRED,
    name TEXT NOT NULL, CHECK (parent_id IS NULL OR parent_id <> id)
  ) STRICT;
  CREATE INDEX tags_parent ON tags(parent_id);
  CREATE TABLE knowledge_tags (
    knowledge_id TEXT REFERENCES knowledge(id) ON DELETE CASCADE,
    tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (knowledge_id, tag_id), UNIQUE (knowledge_id, position)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX knowledge_tags_tag ON knowledge_tags(tag_id);
  CREATE TABLE topics (
    id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, metadata TEXT NOT NULL CHECK (json_valid(metadata))
  ) STRICT;
  CREATE TABLE topic_works (
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    work_id TEXT REFERENCES works(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (topic_id, work_id), UNIQUE (topic_id, position)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX topic_works_work ON topic_works(work_id);
  CREATE TABLE articles (
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE, id TEXT NOT NULL,
    position INTEGER NOT NULL, title TEXT NOT NULL,
    PRIMARY KEY (topic_id, id), UNIQUE (topic_id, position)
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE article_blocks (
    topic_id TEXT NOT NULL, article_id TEXT NOT NULL, id TEXT NOT NULL,
    position INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('markdown', 'knowledge')),
    original_knowledge_id TEXT, knowledge_id TEXT REFERENCES knowledge(id) ON DELETE SET NULL,
    hint TEXT,
    PRIMARY KEY (topic_id, article_id, id), UNIQUE (topic_id, article_id, position),
    FOREIGN KEY (topic_id, article_id) REFERENCES articles(topic_id, id) ON DELETE CASCADE,
    CHECK ((kind = 'markdown' AND original_knowledge_id IS NULL AND knowledge_id IS NULL AND hint IS NULL)
       OR (kind = 'knowledge' AND original_knowledge_id IS NOT NULL AND hint IS NOT NULL
           AND (knowledge_id IS NULL OR knowledge_id = original_knowledge_id)))
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX article_blocks_knowledge ON article_blocks(knowledge_id);
  CREATE TABLE documents (
    id TEXT PRIMARY KEY, knowledge_id TEXT UNIQUE REFERENCES knowledge(id) ON DELETE CASCADE,
    work_id TEXT UNIQUE REFERENCES works(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE, article_id TEXT, block_id TEXT,
    revision TEXT NOT NULL, format_version INTEGER NOT NULL CHECK (format_version > 0),
    body TEXT NOT NULL CHECK (json_valid(body) AND json_extract(body, '$.type') IS 'doc'),
    FOREIGN KEY (topic_id, article_id, block_id) REFERENCES article_blocks(topic_id, article_id, id) ON DELETE CASCADE,
    CHECK ((knowledge_id IS NOT NULL) + (work_id IS NOT NULL) + (topic_id IS NOT NULL) = 1),
    CHECK ((article_id IS NULL AND block_id IS NULL) OR
           (topic_id IS NOT NULL AND article_id IS NOT NULL AND block_id IS NOT NULL))
  ) STRICT;
  CREATE UNIQUE INDEX documents_topic_overview ON documents(topic_id) WHERE article_id IS NULL;
  CREATE UNIQUE INDEX documents_article_block ON documents(topic_id, article_id, block_id) WHERE article_id IS NOT NULL;
  CREATE TABLE relation_targets (
    id TEXT PRIMARY KEY, knowledge_id TEXT UNIQUE REFERENCES knowledge(id) ON DELETE CASCADE,
    work_id TEXT UNIQUE REFERENCES works(id) ON DELETE CASCADE,
    note_id TEXT UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
    CHECK ((knowledge_id IS NOT NULL) + (work_id IS NOT NULL) + (note_id IS NOT NULL) = 1)
  ) STRICT;
  CREATE TABLE relations (
    first TEXT REFERENCES relation_targets(id) ON DELETE CASCADE,
    second TEXT REFERENCES relation_targets(id) ON DELETE CASCADE,
    PRIMARY KEY (first, second), CHECK (first < second)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX relations_second ON relations(second);
  CREATE TABLE images (
    id TEXT PRIMARY KEY CHECK (length(id) = 64 AND id NOT GLOB '*[^0-9a-f]*'),
    mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
    bytes BLOB NOT NULL CHECK (length(bytes) BETWEEN 1 AND 8388608)
  ) STRICT;
  CREATE TABLE document_images (
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    name TEXT NOT NULL, image_id TEXT NOT NULL REFERENCES images(id),
    PRIMARY KEY (document_id, name)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX document_images_image ON document_images(image_id);
  CREATE TABLE draft_images (
    owner_key TEXT NOT NULL, name TEXT NOT NULL, image_id TEXT NOT NULL REFERENCES images(id),
    expires_at INTEGER NOT NULL, PRIMARY KEY (owner_key, name)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX draft_images_image ON draft_images(image_id);
  CREATE INDEX draft_images_expiry ON draft_images(expires_at);
`];

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    if (result?.then) throw new TypeError('SQLite transaction callback must be synchronous');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function prepareLibrary(db, mode, initialize) {
  const id = db.prepare('PRAGMA application_id').get().application_id;
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (initialize ? id !== 0 || version !== 0 : id !== applicationId || version < 1 || version > librarySchemaVersion) {
    throw new Error('Chronicle 资料库格式不兼容');
  }
  if (!initialize && db.prepare('SELECT mode FROM library WHERE singleton = 1').get()?.mode !== mode) {
    throw new Error('Chronicle 资料库运行模式不匹配');
  }
  for (let next = version; next < migrations.length; next++) {
    transaction(db, () => {
      db.exec(migrations[next]);
      if (next === 0) {
        db.prepare('INSERT INTO library (singleton, mode) VALUES (1, ?)').run(mode);
        db.exec(`PRAGMA application_id = ${applicationId}`);
      }
      db.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
}

// SQLite can create a file implicitly. Reserve new paths exclusively and require existing
// files for ordinary opens so a missing library cannot turn into an empty one.
export async function openLibrary(file, { mode, initialize = false } = {}) {
  const handle = await open(file, initialize ? 'wx+' : 'r');
  await handle.close();
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  try {
    prepareLibrary(db, mode, initialize);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function checkLibrary(db) {
  const checks = db.prepare('PRAGMA integrity_check').all();
  if (checks.length !== 1 || checks[0].integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Chronicle 资料库完整性检查失败');
}

export async function backupLibrary(db, destination, mode) {
  const handle = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
  await handle.close();
  await backup(db, destination);
  const snapshot = new DatabaseSync(destination, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    if (snapshot.prepare('PRAGMA application_id').get().application_id !== applicationId ||
        snapshot.prepare('PRAGMA user_version').get().user_version !== librarySchemaVersion ||
        snapshot.prepare('SELECT mode FROM library WHERE singleton = 1').get()?.mode !== mode) {
      throw new Error('Chronicle 备份格式或资料库模式不匹配');
    }
    checkLibrary(snapshot);
  } finally {
    snapshot.close();
  }
}

// Draft aliases are scoped to their owner. A commit promotes only the aliases it uses.
// Run synchronization in the same transaction as the corresponding document write.
export function stageImage(db, { owner, name, mime, bytes, expiresAt }) {
  const id = createHash('sha256').update(bytes).digest('hex');
  return transaction(db, () => {
    db.prepare('INSERT INTO images (id, mime, bytes) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING')
      .run(id, mime, bytes);
    if (db.prepare('SELECT mime FROM images WHERE id = ?').get(id).mime !== mime) {
      throw new Error('图片类型与现有内容不一致');
    }
    db.prepare('INSERT INTO draft_images (owner_key, name, image_id, expires_at) VALUES (?, ?, ?, ?)')
      .run(owner, name, id, expiresAt);
    return id;
  });
}

export function syncDocumentImages(db, documentId, names, now = Date.now()) {
  const existing = db.prepare('SELECT name, image_id FROM document_images WHERE document_id = ?').all(documentId);
  const authorized = new Map(existing.map(row => [row.name, row.image_id]));
  const draft = db.prepare('SELECT image_id FROM draft_images WHERE owner_key = ? AND name = ? AND expires_at > ?');
  const desired = new Map();
  for (const name of new Set(names)) {
    const id = authorized.get(name) ?? draft.get(documentId, name, now)?.image_id;
    if (!id) throw new Error('附件不属于当前正文或草稿已过期');
    desired.set(name, id);
  }
  const remove = db.prepare('DELETE FROM document_images WHERE document_id = ? AND name = ?');
  for (const { name } of existing) if (!desired.has(name)) remove.run(documentId, name);
  const add = db.prepare('INSERT INTO document_images (document_id, name, image_id) VALUES (?, ?, ?)');
  const consume = db.prepare('DELETE FROM draft_images WHERE owner_key = ? AND name = ?');
  for (const [name, id] of desired) {
    if (!authorized.has(name)) {
      add.run(documentId, name, id);
      consume.run(documentId, name);
    }
  }
}

export function collectUnreferencedImages(db, now = Date.now()) {
  return transaction(db, () => {
    db.prepare('DELETE FROM draft_images WHERE expires_at <= ?').run(now);
    return db.prepare(`
      DELETE FROM images
      WHERE NOT EXISTS (SELECT 1 FROM document_images WHERE image_id = images.id)
        AND NOT EXISTS (SELECT 1 FROM draft_images WHERE image_id = images.id)
    `).run().changes;
  });
}
