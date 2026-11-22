import { formatYear } from '../chronology.mjs';
import { sourceYearToAxis } from './years.mjs';

function includesYear(period, year) {
  return sourceYearToAxis(period.fromYear) <= year && year <= sourceYearToAxis(period.toYear);
}

export function placesAt(places, year, zoom) {
  return places.filter(place => zoom >= place.minZoom && place.attested && includesYear(place.attested, year))
    .map(place => ({
      place,
      name: place.names.find(name => includesYear(name, year)),
      role: place.roles.find(role => includesYear(role, year)),
    }));
}

function periodLabel(period) {
  const from = formatYear(sourceYearToAxis(period.fromYear));
  const to = formatYear(sourceYearToAxis(period.toYear));
  return from === to ? from : `${from} 至 ${to}`;
}

function placePopup(place, name, role, sources) {
  const content = document.createElement('div');
  content.className = 'atlas-place-popup';
  const title = document.createElement('h2');
  title.textContent = name?.name ?? place.name;
  const period = document.createElement('p');
  period.textContent = place.attested
    ? `${place.type} · 有资料支持的收录时段 ${periodLabel(place.attested)}`
    : `${place.type} · 参考地点，年代待考`;
  content.append(title, period);
  if (name) {
    const historicalName = document.createElement('p');
    historicalName.textContent = `${name.original} · 地名资料年代 ${periodLabel(name)}`;
    content.append(historicalName);
  }
  if (role) {
    const identity = document.createElement('p');
    identity.textContent = `${role.label} · ${periodLabel(role)}`;
    content.append(identity);
  }
  const position = document.createElement('p');
  position.textContent = '点位为历史城市所在区域的近似位置。';
  content.append(position);
  const references = document.createElement('ul');
  for (const id of new Set([...place.sourceIds, ...[name?.sourceId, role?.sourceId].filter(Boolean)])) {
    const entry = document.createElement('li');
    const link = document.createElement('a');
    link.href = sources[id].url;
    link.textContent = sources[id].title;
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

export function addGeographicLabels(map, rivers, atlasPlaces, Marker, Popup) {
  let anchors = riverAnchors(rivers);
  let mountains = [];
  const markers = new Map();
  const canvas = map.getCanvas();
  let year;

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

    const historical = document.querySelector('#atlas-show-places').checked
      ? placesAt(atlasPlaces.places, year, zoom) : [];
    const reference = document.querySelector('#atlas-reference-places')?.checked
      ? (atlasPlaces.referencePlaces ?? []).filter(place => zoom >= place.minZoom).map(place => ({ place }))
      : [];
    for (const { place, name, role } of [...historical, ...reference]) {
      const label = name?.name ?? place.name;
      if (!reserve(place.coordinates, label)) continue;
      add(`place:${place.id}:${label}:${role?.label ?? ''}`, place.coordinates, () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `atlas-place-label${role ? ' has-role' : ''}`;
        button.textContent = label;
        if (role) button.setAttribute('aria-label', `${label} · ${role.label}`);
        const popup = new Popup({ offset: 14, maxWidth: '260px' })
          .setDOMContent(placePopup(place, name, role, atlasPlaces.sources));
        const marker = new Marker({ element: button, anchor: 'left', offset: [-5, 0] }).setPopup(popup);
        button.addEventListener('click', event => {
          event.stopPropagation();
          marker.togglePopup();
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

  map.on('moveend', render);
  const referenceToggle = document.querySelector('#atlas-reference-places');
  referenceToggle.closest('label').hidden = !atlasPlaces.referencePlaces?.length;
  referenceToggle.addEventListener('change', render);
  for (const id of ['atlas-show-places', 'atlas-show-rivers', 'atlas-show-terrain']) {
    document.getElementById(id).addEventListener('change', render);
  }
  function updateYear(selectedYear) {
    if (year === selectedYear) return;
    year = selectedYear;
    render();
  }
  updateYear.updatePhysical = (riverData, mountainData) => {
    if (rivers !== riverData) {
      rivers = riverData;
      anchors = riverAnchors(riverData);
    }
    mountains = mountainData;
    render();
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
