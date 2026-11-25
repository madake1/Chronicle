import { parseYear, formatYear, formatSegmentYears, ticks, describe, zoomView, constrainView, timelineBounds } from './chronology.mjs';
import { openNote } from './notes.mjs';
import { openBatchNotes } from './batch-notes.mjs';
import { experienceError } from './experience.mjs';
import { workKnowledgeSection } from './work-knowledge.mjs';

const $ = id => document.getElementById(id);
const types = ['游戏', '小说', '电影', '电视剧', '其他'];
const statuses = ['未开始', '进行中', '已完成', '已放弃'];
const confidences = ['确定', '推测', '约略'];
const series = ['--game', '--novel', '--film', '--tv', '--muted'];
const state = { works: [], page: 'library', selected: null, view: [-500, 1550], history: [], ready: false };
let bounds = timelineBounds();
const scroll = document.querySelector('.timeline-scroll');
const form = $('edit-form');
let editing;
let dragging;
let wheelStart;
let wheelTimer;
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
  return work.segments.reduce((first, segment) => Math.min(first, segment.start), Infinity);
}

function filtered() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const type = $('type-filter').value;
  const status = $('status-filter').value;
  return state.works.filter(work => work.title.toLocaleLowerCase().includes(query) &&
    (!type || work.type === type) && (!status || work.status === status));
}

function fitRange(segments, minimum = 5) {
  if (!segments.length) return [-500, 1550];
  let left = Infinity;
  let right = -Infinity;
  for (const segment of segments) {
    left = Math.min(left, segment.start);
    right = Math.max(right, segment.end ?? segment.start);
  }
  const padding = Math.max(minimum, (right - left) * 0.08);
  return [left - padding, right + padding];
}

function remember(view) {
  if (view[0] === state.view[0] && view[1] === state.view[1]) return;
  state.history.push(view);
  if (state.history.length > 40) state.history.shift();
}

function finishWheel() {
  clearTimeout(wheelTimer);
  if (wheelStart) remember(wheelStart);
  wheelStart = undefined;
  $('back').disabled = !state.history.length;
}

function setView(view, record = true) {
  if (record) finishWheel();
  const previous = state.view;
  state.view = constrainView(view, bounds);
  if (record) remember(previous);
  drawTimeline();
}

function zoom(factor, fraction, record = true) {
  setView(zoomView(state.view, factor, fraction, bounds), record);
}

function select(work) {
  state.selected = work.id;
  render();
  $('detail-title')?.focus({ preventScroll: true });
}

function locate(segment) {
  state.page = 'timeline';
  finishWheel();
  const previous = state.view;
  state.view = constrainView(fitRange([segment]), bounds);
  remember(previous);
  render();
  document.querySelector('#rows .selected')?.scrollIntoView({ block: 'nearest' });
}

function drawTimeline(works = filtered()) {
  if (state.page !== 'timeline') return;
  $('back').disabled = !state.history.length;
  const width = $('ruler').clientWidth;
  if (!width) return;
  const [left, right] = state.view;
  $('visible-span').textContent = `当前视野约 ${Math.round(right - left).toLocaleString('zh-CN')} 年`;
  const x = year => (year - left) / (right - left) * width;
  const years = ticks(left, right, width);
  function grid(plot, axis) {
    for (const year of years) {
      const line = node('div', undefined, axis ? 'tick' : 'gridline');
      const position = x(year);
      line.style.left = `${position}px`;
      if (axis && position < width - 85) line.append(node('span', formatYear(year)));
      plot.append(line);
    }
  }
  $('ruler').replaceChildren();
  grid($('ruler'), true);
  const dated = works.filter(work => work.segments.length).sort((a, b) => firstYear(a) - firstYear(b));
  const rows = document.createDocumentFragment();
  if (!dated.length) rows.append(node('p', '当前筛选下没有可定位的作品，可在作品库查看年代未知的作品。', 'empty'));
  for (const work of dated) {
    const row = node('div', undefined, 'timeline-row');
    row.classList.toggle('selected', state.selected === work.id);
    const label = node('div');
    label.append(button(work.title, () => select(work), 'row-name'), node('span', work.type, 'row-type'));
    const plot = node('div', undefined, 'plot');
    grid(plot, false);
    for (const segment of work.segments) {
      const end = segment.end ?? segment.start;
      if (end < left || segment.start > right) continue;
      const startX = Math.max(0, x(segment.start));
      const endX = Math.min(width, x(end));
      const length = endX - startX;
      const mark = button('', () => select(work), 'mark');
      mark.title = `${work.title} · ${describe(segment)}`;
      mark.setAttribute('aria-label', mark.title);
      mark.dataset.kind = length < 6 ? 'point' : segment.kind;
      if (segment.confidence !== '确定' || segment.kind === 'window') mark.dataset.uncertain = '';
      mark.style.left = `${(startX + endX) / 2}px`;
      mark.style.width = `${Math.max(24, length)}px`;
      mark.style.setProperty('--length', `${length}px`);
      mark.style.setProperty('--series', `var(${series[types.indexOf(work.type)] || '--muted'})`);
      mark.append(node('span', undefined, 'glyph'));
      plot.append(mark);
    }
    row.append(label, plot);
    rows.append(row);
  }
  $('rows').replaceChildren(rows);
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
      work.segments.map(formatSegmentYears).join('；') || '年代未知', work.rating || '—']) {
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
  const storyYears = work.segments.map(describe).join('；') || '年代未知';
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
    const label = work.segments.length === 1 ? '定位此段' : `定位：${describe(segment)}`;
    actions.append(button(label, () => locate(segment)));
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
  if (state.page === 'library') panel.append(workKnowledgeSection(work));
  panel.append(actions);
}

function render() {
  bounds = timelineBounds(state.works.flatMap(work => work.segments));
  state.view = constrainView(state.view, bounds);
  const timeline = state.page === 'timeline';
  $('timeline').hidden = !timeline;
  $('library').hidden = timeline;
  $('sort-control').hidden = timeline;
  $('page-title').textContent = timeline ? '故事时间轴' : '作品库';
  $('add').disabled = !state.ready;
  $('export-notes').hidden = timeline;
  $('export-notes').disabled = !state.ready;
  for (const tab of document.querySelectorAll('[data-page]')) {
    if (tab.dataset.page === state.page) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const works = filtered();
  const unknown = works.filter(work => !work.segments.length).length;
  $('summary').textContent = `${works.length} 部作品${unknown ? ` · ${unknown} 部年代未知` : ''}`;
  renderDetails(state.works.find(work => work.id === state.selected));
  if (timeline) drawTimeline(works);
  else renderLibrary(works);
}

function field(parent, title, control) {
  const label = node('label', title);
  label.append(control);
  parent.append(label);
  return control;
}

function addSegment(segment) {
  const row = node('div', undefined, 'segment-edit');
  const kind = field(row, '时间表达', node('select'));
  kind.append(new Option('年份落点', 'point'), new Option('起止跨度', 'range'), new Option('可能发生范围', 'window'));
  const confidence = field(row, '可信度', node('select'));
  options(confidence, confidences);
  const start = field(row, '年份 / 起始年份', node('input'));
  const end = field(row, '结束年份', node('input'));
  const source = field(row, '年代来源', node('input'));
  start.required = true;
  start.placeholder = '例如 公元前431';
  end.placeholder = '例如 1154';
  kind.value = segment?.kind || 'point';
  confidence.value = segment?.confidence || '确定';
  start.value = segment ? formatYear(segment.start) : '';
  end.value = segment?.end === undefined ? '' : formatYear(segment.end);
  source.value = segment?.source || '';
  const sync = () => {
    end.parentElement.hidden = kind.value === 'point';
    end.disabled = end.parentElement.hidden;
    end.required = !end.disabled;
  };
  kind.addEventListener('change', sync);
  sync();
  row.append(button('移除此段', () => row.remove()));
  row.read = () => {
    const value = { kind: kind.value, confidence: confidence.value, start: parseYear(start.value), source: source.value.trim() };
    if (!end.disabled) {
      value.end = parseYear(end.value);
      if (value.end <= value.start) throw new Error('结束年份必须晚于起始年份');
    }
    return value;
  };
  $('segment-fields').append(row);
}

function openEditor(work) {
  editing = work;
  form.reset();
  $('edit-title').textContent = work ? '编辑作品' : '新增作品';
  $('form-error').textContent = '';
  $('segment-fields').replaceChildren();
  if (work) {
    for (const name of ['title', 'type', 'status', 'region', 'period', 'basis', 'rating', 'synopsis', 'notes', 'links']) {
      form.elements.namedItem(name).value = work[name] ?? '';
    }
    for (const name of experienceFields) form.elements.namedItem(name).value = work.experience?.[name] ?? '';
    work.segments.forEach(addSegment);
  }
  $('editor').showModal();
}

async function persist(works) {
  if (saving) throw new Error('正在保存，请稍候');
  saving = true;
  try {
    const response = await fetch('/api/works', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(works),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    state.works = works;
  } finally { saving = false; }
}

options($('type-filter'), types, '全部类型');
options($('status-filter'), statuses, '全部状态');
options(form.elements.namedItem('type'), types);
options(form.elements.namedItem('status'), statuses);
for (const id of ['search', 'type-filter', 'status-filter', 'sort']) $(id).addEventListener('input', render);
for (const tab of document.querySelectorAll('[data-page]')) tab.addEventListener('click', () => {
  state.page = tab.dataset.page;
  render();
});
$('add').onclick = () => openEditor();
$('export-notes').onclick = () => openBatchNotes(state.works);
$('add-segment').onclick = () => addSegment();
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
      segments: [...$('segment-fields').children].map(row => row.read()),
    };
    await persist(editing ? state.works.map(item => item.id === work.id ? work : item) : [...state.works, work]);
    state.selected = work.id;
    $('editor').close();
    notify('作品已保存');
    render();
  } catch (error) { $('form-error').textContent = error.message; }
  finally { $('save').disabled = false; }
});

$('fit').onclick = () => setView(fitRange(filtered().flatMap(work => work.segments), 20));
$('back').onclick = () => {
  finishWheel();
  const previous = state.history.pop();
  if (previous) setView(previous, false);
};
$('out').onclick = () => zoom(1.5, 0.5);
$('in').onclick = () => zoom(1 / 1.5, 0.5);
$('jump').onsubmit = event => {
  event.preventDefault();
  try {
    const center = parseYear(new FormData(event.currentTarget).get('year'));
    if (center < bounds[0] || center > bounds[1]) {
      throw new Error(`当前时间轴范围为 ${formatYear(bounds[0])}至${formatYear(bounds[1])}`);
    }
    const radius = (state.view[1] - state.view[0]) / 2;
    setView([center - radius, center + radius]);
    notify();
  } catch (error) { notify(error.message); }
};
scroll.addEventListener('wheel', event => {
  const plot = event.target.closest('.plot');
  if (!plot || !event.deltaY) return;
  event.preventDefault();
  const rect = plot.getBoundingClientRect();
  wheelStart ||= state.view;
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.width : 1;
  zoom(Math.exp(Math.max(-0.7, Math.min(0.7, event.deltaY * units * .004))),
    (event.clientX - rect.left) / rect.width, false);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(finishWheel, 180);
}, { passive: false });
scroll.addEventListener('pointerdown', event => {
  const plot = event.target.closest('.plot');
  if (!plot || event.target.closest('button') || event.button !== 0) return;
  finishWheel();
  dragging = { id: event.pointerId, x: event.clientX, width: plot.clientWidth, start: state.view };
  scroll.classList.add('dragging');
  scroll.setPointerCapture(event.pointerId);
});
scroll.addEventListener('pointermove', event => {
  if (dragging?.id !== event.pointerId) return;
  const [left, right] = dragging.start;
  const width = right - left;
  const offset = (dragging.x - event.clientX) / dragging.width * width;
  setView([left + offset, right + offset], false);
});
scroll.addEventListener('lostpointercapture', event => {
  if (dragging?.id !== event.pointerId) return;
  remember(dragging.start);
  dragging = undefined;
  scroll.classList.remove('dragging');
  $('back').disabled = !state.history.length;
});
new ResizeObserver(() => drawTimeline()).observe($('ruler'));

const root = document.documentElement;
root.dataset.theme = localStorage.getItem('chronicle-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
};

render();
try {
  const response = await fetch('/api/works');
  if (!response.ok) throw new Error('无法读取本地资料库');
  state.works = await response.json();
  const params = new URLSearchParams(location.search);
  const work = state.works.find(item => item.id === params.get('work'));
  if (work) state.selected = work.id;
  state.ready = true;
  state.view = fitRange(state.works.flatMap(work => work.segments), 20);
  render();
  if (work && params.get('note') === '1') noteButton(work).click();
} catch (error) { notify(error.message); }
