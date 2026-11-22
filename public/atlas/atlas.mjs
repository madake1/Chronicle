import { Map, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';

const status = document.querySelector('#atlas-status');
const years = document.querySelector('#atlas-years');
const slider = document.querySelector('#atlas-year');
const container = document.querySelector('#atlas-map');
const sources = document.querySelector('#atlas-sources');
const sourceRecord = document.querySelector('#atlas-source-record');
const polityPanel = document.querySelector('#atlas-polity');
const ocean = '#dfe9ec';
const palette = ['#4f9587', '#c98d4e', '#8b78a9', '#5b87b1', '#b95d6c', '#879b51',
  '#b47b9b', '#777fa5', '#a48262', '#478ca2', '#9a685e', '#aaa25d'];
document.querySelector('#atlas-polity-close').onclick = () => { polityPanel.hidden = true; };

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

function colorBorders(data) {
  for (const { properties } of data.features) {
    let hash = 0;
    for (const character of properties.name) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
    properties.color = palette[hash % palette.length];
  }
  return data;
}

function showPolity(properties, encyclopedia, year) {
  const entity = encyclopedia?.entities[encyclopedia.byRecord[properties.sourceIndex]];
  const heading = document.querySelector('#atlas-polity-name');
  heading.textContent = entity?.zh || properties.name;
  heading.lang = entity?.zh ? 'zh-CN' : 'en';
  const original = document.querySelector('#atlas-polity-original');
  original.textContent = properties.name;
  original.hidden = !entity?.zh || entity.zh === properties.name;
  document.querySelector('#atlas-polity-year').textContent = `当前地图 · ${yearLabel(year)}`;
  document.querySelector('#atlas-polity-years').textContent =
    `本条疆界记录适用 · ${yearLabel(properties.fromYear)} 至 ${yearLabel(properties.toYear)}`;
  const link = document.querySelector('#atlas-polity-encyclopedia');
  link.hidden = !entity?.url;
  if (entity?.url) link.href = entity.url;
  else link.removeAttribute('href');
  document.querySelector('#atlas-polity-no-encyclopedia').hidden = !link.hidden;
  sourceRecord.textContent = `当前所选疆界：Cliopatria 原始记录第 ${properties.sourceIndex + 1} 条`;
  sourceRecord.hidden = false;
  polityPanel.hidden = false;
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
        { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': ocean } },
      ],
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  let active = initial;
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
  slider.addEventListener('input', async () => {
    const slice = manifest.slices[Number(slider.value)];
    requested = slice;
    slider.setAttribute('aria-valuetext', yearLabel(slice.year));
    requestController?.abort();
    const { signal } = (requestController = new AbortController());
    showStatus();
    if (slice === active && !renderingSlice) return;
    try {
      const data = await readData(slice.file, signal);
      const update = rendering.then(async () => {
        if (signal.aborted || slice === active) return;
        renderingSlice = slice;
        polityPanel.hidden = true;
        sourceRecord.hidden = true;
        try {
          await map.getSource('polities').setData(colorBorders(data));
          active = slice;
          showStatus();
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
  });
  map.on('mouseenter', 'polity-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'polity-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'polity-fill', event => {
    if (!renderingSlice && event.features?.length) {
      showPolity(event.features[0].properties, manifest.encyclopedia, active.year);
    }
  });
}

initialize().catch(error => { status.textContent = `地图加载失败：${error.message}`; });
