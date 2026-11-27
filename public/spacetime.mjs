import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';
import { createAtlasData } from './atlas/data.mjs';
import { constrainView, describe, formatYear, parseYear, timelineBounds, zoomView } from './chronology.mjs';
import { matchingAnnotations, timeFilter } from './spacetime-query.mjs';

import { groupMapPoints, layoutTimeline, timelineTicks } from './timeline-layout.mjs';

const $ = id => document.getElementById(id);
const dated = row => row.start !== undefined;
const located = row => row.longitude !== undefined;
const name = row => row.title || '无标题知识';
const typeName = row => row.entityType === 'work' ? '作品' : '知识';
const uncertain = row => row.kind === 'window' || dated(row) && row.confidence !== '确定';
const empty = { type: 'FeatureCollection', features: [] };
let data = { rows: [], tags: [] };
let rows = [], markers = [], selected, map, atlas, mapFailed = false, fitOnRefresh = true;
let viewYears = [1000, 1500], limits = timelineBounds();
let basemapVersion = 0;
const layers = {
  work: { revision: 0, rows: [], status: 'idle' },
  knowledge: { revision: 0, rows: [], tags: [], status: 'idle' },
};
const enabled = layer => $(layer + '-layer').checked;
let groupOpen, drag, timelineFrame, choiceFrame, fitMapPending = true, mapReady = false;
const initialWork = new URLSearchParams(location.search).get('work');
let initialSelection = new URLSearchParams(location.search).get('annotation') ??
  (initialWork && 'work:' + initialWork);
let recentTimeMode = '';
let view = 'timeline';
if (initialSelection?.startsWith('knowledge:')) {
  $('knowledge-layer').checked = true;
}
const timeline = $('timeline');

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.onclick = action;
  return element;
}

function fit() {
  const years = rows.filter(dated);
  const start = years.reduce((value, row) => Math.min(value, row.start), Infinity);
  const end = years.reduce((value, row) => Math.max(value, row.end ?? row.start), -Infinity);
  viewYears = years.length ? constrainView([start - 10, end + 10], limits) : [-500, 1550];
}

function select(row, origin) {
  selected = row.key;
  renderSelection();
  if (origin === 'timeline' && located(row) && map) {
    map.easeTo({ center: [row.longitude, row.latitude], duration: 240 });
  }
  if (origin === 'map' && dated(row)) {
    const mid = (row.start + (row.end ?? row.start)) / 2;
    const width = viewYears[1] - viewYears[0];
    const [left, right] = viewYears;
    if (mid < left || mid > right) viewYears = constrainView([mid - width / 2, mid + width / 2], limits);
  }
  scheduleTimeline();
  syncMarkers();
}

function renderSelection() {
  const panel = $('selection');
  panel.replaceChildren();
  const row = rows.find(item => item.key === selected);
  panel.hidden = !row;
  if (!row) return;
  const title = document.createElement('h2');
  title.textContent = name(row);
  const details = document.createElement('p');
  details.textContent = [typeName(row), dated(row) ? describe(row) : '年代未知',
    row.place, located(row) ? `${row.longitude}, ${row.latitude}` : '无地图坐标', row.description].filter(Boolean).join(' · ');
  const link = document.createElement('a');
  link.href = row.href;
  link.textContent = '打开原条目';
  panel.append(title, details, link);
}

function showCluster(items, panel, origin, canZoom = false) {
  const heading = document.createElement('h2');
  heading.textContent = `${items.length} 条标注`;
  const list = document.createElement('div');
  list.className = 'annotation-choices';
  let visible = 0;
  function appendBatch() {
    const end = Math.min(items.length, visible + 30);
    list.append(...items.slice(visible, end).map(row => button(
      `${typeName(row)} · ${name(row)} · ${dated(row) ? describe(row) : '年代未知'}`,
      () => select(row, origin),
    )));
    visible = end;
    more.hidden = visible === items.length;
  }
  const more = button('查看更多标注', appendBatch);
  const close = button('收起', () => {
    panel.hidden = true;
    if (origin === 'map') groupOpen = undefined;
  });
  panel.replaceChildren(heading, list, more, close);
  if (canZoom) panel.append(button('放大这段时间', () => {
    const l = Math.min(...items.map(row => row.start));
    const r = Math.max(...items.map(row => row.end ?? row.start));
    const padding = Math.max(1, (r - l) * .08);
    viewYears = constrainView([l - padding, r + padding], limits);
    scheduleTimeline();
  }));
  panel.hidden = false;
  appendBatch();
}

function scheduleTimeline() {
  if (timelineFrame) return;
  timelineFrame = requestAnimationFrame(() => {
    timelineFrame = undefined;
    drawTimeline();
  });
}

function drawTimeline() {
  if ($('timeline-panel').hidden) return;
  const width = timeline.clientWidth;
  if (!width) return;
  const [left, right] = viewYears;
  const { items, clusters, workLanes, knowledgeLanes } = layoutTimeline(rows, viewYears, width, selected);
  const workOverflow = clusters.some(cluster => cluster.side === 'work');
  const knowledgeOverflow = clusters.some(cluster => cluster.side === 'knowledge');
  const step = 56;
  const axis = Math.max(96, 25 + workLanes * step + (workOverflow ? 33 : 0));
  const height = Math.max(195, axis + Math.max(49, 25 + knowledgeLanes * step + (knowledgeOverflow ? 33 : 0)));
  timeline.style.height = height + 'px';
  timeline.style.setProperty('--axis', axis + 'px');
  const fragment = document.createDocumentFragment();
  const add = (className, x, y, length, parent = fragment) => {
    const node = document.createElement('span');
    node.className = className;
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    if (length !== undefined) node.style.width = length + 'px';
    parent.append(node);
    return node;
  };
  const x = year => (year - left) / (right - left) * width;
  const tickValues = timelineTicks(left, right, width);
  for (const year of tickValues.minor) add('space-grid minor', x(year), 0);
  for (const year of tickValues.major) {
    add('space-grid', x(year), 0);
    add('axis-label', Math.min(width - 78, Math.max(5, x(year) + 5)), axis - 15).textContent = formatYear(year);
  }
  add('main-axis', 0, axis, width);
  for (const { row, lane, side, start, end, anchor, card, cardWidth } of items) {
    const above = side === 'work';
    const top = above ? axis - 61 - lane * step : axis + 22 + lane * step;
    const lineY = above ? top + 45 : top - 5;
    const kind = uncertain(row) ? ' uncertain' : '';
    const group = document.createElement('div');
    group.className = 'time-item ' + side + (row.key === selected ? ' selected' : '');
    const line = add('time-stem', anchor, Math.min(axis, lineY), undefined, group);
    line.style.height = Math.abs(axis - lineY) + 'px';
    if (row.kind === 'point') add('time-point' + kind, start, axis, undefined, group);
    else add('time-span' + kind, start, lineY, end - start, group);
    const control = button('', () => {
      select(row, 'timeline');
      requestAnimationFrame(() => [...timeline.querySelectorAll('.time-card')].find(card => card.dataset.key === row.key)?.focus({ preventScroll: true }));
    });
    control.className = 'time-card';
    control.dataset.key = row.key;
    control.style.left = card + 'px';
    control.style.top = top + 'px';
    control.style.width = cardWidth + 'px';
    control.setAttribute('aria-label', `${name(row)} · ${describe(row)}`);
    control.setAttribute('aria-pressed', row.key === selected);
    control.title = control.getAttribute('aria-label');
    const title = document.createElement('strong');
    title.textContent = (above ? '● ' : '◆ ') + name(row);
    const year = document.createElement('small');
    year.textContent = describe(row);
    control.append(title, year);
    group.append(control);
    fragment.append(group);
  }
  const clusterPanel = $('timeline-cluster');
  for (const cluster of clusters) {
    const control = button(`+${cluster.rows.length}`, () => showCluster(cluster.rows, clusterPanel, 'timeline', true));
    control.className = 'time-cluster ' + cluster.side;
    control.style.left = Math.max(5, Math.min(width - 68, cluster.x - 28)) + 'px';
    control.style.top = (cluster.side === 'work' ? 6 : height - 35) + 'px';
    control.setAttribute('aria-label', `展开 ${cluster.rows.length} 条密集标注`);
    fragment.append(control);
  }
  if (!items.length) {
    const state = document.createElement('p');
    state.className = 'time-empty meta';
    state.textContent = rows.some(dated) ? '当前可见年代没有标注，可平移或适配结果。' : '当前图层与筛选条件下没有年代标注。';
    fragment.append(state);
  }
  timeline.replaceChildren(fragment);
  $('visible-years').textContent = `${formatYear(Math.round(left))} — ${formatYear(Math.round(right))}`;
}

async function readAtlas(file) {
  const response = await fetch('/atlas/data/' + file);
  if (!response.ok) throw new Error('历史地图资料缺失');
  return response.json();
}

async function drawBasemap() {
  if (!map?.getSource('history')) return;
  const revision = ++basemapVersion;
  const status = $('basemap-status');
  const layer = map.getSource('history');
  await layer.setData(empty);
  try {
    const year = parseYear($('reference').value);
    const source = await atlas;
    if (revision !== basemapVersion) return;
    if (!source) throw new Error('历史资料缺失，仅显示可用地理参照与个人坐标');
    if (year < source.bounds[0] || year > source.bounds[1]) throw new Error('参考年超出历史底图覆盖，仅显示地理参照与个人坐标');
    const features = await source.data.features(source.data.frame(year));
    if (revision !== basemapVersion) return;
    await layer.setData(features);
    if (revision === basemapVersion) status.textContent = `底图参考年 · ${formatYear(year)}`;
  } catch (error) { if (revision === basemapVersion) status.textContent = error.message; }
}

function initMap() {
  if (map || mapFailed) return;
  try {
    setWorkerUrl('/atlas/vendor/maplibre-gl-worker.mjs');
    map = new MapLibre({ container: 'map', center: [15, 25], zoom: 1.4, renderWorldCopies: false, style: {
      version: 8, sources: { land: { type: 'geojson', data: empty }, history: { type: 'geojson', data: empty } },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': '#aac9d7' } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#e9e4d4' } },
        { id: 'history', type: 'fill', source: 'history', paint: { 'fill-color': '#b08d6c', 'fill-opacity': .55, 'fill-outline-color': '#715943' } },
      ],
    } });
    atlas = readAtlas('chronology.json').then(index => ({ bounds: index.bounds, data: createAtlasData(index, readAtlas) }), () => null);
    map.addControl(new NavigationControl());
    map.on('load', () => {
      mapReady = true;
      void readAtlas('land.geojson').then(land => map.getSource('land').setData(land)).catch(() => {});
      void drawBasemap();
      syncMarkers();
    });
    map.on('moveend', () => {
      if ($('viewport').checked) render();
      else syncMarkers();
    });
  } catch {
    mapFailed = true;
    map = undefined;
    $('map').hidden = true;
    $('basemap-status').textContent = '地图无法启动，可在坐标列表查看匹配标注。';
    $('viewport').disabled = true;
  }
}

function fitMap(points) {
  if (!map || !points.length) return;
  const bounds = new LngLatBounds();
  for (const row of points) bounds.extend([row.longitude, row.latitude]);
  fitMapPending = false;
  map.fitBounds(bounds, { padding: 65, maxZoom: 5, duration: 0 });
}

function syncMarkers() {
  for (const marker of markers) marker.remove();
  markers = [];
  const list = $('coordinate-list');
  list.replaceChildren();
  const points = rows.filter(located);
  $('fit-map').disabled = !map || !points.length;
  list.hidden = !(mapFailed || groupOpen);
  if (mapFailed) {
    if (points.length) showCluster(points, list, 'map');
    return;
  }
  if (!map || $('map-panel').hidden) return;
  if (fitMapPending && points.length && mapReady) {
    fitMap(points);
    if (markers.length) return;
  }
  for (const { key, rows: items } of groupMapPoints(points, map)) {
    const first = items[0];
    const element = button(items.length > 1 ? String(items.length) : first.entityType === 'knowledge' ? '◆' : '●', () => {
      if (items.length === 1) { groupOpen = undefined; select(first, 'map'); }
      else { groupOpen = groupOpen === key ? undefined : key; syncMarkers(); }
    });
    element.className = 'spacetime-marker';
    const mixed = items.some(item => item.entityType !== first.entityType);
    element.dataset.type = mixed ? 'mixed' : first.entityType;
    element.toggleAttribute('data-unknown', items.every(row => !dated(row)));
    element.toggleAttribute('data-uncertain', items.some(uncertain));
    element.setAttribute('aria-pressed', items.some(row => row.key === selected));
    element.setAttribute('aria-label', items.length > 1 ? `展开 ${items.length} 条地图标注` : `${typeName(first)} · ${name(first)}`);
    const pin = items.find(row => row.key === selected) ?? first;
    markers.push(new Marker({ element }).setLngLat([pin.longitude, pin.latitude]).addTo(map));
    if (groupOpen === key) showCluster(items, list, 'map');
  }
  list.hidden = !list.childElementCount;
}

function render() {
  const mode = $('time').value;
  if (mode !== recentTimeMode && mode && !recentTimeMode) $('unknown').checked = false;
  recentTimeMode = mode;
  $('first-field').hidden = !mode;
  $('last-field').hidden = mode !== 'interval';
  $('time-explanation').textContent = mode === 'cumulative' ? '展示截至该年曾涉及的内容' : '';
  $('map-panel').hidden = view === 'timeline';
  $('timeline-panel').hidden = view === 'map';
  $('viewport-field').hidden = view === 'timeline';
  $('work-filter').hidden = !enabled('work');
  $('knowledge-filter').hidden = !enabled('knowledge');
  const filterCount = Number(Boolean($('query').value.trim())) + Number(Boolean(mode)) +
    Number(enabled('work') && Boolean($('work-type').value)) +
    Number(enabled('knowledge') && Boolean($('tag').value)) +
    Number(view !== 'timeline' && $('viewport').checked) + Number($('unknown').checked !== !mode);
  $('filter-count').textContent = filterCount ? `· ${filterCount} 项已启用` : '';
  const visibleLayers = Object.keys(layers).filter(enabled);
  const messages = visibleLayers.flatMap(layer => layers[layer].status === 'loading' ? [`正在加载${layer === 'work' ? '作品' : '知识'}…`] :
    layers[layer].status === 'error' ? [`${layer === 'work' ? '作品' : '知识'}加载失败，切换图层或重新聚焦可重试。`] : []);
  $('layer-status').textContent = messages.join(' ');
  $('layer-status').hidden = !messages.length;
  if (!$('map-panel').hidden) { initMap(); map?.resize(); }
  try {
    const time = timeFilter(mode, $('first').value, $('last').value);
    const bounds = !$('map-panel').hidden && $('viewport').checked && map?.getBounds();
    rows = matchingAnnotations(data, {
      time, tag: $('tag').value, workType: $('work-type').value, query: $('query').value,
      unknown: $('unknown').checked,
      bounds: bounds && { west: bounds.getWest(), east: bounds.getEast(), north: bounds.getNorth(), south: bounds.getSouth() },
    });
    $('error').textContent = '';
  } catch (error) { rows = []; $('error').textContent = error.message; }
  limits = timelineBounds(rows.filter(dated));
  viewYears = constrainView(viewYears, limits);
  if (fitOnRefresh) { fit(); fitOnRefresh = false; }
  if (!rows.some(row => row.key === selected)) selected = undefined;
  if (initialSelection && layers[initialSelection.startsWith('knowledge:') ? 'knowledge' : 'work'].status === 'ready') {
    const row = rows.find(item => item.key === initialSelection || item.entityId === initialSelection);
    if (row) {
      selected = row.key;
      fitMapPending = !located(row) || !map;
      if (located(row) && map) {
        const center = [row.longitude, row.latitude];
        queueMicrotask(() => map?.jumpTo({ center }));
      }
    } else $('error').textContent = '该时空标注已不可用。';
    initialSelection = undefined;
  }
  $('count').textContent = visibleLayers.length ? `${new Set(rows.map(row => row.entityId)).size} 个条目 · ${rows.length} 条标注` : '请选择要查看的图层';
  const unknown = rows.filter(row => !dated(row));
  $('unknown-panel').hidden = !unknown.length;
  const unknownList = $('unknown-list');
  unknownList.replaceChildren();
  if (unknown.length) {
    if (unknown.length > 12) unknownList.append(button(`查看 ${unknown.length} 条`, () => showCluster(unknown, $('timeline-cluster'), 'timeline')));
    else unknownList.append(...unknown.map(row => button(name(row), () => select(row, 'timeline'))));
  }
  $('timeline-cluster').hidden = true;
  scheduleTimeline();
  renderSelection();
  syncMarkers();
}

function syncTags() {
  const choice = $('tag').value;
  const tagsById = new Map(data.tags.map(item => [item.id, item]));
  $('tag').replaceChildren(new Option('全部', ''), ...data.tags.map(item => {
    const path = [item.name];
    for (let parent = tagsById.get(item.parentId); parent; parent = tagsById.get(parent.parentId)) path.unshift(parent.name);
    return new Option(path.join(' / '), item.id);
  }));
  if (tagsById.has(choice)) $('tag').value = choice;
}

function updateData() {
  data = { rows: Object.keys(layers).filter(enabled).flatMap(layer => layers[layer].rows),
    tags: enabled('knowledge') ? layers.knowledge.tags : [] };
  render();
}

async function loadLayer(layer) {
  const state = layers[layer];
  state.controller?.abort();
  const revision = ++state.revision;
  if (!enabled(layer)) {
    Object.assign(state, { rows: [], tags: [], status: 'idle' });
    updateData();
    return;
  }
  const controller = new AbortController();
  state.controller = controller;
  if (state.status !== 'ready') state.status = 'loading';
  updateData();
  try {
    const response = await fetch('/api/spacetime?layer=' + layer, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('无法读取个人时空');
    const result = await response.json();
    if (revision !== state.revision) return;
    const changed = state.status !== 'ready';
    Object.assign(state, { ...result, status: 'ready' });
    if (changed) fitOnRefresh = true;
    if (layer === 'knowledge') {
      data.tags = state.tags;
      syncTags();
    }
    updateData();
  } catch (error) {
    if (revision !== state.revision || error.name === 'AbortError') return;
    Object.assign(state, { rows: [], tags: [], status: 'error' });
    updateData();
  }
}

function refresh() {
  for (const layer of Object.keys(layers)) if (enabled(layer)) void loadLayer(layer);
}

for (const control of document.querySelectorAll('[data-view]')) control.onclick = () => setView(control.dataset.view);
function setView(next) {
  view = next;
  for (const control of document.querySelectorAll('[data-view]')) control.setAttribute('aria-pressed', String(control.dataset.view === view));
  render();
}
for (const layer of Object.keys(layers)) $(layer + '-layer').onchange = () => {
  fitOnRefresh = true;
  void loadLayer(layer);
};
for (const id of ['query', 'tag', 'work-type', 'time', 'first', 'last', 'unknown', 'viewport']) {
  $(id).oninput = () => {
    cancelAnimationFrame(choiceFrame);
    choiceFrame = requestAnimationFrame(() => {
      if (id !== 'viewport') fitOnRefresh = true;
      render();
    });
  };
}
$('clear').onclick = () => {
  for (const id of ['query', 'tag', 'work-type', 'time']) $(id).value = '';
  $('unknown').checked = true;
  $('viewport').checked = false;
  fitOnRefresh = true;
  render();
};
$('fit-map').onclick = () => fitMap(rows.filter(located));
$('reference').onchange = () => void drawBasemap();
$('fit-all').onclick = () => { fit(); scheduleTimeline(); };
function zoom(factor, at = .5) { viewYears = zoomView(viewYears, factor, at, limits); scheduleTimeline(); }
$('zoom-in').onclick = () => zoom(.7);
$('zoom-out').onclick = () => zoom(1.4);
function pan(direction) {
  const offset = (viewYears[1] - viewYears[0]) * direction;
  viewYears = constrainView(viewYears.map(year => year + offset), limits);
  scheduleTimeline();
}
$('jump').onsubmit = event => {
  event.preventDefault();
  try {
    const year = parseYear($('jump-year').value);
    if (year < limits[0] || year > limits[1]) throw new Error('年份超出当前时间轴范围');
    const half = (viewYears[1] - viewYears[0]) / 2;
    viewYears = constrainView([year - half, year + half], limits);
    $('error').textContent = '';
    scheduleTimeline();
  } catch (error) { $('error').textContent = error.message; }
};
const timelineScroll = timeline;
timelineScroll.addEventListener('pointerdown', event => {
  if (event.button || event.target.closest('button,a')) return;
  drag = { start: event.clientX, years: viewYears };
  timelineScroll.setPointerCapture(event.pointerId);
});
timelineScroll.addEventListener('pointermove', event => {
  if (!drag) return;
  const offset = (drag.start - event.clientX) / timeline.clientWidth * (drag.years[1] - drag.years[0]);
  viewYears = constrainView(drag.years.map(year => year + offset), limits);
  scheduleTimeline();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  timelineScroll.addEventListener(event, () => { drag = undefined; });
}
$('earlier').onclick = () => pan(-.35);
$('later').onclick = () => pan(.35);
timeline.addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.shiftKey) return;
  event.preventDefault();
  if (event.shiftKey) pan(event.deltaY > 0 ? .2 : -.2);
  else {
    const ruler = timeline.getBoundingClientRect();
    zoom(event.deltaY > 0 ? 1.2 : .83, Math.max(0, Math.min(1, (event.clientX - ruler.left) / ruler.width)));
  }
}, { passive: false });
timeline.onkeydown = event => {
  if (event.target !== timeline) return;
  if (event.key === 'ArrowLeft') pan(-.25);
  else if (event.key === 'ArrowRight') pan(.25);
  else if (event.key === '+' || event.key === '=') zoom(.7);
  else if (event.key === '-') zoom(1.4);
  else return;
  event.preventDefault();
};
new ResizeObserver(scheduleTimeline).observe(timeline);
window.addEventListener('focus', refresh);
window.addEventListener('pageshow', event => { if (event.persisted) refresh(); });
if (new URLSearchParams(location.search).get('view') === 'both') setView('both');
refresh();
