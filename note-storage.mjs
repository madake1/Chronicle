import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import { zipSync } from 'fflate';

export const noteLimit = 512 * 1024;
export const imageLimit = 8 * 1024 * 1024;
const workId = /^[a-zA-Z0-9_-]{1,100}$/;
const assetName = /^[a-f0-9-]{36}\.(png|jpg|gif|webp)$/;
const assetReference = /^(?:\.\/)?assets\/([^/]+)$/;
const markdown = new MarkdownIt({ html: false });
const renderImage = markdown.renderer.rules.image;
const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export class NoteError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function notePath(id) {
  if (!workId.test(id)) throw new NoteError(404, '找不到作品');
  return `works/work-${id}/note.md`;
}

export async function atomicWrite(file, content) {
  const temporary = new URL(`.chronicle-${randomUUID()}.tmp`, file);
  try {
    await writeFile(temporary, content, { flag: 'wx', flush: true });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function directory(url, create) {
  if (create) {
    await mkdir(url).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  if (!(await lstat(url)).isDirectory()) throw new NoteError(409, '资料目录不可用');
  return url;
}

async function noteDirectory(data, id, create = false) {
  const relative = notePath(id);
  await directory(data, create);
  await directory(new URL('works/', data), create);
  return directory(new URL('./', new URL(relative, data)), create);
}

async function checkedRead(file) {
  if (!(await lstat(file)).isFile()) throw new NoteError(404, '文件不可用');
  return readFile(file);
}

function revision(content) {
  return createHash('sha256').update(content).digest('hex');
}

markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const name = assetReference.exec(token.attrGet('src'))?.[1];
  if (!name || !assetName.test(name)) return markdown.utils.escapeHtml(token.content);
  token.attrSet('src', `${env.url}/assets/${name}`);
  return renderImage(tokens, index, options, env, self);
};

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
    html: markdown.render(content, { url: `/api/works/${work.id}/note` }),
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

function imageExtension(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 &&
      bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'jpg';
  if (bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) &&
      bytes.at(-1) === 59) return 'gif';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length &&
      ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return 'webp';
}

export async function saveImage(data, id, bytes, contentType) {
  const extension = imageExtension(bytes);
  if (!extension || mime[extension] !== contentType) {
    throw new NoteError(415, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片');
  }
  const folder = await noteDirectory(data, id, true);
  const assets = await directory(new URL('assets/', folder), true);
  const name = `${randomUUID()}.${extension}`;
  await atomicWrite(new URL(name, assets), bytes);
  return `assets/${name}`;
}

export async function loadImage(data, id, name) {
  if (!assetName.test(name)) throw new NoteError(404, '找不到图片');
  try {
    const folder = await noteDirectory(data, id);
    const assets = await directory(new URL('assets/', folder), false);
    return { bytes: await checkedRead(new URL(name, assets)), type: mime[name.split('.').at(-1)] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new NoteError(404, '找不到图片');
  }
}

export async function exportNote(data, work, zip) {
  const { content, revision: saved } = await loadNote(data, work);
  if (saved === null) throw new NoteError(404, '请先保存笔记');
  const text = Buffer.from(content);
  if (!zip) return text;
  const files = { 'note.md': text };
  let size = text.length;
  for (const block of markdown.parse(content, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'image') continue;
      const name = assetReference.exec(token.attrGet('src'))?.[1];
      if (!name) continue;
      const path = `assets/${name}`;
      if (Object.hasOwn(files, path)) continue;
      const { bytes } = await loadImage(data, work.id, name);
      size += bytes.length;
      if (size > 128 * 1024 * 1024) throw new NoteError(413, '完整导出超过 128 MB，请减少笔记中的图片');
      files[path] = bytes;
    }
  }
  return zipSync(files, { level: 0 });
}
