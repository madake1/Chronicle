import { createNoteDialog, noteRequest } from './note-dialog.mjs';
import { createTagManager } from './tag-manager.mjs';

const $ = id => document.getElementById(id);
const base = '/api/knowledge';
const params = new URLSearchParams(location.search);
const types = { knowledge: '知识', work: '作品', 'work-note': '作品笔记' };
$('note-dialog').querySelector('.note-editor').after($('metadata-template').content);
const editor = createNoteDialog($('note-dialog'), { entity: '知识', untitledFile: '无标题知识' });
const entityKey = item => `${item.type}:${item.id}`;
const entityLabel = item => item.title || item.excerpt || '无标题知识';
const collapsedTags = new Set();
const recordDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
let tags = [], selectedTag = '', selectedNote = null, metadata;
let visibleNotes = new Set();
let relatedTo = params.get('related'), listVersion = 0, readerVersion = 0;

function el(tag, text, className) {
  const item = document.createElement(tag);
  if (text != null) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function button(text, action) {
  const item = el('button', text);
  item.type = 'button';
  item.onclick = action;
  return item;
}
async function json(url, method = 'GET', payload) {
  const options = { method };
  if (payload !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(payload);
  }
  return (await noteRequest(url, options)).json();
}
function report(error) { $('knowledge-status').textContent = error.message; }
function tagPaths(parent = null, prefix = '') {
  return tags.filter(tag => tag.parentId === parent).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .flatMap(tag => {
      const path = prefix ? `${prefix} / ${tag.name}` : tag.name;
      return [{ ...tag, path }, ...tagPaths(tag.id, path)];
    });
}
function tree(parent = null) {
  const items = tags.filter(tag => tag.parentId === parent).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const list = el('ul');
  for (const tag of items) {
    const item = el('li');
    const line = el('div', null, 'tag-line');
    const control = button(tag.name, () => browse(tag.id));
    control.setAttribute('aria-pressed', String(selectedTag === tag.id));
    control.className = 'tag-filter';
    control.append(el('span', tag.count, 'tag-count'));
    if (tags.some(child => child.parentId === tag.id)) {
      const children = tree(tag.id);
      children.id = `tag-group-${tag.id}`;
      const toggle = button('', () => {
        if (collapsedTags.has(tag.id)) collapsedTags.delete(tag.id);
        else collapsedTags.add(tag.id);
        updateToggle();
      });
      toggle.className = 'tag-toggle';
      toggle.setAttribute('aria-controls', children.id);
      function updateToggle() {
        const expanded = !collapsedTags.has(tag.id);
        children.hidden = !expanded;
        toggle.textContent = expanded ? '▾' : '▸';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}${tag.name}下的标签`);
      }
      updateToggle();
      line.append(toggle, control);
      item.append(line, children);
    } else {
      line.append(control);
      item.append(line);
    }
    list.append(item);
  }
  return list;
}
function browse(tag) {
  supersedeReaderRequest();
  selectedTag = tag;
  relatedTo = null;
  if (mobile.matches) $('tag-index').open = false;
  const url = new URL(location.href);
  url.searchParams.delete('related');
  history.replaceState(null, '', url);
  void loadList().catch(report);
}
async function loadList() {
  const version = ++listVersion;
  const query = new URLSearchParams();
  if (selectedTag) query.set('tag', selectedTag);
  if (relatedTo) query.set('related', relatedTo);
  if ($('knowledge-search').value.trim()) query.set('q', $('knowledge-search').value.trim());
  const result = await json(`${base}?${query}`);
  if (version !== listVersion) return;
  visibleNotes = new Set(result.notes.map(note => note.id));
  if (selectedNote && !visibleNotes.has(selectedNote)) closeReader();
  tags = result.tags;
  $('tag-tree').replaceChildren(tags.length ? tree() : el('p', '还没有标签', 'meta'));
  $('list-heading').textContent = relatedTo ? `${result.relatedTarget ? entityLabel(result.relatedTarget) : '此条目'}的关联知识` :
    selectedTag === 'untagged' ? '无标签知识' : tags.find(tag => tag.id === selectedTag)?.name ?? '全部知识';
  $('all').setAttribute('aria-pressed', String(!relatedTo && !selectedTag));
  $('untagged').setAttribute('aria-pressed', String(selectedTag === 'untagged'));
  $('list-count').textContent = `${result.notes.length} 条`;
  const rows = result.notes.map(note => {
    const row = el('article', null, 'knowledge-row');
    row.dataset.noteId = note.id;
    const open = button('', () => {
      if (selectedNote === note.id) closeReader();
      else void showNote(note.id).catch(report);
    });
    open.className = 'knowledge-entry';
    open.setAttribute('aria-expanded', String(note.id === selectedNote && !$('reader').hidden));
    open.setAttribute('aria-controls', 'reader');
    if (note.title) open.append(el('strong', note.title));
    open.append(el('span', note.excerpt, 'knowledge-excerpt'));
    row.append(open);
    const names = note.tagIds.map(id => tags.find(tag => tag.id === id)?.name).filter(Boolean);
    const footer = el('div', null, 'entry-meta');
    for (const name of names) footer.append(el('span', name, 'knowledge-tag'));
    const time = el('time', recordDate.format(new Date(note.createdAt)), 'meta');
    time.dateTime = note.createdAt;
    footer.append(time);
    row.append(footer);
    return row;
  });
  const reader = $('reader');
  $('knowledge-list').after(reader);
  $('knowledge-list').replaceChildren(...(rows.length ? rows : [el('p', '没有符合条件的知识', 'meta')]));
  placeReader();
  return visibleNotes;
}
function placeReader() {
  const reader = $('reader');
  $('knowledge-list').after(reader);
  for (const row of $('knowledge-list').children) {
    const isOpen = !reader.hidden && row.dataset.noteId === selectedNote;
    row.querySelector('.knowledge-entry')?.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) row.append(reader);
  }
}
function closeReader() {
  ++readerVersion;
  selectedNote = null;
  const reader = $('reader');
  reader.hidden = true;
  $('knowledge-list').after(reader);
  placeReader();
  const url = new URL(location.href);
  url.searchParams.delete('note');
  history.replaceState(null, '', url);
}
function supersedeReaderRequest() {
  if (selectedNote && $('reader').hidden) closeReader();
  else ++readerVersion;
}
function editBody(note = null) {
  const id = note?.id ?? crypto.randomUUID();
  editor.open({
    title: note?.title,
    heading: note ? undefined : '记录知识',
    url: `${base}/${id}`,
    draft: !note,
    edit: true,
    metadata: {
      load: value => loadMetadata(id, value),
      value: metadataInput,
      dirty: () => JSON.stringify(metadataInput()) !== metadata.initial,
    },
    onSaved: async () => {
      const intent = readerVersion;
      try {
        const visible = await loadList();
        if (visible?.has(id) && intent === readerVersion) await showNote(id);
      } catch (error) { report(error); }
    },
  });
}
async function showNote(id, { external = false } = {}) {
  if (!external && !visibleNotes.has(id)) return;
  if (selectedNote !== id) {
    $('reader').hidden = true;
    placeReader();
  }
  selectedNote = id;
  const version = ++readerVersion;
  let note;
  try {
    note = await json(`${base}/${id}`);
  } catch (error) {
    if (version !== readerVersion) return;
    closeReader();
    throw error;
  }
  if (version !== readerVersion) return;
  const url = new URL(location.href);
  url.searchParams.set('note', id);
  history.replaceState(null, '', url);
  const time = el('p', `记录于 ${recordDate.format(new Date(note.createdAt))}`, 'meta');
  const article = el('article', null, 'note-preview');
  article.innerHTML = note.html;
  const actions = el('div', null, 'knowledge-actions');
  actions.append(button('编辑知识', () => editBody(note)),
    button('删除知识', async () => {
      if (!confirm('删除这条知识及其关联？')) return;
      try {
        await json(`${base}/${id}`, 'DELETE');
        if (selectedNote === id) {
          closeReader();
        }
        await loadList();
        $('knowledge-status').textContent = '知识已删除';
      } catch (error) { report(error); }
    }));
  const links = el('section', null, 'detail-section');
  if (note.related.length) {
    links.append(el('h3', '关联条目'));
    for (const item of note.related) {
      links.append(button(`${types[item.type]} · ${entityLabel(item)}`, () => preview(item).catch(report)));
    }
  }
  const names = note.tagIds.map(id => tags.find(tag => tag.id === id)?.name).filter(Boolean);
  $('reader').replaceChildren();
  if (note.title || !visibleNotes.has(id)) $('reader').append(el('h3', note.title || '无标题知识'));
  $('reader').append(time);
  if (names.length) $('reader').append(el('p', names.join(' · '), 'meta'));
  $('reader').append(article, actions);
  if (note.related.length) $('reader').append(links);
  $('reader').hidden = false;
  placeReader();
}
async function preview(item) {
  const dialog = $('related-preview');
  const body = dialog.querySelector('article');
  $('related-title').textContent = entityLabel(item);
  const jump = $('related-jump');
  const id = encodeURIComponent(item.id);
  if (item.type === 'knowledge') {
    const note = await json(`${base}/${id}`);
    body.innerHTML = note.html;
    jump.href = `/knowledge?note=${id}`;
  } else if (item.type === 'work-note') {
    const note = await json(`/api/works/${id}/note`);
    body.innerHTML = note.html;
    jump.href = `/?work=${id}&note=1`;
  } else {
    const work = (await json('/api/works')).find(work => work.id === item.id);
    body.replaceChildren(el('p', [work?.type, work?.region, work?.period].filter(Boolean).join(' · '), 'meta'),
      el('p', work?.synopsis || '暂无作品简介'));
    jump.href = `/?work=${id}`;
  }
  dialog.showModal();
}
function options(control, first) {
  control.replaceChildren(new Option(first, ''), ...tagPaths().map(tag => new Option(tag.path, tag.id)));
}
function choice(text, key, selected) {
  const label = el('label');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = selected.has(key);
  input.onchange = () => input.checked ? selected.add(key) : selected.delete(key);
  label.append(input, text);
  return label;
}
function metadataChoices() {
  const query = $('tag-search').value.trim().toLowerCase();
  $('tag-choices').replaceChildren(...tagPaths().filter(tag => tag.path.toLowerCase().includes(query))
    .map(tag => choice(tag.path, tag.id, metadata.tags)));
}
let targetVersion = 0;
let targetTimer;
function searchTargets() {
  clearTimeout(targetTimer);
  const version = ++targetVersion;
  if (!$('relation-fields').open) return;
  const query = new URLSearchParams({ q: $('target-search').value });
  $('target-choices').replaceChildren(el('p', '正在查找关联条目…', 'meta'));
  targetTimer = setTimeout(async () => {
    try {
      const targets = await json(`${base}/targets?${query}`);
      if (version !== targetVersion) return;
      const choices = targets.filter(item => entityKey(item) !== `knowledge:${metadata.note.id}`)
        .map(item => choice(`${types[item.type]} · ${entityLabel(item)}`, entityKey(item), metadata.links));
      $('target-choices').replaceChildren(...(choices.length ? choices : [el('p', '没有匹配的关联条目', 'meta')]));
    } catch (error) {
      if (version === targetVersion) $('target-choices').textContent = error.message;
    }
  }, 140);
}
function metadataInput() {
  const related = [...metadata.links].sort().map(value => {
    const [type, id] = value.split(':');
    return { type, id };
  });
  return { title: $('metadata-title').value, tagIds: [...metadata.tags].sort(), related, version: metadata.note.metadataVersion };
}
function loadMetadata(id, note) {
  metadata = { note: note ?? { id, metadataVersion: null }, tags: new Set(note?.tagIds), links: new Set(note?.related?.map(entityKey)) };
  $('metadata-title').value = note?.title ?? '';
  $('tag-fields').open = $('relation-fields').open = false;
  searchTargets();
  $('tag-search').value = $('target-search').value = $('inline-tag').value = '';
  $('metadata-error').textContent = '';
  options($('inline-parent'), '无上级');
  metadataChoices();
  metadata.initial = JSON.stringify(metadataInput());
}
async function changeTag(id, method, payload) {
  const result = await json(id ? `${base}/tags/${id}` : `${base}/tags`, method, payload);
  if (method === 'DELETE' && selectedTag === id) selectedTag = result.parentId ?? '';
  const visible = await loadList();
  if (visible?.has(selectedNote) && $('tag-dialog').open) await showNote(selectedNote);
  return result;
}
for (const control of document.querySelectorAll('[data-close]')) control.onclick = () => control.closest('dialog').close();
$('new-note').onclick = () => editBody();
$('all').onclick = () => browse('');
$('untagged').onclick = () => browse('untagged');
let searchTimer;
$('knowledge-search').oninput = () => {
  clearTimeout(searchTimer);
  ++listVersion;
  supersedeReaderRequest();
  searchTimer = setTimeout(() => void loadList().catch(report), 160);
};
const tagManager = createTagManager($('tag-dialog'), { paths: tagPaths, changeTag });
$('manage-tags').onclick = () => tagManager.open();
$('tag-search').oninput = metadataChoices;
$('target-search').oninput = searchTargets;
$('relation-fields').ontoggle = searchTargets;
$('inline-add').onclick = async () => {
  try {
    const tag = await changeTag('', 'POST', { name: $('inline-tag').value, parentId: $('inline-parent').value || null });
    metadata.tags.add(tag.id);
    $('inline-tag').value = $('tag-search').value = '';
    options($('inline-parent'), '无上级');
    metadataChoices();
  } catch (error) { $('metadata-error').textContent = error.message; }
};
const mobile = matchMedia('(max-width: 700px)');
function syncTagIndex() { $('tag-index').open = !mobile.matches; }
syncTagIndex();
mobile.addEventListener('change', syncTagIndex);

const root = document.documentElement;
root.dataset.theme = localStorage.getItem('chronicle-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
};
try {
  const visible = await loadList();
  const linkedNote = params.get('note');
  if (visible && linkedNote && !selectedNote) await showNote(linkedNote, { external: true });
} catch (error) { report(error); }
