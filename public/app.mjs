import { annotationEditor } from './annotation-editor.mjs';
import { describe, formatSegmentYears } from './chronology.mjs';
import { openNote } from './notes.mjs';
import { openBatchNotes } from './batch-notes.mjs';
import { experienceError } from './experience.mjs';
import { workKnowledgeSection } from './work-knowledge.mjs';

const $ = id => document.getElementById(id);
const types = ['游戏', '小说', '电影', '电视剧', '其他'];
const statuses = ['未开始', '进行中', '已完成', '已放弃'];
const state = { works: [], selected: null, ready: false };
const form = $('edit-form');
let editing;
let saving = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, action, className) {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function options(select, values, placeholder) {
  if (placeholder) select.append(new Option(placeholder, ''));
  for (const value of values) select.append(new Option(value));
}

function notify(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

function firstYear(work) {
  return datedSegments(work).reduce((first, segment) => Math.min(first, segment.start), Infinity);
}

function filtered() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const type = $('type-filter').value;
  const status = $('status-filter').value;
  return state.works.filter(work => work.title.toLocaleLowerCase().includes(query) &&
    (!type || work.type === type) && (!status || work.status === status));
}

function select(work) {
  state.selected = work.id;
  render();
  $('detail-title')?.focus({ preventScroll: true });
}

function noteButton(work) {
  const control = button(work.notePath ? '查看笔记' : '创建笔记', () => {
    openNote(work, notePath => {
      work.notePath = notePath;
      for (const item of document.querySelectorAll('[data-note-work]')) {
        if (item.dataset.noteWork === work.id) {
          item.textContent = '查看笔记';
          item.setAttribute('aria-label', `${work.title} · 查看笔记`);
        }
      }
    });
  });
  control.dataset.noteWork = work.id;
  control.setAttribute('aria-label', `${work.title} · ${control.textContent}`);
  return control;
}

function renderLibrary(works) {
  const table = node('table');
  const header = table.createTHead().insertRow();
  for (const title of ['作品', '笔记', '类型', '体验状态', '体验时间', '故事年代', '评分']) header.append(node('th', title));
  const body = table.createTBody();
  const comparer = {
    recent: (a, b) => (b.experience?.endedOn ?? b.experience?.startedOn ?? '')
      .localeCompare(a.experience?.endedOn ?? a.experience?.startedOn ?? ''),
    year: (a, b) => firstYear(a) - firstYear(b),
    title: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
    rating: (a, b) => (b.rating || -1) - (a.rating || -1),
  }[$('sort').value];
  for (const work of [...works].sort(comparer)) {
    const row = body.insertRow();
    row.classList.toggle('selected', state.selected === work.id);
    row.insertCell().append(button(work.title, () => select(work), 'row-name'));
    row.insertCell().append(noteButton(work));
    for (const value of [work.type, work.status, experienceDates(work.experience, { compact: true }),
      datedSegments(work).map(formatSegmentYears).join('；') || '年代未知', work.rating || '—']) {
      row.insertCell().textContent = value;
    }
  }
  $('library').replaceChildren(works.length ? table : node('p', '没有符合条件的作品。', 'empty'));
}

const experienceFields = ['startedOn', 'endedOn', 'durationMinutes'];

function experienceDates({ startedOn, endedOn } = {}, { compact = false } = {}) {
  const start = compact ? startedOn?.slice(2).replaceAll('-', '') : startedOn;
  const end = compact ? endedOn?.slice(2).replaceAll('-', '') : endedOn;
  if (start && end) return `${start} – ${end}`;
  if (start) return `${start} 开始`;
  return end ? `${end} 结束` : '';
}

function renderDetails(work) {
  const panel = $('details');
  panel.hidden = !work;
  panel.replaceChildren();
  if (!work) return;
  const header = node('div', undefined, 'detail-head');
  const title = node('h2', work.title);
  title.id = 'detail-title';
  title.tabIndex = -1;
  const close = button('×', () => {
    state.selected = null;
    render();
  });
  close.setAttribute('aria-label', '关闭详情');
  header.append(title, close);
  panel.append(header, node('p', [work.type, work.status, work.rating && `${work.rating}/10`].filter(Boolean).join(' · '), 'meta'));
  const actions = node('div', undefined, 'detail-actions');
  const introduction = node('section', undefined, 'detail-section');
  introduction.append(node('h3', '作品简介'));
  if (work.synopsis) introduction.append(node('p', work.synopsis));
  const storyYears = datedSegments(work).map(describe).join('；') || '年代未知';
  const context = [storyYears, work.region, work.period, work.basis].filter(Boolean).join(' · ');
  introduction.append(node('p', context, 'meta'));
  if (work.links) {
    for (const value of work.links.split('\n').map(line => line.trim()).filter(Boolean)) {
      const paragraph = node('p', undefined, 'meta');
      const namedLink = /^\[([^\]]+)\]\((https?:\/\/\S+)\)$/i.exec(value);
      const href = namedLink?.[2] ?? value;
      if (/^https?:\/\//i.test(href)) {
        const link = node('a', namedLink?.[1] ?? href);
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        paragraph.append(link);
      } else paragraph.textContent = value;
      introduction.append(paragraph);
    }
  }
  panel.append(introduction);
  const progress = experienceDates(work.experience);
  const duration = work.experience?.durationMinutes;
  if (work.notes || progress || duration !== undefined) {
    const section = node('section', undefined, 'detail-section');
    section.append(node('h3', '我的体验'));
    if (work.notes) section.append(node('p', work.notes));
    const details = node('p', progress, 'meta');
    if (duration !== undefined) {
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      const time = hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
      if (progress) details.append(' · ');
      details.append(node('small', `体验时长 ${time}`));
    }
    if (progress || duration !== undefined) section.append(details);
    panel.append(section);
  }
  for (const segment of work.segments) {
    if (segment.start === undefined && segment.longitude === undefined) continue;
    const label = segment.start === undefined ? segment.place || '年代未知地点' : describe(segment);
    const key = `work:${work.id}:${segment.id}`;
    const link = node('a', `定位：${label}`, 'nav-link');
    link.href = '/spacetime?annotation=' + encodeURIComponent(key) +
      (segment.longitude === undefined ? '' : '&view=both');
    actions.append(link);
  }
  actions.append(button('编辑作品', () => openEditor(work)), button('删除作品', async () => {
    if (!confirm(`删除《${work.title}》？`)) return;
    try {
      await persist(state.works.filter(item => item.id !== work.id));
      state.selected = null;
      notify('作品已删除');
      render();
    } catch (error) { notify(error.message); }
  }, 'detail-delete'));
  panel.append(workKnowledgeSection(work));
  panel.append(actions);
}

function render() {
  $('add').disabled = !state.ready;
  $('export-notes').disabled = !state.ready;
  const works = filtered();
  const unknown = works.filter(work => !datedSegments(work).length).length;
  $('summary').textContent = `${works.length} 部作品${unknown ? ` · ${unknown} 部年代未知` : ''}`;
  renderDetails(state.works.find(work => work.id === state.selected));
  renderLibrary(works);
}

const storyEditor = annotationEditor($('segment-fields'), $('add-segment'));
const datedSegments = work => work.segments.filter(segment => segment.start !== undefined);
let version;

function openEditor(work) {
  editing = work;
  form.reset();
  $('edit-title').textContent = work ? '编辑作品' : '新增作品';
  $('form-error').textContent = '';
  storyEditor.load(work?.segments);
  if (work) {
    for (const name of ['title', 'type', 'status', 'region', 'period', 'basis', 'rating', 'synopsis', 'notes', 'links']) {
      form.elements.namedItem(name).value = work[name] ?? '';
    }
    for (const name of experienceFields) form.elements.namedItem(name).value = work.experience?.[name] ?? '';
  }
  $('editor').showModal();
}

async function persist(works) {
  if (saving) throw new Error('正在保存，请稍候');
  saving = true;
  try {
    const response = await fetch('/api/works', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': version },
      body: JSON.stringify(works),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    version = response.headers.get('ETag');
    state.works = works;
  } finally { saving = false; }
}

options($('type-filter'), types, '全部类型');
options($('status-filter'), statuses, '全部状态');
options(form.elements.namedItem('type'), types);
options(form.elements.namedItem('status'), statuses);
for (const id of ['search', 'type-filter', 'status-filter', 'sort']) $(id).addEventListener('input', render);
$('add').onclick = () => openEditor();
$('export-notes').onclick = () => openBatchNotes(state.works);
for (const id of ['cancel', 'cancel-top']) $(id).onclick = () => {
  if (!saving) $('editor').close();
};
$('editor').addEventListener('cancel', event => {
  if (saving) event.preventDefault();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  $('form-error').textContent = '';
  $('save').disabled = true;
  try {
    const fields = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
    if (!fields.title) throw new Error('请输入作品名称');
    const experience = { ...editing?.experience };
    for (const name of experienceFields) {
      if (fields[name]) experience[name] = name === 'durationMinutes' ? Number(fields[name]) : fields[name];
      else delete experience[name];
      delete fields[name];
    }
    const error = experienceError(experience);
    if (error) throw new Error(error);
    const work = {
      ...editing,
      ...fields,
      experience: Object.keys(experience).length ? experience : undefined,
      id: editing?.id || crypto.randomUUID(),
      segments: storyEditor.value(),
    };
    await persist(editing ? state.works.map(item => item.id === work.id ? work : item) : [...state.works, work]);
    state.selected = work.id;
    $('editor').close();
    notify('作品已保存');
    render();
  } catch (error) { $('form-error').textContent = error.message; }
  finally { $('save').disabled = false; }
});

render();
try {
  const response = await fetch('/api/works?annotations=1');
  if (!response.ok) throw new Error('无法读取本地资料库');
  version = response.headers.get('ETag');
  state.works = await response.json();
  const params = new URLSearchParams(location.search);
  const work = state.works.find(item => item.id === params.get('work'));
  if (work) state.selected = work.id;
  else if (params.has('work')) notify('该作品已不可用，请刷新个人时空。');
  state.ready = true;
  render();
  if (work && params.get('note') === '1') noteButton(work).click();
} catch (error) { notify(error.message); }
