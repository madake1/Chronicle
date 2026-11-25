export async function noteRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '操作失败，请重试');
  }
  return response;
}

export async function saveNoteDownload(filename, extension, request) {
  const mime = extension === 'zip' ? 'application/zip' : 'text/markdown';
  let file;
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      file = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ accept: { [mime]: [`.${extension}`] } }],
      });
    } catch (error) {
      if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
    }
  }
  const blob = await (await request()).blob();
  if (file) {
    const stream = await file.createWritable();
    try {
      await stream.write(blob);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export function createNoteDialog(dialog) {
  const title = dialog.querySelector('h2');
  const editor = dialog.querySelector('textarea');
  const preview = dialog.querySelector('.note-preview');
  const status = dialog.querySelector('.note-status');
  const image = dialog.querySelector('input[type=file]');
  const controls = Object.fromEntries([...dialog.querySelectorAll('[data-note-action]')]
    .map(button => [button.dataset.noteAction, button]));
  let current;

  function dirty() {
    return dialog.open && current?.editing && editor.value !== current.content;
  }

  function refresh() {
    const { editing, busy, loaded, revision } = current;
    editor.parentElement.hidden = !loaded || !editing;
    preview.hidden = !loaded || editing;
    controls.edit.hidden = !loaded || editing;
    controls.save.hidden = !loaded || !editing;
    controls.image.hidden = !loaded || !editing;
    controls.markdown.hidden = !loaded || revision === null;
    controls.zip.hidden = controls.markdown.hidden;
    for (const button of Object.values(controls)) button.disabled = busy;
    editor.readOnly = busy;
  }

  async function run(action, message = '') {
    if (!current || current.busy) return;
    current.busy = true;
    status.textContent = message;
    refresh();
    try {
      await action();
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = error.message;
    } finally {
      current.busy = false;
      refresh();
    }
  }

  function showEditor() {
    current.editing = true;
    refresh();
    editor.focus();
  }

  function showPreview(html) {
    preview.innerHTML = html; // The server renders Markdown with raw HTML disabled.
    if (!preview.hasChildNodes()) preview.textContent = '这份笔记目前是空白的。';
  }

  function close() {
    if (!current || current.busy) return;
    if (dirty() && !confirm('笔记还没保存。要放弃这次修改吗？')) return;
    dialog.close();
  }

  function open({ title: noteTitle, url, onSaved }) {
    if (dialog.open) return;
    current = { onSaved, url, noteTitle,
      content: '', revision: null, editing: false, busy: false, loaded: false };
    title.textContent = `${noteTitle} · 笔记`;
    editor.value = '';
    preview.replaceChildren();
    image.value = '';
    refresh();
    dialog.showModal();
    window.addEventListener('beforeunload', warnBeforeUnload);
    void run(async () => {
      const note = await (await noteRequest(current.url)).json();
      current.content = editor.value = note.content;
      current.revision = note.revision;
      current.loaded = true;
      showPreview(note.html);
      if (note.revision === null) showEditor();
      else title.focus();
      status.textContent = '';
    }, '正在打开笔记…');
  }

  controls.edit.onclick = showEditor;
  controls.close.onclick = close;
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  function warnBeforeUnload(event) {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  dialog.addEventListener('close', () => {
    if (!dialog.open) window.removeEventListener('beforeunload', warnBeforeUnload);
  });
  controls.save.onclick = () => run(async () => {
    const note = await (await noteRequest(current.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editor.value, revision: current.revision }),
    })).json();
    current.content = note.content;
    current.revision = note.revision;
    current.editing = false;
    showPreview(note.html);
    current.onSaved?.(note);
    title.focus();
    status.textContent = '笔记已保存';
  }, '正在保存…');

  controls.image.onclick = () => image.click();
  image.onchange = () => {
    const file = image.files[0];
    image.value = '';
    if (!file) return;
    const { selectionStart, selectionEnd } = editor;
    void run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error('每张图片最多 8 MB');
      const { path } = await (await noteRequest(`${current.url}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })).json();
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').trim() || '插图';
      editor.setRangeText(`\n![${alt}](${path})\n`, selectionStart, selectionEnd, 'end');
      editor.focus();
      status.textContent = '图片已插入，保存笔记后即可阅读和导出';
    }, '正在上传图片…');
  };

  function download(extension) {
    if (dirty()) {
      status.textContent = '请先保存编辑内容，再导出笔记';
      return;
    }
    const name = current.noteTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100) || 'note';
    void run(async () => {
      await saveNoteDownload(`${name}.${extension}`, extension,
        () => noteRequest(`${current.url}/export.${extension}`));
      status.textContent = '已导出笔记';
    });
  }

  controls.markdown.onclick = () => download('md');
  controls.zip.onclick = () => download('zip');
  return { open };
}
