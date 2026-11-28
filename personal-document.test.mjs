import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownDocument } from './personal-document.mjs';

test('Markdown token conversion retains structure, marks and owner-resolved image identity', () => {
  const name = '12345678-aaaa-bbbb-cccc-123456789012.png';
  const document = markdownDocument(
    '# 标题\n\n> **粗体**\n\n| 左 | 右 |\n| :-- | --: |\n| A | B |\n\n![说明](./assets/' + name + ')',
    filename => filename === name ? 'asset-id' : undefined,
  );
  assert.deepEqual(document.content.map(node => node.type), ['heading', 'blockquote', 'table', 'paragraph']);
  assert.equal(document.content[1].content[0].content[0].marks[0].type, 'bold');
  assert.equal(document.content[2].content[0].content[0].content[1].attrs.align, 'right');
  assert.deepEqual(document.content[3].content[0].attrs, { attachmentId: 'asset-id', name, alt: '说明', title: null });
  assert.throws(() => markdownDocument('![图](assets/' + name + ')'), /找不到正文附件/);
});
