import { Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';
import { createAtlasData } from './atlas/data.mjs';
import { constrainView, describe, formatYear, parseYear, ticks, timelineBounds, zoomView } from './chronology.mjs';
import { matchingAnnotations, timeFilter } from './spacetime-query.mjs';

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
let requestVersion = 0, basemapVersion = 0, loaded = false;
let groupOpen, drag;
const initialWork = new URLSearchParams(location.search).get('work');
let initialSelection = new URLSearchParams(location.search).get('annotation') ??
  (initialWork && 'work:' + initialWork);
let recentTimeMode = '';

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
    map.easeTo({ center: [row.longitude, row.latitude] });
  }
  if (origin === 'map' && dated(row)) {
    const mid = (row.start + (row.end ?? row.start)) / 2;
    const width = viewYears[1] - viewYears[0];
    const [left, right] = viewYears;
    if (mid < left || mid > right) viewYears = constrainView([mid - width / 2, mid + width / 2], limits);
  }
  drawTimeline();
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

function drawTimeline() {
  if ($('timeline-panel').hidden) return;
  const ruler = $('ruler');
  const width = ruler.clientWidth;
  if (!width) return;
  const [left, right] = viewYears;
  const percent = value => 100 * (value - left) / (right - left);
  ruler.replaceChildren(...ticks(left, right, width).map(year => {
    const mark = document.createElement('span');
    mark.className = 'st-tick';
    mark.style.left = Math.min(88, percent(year)) + '%';
    mark.textContent = formatYear(year);
    return mark;
  }));
  const groups = new Map();
  for (const row of rows.filter(dated).sort((a, b) => a.start - b.start)) {
    if ((row.end ?? row.start) < left || row.start > right) continue;
    if (!groups.has(row.entityId)) groups.set(row.entityId, []);
    groups.get(row.entityId).push(row);
  }
  $('timeline-rows').replaceChildren(...[...groups.values()].map(items => {
    const group = document.createElement('div');
    group.className = 'timeline-row';
    const title = document.createElement('div');
    const link = document.createElement('a');
    link.href = items[0].href;
    link.textContent = name(items[0]);
    title.append(link);
    const plot = document.createElement('div');
    plot.className = 'plot';
    plot.style.minHeight = Math.max(53, 16 + 21 * items.length) + 'px';
    items.forEach((row, index) => {
      const mark = button(`选中${name(row)}，${describe(row)}`, () => select(row, 'timeline'));
      mark.title = `${name(row)} · ${describe(row)}`;
      mark.setAttribute('aria-label', mark.textContent);
      mark.textContent = '';
      mark.className = 'st-mark';
      mark.dataset.type = row.entityType;
      mark.toggleAttribute('data-uncertain', uncertain(row));
      mark.setAttribute('aria-pressed', row.key === selected);
      const start = Math.max(0, percent(row.start));
      if (row.kind === 'point') mark.style.borderRadius = '50%';
      mark.style.left = `clamp(0px, ${start}%, calc(100% - 13px))`;
      mark.style.width = Math.max(0, Math.min(100, percent(row.end ?? row.start)) - start) + '%';
      mark.style.top = 10 + index * 21 + 'px';
      plot.append(mark);
    });
    group.append(title, plot);
    return group;
  }));
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
      void readAtlas('land.geojson').then(land => map.getSource('land').setData(land)).catch(() => {});
      void drawBasemap();
      syncMarkers();
    });
    map.on('moveend', () => { if ($('viewport').checked) render(); });
  } catch {
    mapFailed = true;
    map = undefined;
    $('map').hidden = true;
    $('basemap-status').textContent = '地图无法启动，可在坐标列表查看匹配标注。';
    $('viewport').disabled = true;
  }
}

function syncMarkers() {
  for (const marker of markers) marker.remove();
  markers = [];
  const list = $('coordinate-list');
  list.replaceChildren();
  const points = rows.filter(located);
  list.hidden = !(mapFailed || groupOpen);
  if (mapFailed) {
    list.append(...points.map(row => button(`${name(row)} · ${row.longitude}, ${row.latitude}`, () => select(row, 'map'))));
    return;
  }
  if (!map || $('map-panel').hidden) return;
  const groups = new Map();
  for (const row of points) {
    const key = `${row.longitude},${row.latitude}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, items] of groups) {
    const first = items[0];
    const element = button(items.length > 1 ? String(items.length) : typeName(first), () => {
      if (items.length === 1) { groupOpen = undefined; select(first, 'map'); }
      else { groupOpen = groupOpen === key ? undefined : key; syncMarkers(); }
    });
    element.className = 'spacetime-marker';
    element.dataset.type = first.entityType;
    element.toggleAttribute('data-unknown', items.every(row => !dated(row)));
    element.toggleAttribute('data-uncertain', items.some(uncertain));
    element.setAttribute('aria-pressed', items.some(row => row.key === selected));
    element.title = items.map(name).join('、');
    markers.push(new Marker({ element }).setLngLat([first.longitude, first.latitude]).addTo(map));
    if (groupOpen === key) list.append(...items.map(row => button(name(row), () => select(row, 'map'))));
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
  $('map-panel').hidden = $('view').value === 'timeline';
  $('timeline-panel').hidden = $('view').value === 'map';
  if (!$('map-panel').hidden) { initMap(); map?.resize(); }
  try {
    const time = timeFilter(mode, $('first').value, $('last').value);
    const bounds = !$('map-panel').hidden && $('viewport').checked && map?.getBounds();
    rows = matchingAnnotations(data, {
      time, type: $('type').value, tag: $('tag').value, workType: $('work-type').value, query: $('query').value,
      unknown: $('unknown').checked,
      bounds: bounds && { west: bounds.getWest(), east: bounds.getEast(), north: bounds.getNorth(), south: bounds.getSouth() },
    });
    $('error').textContent = '';
  } catch (error) { rows = []; $('error').textContent = error.message; }
  if (fitOnRefresh && rows.some(dated)) { fit(); fitOnRefresh = false; }
  if (!rows.some(row => row.key === selected)) selected = undefined;
  if (initialSelection && loaded) {
    const row = rows.find(item => item.key === initialSelection || item.entityId === initialSelection);
    if (row) {
      selected = row.key;
      if (located(row)) map?.jumpTo({ center: [row.longitude, row.latitude] });
    } else $('error').textContent = '该时空标注已不可用。';
    initialSelection = undefined;
  }
  $('count').textContent = `${new Set(rows.map(row => row.entityId)).size} 个条目 · ${rows.length} 条标注`;
  const unknown = rows.filter(row => !dated(row));
  $('unknown-panel').hidden = !unknown.length;
  $('unknown-list').replaceChildren(...unknown.map(row => button(name(row), () => select(row, 'timeline'))));
  drawTimeline();
  renderSelection();
  syncMarkers();
}

async function refresh() {
  const version = ++requestVersion;
  try {
    const response = await fetch('/api/spacetime', { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取个人时空');
    const result = await response.json();
    if (version !== requestVersion) return;
    data = result;
    loaded = true;
    limits = timelineBounds(data.rows.filter(dated));
    const tag = $('tag').value;
    const tagsById = new Map(data.tags.map(item => [item.id, item]));
    $('tag').replaceChildren(new Option('全部', ''), ...data.tags.map(item => {
      const path = [item.name];
      for (let parent = tagsById.get(item.parentId); parent; parent = tagsById.get(parent.parentId)) path.unshift(parent.name);
      return new Option(path.join(' / '), item.id);
    }));
    if (tagsById.has(tag)) $('tag').value = tag;
    render();
  } catch (error) { if (version === requestVersion) $('error').textContent = error.message; }
}

for (const id of ['view', 'query', 'type', 'tag', 'work-type', 'time', 'first', 'last', 'unknown', 'viewport']) {
  $(id).oninput = () => {
    if (['time', 'first', 'last', 'type', 'tag', 'work-type', 'query'].includes(id)) fitOnRefresh = true;
    render();
  };
}
$('reference').onchange = () => void drawBasemap();
$('fit-all').onclick = () => { fit(); drawTimeline(); };
function zoom(factor, at = .5) { viewYears = zoomView(viewYears, factor, at, limits); drawTimeline(); }
$('zoom-in').onclick = () => zoom(.7);
$('zoom-out').onclick = () => zoom(1.4);
function pan(direction) {
  const offset = (viewYears[1] - viewYears[0]) * direction;
  viewYears = constrainView(viewYears.map(year => year + offset), limits);
  drawTimeline();
}
$('jump').onsubmit = event => {
  event.preventDefault();
  try {
    const year = parseYear($('jump-year').value);
    if (year < limits[0] || year > limits[1]) throw new Error('年份超出当前时间轴范围');
    const half = (viewYears[1] - viewYears[0]) / 2;
    viewYears = constrainView([year - half, year + half], limits);
    $('error').textContent = '';
    drawTimeline();
  } catch (error) { $('error').textContent = error.message; }
};
const timelineScroll = $('timeline-scroll');
timelineScroll.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button || event.target.closest('button,a')) return;
  drag = { start: event.clientX, years: viewYears };
  timelineScroll.setPointerCapture(event.pointerId);
});
timelineScroll.addEventListener('pointermove', event => {
  if (!drag) return;
  const offset = (drag.start - event.clientX) / $('ruler').clientWidth * (drag.years[1] - drag.years[0]);
  viewYears = constrainView(drag.years.map(year => year + offset), limits);
  drawTimeline();
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  timelineScroll.addEventListener(event, () => { drag = undefined; });
}
$('earlier').onclick = () => pan(-.35);
$('later').onclick = () => pan(.35);
$('timeline-scroll').addEventListener('wheel', event => {
  if (!event.ctrlKey && !event.shiftKey) return;
  event.preventDefault();
  if (event.shiftKey) pan(event.deltaY > 0 ? .2 : -.2);
  else {
    const ruler = $('ruler').getBoundingClientRect();
    zoom(event.deltaY > 0 ? 1.2 : .83, Math.max(0, Math.min(1, (event.clientX - ruler.left) / ruler.width)));
  }
}, { passive: false });
new ResizeObserver(drawTimeline).observe($('ruler'));
const root = document.documentElement;
root.dataset.theme = localStorage.getItem('chronicle-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('theme').onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chronicle-theme', root.dataset.theme);
};
window.addEventListener('focus', refresh);
window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
if (new URLSearchParams(location.search).get('view') === 'both') $('view').value = 'both';
void refresh();
