import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { inspectLegacyLibrary, migrateLegacyLibrary } from './legacy-library.mjs';
import { openLibrary } from './personal-library.mjs';

test('legacy preflight verifies active bodies and imports a V7.1 snapshot exactly once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'Chronicle 旧资料 测试 '));
  const file = join(dir, 'chronicle.sqlite');
  const data = pathToFileURL(dir + sep);
  const note = '12345678-aaaa-bbbb-cccc-123456789012';
  const source = '# 标题\n\n**正文**';
  const revision = createHash('sha256').update(source).digest('hex');
  const folder = join(dir, 'knowledge', 'note-' + note);
  const body = join(folder, revision + '.md');
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(new URL('chronicle.json', data), JSON.stringify({ schemaVersion: 1, works: [] }));
    await writeFile(new URL('knowledge/index.json', data), JSON.stringify({
      schemaVersion: 1, notes: [{ id: note, tagIds: [], revision, title: '' }], tags: [], relations: [],
    }));
    await writeFile(body, source);
    await writeFile(join(folder, 'a'.repeat(64) + '.md'), 'older');
    assert.equal((await inspectLegacyLibrary(data)).report.oldKnowledgeBodies, 1);
    assert.equal((await migrateLegacyLibrary(data, file, 'formal')).topics, 0);
    await assert.rejects(migrateLegacyLibrary(data, file, 'formal'), { code: 'EEXIST' });
    const db = await openLibrary(file, { mode: 'formal' });
    try {
      const row = db.prepare('SELECT knowledge_id, revision, body FROM documents').get();
      assert.equal(row.knowledge_id, note);
      assert.equal(row.revision, revision);
      assert.equal(JSON.parse(row.body).content[0].type, 'heading');
      assert.equal(db.prepare('SELECT count(*) AS count FROM documents').get().count, 1);
    } finally {
      db.close();
    }
    await writeFile(body, 'corrupted');
    await assert.rejects(inspectLegacyLibrary(data), /校验失败/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
