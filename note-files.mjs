import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import { atomicWrite } from './atomic-write.mjs';

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

export async function directory(url, create) {
  if (create) {
    await mkdir(url).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  if (!(await lstat(url)).isDirectory()) throw new NoteError(409, '资料目录不可用');
  return url;
}

export async function checkedRead(file) {
  if (!(await lstat(file)).isFile()) throw new NoteError(404, '文件不可用');
  return readFile(file);
}

markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const name = assetReference.exec(token.attrGet('src'))?.[1];
  if (!env.assetsUrl || !name || !assetName.test(name)) return markdown.utils.escapeHtml(token.content);
  token.attrSet('src', `${env.assetsUrl}/${name}`);
  return renderImage(tokens, index, options, env, self);
};

export function renderNoteMarkdown(content, assetsUrl) {
  return markdown.render(content, { assetsUrl });
}

export function markdownExcerpt(content, limit = 120) {
  let excerpt = '';
  for (const token of markdown.parse(content, {})) {
    let text = '';
    if (token.type === 'inline') {
      text = token.children.map(child => {
        if (child.type === 'text' || child.type === 'code_inline') return child.content;
        if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
        return '';
      }).join('');
    } else if (token.type === 'fence' || token.type === 'code_block') {
      text = token.content;
    }
    const readable = text.trim().replace(/\s+/g, ' ');
    if (readable) excerpt += (excerpt ? ' ' : '') + readable;
    if (Array.from(excerpt).length >= limit) break;
  }
  return Array.from(excerpt).slice(0, limit).join('');
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

export async function saveNoteImage(getFolder, bytes, contentType) {
  const extension = imageExtension(bytes);
  if (!extension || mime[extension] !== contentType) {
    throw new NoteError(415, '请选择有效的 PNG、JPEG、GIF 或 WebP 图片');
  }
  const folder = await getFolder();
  const assets = await directory(new URL('assets/', folder), true);
  const name = `${randomUUID()}.${extension}`;
  await atomicWrite(new URL(name, assets), bytes);
  return `assets/${name}`;
}

export async function loadNoteImage(getFolder, name) {
  if (!assetName.test(name)) throw new NoteError(404, '找不到图片');
  try {
    const folder = await getFolder();
    const assets = await directory(new URL('assets/', folder), false);
    return { bytes: await checkedRead(new URL(name, assets)), type: mime[name.split('.').at(-1)] };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new NoteError(404, '找不到图片');
  }
}

export function* referencedImages(content) {
  for (const block of markdown.parse(content, {})) {
    for (const token of block.children ?? []) {
      if (token.type !== 'image') continue;
      const name = assetReference.exec(token.attrGet('src'))?.[1];
      if (name) yield name;
    }
  }
}
