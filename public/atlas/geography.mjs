import { placeAt, placePeriod, placesAt } from './places.mjs';
import { readPlaceApi, readViewportPlaces } from './place-api.mjs';

export { placesAt };

function placePopup({ place, name, role, coverage }, sources) {
  const content = document.createElement('div');
  content.className = 'atlas-place-popup';
  const title = document.createElement('h2');
  title.textContent = name?.name ?? place.name;
  const period = document.createElement('p');
  period.textContent = coverage
    ? `${place.type} · 有资料支持的收录时段 ${placePeriod(coverage)}`
    : `${place.type} · 参考地点，年代待考`;
  content.append(title, period);
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
  if (place.names.length > 1) {
    const names = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = '其他历史名称';
    names.append(heading);
    for (const entry of place.names.filter(entry => entry !== name)) {
      const line = document.createElement('p');
      line.textContent = `${[entry.name, entry.original === entry.name ? null : entry.original,
        entry.fromYear === undefined ? '名称年代待考' : placePeriod(entry)].filter(Boolean).join(' · ')}`;
      names.append(line);
    }
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
  const position = document.createElement('p');
  position.textContent = place.confidence ?? '点位为历史城市所在区域的近似位置。';
  content.append(position);
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

function riverAnchors(rivers) {
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

export function addGeographicLabels(map, rivers, Marker, Popup) {
  let anchors = riverAnchors(rivers);
  let mountains = [];
  const markers = new Map();
  const canvas = map.getCanvas();
  let year;
  let searchPopup;
  let detailRequest = 0;
  let viewportRequest = 0;
  let historical = [];
  const placesToggle = document.querySelector('#atlas-show-places');
  const placeStatus = document.querySelector('#atlas-place-layer-status');

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
    const request = ++detailRequest;
    searchPopup?.remove();
    try {
      const detail = await readPlaceApi('detail', { id: place.id });
      if (request !== detailRequest) return;
      searchPopup = new Popup({ offset: 14, maxWidth: '280px' }).setLngLat(place.coordinates)
        .setDOMContent(placePopup(placeAt(detail.place, selectedYear), detail.sources)).addTo(map);
    } catch {
      if (request === detailRequest) placeStatus.hidden = false;
    }
  }


  function render() {
    const zoom = map.getZoom();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const bounds = map.getBounds();
    const used = [];
    const next = new Set();

    function reserve(position, label) {
      if (!bounds.contains(position)) return false;
      const { x, y } = map.project(position);
      const left = x - 8;
      const right = x + Math.max(26, label.length * 10 + 8);
      if (left < 0 || right > width || y < 14 || y > height - 14 ||
          used.some(box => left < box.right && right > box.left && Math.abs(y - box.y) < 22)) return false;
      used.push({ left, right, y });
      return true;
    }

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
      ++detailRequest;
      searchPopup?.remove();
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
    ++detailRequest;
    searchPopup?.remove();
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
    map.jumpTo({ center: place.coordinates, zoom: Math.max(Math.min(map.getZoom(), 6), place.minZoom, 4.7) });
    void openPlace(place, selectedYear);
  };
  return updateYear;
}

export function geographyScale(zoom) {
  return zoom >= 4.5 ? 10 : zoom >= 2.5 ? 50 : 110;
}

export function addGeographicDetail(map, readData, initial, labels) {
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
      mountainRequest = readData('mountains.json').catch(error => {
        mountainRequest = undefined;
        console.warn('山脉参考图层加载失败', error);
        return null;
      });
    }
    try {
      const [layers, mountains] = await Promise.all([cache.get(scale), mountainRequest]);
      if (current !== request) return;
      if (scale === applied && mountains === appliedMountains) return;
      if (scale !== applied) {
        for (const name of ['land', 'lakes', 'rivers']) map.getSource(name).setData(layers[name]);
        applied = scale;
      }
      if (mountains && !map.getSource('mountains')) {
        map.addSource('mountains', { type: 'geojson', data: mountains.areas });
        map.addLayer({ id: 'mountains', type: 'fill', source: 'mountains', minzoom: 3,
          layout: { visibility: document.querySelector('#atlas-show-terrain').checked ? 'visible' : 'none' },
          paint: { 'fill-color': '#8a785b', 'fill-opacity': 0.20 } }, 'major-rivers');
      }
      appliedMountains = mountains;
      labels.updatePhysical(layers.rivers, mountains?.labels ?? []);
    } catch (error) {
      console.warn('自然地理参考图层加载失败', error);
    }
  }
  map.on('load', update);
  map.on('zoomend', update);
}
