import { checkDocument } from './personal-document-schema.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { documentMarkdown, markdownDocument } from './personal-document.mjs';

test('Markdown token conversion retains structure, marks and owner-resolved image identity', () => {
  const name = '12345678-aaaa-bbbb-cccc-123456789012.png';
  const document = markdownDocument(
    '# 标题\n\n> **粗体**\n\n| 左 | 右 |\n| :-- | --: |\n| A | B |\n\n![说明](./assets/' + name + ')',
    filename => filename === name ? 'asset-id' : undefined,
  );
  assert.deepEqual(document.content.map(node => node.type), ['heading', 'blockquote', 'table', 'paragraph']);
  assert.equal(document.content[1].content[0].content[0].marks[0].type, 'bold');
  assert.equal(document.content[2].content[0].content[1].attrs.align, 'right');
  assert.deepEqual(document.content[3].content[0].attrs, { attachmentId: 'asset-id', name, alt: '说明', title: null });
  assert.match(documentMarkdown(document, () => 'asset-id'), /\| A \| B \|/);
  assert.throws(() => markdownDocument('![图](assets/' + name + ')'), /找不到正文附件/);
});

test('actual ProseMirror schema accepts soft and hard breaks, code blocks, image nodes and supported marks', () => {
  const source = [
    '软换行', '第二行  ', '第三行', '',
    '[**粗体**、*斜体*、~~删除线~~、`代码`](https://example.com "标题")', '',
    '~~~js', 'const x = 1;', '~~~',
  ].join('\n');
  const document = markdownDocument(source);
  const parsed = checkDocument(document);
  const roundtrip = checkDocument(markdownDocument(documentMarkdown(document)));
  assert.ok(parsed.eq(roundtrip));
  assert.equal(parsed.child(0).child(1).type.name, 'softBreak');
  assert.equal(parsed.child(0).child(3).type.name, 'hardBreak');
  assert.equal(parsed.lastChild.attrs.language, 'js');
  const marks = new Set();
  parsed.descendants(node => node.marks.forEach(mark => marks.add(mark.type.name)));
  assert.deepEqual([...marks].sort(), ['bold', 'code', 'italic', 'link', 'strike']);
  assert.throws(() => checkDocument({ type: 'doc', content: [{ type: 'text', text: 'invalid' }] }), /Invalid content/);
  assert.throws(() => markdownDocument('![内嵌](data:image/png;base64,AAAA)'), /附件上传/);
});
