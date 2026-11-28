import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt({ html: false });
const blockNodes = {
  paragraph: 'paragraph', heading: 'heading', blockquote: 'blockquote',
  bullet_list: 'bulletList', ordered_list: 'orderedList', list_item: 'listItem',
  table: 'table', tr: 'tableRow', th: 'tableHeader', td: 'tableCell',
  thead: 'tableHead', tbody: 'tableBody',
};
const markTypes = { strong: 'bold', em: 'italic', s: 'strike', link: 'link' };
export const documentFormatVersion = 1;

function appendInline(parent, tokens, resolveImage) {
  const marks = [];
  const content = parent.content ??= [];
  for (const token of tokens) {
    const base = token.type.replace(/_(open|close)$/, '');
    if (markTypes[base]) {
      if (token.nesting === 1) {
        const mark = { type: markTypes[base] };
        if (base === 'link') mark.attrs = { href: token.attrGet('href'), title: token.attrGet('title') };
        marks.push(mark);
      } else {
        marks.pop();
      }
      continue;
    }
    let node;
    switch (token.type) {
      case 'text':
      case 'code_inline':
        if (!token.content) continue;
        node = { type: 'text', text: token.content };
        if (token.type === 'code_inline') node.marks = [...marks, { type: 'code' }];
        break;
      case 'softbreak':
        node = { type: 'softBreak' };
        break;
      case 'hardbreak':
        node = { type: 'hardBreak' };
        break;
      case 'image': {
        const src = token.attrGet('src');
        const name = /^(?:\.\/)?assets\/([a-f0-9-]{36}\.(?:png|jpg|gif|webp))$/.exec(src)?.[1];
        const attachmentId = name ? resolveImage(name) : null;
        if (name && !attachmentId) throw new Error(`找不到正文附件 ${name}`);
        node = { type: 'image', attrs: {
          ...(name ? { attachmentId, name } : { src }), alt: token.content, title: token.attrGet('title'),
        } };
        break;
      }
      default:
        throw new Error(`不支持 Markdown 行内节点 ${token.type}`);
    }
    if (!node.marks && marks.length) node.marks = [...marks];
    content.push(node);
  }
}

// Document extensions preserve Markdown semantics that require custom ProseMirror nodes:
// soft breaks, table sections and heading/cell metadata.
export function markdownDocument(source, resolveImage = () => undefined) {
  const root = { type: 'doc', content: [] };
  const parents = [root];
  for (const token of parser.parse(source, {})) {
    const parent = parents.at(-1);
    const content = parent.content ??= [];
    const base = token.type.replace(/_(open|close)$/, '');
    if (token.type === 'inline') {
      appendInline(parent, token.children ?? [], resolveImage);
    } else if (token.nesting === -1 && blockNodes[base]) {
      parents.pop();
    } else if (token.nesting === 1 && blockNodes[base]) {
      const node = { type: blockNodes[base], content: [] };
      if (base === 'heading') node.attrs = { level: Number(token.tag.slice(1)) };
      if (base === 'ordered_list') node.attrs = { start: Number(token.attrGet('start') ?? 1) };
      if (base === 'paragraph' && token.hidden) node.attrs = { tight: true };
      if (base === 'th' || base === 'td') node.attrs = { align: token.attrGet('style')?.split(':').at(-1) ?? null };
      content.push(node);
      parents.push(node);
    } else if (token.type === 'fence' || token.type === 'code_block') {
      content.push({
        type: 'codeBlock', attrs: { language: token.info.trim() || null },
        content: token.content ? [{ type: 'text', text: token.content }] : [],
      });
    } else if (token.type === 'hr') {
      content.push({ type: 'horizontalRule' });
    } else {
      throw new Error(`不支持 Markdown 块节点 ${token.type}`);
    }
  }
  return root;
}

function inlineMarkdown(nodes = []) {
  const parts = [];
  let active = [];
  function close(depth) {
    for (let index = active.length - 1; index >= depth; index--) {
      const mark = active[index];
      parts.push(mark.type === 'link' ?
        `](<${mark.attrs.href}>${mark.attrs.title ? ' ' + JSON.stringify(mark.attrs.title) : ''})` :
        { bold: '**', italic: '*', strike: '~~' }[mark.type]);
    }
    active = active.slice(0, depth);
  }
  for (const node of nodes) {
    const marks = (node.marks ?? []).filter(mark => mark.type !== 'code');
    let shared = 0;
    while (shared < active.length && shared < marks.length &&
           JSON.stringify(active[shared]) === JSON.stringify(marks[shared])) shared++;
    close(shared);
    for (const mark of marks.slice(shared)) {
      const delimiter = { bold: '**', italic: '*', strike: '~~', link: '[' }[mark.type];
      if (!delimiter) throw new Error(`无法输出标记 ${mark.type}`);
      parts.push(delimiter);
    }
    active = marks;
    switch (node.type) {
      case 'text':
        if (node.marks?.some(mark => mark.type === 'code')) {
          const tick = '`'.repeat(Math.max(0, ...[...node.text.matchAll(/`+/g)].map(match => match[0].length)) + 1);
          const pad = /^`|`$/.test(node.text) || (/^ .* $/.test(node.text) && /\S/.test(node.text)) ? ' ' : '';
          parts.push(tick + pad + node.text + pad + tick);
        } else {
          parts.push(node.text.replace(/[\\`*_[\]<>~!#|]/g, '\\$&'));
        }
        break;
      case 'image': {
        const { attachmentId, name, src, alt, title } = node.attrs;
        const target = attachmentId ? 'assets/' + name : src;
        parts.push(`![${alt.replace(/[\\\[\]]/g, '\\$&')}](<${target}>${title ? ' ' + JSON.stringify(title) : ''})`);
        break;
      }
      case 'hardBreak':
        parts.push('  \n');
        break;
      case 'softBreak':
        parts.push('\n');
        break;
      default:
        throw new Error(`无法输出行内节点 ${node.type}`);
    }
  }
  close(0);
  return parts.join('');
}

function blockMarkdown(node) {
  const blocks = node.content ?? [];
  switch (node.type) {
    case 'doc':
      return blocks.map(blockMarkdown).join('\n\n');
    case 'paragraph':
      return inlineMarkdown(blocks);
    case 'heading':
      return '#'.repeat(node.attrs.level) + ' ' + inlineMarkdown(blocks);
    case 'blockquote':
      return blocks.map(blockMarkdown).join('\n\n').split('\n').map(line => '> ' + line).join('\n');
    case 'horizontalRule':
      return '---';
    case 'codeBlock': {
      const content = blocks.map(block => block.text).join('');
      const fence = '~'.repeat(Math.max(2, ...[...content.matchAll(/~+/g)].map(match => match[0].length)) + 1);
      return fence + (node.attrs.language ?? '') + '\n' + content + (content && !content.endsWith('\n') ? '\n' : '') + fence;
    }
    case 'bulletList':
    case 'orderedList': {
      const tight = blocks.every(item => item.content.filter(child => child.type === 'paragraph').every(child => child.attrs?.tight));
      return blocks.map((item, index) => {
        const prefix = node.type === 'bulletList' ? '- ' : (node.attrs.start + index) + '. ';
        const lines = item.content.map(blockMarkdown).join(tight ? '\n' : '\n\n').split('\n');
        return prefix + lines.map((line, lineIndex) => lineIndex && line ? ' '.repeat(prefix.length) + line : line).join('\n');
      }).join(tight ? '\n' : '\n\n');
    }
    case 'table': {
      const [header, body] = blocks;
      const cells = header.content[0].content;
      const row = cells => '| ' + cells.map(cell => inlineMarkdown(cell.content)).join(' | ') + ' |';
      const align = cells.map(cell => ({ left: ':---', center: ':---:', right: '---:' })[cell.attrs.align] ?? '---');
      return [row(cells), '| ' + align.join(' | ') + ' |', ...(body?.content ?? []).map(item => row(item.content))].join('\n');
    }
    default:
      throw new Error(`无法输出块节点 ${node.type}`);
  }
}

// Reparse the generated Markdown and reject any semantic change. This is also
// the preflight check for content that needs explicit migration treatment.
export function documentMarkdown(document, resolveImage) {
  const source = blockMarkdown(document);
  if (JSON.stringify(markdownDocument(source, resolveImage)) !== JSON.stringify(document)) {
    throw new Error('正文无法无损转换为 Markdown');
  }
  return source;
}
