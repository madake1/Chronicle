import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { backupLibrary, checkLibrary, collectUnreferencedImages, openLibrary, stageImage, syncDocumentImages, transaction } from './personal-library.mjs';

test('SQLite validates mode, rolls back failed writes, and backs up committed WAL data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Chronicle SQLite 测试 '));
  const source = join(directory, 'chronicle.sqlite');
  const destination = join(directory, 'backup.sqlite');
  try {
    await assert.rejects(openLibrary(source, { mode: 'formal' }), { code: 'ENOENT' });
    const db = await openLibrary(source, { mode: 'formal', initialize: true });
    try {
      await assert.rejects(openLibrary(source, { mode: 'formal', initialize: true }), { code: 'EEXIST' });
      await assert.rejects(openLibrary(source, { mode: 'demo' }), /模式不匹配/);
      assert.throws(() => transaction(db, () => {
        db.exec("INSERT INTO works VALUES ('failed', 0, '{}')");
        throw new Error('injected failure');
      }), /injected failure/);
      assert.equal(db.prepare('SELECT count(*) AS total FROM works').get().total, 0);
      assert.throws(() => db.exec("INSERT INTO knowledge_tags VALUES ('absent', 'absent', 0)"), /FOREIGN KEY/);
      db.exec('PRAGMA wal_autocheckpoint = 0;');
      db.exec("INSERT INTO works VALUES ('committed', 0, '{}')");
      assert.ok((await stat(source + '-wal')).size > 0);
      await backupLibrary(db, destination, 'formal');
      await assert.rejects(backupLibrary(db, destination, 'formal'), { code: 'EEXIST' });
      const snapshot = await openLibrary(destination, { mode: 'formal' });
      try {
        checkLibrary(snapshot);
        assert.equal(snapshot.prepare('SELECT id FROM works').get().id, 'committed');
      } finally {
        snapshot.close();
      }
      db.exec('PRAGMA user_version = 999');
      await assert.rejects(openLibrary(source, { mode: 'formal' }), /格式不兼容/);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('deleting knowledge leaves the article block at its original position', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Chronicle SQLite references '));
  try {
    const db = await openLibrary(join(directory, 'chronicle.sqlite'), { mode: 'demo', initialize: true });
    try {
      db.exec(`
        INSERT INTO knowledge VALUES ('knowledge-1', '{}');
        INSERT INTO topics VALUES ('topic-1', 0, '{}');
        INSERT INTO articles VALUES ('topic-1', 'article-1', 0, 'Article');
        INSERT INTO article_blocks VALUES
          ('topic-1', 'article-1', 'block-1', 2, 'knowledge', 'knowledge-1', 'knowledge-1', 'Original');
        DELETE FROM knowledge WHERE id = 'knowledge-1';
        INSERT INTO knowledge VALUES ('knowledge-2', '{}');
      `);
      const block = db.prepare('SELECT * FROM article_blocks').get();
      assert.equal(block.id, 'block-1');
      assert.equal(block.position, 2);
      assert.equal(block.original_knowledge_id, 'knowledge-1');
      assert.equal(block.knowledge_id, null);
      assert.equal(block.hint, 'Original');
      checkLibrary(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('shared images use one BLOB and survive until the last committed or draft reference is removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'Chronicle SQLite images '));
  try {
    const db = await openLibrary(join(directory, 'chronicle.sqlite'), { mode: 'development', initialize: true });
    try {
      db.exec(`
        INSERT INTO knowledge VALUES ('a', '{}'), ('b', '{}');
        INSERT INTO documents (id, knowledge_id, revision, format_version, body) VALUES
          ('knowledge:a', 'a', 'r1', 1, '{"type":"doc"}'),
          ('knowledge:b', 'b', 'r1', 1, '{"type":"doc"}');
      `);
      const bytes = Buffer.from('synthetic binary');
      const stage = (owner, name) => stageImage(db, { owner, name, mime: 'image/png', bytes, expiresAt: 10 });
      const first = stage('knowledge:a', 'a.png');
      assert.equal(stage('knowledge:b', 'b.png'), first);
      assert.equal(db.prepare('SELECT count(*) AS total FROM images').get().total, 1);
      assert.throws(() => transaction(db, () => syncDocumentImages(db, 'knowledge:b', ['a.png'], 1)), /附件不属于/);
      transaction(db, () => syncDocumentImages(db, 'knowledge:a', ['a.png'], 1));
      assert.equal(collectUnreferencedImages(db, 2), 0);
      transaction(db, () => syncDocumentImages(db, 'knowledge:a', [], 3));
      assert.equal(collectUnreferencedImages(db, 4), 0);
      assert.equal(collectUnreferencedImages(db, 10), 1);
      checkLibrary(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
