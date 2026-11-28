import { createHash } from 'node:crypto';
import { access, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkLibrary, backupLibrary, openLibrary, openLibrarySnapshot } from './personal-library.mjs';
import { documentFormatVersion, documentMarkdown } from './personal-document.mjs';
import { validateImage } from './note-files.mjs';
import { locateData, lockData } from './runtime-config.mjs';

export function validatePersonalLibrary(db) {
  checkLibrary(db);
  const requireEmpty = (sql, message) => {
    if (db.prepare(sql).get()) throw new Error(message);
  };
  requireEmpty(`
    SELECT id FROM knowledge WHERE NOT EXISTS (SELECT 1 FROM documents WHERE knowledge_id = knowledge.id)
    UNION ALL SELECT id FROM topics WHERE NOT EXISTS (SELECT 1 FROM documents
      WHERE topic_id = topics.id AND article_id IS NULL)
    UNION ALL SELECT id FROM article_blocks WHERE kind = 'markdown' AND NOT EXISTS (
      SELECT 1 FROM documents WHERE topic_id = article_blocks.topic_id AND article_id = article_blocks.article_id
        AND block_id = article_blocks.id)
  `, '资料条目缺少正文');
  requireEmpty(`
    SELECT documents.id FROM documents JOIN article_blocks
      ON documents.topic_id = article_blocks.topic_id AND documents.article_id = article_blocks.article_id
      AND documents.block_id = article_blocks.id WHERE article_blocks.kind <> 'markdown'
  `, '引用块包含独立正文');
  requireEmpty(`
    SELECT id FROM works WHERE NOT EXISTS (SELECT 1 FROM relation_targets WHERE work_id = works.id AND id = 'work:' || works.id)
    UNION ALL SELECT id FROM knowledge WHERE NOT EXISTS (
      SELECT 1 FROM relation_targets WHERE knowledge_id = knowledge.id AND id = 'knowledge:' || knowledge.id)
    UNION ALL SELECT id FROM documents WHERE work_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM relation_targets WHERE note_id = documents.id AND id = 'work-note:' || documents.work_id)
    UNION ALL SELECT relation_targets.id FROM relation_targets JOIN documents ON note_id = documents.id
      WHERE documents.work_id IS NULL
  `, '关联目标与资料条目不一致');
  const tags = new Map(db.prepare('SELECT id, parent_id FROM tags').all().map(row => [row.id, row.parent_id]));
  for (const initial of tags.keys()) {
    const seen = new Set();
    for (let id = initial; id !== null; id = tags.get(id)) {
      if (seen.has(id) || !tags.has(id)) throw new Error('标签层级不一致');
      seen.add(id);
    }
  }
  const links = db.prepare('SELECT name, image_id FROM document_images WHERE document_id = ?');
  for (const row of db.prepare('SELECT id, format_version, body, revision FROM documents').iterate()) {
    if (row.format_version !== documentFormatVersion || !/^[a-f0-9]{64}$/.test(row.revision)) throw new Error('正文版本不兼容');
    const aliases = new Map(links.all(row.id).map(link => [link.name, link.image_id]));
    const used = new Set();
    documentMarkdown(JSON.parse(row.body), name => {
      used.add(name);
      return aliases.get(name);
    });
    if (used.size !== aliases.size) throw new Error('正文附件引用与授权不一致');
  }
  for (const { id, mime, bytes } of db.prepare('SELECT id, mime, bytes FROM images').iterate()) {
    if (id !== createHash('sha256').update(bytes).digest('hex')) throw new Error('图片散列校验失败');
    validateImage(Buffer.from(bytes), mime);
  }
}

export async function savePersonalBackup({ data, mode, destination }) {
  const db = openLibrarySnapshot(join(resolve(data), 'chronicle.sqlite'), mode);
  try {
    await backupLibrary(db, resolve(destination), mode, validatePersonalLibrary);
  } finally {
    db.close();
  }
}

async function exists(file) {
  try { await access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function restorePersonalBackup({ data, mode, source, previous }) {
  const { canonical, identity } = await locateData({ data: resolve(data) });
  const guard = await lockData(identity);
  let staging;
  try {
    const target = join(canonical, 'chronicle.sqlite');
    const hasTarget = await exists(target);
    if (!hasTarget && (await readdir(canonical)).length) throw new Error('恢复目标必须为空目录或现有 SQLite 库');
    if (hasTarget && !previous) throw new Error('恢复现有库前必须指定独立的备份文件');
    staging = await mkdtemp(join(canonical, '.restore-'));
    const candidate = join(staging, 'chronicle.sqlite');
    const snapshot = openLibrarySnapshot(resolve(source), mode);
    try {
      await backupLibrary(snapshot, candidate, mode, validatePersonalLibrary);
    } finally {
      snapshot.close();
    }
    if (hasTarget) {
      const current = await openLibrary(target, { mode });
      try {
        await backupLibrary(current, resolve(previous), mode, validatePersonalLibrary);
      } finally {
        current.close();
      }
      for (const suffix of ['-wal', '-shm', '-journal']) {
        if (await exists(target + suffix)) throw new Error('资料库仍存在运行日志，请确认旧实例已完全停止');
      }
    }
    await rename(candidate, target);
  } finally {
    try {
      if (staging) {
        for (const suffix of ['', '-wal', '-shm', '-journal']) {
          await rm(join(staging, 'chronicle.sqlite' + suffix), { force: true });
        }
        await rmdir(staging);
      }
    } finally {
      await new Promise((done, reject) => guard.close(error => error ? reject(error) : done()));
    }
  }
}
