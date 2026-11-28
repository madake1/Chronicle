import { getSchema, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Code from '@tiptap/extension-code';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';

const softBreak = Node.create({
  name: 'softBreak', inline: true, group: 'inline', atom: true,
  renderHTML() { return ['span', { 'data-soft-break': '' }, '\n']; },
});
const tableCell = extension => extension.extend({
  addAttributes() { return { ...this.parent(), align: { default: null } }; },
});
export const documentSchema = getSchema([
  StarterKit.configure({ paragraph: false, code: false }),
  Code.extend({ excludes: '' }),
  Node.create({
    name: 'paragraph', group: 'block', content: 'inline*',
    addAttributes() { return { tight: { default: false } }; },
    renderHTML() { return ['p', 0]; },
  }),
  softBreak,
  Image.extend({
    addAttributes() {
      return { ...this.parent(), attachmentId: { default: null }, name: { default: null } };
    },
  }).configure({ inline: true }),
  Table,
  TableRow,
  tableCell(TableHeader),
  tableCell(TableCell),
]);

export function checkDocument(document) {
  const node = documentSchema.nodeFromJSON(document);
  node.check();
  return node;
}
