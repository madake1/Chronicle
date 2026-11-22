import { Map, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';

const status = document.querySelector('#atlas-status');
const years = document.querySelector('#atlas-years');
const slider = document.querySelector('#atlas-year');
const container = document.querySelector('#atlas-map');
const sources = document.querySelector('#atlas-sources');
const sourceRecord = document.querySelector('#atlas-source-record');
const polityPanel = document.querySelector('#atlas-polity');
const historyPanel = document.querySelector('#atlas-polity-history');
const historyList = document.querySelector('#atlas-history-list');
const ocean = '#dfe9ec';
const palette = ['#4f9587', '#c98d4e', '#8b78a9', '#5b87b1', '#b95d6c', '#879b51',
  '#b47b9b', '#777fa5', '#a48262', '#478ca2', '#9a685e', '#aaa25d'];

document.documentElement.dataset.theme = localStorage.getItem('chronicle-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

async function readData(name, signal) {
  const response = await fetch(`/atlas/data/${name}`, { signal });
  if (!response.ok) throw new Error('地图数据尚未准备，请运行 npm run atlas:prepare');
  return response.json();
}

function yearLabel(year) {
  return year <= 0 ? `公元前 ${-year || 1} 年` : `${year} 年`;
}

const areaNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

function areaLabel(area) {
  if (!Number.isFinite(area) || area <= 0) return '';
  const large = area >= 10000;
  const value = areaNumber.format(large ? area / 10000 : area);
  return `约 ${value}${large ? ' 万' : ''}平方公里`;
}

function recordYears(record) {
  return record.fromYear === record.toYear ? yearLabel(record.fromYear) :
    `${yearLabel(record.fromYear)} 至 ${yearLabel(record.toYear)}`;
}

function renderHistory(records, selected, slice, slices, jump, keepOpen) {
  historyPanel.open = keepOpen && historyPanel.open;
  const scrollTop = keepOpen ? historyList.scrollTop : 0;
  historyList.replaceChildren();
  if (records.length === 1) {
    const message = document.createElement('li');
    message.textContent = '当前数据集仅收录这一时期可确认关联的疆界记录。';
    historyList.append(message);
  }
  for (const record of records) {
    const row = document.createElement('li');
    const active = record.sourceIndex === selected.sourceIndex;
    if (active) row.setAttribute('aria-current', 'true');
    const description = document.createElement('p');
    description.textContent = [recordYears(record), areaLabel(record.areaKm2)].filter(Boolean).join(' · ');
    row.append(description);
    const available = slices.filter(({ year }) => record.fromYear <= year && year <= record.toYear);
    const target = available.reduce((best, item) =>
      !best || Math.abs(item.year - slice.year) < Math.abs(best.year - slice.year) ? item : best, null);
    if (target && (!active || target !== slice)) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = `查看该时期地图 · ${yearLabel(target.year)}`;
      action.onclick = () => jump(target, record.sourceIndex);
      row.append(action);
    } else {
      const message = document.createElement('p');
      message.className = 'meta';
      message.textContent = active ? '当前显示' : '暂不可查看 · 此期间没有已生成的地图切片';
      row.append(message);
    }
    historyList.append(row);
  }
  historyList.scrollTop = scrollTop;
}

function colorBorders(data) {
  for (const { properties } of data.features) {
    let hash = 0;
    for (const character of properties.name) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
    properties.color = palette[hash % palette.length];
  }
  return data;
}

function showPolity(properties, encyclopedia, year, record) {
  const entity = encyclopedia?.entities[encyclopedia.byRecord[properties.sourceIndex]];
  const heading = document.querySelector('#atlas-polity-name');
  heading.textContent = entity?.zh || properties.name;
  heading.lang = entity?.zh ? 'zh-CN' : 'en';
  const original = document.querySelector('#atlas-polity-original');
  original.textContent = properties.name;
  original.hidden = !entity?.zh || entity.zh === properties.name;
  document.querySelector('#atlas-polity-year').textContent = yearLabel(year);
  document.querySelector('#atlas-polity-years').textContent = recordYears(properties);
  const area = document.querySelector('#atlas-polity-area');
  const estimate = areaLabel(record.areaKm2);
  area.hidden = !estimate;
  area.textContent = estimate ? `估算疆域面积 · ${estimate}` : '';
  const link = document.querySelector('#atlas-polity-encyclopedia');
  link.hidden = !entity?.url;
  if (entity?.url) link.href = entity.url;
  else link.removeAttribute('href');
  document.querySelector('#atlas-polity-no-encyclopedia').hidden = !link.hidden;
  sourceRecord.textContent = `当前所选疆界：Cliopatria 原始记录第 ${properties.sourceIndex + 1} 条`;
  sourceRecord.hidden = false;
  polityPanel.hidden = false;
}

function revealGeometry(map, geometry) {
  const bounds = map.getBounds();
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0]) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  if (west > bounds.getEast() || east < bounds.getWest() ||
      south > bounds.getNorth() || north < bounds.getSouth()) {
    map.easeTo({ center: [(west + east) / 2, (south + north) / 2] });
  }
}

function renderSources(items) {
  for (const item of Object.values(items)) {
    const line = document.createElement('li');
    const source = document.createElement('a');
    source.href = item.source;
    source.textContent = `${item.name} ${item.version}`;
    const license = document.createElement('a');
    license.href = item.licenseUrl;
    license.textContent = item.license;
    line.append(source, ' · ', license);
    if (item.citation) line.append(` · ${item.citation}`);
    sources.append(line);
  }
}

async function initialize() {
  const manifest = await readData('manifest.json');
  renderSources(manifest.sources);
  const initial = manifest.slices[0];
  const [land, lakes, borders] = await Promise.all([
    readData('land.geojson'), readData('lakes.geojson'), readData(initial.file),
  ]);
  setWorkerUrl(new URL('/atlas/vendor/maplibre-gl-worker.mjs', location.href).href);
  const map = new Map({
    container,
    bounds: [[-179, -70], [179, 80]],
    fitBoundsOptions: { padding: 14 },
    minZoom: -2,
    maxZoom: 6,
    renderWorldCopies: false,
    dragRotate: false,
    touchPitch: false,
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        land: { type: 'geojson', data: land },
        lakes: { type: 'geojson', data: lakes },
        polities: { type: 'geojson', data: colorBorders(borders) },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': ocean } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f6f2e5' } },
        { id: 'polity-fill', type: 'fill', source: 'polities', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.79 } },
        { id: 'polity-line', type: 'line', source: 'polities', paint: { 'line-color': '#755236', 'line-width': 0.8 } },
        { id: 'polity-highlight', type: 'line', source: 'polities',
          filter: ['==', ['get', 'sourceIndex'], -1],
          paint: { 'line-color': '#152b25', 'line-width': 3 } },
        { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': ocean } },
      ],
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  let active = initial;
  let activeData = borders;
  let loaded = false;
  let requested = initial;
  let requestController;
  let rendering = Promise.resolve();
  let renderingSlice;

  function showStatus(error) {
    const current = `当前切片 · ${yearLabel(active.year)}`;
    status.textContent = error ? `${current}；切换失败：${error.message}` :
      requested === active ? current : `${current}；正在加载 ${yearLabel(requested.year)}`;
  }

  function clearPolity() {
    polityPanel.hidden = true;
    sourceRecord.hidden = true;
    map.setFilter('polity-highlight', ['==', ['get', 'sourceIndex'], -1]);
  }

  function selectPolity(properties, keepOpen = false) {
    const history = manifest.polityHistory;
    const group = history?.groups[history.byRecord[properties.sourceIndex]] ?? [properties];
    const record = group.find(item => item.sourceIndex === properties.sourceIndex) ?? properties;
    map.setFilter('polity-highlight', ['==', ['get', 'sourceIndex'], properties.sourceIndex]);
    showPolity(properties, manifest.encyclopedia, active.year, record);
    renderHistory(group, record, active, manifest.slices, selectSlice, keepOpen);
  }

  function focusRecord(sourceIndex) {
    const feature = activeData.features.find(item => item.properties.sourceIndex === sourceIndex);
    if (!feature) throw new Error('此切片未收录所选疆界');
    selectPolity(feature.properties, true);
    revealGeometry(map, feature.geometry);
  }

  document.querySelector('#atlas-polity-close').onclick = clearPolity;

  map.on('error', event => {
    if (!loaded) status.textContent = `地图加载失败：${event.error.message}`;
  });
  map.once('load', () => {
    loaded = true;
    slider.disabled = false;
    showStatus();
  });
  slider.max = String(manifest.slices.length - 1);
  slider.setAttribute('aria-valuetext', yearLabel(initial.year));
  for (const { year } of manifest.slices) {
    const label = document.createElement('span');
    label.textContent = yearLabel(year);
    years.append(label);
  }
  async function selectSlice(slice, sourceIndex) {
    requested = slice;
    slider.value = String(manifest.slices.indexOf(slice));
    slider.setAttribute('aria-valuetext', yearLabel(slice.year));
    requestController?.abort();
    const { signal } = (requestController = new AbortController());
    showStatus();
    try {
      if (slice === active && !renderingSlice) {
        if (sourceIndex !== undefined) focusRecord(sourceIndex);
        return;
      }
      const data = await readData(slice.file, signal);
      const update = rendering.then(async () => {
        if (signal.aborted) return;
        if (slice === active) {
          if (sourceIndex !== undefined) focusRecord(sourceIndex);
          return;
        }
        if (sourceIndex !== undefined && !data.features.some(item => item.properties.sourceIndex === sourceIndex)) {
          throw new Error('此切片未收录所选疆界');
        }
        renderingSlice = slice;
        try {
          await map.getSource('polities').setData(colorBorders(data));
          active = slice;
          activeData = data;
          showStatus();
          if (sourceIndex !== undefined && !signal.aborted) focusRecord(sourceIndex);
          else clearPolity();
        } finally {
          renderingSlice = undefined;
        }
      });
      rendering = update.catch(() => {});
      await update;
    } catch (error) {
      if (signal.aborted) return;
      requested = active;
      slider.value = String(manifest.slices.indexOf(active));
      slider.setAttribute('aria-valuetext', yearLabel(active.year));
      showStatus(error);
    }
  }
  slider.addEventListener('input', () => selectSlice(manifest.slices[Number(slider.value)]));
  map.on('mouseenter', 'polity-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'polity-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'polity-fill', event => {
    if (!renderingSlice && event.features?.length) {
      selectPolity(event.features[0].properties);
    }
  });
}

initialize().catch(error => { status.textContent = `地图加载失败：${error.message}`; });
