import { link, readerBar, restoreReading } from './knowledge-reader.mjs';
import { chooseArticle, mountTopics, topicHref } from './topics.mjs';
import { annotationEditor } from './annotation-editor.mjs';
import { createNoteDialog, noteRequest } from './note-dialog.mjs';
import { createTagManager } from './tag-manager.mjs';

const $ = id => document.getElementById(id);
const base = '/api/knowledge';
const params = new URLSearchParams(location.search);
const topicsMode = params.get('section') === 'topics';
let selectedTopic = params.get('topic') ?? '';
let collection = params.get('collection') ?? (selectedTopic === 'unfiled' ? 'unfiled' : '');
if (selectedTopic === 'unfiled') selectedTopic = '';
if (!['filed', 'unfiled'].includes(collection)) collection = '';
const types = { knowledge: '知识', work: '作品', 'work-note': '作品笔记' };
$('note-dialog').querySelector('.note-editor').after($('metadata-template').content);
const editor = createNoteDialog($('note-dialog'), { entity: '知识', untitledFile: '无标题知识' });
const entityKey = item => `${item.type}:${item.id}`;
const entityLabel = item => item.title || item.excerpt || '无标题知识';
const expandedTags = new Set();
let revealLinkedTag = params.has('tag');
const recordDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
let tags = [], selectedTag = params.get('tag') ?? '', selectedNote = null, metadata;
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
    control.dataset.tagControl = 'select-' + tag.id;
    control.append(el('span', tag.count, 'tag-count'));
    if (tags.some(child => child.parentId === tag.id)) {
      const children = tree(tag.id);
      children.id = `tag-group-${tag.id}`;
      const toggle = button('', () => {
        if (expandedTags.has(tag.id)) expandedTags.delete(tag.id);
        else expandedTags.add(tag.id);
        updateToggle();
      });
      toggle.className = 'tag-toggle';
      toggle.dataset.tagControl = 'expand-' + tag.id;
      toggle.setAttribute('aria-controls', children.id);
      function updateToggle() {
        const expanded = expandedTags.has(tag.id);
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
function writeFilterUrl() {
  const url = new URL(location.href);
  const values = { tag: selectedTag, topic: selectedTopic, collection, related: relatedTo,
    q: $('knowledge-search').value.trim() };
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
}
function reloadFilters() {
  clearTimeout(searchTimer);
  supersedeReaderRequest();
  writeFilterUrl();
  void loadList().catch(report);
}
function browse(tag) {
  selectedTag = tag;
  relatedTo = null;
  reloadFilters();
}
function renderFilters(result) {
  const filters = $('record-filters');
  filters.replaceChildren();
  function chip(label, callback) {
    const item = button(label + ' ×', callback);
    item.setAttribute('aria-label', '清除' + label);
    filters.append(item);
  }
  if (collection) chip(collection === 'filed' ? '已收录' : '未收录', () => {
    collection = '';
    $('collection-filter').value = '';
    reloadFilters();
  });
  if (selectedTopic) chip(result.topicTitle ? '专题范围 · ' + result.topicTitle : '专题范围已失效', () => {
    selectedTopic = '';
    reloadFilters();
  });
  filters.hidden = !filters.childElementCount;
}
async function loadList() {
  const version = ++listVersion;
  const query = new URLSearchParams();
  if (selectedTag) query.set('tag', selectedTag);
  if (relatedTo) query.set('related', relatedTo);
  if (selectedTopic) query.set('topic', selectedTopic);
  if (collection) query.set('collection', collection);
  if ($('knowledge-search').value.trim()) query.set('q', $('knowledge-search').value.trim());
  const result = await json(`${base}?${query}`);
  if (version !== listVersion) return;
  visibleNotes = new Set(result.notes.map(note => note.id));
  if (selectedNote && !visibleNotes.has(selectedNote)) closeReader();
  tags = result.tags;
  if (revealLinkedTag) {
    const parents = new Map(tags.map(tag => [tag.id, tag.parentId]));
    for (let id = parents.get(selectedTag); id && !expandedTags.has(id); id = parents.get(id)) expandedTags.add(id);
    revealLinkedTag = false;
  }
  const focusedTag = document.activeElement?.dataset.tagControl;
  $('tag-tree').replaceChildren(tags.length ? tree() : el('p', '还没有标签', 'meta'));
  if (focusedTag) $('tag-tree').querySelector(`[data-tag-control="${CSS.escape(focusedTag)}"]`)?.focus({ preventScroll: true });
  $('list-heading').textContent = relatedTo ? `${result.relatedTarget ? entityLabel(result.relatedTarget) : '此条目'}的关联知识` :
    selectedTag === 'untagged' ? '无标签知识' : tags.find(tag => tag.id === selectedTag)?.name ?? '全部知识';
  renderFilters(result);
  $('all').setAttribute('aria-pressed', String(!relatedTo && !selectedTag && !selectedTopic && !collection && !$('knowledge-search').value.trim()));
  $('untagged').setAttribute('aria-pressed', String(selectedTag === 'untagged'));
  $('list-count').textContent = `${result.notes.length} 条`;
  const rows = result.notes.map(note => {
    const row = el('article', null, 'knowledge-row');
    row.dataset.noteId = note.id;
    const open = button('', () => {
      if (selectedNote === note.id) closeReader(true);
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
function closeReader(restore = false) {
  const original = document.querySelector(`[data-note-id="${CSS.escape(selectedNote ?? '')}"] .knowledge-entry`);
  ++readerVersion;
  selectedNote = null;
  const reader = $('reader');
  reader.hidden = true;
  $('knowledge-list').after(reader);
  placeReader();
  const url = new URL(location.href);
  url.searchParams.delete('note');
  history.replaceState(null, '', url);
  if (restore) restoreReading(original);
}
function supersedeReaderRequest() {
  if (selectedNote && $('reader').hidden) closeReader();
  else ++readerVersion;
}
function editBody(note = null, onSave) {
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
      dirty: () => {
        try { return JSON.stringify(metadataInput()) !== metadata.initial; }
        catch { return true; }
      },
    },
    onSaved: async saved => {
      if (onSave) {
        $('note-dialog').close();
        try { await onSave(saved); } catch (error) { report(error); }
        return;
      }
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
  const topics = el('section', null, 'detail-section');
  const topicList = el('div', null, 'knowledge-memberships');
  topics.append(el('h3', '所属专题'), topicList, button('加入专题文章', () => {
    void chooseArticle(id, renderMembership);
  }));
  async function renderMembership() {
    try {
      const { references } = await json(`${base}/${id}/topics`);
      if (version !== readerVersion) return;
      const counts = new Map();
      const displayed = new Map();
      for (const item of references) counts.set(item.articleId, (counts.get(item.articleId) ?? 0) + 1);
      topicList.replaceChildren(...references.map(item => {
        const next = (displayed.get(item.articleId) ?? 0) + 1;
        displayed.set(item.articleId, next);
        const suffix = counts.get(item.articleId) > 1 ? ` · 引用 ${next}` : '';
        return link(`${item.topicTitle} / ${item.articleTitle}${suffix}`, topicHref(item.topicId, item.articleId, item.blockId));
      }));
      if (!references.length) topicList.append(el('span', '未收录', 'meta'));
    } catch (error) {
      if (version === readerVersion) topicList.textContent = error.message;
    }
  }
  const actions = [button('编辑知识', () => editBody(note)),
    button('关闭', () => closeReader(true)),
    button('删除知识', async () => {
      try {
        const { impact } = await json(`${base}/${id}/topics`);
        if (!confirm(`删除这条知识？它被 ${impact.topics} 个专题的 ${impact.articles} 篇文章引用，${impact.references} 处引用将保留已删除占位。`)) return;
        await json(`${base}/${id}?topicImpact=${impact.version}`, 'DELETE');
        if (selectedNote === id) closeReader();
        await loadList();
        $('knowledge-status').textContent = '知识已删除';
      } catch (error) { report(error); }
    })];
  const links = el('section', null, 'detail-section');
  if (note.related.length) {
    links.append(el('h3', '关联条目'));
    for (const item of note.related) {
      links.append(button(`${types[item.type]} · ${entityLabel(item)}`, () => preview(item).catch(report)));
    }
  }
  const names = note.tagIds.map(id => tags.find(tag => tag.id === id)?.name).filter(Boolean);
  $('reader').replaceChildren();
  $('reader').append(readerBar(note.title, actions));
  $('reader').append(time);
  if (names.length) $('reader').append(el('p', names.join(' · '), 'meta'));
  $('reader').append(article, topics);
  void renderMembership();
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
const noteAnnotations = annotationEditor($('note-annotations'), $('add-note-annotation'));

function metadataInput() {
  const related = [...metadata.links].sort().map(value => {
    const [type, id] = value.split(':');
    return { type, id };
  });
  return { title: $('metadata-title').value, tagIds: [...metadata.tags].sort(), related, annotations: noteAnnotations.value(), version: metadata.note.metadataVersion };
}
function loadMetadata(id, note) {
  metadata = { note: note ?? { id, metadataVersion: null }, tags: new Set(note?.tagIds), links: new Set(note?.related?.map(entityKey)) };
  $('metadata-title').value = note?.title ?? '';
  noteAnnotations.load(note?.annotations);
  $('annotation-fields').open = false;
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
  if (method === 'DELETE') {
    expandedTags.delete(id);
    if (selectedTag === id) {
      selectedTag = result.parentId ?? '';
      writeFilterUrl();
    }
  }
  const visible = await loadList();
  if (visible?.has(selectedNote) && $('tag-dialog').open) await showNote(selectedNote);
  return result;
}
for (const control of document.querySelectorAll('[data-close]')) control.onclick = () => control.closest('dialog').close();
$('new-note').onclick = () => editBody();
$('all').onclick = () => {
  selectedTopic = selectedTag = collection = '';
  relatedTo = null;
  $('collection-filter').value = $('knowledge-search').value = '';
  reloadFilters();
};
$('untagged').onclick = () => browse('untagged');
$('collection-filter').onchange = event => { collection = event.target.value; reloadFilters(); };
let searchTimer;
$('knowledge-search').oninput = () => {
  clearTimeout(searchTimer);
  ++listVersion;
  supersedeReaderRequest();
  writeFilterUrl();
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
if (topicsMode) {
  $('records-area').hidden = true;
  $('topics-area').hidden = false;
  $('records-nav').removeAttribute('aria-current');
  $('topics-nav').setAttribute('aria-current', 'page');
  void mountTopics($('topics-area'), params, async (note, done) => {
    try {
      tags = (await json(base + '/tags')).tags;
      editBody(note, done);
    } catch (error) {
      const status = $('topics-area').querySelector('[role=alert]');
      status.textContent = error.message;
    }
  });
} else {
  $('knowledge-search').value = params.get('q') ?? '';
  $('collection-filter').value = collection;
  writeFilterUrl();
  try {
    const visible = await loadList();
    const linkedNote = params.get('note');
    if (visible && linkedNote && !selectedNote) await showNote(linkedNote, { external: true });
  } catch (error) { report(error); }
}
