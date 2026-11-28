import { noteRequest, saveNoteDownload } from './note-dialog.mjs';

const dialog = document.querySelector('#batch-notes');
const controls = Object.fromEntries([...dialog.querySelectorAll('[data-batch]')]
  .map(element => [element.dataset.batch, element]));
const pageSize = 10;
const selected = new Set();
let works = [];
let page = 0;
let busy = false;

function pageCount() {
  return Math.max(1, Math.ceil(works.length / pageSize));
}

function updateControls() {
  const allSelected = works.length > 0 && selected.size === works.length;
  controls.all.checked = allSelected;
  controls.all.indeterminate = !allSelected && selected.size > 0;
  controls.all.disabled = busy || !works.length;
  controls.close.disabled = busy;
  controls.prev.disabled = busy || page === 0;
  controls.next.disabled = busy || page + 1 === pageCount();
  controls.export.disabled = busy || !selected.size;
  controls.count.textContent = `已选 ${selected.size} / ${works.length}`;
  controls.page.textContent = `第 ${page + 1} / ${pageCount()} 页`;
  for (const checkbox of controls.list.querySelectorAll('input')) {
    checkbox.checked = selected.has(checkbox.value);
    checkbox.disabled = busy;
  }
}

function renderPage() {
  controls.list.replaceChildren();
  if (!works.length) controls.list.textContent = '作品库还没有已保存的笔记。';
  for (const work of works.slice(page * pageSize, (page + 1) * pageSize)) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = work.id;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(work.id);
      else selected.delete(work.id);
      updateControls();
    });
    label.append(checkbox, work.title);
    controls.list.append(label);
  }
  updateControls();
}

export function openBatchNotes(library) {
  works = library.filter(work => work.hasNote)
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  page = 0;
  selected.clear();
  controls.status.textContent = '';
  renderPage();
  dialog.showModal();
}

controls.all.onchange = () => {
  selected.clear();
  if (controls.all.checked) for (const { id } of works) selected.add(id);
  updateControls();
};
controls.prev.onclick = () => { page--; renderPage(); };
controls.next.onclick = () => { page++; renderPage(); };
controls.close.onclick = () => dialog.close();
dialog.addEventListener('cancel', event => {
  if (busy) event.preventDefault();
});

controls.export.onclick = async () => {
  if (busy || !selected.size) return;
  busy = true;
  controls.status.textContent = '正在打包笔记…';
  updateControls();
  try {
    const ids = works.filter(work => selected.has(work.id)).map(work => work.id);
    await saveNoteDownload('chronicle-notes.zip', 'zip', () => noteRequest('/api/notes/export.zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }));
    controls.status.textContent = `已导出 ${ids.length} 份笔记`;
  } catch (error) {
    controls.status.textContent = error.name === 'AbortError' ? '' : error.message;
  } finally {
    busy = false;
    updateControls();
  }
};
