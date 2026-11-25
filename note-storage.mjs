import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { atomicWrite } from './atomic-write.mjs';
import { checkedRead, directory, loadNoteImage, NoteError, referencedImages,
  renderNoteMarkdown, saveNoteImage } from './note-files.mjs';

export const noteLimit = 512 * 1024;
export const imageLimit = 8 * 1024 * 1024;
const workId = /^[a-zA-Z0-9_-]{1,100}$/;

export function notePath(id) {
  if (!workId.test(id)) throw new NoteError(404, '找不到作品');
  return `works/work-${id}/note.md`;
}

async function noteDirectory(data, id, create = false) {
  const relative = notePath(id);
  await directory(data, create);
  await directory(new URL('works/', data), create);
  return directory(new URL('./', new URL(relative, data)), create);
}

function revision(content) {
  return createHash('sha256').update(content).digest('hex');
}

export async function loadNote(data, work) {
  if (work.notePath !== notePath(work.id)) return { content: '', revision: null, html: '' };
  let bytes;
  try {
    const folder = await noteDirectory(data, work.id);
    bytes = await checkedRead(new URL('note.md', folder));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new NoteError(409, '索引已关联笔记，但本地笔记文件缺失');
  }
  const content = bytes.toString('utf8');
  return {
    content,
    revision: revision(bytes),
    html: renderNoteMarkdown(content, `/api/works/${work.id}/note/assets`),
  };
}

export async function saveNote(data, work, content, expectedRevision) {
  const current = await loadNote(data, work);
  if (expectedRevision !== current.revision) {
    throw new NoteError(409, '笔记已在其他页面更新。请先复制当前草稿，再重新打开笔记核对。');
  }
  const folder = await noteDirectory(data, work.id, true);
  await atomicWrite(new URL('note.md', folder), content);
}

export function saveImage(data, id, bytes, contentType) {
  return saveNoteImage(() => noteDirectory(data, id, true), bytes, contentType);
}

export function loadImage(data, id, name) {
  return loadNoteImage(() => noteDirectory(data, id), name);
}

export async function exportNote(data, work, zip) {
  if (zip) return exportNotes(data, [work], false);
  const { content, revision: saved } = await loadNote(data, work);
  if (saved === null) throw new NoteError(404, '请先保存笔记');
  return Buffer.from(content);
}

async function addNoteFiles(data, work, prefix, add) {
  const { content, revision: saved } = await loadNote(data, work);
  if (saved === null) throw new NoteError(404, `《${work.title}》没有已保存的笔记`);
  add(`${prefix}note.md`, Buffer.from(content));
  for (const name of new Set(referencedImages(content))) {
    const { bytes } = await loadImage(data, work.id, name);
    add(`${prefix}assets/${name}`, bytes);
  }
}

export async function exportNotes(data, works, group = true) {
  const files = {};
  let size = 0;
  for (const [index, work] of works.entries()) {
    const title = work.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60).trim().replace(/\.+$/, '') || '作品';
    const prefix = group ? `${index + 1} - ${title}/` : '';
    await addNoteFiles(data, work, prefix, (path, bytes) => {
      size += bytes.length;
      if (size > 128 * 1024 * 1024) throw new NoteError(413, 'ZIP 超过 128 MB，请分批导出或减少笔记中的图片');
      files[path] = bytes;
    });
  }
  return zipSync(files, { level: 0 });
}
