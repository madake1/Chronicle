import { zipSync } from 'fflate';
import { NoteError, referencedImages, renderNoteMarkdown } from './note-files.mjs';
import { workDocument } from './personal-store.mjs';

export const noteLimit = 512 * 1024;
export const imageLimit = 8 * 1024 * 1024;

export function loadNote(store, work) {
  const saved = store.readDocument(workDocument(work.id));
  if (!saved) return { content: '', revision: null, html: '' };
  return { ...saved, html: renderNoteMarkdown(saved.content, `/api/works/${work.id}/note/assets`) };
}
export async function exportNote(store, work, zip) {
  if (zip) return exportNotes(store, [work], false);
  const { content, revision: saved } = await loadNote(store, work);
  if (saved === null) throw new NoteError(404, '请先保存笔记');
  return Buffer.from(content);
}

async function addNoteFiles(content, loadAsset, add) {
  add('note.md', Buffer.from(content));
  for (const name of new Set(referencedImages(content))) {
    const { bytes } = await loadAsset(name);
    add(`assets/${name}`, bytes);
  }
}

export async function exportNoteContent(content, loadAsset, zip) {
  if (!zip) return Buffer.from(content);
  const { files, add } = archiveFiles();
  await addNoteFiles(content, loadAsset, add);
  return zipSync(files, { level: 0 });
}

function archiveFiles() {
  const files = {};
  let size = 0;
  function add(path, bytes) {
    size += bytes.length;
    if (size > 128 * 1024 * 1024) throw new NoteError(413, 'ZIP 超过 128 MB，请分批导出或减少笔记中的图片');
    files[path] = bytes;
  }
  return { files, add };
}

export async function exportNotes(store, works, group = true) {
  const { files, add } = archiveFiles();
  for (const [index, work] of works.entries()) {
    const title = work.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60).trim().replace(/\.+$/, '') || '作品';
    const prefix = group ? `${index + 1} - ${title}/` : '';
    const { content, revision: saved } = await loadNote(store, work);
    if (saved === null) throw new NoteError(404, `《${work.title}》没有已保存的笔记`);
    await addNoteFiles(content, name => store.loadImage(workDocument(work.id), name, false), (path, bytes) => add(prefix + path, bytes));
  }
  return zipSync(files, { level: 0 });
}
