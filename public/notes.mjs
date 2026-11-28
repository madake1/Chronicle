import { createNoteDialog } from './note-dialog.mjs';

const dialog = createNoteDialog(document.querySelector('#note-dialog'));

export function openNote(work, onSaved) {
  dialog.open({
    title: work.title,
    url: `/api/works/${encodeURIComponent(work.id)}/note`,
    relatedUrl: `/knowledge?related=${encodeURIComponent(`work-note:${work.id}`)}`,
    onSaved: note => onSaved(note.hasNote),
  });
}
