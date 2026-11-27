import { placeAt, placePeriod, placesAt } from './places.mjs';
import { readPlaceApi, readViewportPlaces } from './place-api.mjs';

export { placesAt };

export function placePopup({ place, name, role, coverage }, sources, content = document.createElement('div')) {
  content.classList.add('atlas-place-popup');
  const title = document.createElement('h2');
  title.textContent = name?.name ?? place.name;
  const period = document.createElement('p');
  period.textContent = coverage
    ? `${place.type} · 资料记载：${placePeriod(coverage)}`
    : `${place.type} · 参考地点，年代待考`;
  content.append(title, period);
  if (place.datasetName) {
    const dataset = document.createElement('p');
    dataset.className = 'meta';
    dataset.textContent = `地点资料来源 · ${place.datasetName}`;
    content.append(dataset);
  }
  if (name) {
    const historicalName = document.createElement('p');
    historicalName.textContent = `${name.original} · 地名资料年代 ${placePeriod(name)}`;
    content.append(historicalName);
  }
  if (!name && place.originalName && place.originalName !== place.name) {
    const original = document.createElement('p');
    original.textContent = place.originalName;
    content.append(original);
  }
  const otherNames = place.names.filter(entry => entry !== name);
  if (otherNames.length && (name || place.names.length > 1 || otherNames[0].name !== place.name)) {
    const names = document.createElement('details');
    const heading = document.createElement('summary');
    const dated = otherNames.filter(entry => entry.fromYear !== undefined);
    const undated = otherNames.filter(entry => entry.fromYear === undefined);
    heading.textContent = dated.length ? '其他名称' : '其他名称（年代待考）';
    names.append(heading);
    const appendName = (entry, date) => {
      const line = document.createElement('p');
      line.textContent = [entry.name, entry.original === entry.name ? null : entry.original, date]
        .filter(Boolean).join(' · ');
      const variants = (entry.aliases ?? []).filter(alias => alias !== entry.name && alias !== entry.original);
      if (variants.length) line.append(`（${[...new Set(variants)].join('、')}）`);
      if (entry.citation?.startsWith('https://')) {
        const link = document.createElement('a');
        link.href = entry.citation;
        link.textContent = '出处';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        line.append(' · ', link);
      }
      names.append(line);
    };
    for (const entry of dated) appendName(entry, placePeriod(entry));
    if (dated.length && undated.length) {
      const label = document.createElement('p');
      label.className = 'meta';
      label.textContent = '年代待考';
      names.append(label);
    }
    for (const entry of undated) appendName(entry);
    content.append(names);
  }
  for (const observed of place.attestations ?? []) {
    if (observed === coverage || observed.fromYear === coverage?.fromYear && observed.toYear === coverage?.toYear) continue;
    const evidence = document.createElement('p');
    evidence.textContent = `地点资料记载 · ${placePeriod(observed)}`;
    content.append(evidence);
  }
  for (const observed of place.existence ?? []) {
    const existence = document.createElement('p');
    existence.textContent = `存在年代资料 · ${placePeriod(observed)}`;
    content.append(existence);
  }
  if (role) {
    const identity = document.createElement('p');
    identity.textContent = `${role.label} · ${placePeriod(role)}`;
    content.append(identity);
  }
  if (place.confidence && place.confidence !== '地图时段采用来源对地点或点位的记载，名称与存在年代分开记录。') {
    const note = document.createElement('p');
    note.textContent = place.confidence;
    content.append(note);
  }
  appendPlaceSources(content, place, role);
  const references = document.createElement('ul');
  for (const id of new Set([...place.sourceIds, ...[coverage, ...place.names, ...place.roles, ...(place.existence ?? [])].map(item => item?.sourceId).filter(Boolean)])) {
    if (!sources[id]) continue;
    const entry = document.createElement('li');
    const link = document.createElement('a');
    link.href = sources[id].url;
    const source = sources[id];
    link.textContent = source.title;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (source.license || source.credits?.length) {
      const credit = [source.license, source.version?.slice(0, 10), ...source.credits ?? []].filter(Boolean).join(' · ');
      entry.title = credit;
    }
    entry.append(link);
    references.append(entry);
  }
  content.append(references);
  if (place.encyclopedia) {
    const link = document.createElement('a');
    link.href = place.encyclopedia;
    link.textContent = '查看百科';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    content.append(link);
  }
  return content;
}

function appendPlaceSources(content, place, currentRole) {
  const details = place.sourceDetails ?? {};
  const withDates = item => ({
    ...item, label: [item.label ?? item.url, item.type, ...(item.dates ?? []).map(placePeriod)]
      .filter(Boolean).join(' · '),
  });
  const catalog = [];
  if (place.sourceTypes?.length) catalog.push({ label: `原始分类 · ${place.sourceTypes.join('、')}` });
  if (place.originalId) catalog.push({ label: `来源编号 · ${place.originalId}` });
  if (place.coordinates?.length === 2) {
    catalog.push({ label: `地图点位（经度、纬度）· ${place.coordinates.map(value => value.toFixed(5)).join(', ')}` });
  }
  const groups = [
    ['史料备注', (details.notes ?? []).map(label => ({ label }))],
    ['归属与关联（按来源记载）', (details.relations ?? []).map(withDates)],
    ['其他身份记录', (place.roles ?? []).filter(role => role !== currentRole)
      .map(role => withDates({ label: role.label, dates: [role] }))],
    ['点位依据', (details.location ?? []).map(withDates)],
    ['逐条引文', details.citations ?? []],
    ['原始图像资料', details.depictions ?? []],
    ['外部资料关联', (details.links ?? []).map(item => ({
      ...item, label: [item.label, item.type === 'closeMatch' && '近似匹配',
        item.augmented && 'WHG 补充'].filter(Boolean).join(' · '),
    }))],
    ['记录信息', catalog],
  ];
  for (const [title, items] of groups) {
    if (!items.length) continue;
    const group = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = title;
    const list = document.createElement('ul');
    for (const { label, url } of items) {
      const row = document.createElement('li');
      if (url && /^https?:\/\//i.test(url)) {
        const link = document.createElement('a');
        link.href = url;
        link.textContent = label;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        row.append(link);
      } else row.textContent = label;
      list.append(row);
    }
    group.append(summary, list);
    content.append(group);
  }
}

export function riverAnchors(rivers) {
  const anchors = [];
  for (const { geometry, properties } of rivers.features) {
    if (!properties.name) continue;
    const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    for (const line of lines) {
      if (line.length < 3) continue;
      for (const fraction of [0.25, 0.5, 0.75]) {
        anchors.push({ ...properties, position: line[Math.floor((line.length - 1) * fraction)] });
      }
    }
  }
  return anchors.sort((a, b) => a.rank - b.rank);
}

export function labelSpace(map, points = []) {
  const { clientWidth: width, clientHeight: height } = map.getCanvas();
  const bounds = map.getBounds();
  const used = points.map(position => {
    const { x, y } = map.project(position);
    return { left: x - 21, right: x + 21, y };
  });
  return (position, label, centered = false) => {
    if (!bounds.contains(position)) return false;
    const { x, y } = map.project(position);
    const size = Math.max(26, [...label].reduce((n, character) => n + (character.codePointAt(0) > 255 ? 12 : 8), 12));
    const left = x - (centered ? size / 2 : 8);
    const right = left + size;
    if (left < 0 || right > width || y < 14 || y > height - 14 ||
        used.some(box => left < box.right && right > box.left && Math.abs(y - box.y) < 24)) return false;
    used.push({ left, right, y });
    return true;
  };
}

export function physicalMapLayers(ocean) {
  const paint = { 'line-color': '#438498', 'line-opacity': 0.72,
    'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.65, 6, 1.25] };
  return [
    { id: 'major-rivers', type: 'line', source: 'rivers', minzoom: 2, maxzoom: 4,
      filter: ['<=', ['get', 'rank'], 3], paint },
    { id: 'detail-rivers', type: 'line', source: 'rivers', minzoom: 4, paint },
    { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': ocean } },
  ];
}

export function addGeographicLabels(map, rivers, Marker, onPlaceOpen) {
  let anchors = riverAnchors(rivers);
  let mountains = [];
  const markers = new Map();
  let year;
  let detailRequest = 0;
  let viewportRequest = 0;
  let historical = [];
  const placesToggle = document.querySelector('#atlas-show-places');
  const placeStatus = document.querySelector('#atlas-place-layer-status');
  const panel = document.querySelector('#atlas-place-panel');
  const detailContent = document.querySelector('#atlas-place-content');

  function closePlace() {
    ++detailRequest;
    panel.hidden = true;
    detailContent.replaceChildren();
  }

  document.querySelector('#atlas-place-close').addEventListener('click', closePlace);
  panel.addEventListener('dblclick', event => event.stopPropagation());
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePlace();
  });

  async function refreshPlaces() {
    const request = ++viewportRequest;
    if (year === undefined || !placesToggle.checked) return;
    try {
      const data = await readViewportPlaces(map, year);
      if (request !== viewportRequest) return;
      historical = data;
      placeStatus.hidden = true;
      render();
    } catch {
      if (request !== viewportRequest) return;
      placeStatus.hidden = false;
    }
  }

  async function openPlace(place, selectedYear) {
    closePlace();
    const request = detailRequest;
    try {
      const detail = await readPlaceApi('detail', { id: place.id });
      if (request !== detailRequest) return;
      onPlaceOpen?.();
      detailContent.replaceChildren(placePopup(placeAt(detail.place, selectedYear), detail.sources));
      panel.hidden = false;
    } catch {
      if (request === detailRequest) placeStatus.hidden = false;
    }
  }


  function render() {
    const zoom = map.getZoom();
    const reserve = labelSpace(map);
    const next = new Set();

    function add(key, position, makeMarker) {
      next.add(key);
      if (!markers.has(key)) markers.set(key, makeMarker().setLngLat(position).addTo(map));
    }

    let historicalCount = 0;
    for (const item of placesToggle.checked ? historical : []) {
      const { place, name, role, coverage } = item;
      const label = name?.name ?? place.name;
      if (coverage && zoom < 3 && historicalCount >= 6) continue;
      if (!reserve(place.coordinates, label)) continue;
      if (coverage) historicalCount++;
      add(`place:${place.id}:${label}:${role?.label ?? ''}:${coverage?.fromYear ?? ''}`, place.coordinates, () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `atlas-place-label${role ? ' has-role' : ''}`;
        button.textContent = label;
        if (role) button.setAttribute('aria-label', `${label} · ${role.label}`);
        const marker = new Marker({ element: button, anchor: 'left', offset: [-5, 0] });
        button.addEventListener('click', event => {
          event.stopPropagation();
          void openPlace(place, year);
        });
        button.addEventListener('dblclick', event => event.stopPropagation());
        return marker;
      });
    }

    for (const { name, position, minZoom } of document.querySelector('#atlas-show-terrain').checked ? mountains : []) {
      if (zoom < minZoom || !reserve(position, name)) continue;
      add(`mountain:${name}`, position, () => {
        const label = document.createElement('span');
        label.className = 'atlas-river-label atlas-mountain-label';
        label.textContent = name;
        label.setAttribute('aria-hidden', 'true');
        return new Marker({ element: label, anchor: 'left' });
      });
    }
    const seen = new Set();
    for (const river of document.querySelector('#atlas-show-rivers').checked ? anchors : []) {
      if (seen.size === 14) break;
      if (zoom < river.labelZoom || seen.has(river.name) || !reserve(river.position, river.name)) continue;
      seen.add(river.name);
      add(`river:${river.name}:${river.position.join(',')}`, river.position, () => {
        const label = document.createElement('span');
        label.className = 'atlas-river-label';
        label.textContent = river.name;
        label.setAttribute('aria-hidden', 'true');
        return new Marker({ element: label, anchor: 'left' });
      });
    }

    for (const [key, marker] of markers) {
      if (!next.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    }
  }

  map.on('moveend', () => { render(); void refreshPlaces(); });
  placesToggle.addEventListener('change', () => {
    if (!placesToggle.checked) {
      closePlace();
      historical = [];
      placeStatus.hidden = true;
    }
    render();
    void refreshPlaces();
  });
  for (const id of ['atlas-show-rivers', 'atlas-show-terrain']) {
    document.getElementById(id).addEventListener('change', render);
  }
  function updateYear(selectedYear) {
    if (year === selectedYear) return;
    closePlace();
    year = selectedYear;
    historical = [];
    placeStatus.hidden = true;
    render();
    void refreshPlaces();
  }
  updateYear.updatePhysical = (riverData, mountainData) => {
    if (rivers !== riverData) {
      rivers = riverData;
      anchors = riverAnchors(riverData);
    }
    mountains = mountainData;
    render();
  };
  updateYear.locate = (place, selectedYear) => {
    map.stop();
    map.jumpTo({ center: place.coordinates });
    void openPlace(place, selectedYear);
  };
  updateYear.close = closePlace;
  return updateYear;
}

export function geographyScale(zoom) {
  return zoom >= 4.5 ? 10 : zoom >= 2.5 ? 50 : 110;
}

export function addGeographicDetail(map, readData, initial, labels, {
  terrainVisible = () => true,
  onStatus = message => { if (message) console.warn(message); },
} = {}) {
  const cache = new Map([[110, Promise.resolve(initial)]]);
  let applied = 110;
  let request = 0;
  let mountainRequest;
  let appliedMountains;

  async function update() {
    const scale = geographyScale(map.getZoom());
    const current = ++request;
    if (!cache.has(scale)) {
      cache.set(scale, readData(`geography-${scale}.json`).catch(error => {
        cache.delete(scale);
        throw error;
      }));
    }
    if (scale !== 110 && !mountainRequest) {
      mountainRequest = readData('mountains.json').catch(() => {
        mountainRequest = undefined;
        return null;
      });
    }
    try {
      const [layers, mountains] = await Promise.all([cache.get(scale), mountainRequest]);
      if (current !== request) return;
      onStatus(mountains === null && scale !== 110 ? '山脉参照缺失' : '');
      if (scale === applied && mountains === appliedMountains) return;
      if (scale !== applied) {
        for (const name of ['land', 'lakes', 'rivers']) map.getSource(name).setData(layers[name]);
        applied = scale;
      }
      if (mountains && !map.getSource('mountains')) {
        map.addSource('mountains', { type: 'geojson', data: mountains.areas });
        map.addLayer({ id: 'mountains', type: 'fill', source: 'mountains', minzoom: 3,
          layout: { visibility: terrainVisible() ? 'visible' : 'none' },
          paint: { 'fill-color': '#8a785b', 'fill-opacity': 0.20 } }, 'major-rivers');
      }
      appliedMountains = mountains;
      labels.updatePhysical(layers.rivers, mountains?.labels ?? []);
    } catch {
      if (current === request) onStatus('详细自然地理资料缺失，保留可用参照');
    }
  }
  map.on('load', update);
  map.on('zoomend', update);
  return update;
}
