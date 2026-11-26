import { Map, Marker, NavigationControl, setWorkerUrl } from '/atlas/vendor/maplibre-gl.mjs';
import { formatYear, parseYear } from '../chronology.mjs';
import { createAtlasData, createPolitySearch, recordAtYear } from './data.mjs';
import { readPlaceApi } from './place-api.mjs';
import { bindPlaceSearch } from './places.mjs';
import { bindMapSources } from './comparison.mjs';
import { sourceYearToAxis, zoomYears } from './years.mjs';
import { addGeographicLabels, addGeographicDetail } from './geography.mjs';
import { bindEvents } from './events.mjs';
import { mergeEventDatasets } from './event-data.mjs';

const status = document.querySelector('#atlas-status');
const years = document.querySelector('#atlas-years');
const slider = document.querySelector('#atlas-year');
const yearInput = document.querySelector('#atlas-year-input');
const timeIn = document.querySelector('#atlas-time-in');
const timeOut = document.querySelector('#atlas-time-out');
const timeFit = document.querySelector('#atlas-time-fit');
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

function renderHistory(records, selected, year, jump, keepOpen) {
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
    const target = Math.max(sourceYearToAxis(record.fromYear), Math.min(sourceYearToAxis(record.toYear), year));
    if (!active) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = `查看该时期地图 · ${formatYear(target)}`;
      action.onclick = () => jump(target, record.sourceIndex);
      row.append(action);
    } else {
      const message = document.createElement('p');
      message.className = 'meta';
      message.textContent = '当前显示';
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

function showPolity(properties, identity, year) {
  const heading = document.querySelector('#atlas-polity-name');
  heading.textContent = identity.name;
  heading.lang = identity.chinese ? 'zh-CN' : 'en';
  const original = document.querySelector('#atlas-polity-original');
  original.textContent = properties.name;
  original.hidden = identity.name === properties.name;
  document.querySelector('#atlas-polity-year').textContent = formatYear(year);
  document.querySelector('#atlas-polity-years').textContent = recordYears(properties);
  const area = document.querySelector('#atlas-polity-area');
  const estimate = areaLabel(properties.areaKm2);
  area.hidden = !estimate;
  area.textContent = estimate ? `估算疆域面积 · ${estimate}` : '';
  const link = document.querySelector('#atlas-polity-encyclopedia');
  link.hidden = !identity.url;
  if (identity.url) link.href = identity.url;
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
    if (item.citation || item.credits) line.append(` · ${item.citation ?? item.credits}`);
    sources.append(line);
  }
}

async function initialize() {
  const eventFiles = ['events.json', 'events-wikidata.json', 'events-noaa.json', 'events-milestones.json', 'events-regional.json'];
  const eventDataset = Promise.all(eventFiles.map(async file => {
    const response = await fetch(`/atlas/${file}`);
    if (!response.ok) throw new Error('事件数据无法读取');
    return response.json();
  })).then(datasets => mergeEventDatasets(...datasets)).catch(error => {
    console.warn(error.message);
    return null;
  });
  const [manifest, chronology, land, lakes, rivers, places] = await Promise.all([
    readData('manifest.json'), readData('chronology.json'), readData('land.geojson'), readData('lakes.geojson'),
    readData('rivers.geojson'),
    readPlaceApi('meta').catch(error => {
      console.warn(error.message);
      return { datasets: [] };
    }),
  ]);
  if (!chronology.names) throw new Error('政权名称索引需要更新，请运行 npm run atlas:prepare');
  renderSources({ ...manifest.sources, ...Object.fromEntries((places.datasets ?? []).map((source, index) =>
    [`place-dataset-${index}`, source])), places: {
    name: '北宋历史地点（近似点位）', version: 'v1.1', source: '/atlas/northern-song-places.json',
    license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  } });
  const riverPaint = { 'line-color': '#438498', 'line-opacity': 0.72,
    'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.65, 6, 1.25] };
  const data = createAtlasData(chronology, readData);
  const initial = 1;
  let activeFrame = data.frame(initial);
  let activeData = colorBorders(await data.features(activeFrame));
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
        rivers: { type: 'geojson', data: rivers },
        polities: { type: 'geojson', data: activeData },
        comparison: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': ocean } },
        { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f6f2e5' } },
        { id: 'polity-fill', type: 'fill', source: 'polities', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.79 } },
        { id: 'comparison-fill', type: 'fill', source: 'comparison', layout: { visibility: 'none' },
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.66 } },
        { id: 'major-rivers', type: 'line', source: 'rivers', minzoom: 2, maxzoom: 4,
          filter: ['<=', ['get', 'rank'], 3], paint: riverPaint },
        { id: 'detail-rivers', type: 'line', source: 'rivers', minzoom: 4, paint: riverPaint },
        { id: 'comparison-line', type: 'line', source: 'comparison', layout: { visibility: 'none' },
          paint: { 'line-color': '#675342', 'line-width': 0.8 } },
        { id: 'polity-line', type: 'line', source: 'polities', paint: { 'line-color': '#755236', 'line-width': 0.8 } },
        { id: 'polity-highlight', type: 'line', source: 'polities',
          filter: ['==', ['get', 'visual'], ''],
          paint: { 'line-color': '#152b25', 'line-width': 3 } },
        { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': ocean } },
      ],
    },
  });
  map.addControl(new NavigationControl({ showCompass: false }));
  let events;
  let visibleYear;
  const updateGeography = addGeographicLabels(map, rivers, Marker, () => events?.close());
  function updateMapYear(year) {
    visibleYear = year;
    updateGeography(year);
    events?.updateYear(year);
  }
  if (manifest.geography) addGeographicDetail(map, readData, { land, lakes, rivers }, updateGeography);
  let active = initial;
  let loaded = false;
  let requested = initial;
  let window = chronology.bounds;
  let selection;
  let changeTimer;
  let prefetchTimer;
  let requestNumber = 0;
  let rendering = Promise.resolve();
  let drawing = false;

  let mapSources;
  let refreshPlaceSearch;

  function showStatus(error) {
    document.querySelector('#atlas-map-source').disabled = !loaded || requested !== active;
    const missing = activeFrame.byRecord.size ? '' : ' · 该年无疆界资料';
    const current = `当前地图 · ${formatYear(active)}${missing}`;
    status.textContent = error ? `${current}；切换失败：${error.message}` :
      requested === active ? current : `${current}；正在加载 ${formatYear(requested)}`;
  }

  function clearPolity() {
    polityPanel.hidden = true;
    sourceRecord.hidden = true;
    if (selection !== undefined) map.setFilter('polity-highlight', ['==', ['get', 'visual'], '']);
    selection = undefined;
  }

  function selectPolity(item, keepOpen = false) {
    const { record } = item;
    const { history, names } = chronology;
    const key = history.byRecord[record.sourceIndex];
    const group = history.groups[key];
    if (selection !== item.visual) map.setFilter('polity-highlight', ['==', ['get', 'visual'], item.visual]);
    selection = item.visual;
    showPolity(record, names[key], active);
    renderHistory(group, record, active, selectYear, keepOpen);
  }

  function focusRecord(sourceIndex) {
    const item = activeFrame.byRecord.get(sourceIndex);
    selectPolity(item, true);
    const feature = activeData.features.find(candidate => candidate.properties.visual === item.visual);
    if (feature) revealGeometry(map, feature.geometry);
  }

  document.querySelector('#atlas-polity-close').onclick = clearPolity;

  function syncControls(year) {
    if (year < window[0] || year > window[1]) {
      window = zoomYears(window, year, 1, chronology.bounds);
    }
    slider.min = String(window[0]);
    slider.max = String(window[1]);
    slider.value = String(year);
    slider.setAttribute('aria-valuetext', formatYear(year));
    yearInput.value = formatYear(year);
    timeIn.disabled = !loaded || window[1] - window[0] <= 20;
    timeOut.disabled = timeFit.disabled = !loaded ||
      (window[0] === chronology.bounds[0] && window[1] === chronology.bounds[1]);
    years.replaceChildren(...window.map(value => {
      const label = document.createElement('span');
      label.textContent = formatYear(value);
      return label;
    }));
  }

  function prefetch() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => data.prefetch(activeFrame), 180);
  }

  map.on('error', event => {
    if (!loaded) status.textContent = `地图加载失败：${event.error.message}`;
  });
  map.once('load', () => {
    loaded = true;
    slider.disabled = yearInput.disabled = document.querySelector('#atlas-jump-submit').disabled = false;
    document.querySelector('#atlas-polity-input').disabled = false;
    mapSources = bindMapSources(map, readData, () => active, clearPolity, updateMapYear, palette);
    refreshPlaceSearch = bindPlaceSearch((q, year) => readPlaceApi('search', { q, year }), () => active,
      async (place, year) => {
        const expected = requestNumber + Number(year !== undefined);
        if (year !== undefined) await selectYear(year);
        const placesToggle = document.querySelector('#atlas-show-places');
        if (requestNumber !== expected || mapSources.comparing() || (year !== undefined && active !== year)) return;
        if (year !== undefined && !placesToggle.checked) {
          placesToggle.checked = true;
          placesToggle.dispatchEvent(new Event('change'));
        }
        updateGeography.locate(place, year);
      });
    syncControls(active);
    showStatus();
    updateMapYear(active);
    void eventDataset.then(dataset => {
      if (!dataset) throw new Error('事件数据无法读取');
      events = bindEvents(map, Marker, dataset, updateGeography.close);
      events.updateYear(visibleYear);
    }).catch(error => {
      console.warn(error.message);
      const status = document.querySelector('#atlas-event-status');
      status.textContent = '历史事件资料暂时无法读取。';
      document.querySelector('#atlas-events').hidden = false;
    });
    prefetch();
  });

  const search = createPolitySearch(chronology);
  const searchInput = document.querySelector('#atlas-polity-input');
  const searchResults = document.querySelector('#atlas-search-results');
  const searchList = document.querySelector('#atlas-search-list');
  const searchStatus = document.querySelector('#atlas-search-status');
  const resultLimit = 12;
  function jumpFromSearch(entry, record, year) {
    searchInput.value = entry.name;
    searchResults.hidden = true;
    searchInput.focus();
    selectYear(year, record.sourceIndex);
  }

  function showMatches() {
    const query = searchInput.value.trim();
    searchResults.hidden = !query;
    searchList.replaceChildren();
    const matches = search(query, active);
    searchStatus.textContent = !matches.length ? '没有匹配的政权' :
      matches.length > resultLimit ? `找到 ${matches.length} 项，显示前 ${resultLimit} 项` : '';
    for (const entry of matches.slice(0, resultLimit)) {
      const { name, original, records, current, composite } = entry;
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      const detail = document.createElement('small');
      const recordType = composite ? '组合疆界' : '政权';
      const availability = current ? `当前年份可定位（${recordYears(current)}）` : '查看可用年代';
      detail.textContent = [name !== original && original, recordType, availability].filter(Boolean).join(' · ');
      button.append(detail);
      button.onclick = () => {
        const currentRecord = recordAtYear(records, active);
        if (currentRecord) {
          jumpFromSearch(entry, currentRecord, active);
          return;
        }
        const periods = row.querySelector('.atlas-search-periods');
        periods.hidden = !periods.hidden;
        button.setAttribute('aria-expanded', String(!periods.hidden));
        if (!periods.hidden) periods.querySelector('button')?.focus();
      };
      row.append(button);
      if (!current) {
        button.setAttribute('aria-expanded', 'false');
        const periods = document.createElement('ul');
        periods.className = 'atlas-search-periods';
        periods.setAttribute('aria-label', `${name}可用的疆界资料年代`);
        periods.hidden = true;
        for (const record of records) {
          const item = document.createElement('li');
          const option = document.createElement('button');
          const year = sourceYearToAxis(record.fromYear);
          option.type = 'button';
          option.textContent = `疆界资料 · ${recordYears(record)}`;
          const hint = document.createElement('small');
          hint.textContent = `查看 ${formatYear(year)}的地图`;
          option.append(hint);
          option.onclick = () => jumpFromSearch(entry, record, year);
          item.append(option);
          periods.append(item);
        }
        row.append(periods);
      }
      searchList.append(row);
    }
  }
  searchInput.addEventListener('input', showMatches);
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !searchResults.hidden) {
      event.preventDefault();
      searchResults.hidden = true;
    }
  });
  document.querySelector('#atlas-polity-search').onsubmit = event => {
    event.preventDefault();
    showMatches();
    const first = searchList.querySelector('button');
    if (searchList.children.length === 1) first.click();
    else first?.focus();
  };

  function selectYear(year, sourceIndex, delay = 0) {
    clearTimeout(changeTimer);
    clearTimeout(prefetchTimer);
    const request = ++requestNumber;
    requested = year;
    syncControls(year);
    showStatus();

    async function apply() {
      const target = data.frame(year);
      try {
        if (sourceIndex !== undefined && !target.byRecord.has(sourceIndex)) throw new Error('该年未收录所选疆界');
        const features = target.key === activeFrame.key && !drawing ? null : await data.features(target);
        const update = rendering.then(async () => {
          if (request !== requestNumber) return;
          if (target.key !== activeFrame.key) {
            drawing = true;
            try {
              const next = colorBorders(features ?? await data.features(target));
              if (request !== requestNumber) return;
              await map.getSource('polities').setData(next);
              activeData = next;
            } finally {
              drawing = false;
            }
          }
          active = year;
          activeFrame = target;
          if (!searchResults.hidden) showMatches();
          mapSources.updateYear();
          refreshPlaceSearch();
          if (sourceIndex !== undefined && request === requestNumber) focusRecord(sourceIndex);
          else clearPolity();
          showStatus();
          if (request === requestNumber) prefetch();
        });
        rendering = update.catch(() => {});
        await update;
      } catch (error) {
        if (request !== requestNumber) return;
        requested = active;
        syncControls(active);
        showStatus(error);
      }
    }
    if (delay) changeTimer = setTimeout(apply, delay);
    else return apply();
  }

  slider.addEventListener('input', () => selectYear(Number(slider.value), undefined, 70));
  document.querySelector('#atlas-jump').onsubmit = event => {
    event.preventDefault();
    try {
      const year = parseYear(yearInput.value);
      if (year < chronology.bounds[0] || year > chronology.bounds[1]) {
        throw new Error(`请选择 ${formatYear(chronology.bounds[0])}至${formatYear(chronology.bounds[1])}`);
      }
      selectYear(year);
    } catch (error) { showStatus(error); }
  };
  function zoomTime(factor) {
    window = zoomYears(window, requested, factor, chronology.bounds);
    syncControls(requested);
  }
  timeIn.onclick = () => zoomTime(0.4);
  timeOut.onclick = () => zoomTime(2.5);
  timeFit.onclick = () => { window = chronology.bounds; syncControls(requested); };
  syncControls(initial);
  map.on('mouseenter', 'polity-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'polity-fill', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'polity-fill', event => {
    if (!drawing && !mapSources?.comparing() && event.features?.length) {
      const item = activeFrame.byVisual.get(event.features[0].properties.visual);
      if (item) selectPolity(item);
    }
  });
}

initialize().catch(error => {
  status.textContent = `地图资料无法加载：${error.message}。请按 README 恢复已准备的 atlas-data 资料包后刷新。`;
});
