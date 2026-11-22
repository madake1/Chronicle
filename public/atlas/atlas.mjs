import { Map, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';

const status = document.querySelector('#atlas-status');
const years = document.querySelector('#atlas-years');
const container = document.querySelector('#atlas-map');
const sources = document.querySelector('#atlas-sources');
const ocean = '#dfe9ec';

document.documentElement.dataset.theme = localStorage.getItem('chronicle-theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

async function readData(name) {
  const response = await fetch(`/atlas/data/${name}`);
  if (!response.ok) throw new Error('地图数据尚未准备，请运行 npm run atlas:prepare');
  return response.json();
}

function yearLabel(year) {
  return year < 0 ? `公元前 ${-year} 年` : `${year} 年`;
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
        polities: { type: 'geojson', data: borders },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': ocean } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f6f2e5' } },
        { id: 'polity-fill', type: 'fill', source: 'polities', paint: { 'fill-color': '#b1875b', 'fill-opacity': 0.67 } },
        { id: 'polity-line', type: 'line', source: 'polities', paint: { 'line-color': '#755236', 'line-width': 0.8 } },
        { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': ocean } },
      ],
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  const buttons = [];
  let active = initial;
  let loaded = false;
  map.on('error', event => {
    if (!loaded) status.textContent = `地图加载失败：${event.error.message}`;
  });
  map.once('load', () => {
    loaded = true;
    for (const button of buttons) button.disabled = false;
    status.textContent = `当前切片 · ${yearLabel(active.year)}`;
  });
  for (const slice of manifest.slices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = yearLabel(slice.year);
    button.disabled = true;
    button.setAttribute('aria-pressed', String(slice === active));
    button.addEventListener('click', async () => {
      if (slice === active) return;
      for (const item of buttons) item.disabled = true;
      try {
        const data = await readData(slice.file);
        await map.getSource('polities').setData(data);
        active = slice;
        for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
        status.textContent = `当前切片 · ${yearLabel(active.year)}`;
      } catch (error) {
        status.textContent = `切换失败：${error.message}`;
      } finally {
        for (const item of buttons) item.disabled = false;
      }
    });
    buttons.push(button);
    years.append(button);
  }
}

initialize().catch(error => { status.textContent = `地图加载失败：${error.message}`; });
