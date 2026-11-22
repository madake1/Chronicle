import { formatYear } from '../chronology.mjs';
import { sourceYearToAxis } from './years.mjs';

function includesYear(period, year) {
  return sourceYearToAxis(period.fromYear) <= year && year <= sourceYearToAxis(period.toYear);
}

export function placesAt(places, year, zoom) {
  return places.filter(place => zoom >= place.minZoom && includesYear(place, year))
    .map(place => ({ place, role: place.roles.find(role => includesYear(role, year)) }));
}

function periodLabel(period) {
  const from = formatYear(sourceYearToAxis(period.fromYear));
  const to = formatYear(sourceYearToAxis(period.toYear));
  return from === to ? from : `${from} 至 ${to}`;
}

function placePopup(place, role, sources) {
  const content = document.createElement('div');
  content.className = 'atlas-place-popup';
  const title = document.createElement('h2');
  title.textContent = place.name;
  const period = document.createElement('p');
  period.textContent = `${place.type} · 本图收录 ${periodLabel(place)}`;
  content.append(title, period);
  if (role) {
    const identity = document.createElement('p');
    identity.textContent = `${role.label} · ${periodLabel(role)}`;
    content.append(identity);
  }
  const position = document.createElement('p');
  position.textContent = '点位为历史城市所在区域的近似位置。';
  content.append(position);
  const references = document.createElement('ul');
  for (const id of new Set([...place.sourceIds, ...(role ? [role.sourceId] : [])])) {
    const entry = document.createElement('li');
    const link = document.createElement('a');
    link.href = sources[id].url;
    link.textContent = sources[id].title;
    entry.append(link);
    references.append(entry);
  }
  content.append(references);
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
  const anchors = riverAnchors(rivers);
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

    for (const { place, role } of placesAt(atlasPlaces.places, year, zoom)) {
      if (!reserve(place.coordinates, place.name)) continue;
      add(`place:${place.id}:${role?.label ?? ''}`, place.coordinates, () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `atlas-place-label${role ? ' has-role' : ''}`;
        button.textContent = place.name;
        if (role) button.setAttribute('aria-label', `${place.name} · ${role.label}`);
        const popup = new Popup({ offset: 14, maxWidth: '260px' })
          .setDOMContent(placePopup(place, role, atlasPlaces.sources));
        const marker = new Marker({ element: button, anchor: 'left', offset: [-5, 0] }).setPopup(popup);
        button.addEventListener('click', event => {
          event.stopPropagation();
          marker.togglePopup();
        });
        return marker;
      });
    }

    const seen = new Set();
    for (const river of anchors) {
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
  return selectedYear => {
    if (year === selectedYear) return;
    year = selectedYear;
    render();
  };
}
