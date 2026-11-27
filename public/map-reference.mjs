import { labelSpace, riverAnchors } from './atlas/geography.mjs';
import { readViewportPlaces } from './atlas/place-api.mjs';

function polygonParts(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// A scan line through all rings yields valid intervals, including around holes.
export function polityAnchor(geometry, bounds) {
  let best;
  for (const rings of polygonParts(geometry)) {
    if (!rings[0]?.length) continue;
    if (rings.some(ring => ring.some(([x], index) => index && Math.abs(x - ring[index - 1][0]) > 180))) continue;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [x, y] of rings[0]) {
      west = Math.min(west, x); east = Math.max(east, x);
      south = Math.min(south, y); north = Math.max(north, y);
    }
    const bottom = Math.max(south, bounds.getSouth());
    const top = Math.min(north, bounds.getNorth());
    const left = Math.max(west, bounds.getWest());
    const right = Math.min(east, bounds.getEast());
    if (bottom >= top || left >= right) continue;
    for (const fraction of [.5, .3, .7, .15, .85]) {
      const y = bottom + (top - bottom) * fraction;
      const crossings = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [a, b] = ring[i];
          const [c, d] = ring[j];
          if ((b > y) !== (d > y)) crossings.push(a + (c - a) * (y - b) / (d - b));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const start = Math.max(left, crossings[index]);
        const end = Math.min(right, crossings[index + 1]);
        const score = (end - start) * Math.min(y - bottom, top - y);
        if (score > (best?.score ?? 0)) best = { position: [(start + end) / 2, y], score };
      }
    }
  }
  return best;
}

export function createReferenceLabels(map, Marker, { readPlaces = readViewportPlaces, onStatus = () => {} } = {}) {
  const displayed = new Map();
  let physical = { rivers: [], mountains: [] };
  let year, frame = [], places = [], personal = [];
  let revision = 0;

  function render() {
    const reserve = labelSpace(map, personal);
    const zoom = map.getZoom();
    const width = map.getCanvas().clientWidth;
    const next = new Set();
    function add(key, name, position, kind, fallback = false) {
      const centered = kind === 'polity';
      if (!reserve(position, name, centered)) return false;
      next.add(key);
      if (displayed.has(key)) {
        displayed.get(key).setLngLat(position);
        return true;
      }
      const label = document.createElement('span');
      label.className = 'reference-label ' + (centered ? 'reference-polity' :
        kind === 'place' ? 'atlas-place-label' : 'atlas-river-label');
      label.dataset.referenceKind = kind;
      if (fallback) label.dataset.catalogName = '';
      label.textContent = name;
      const marker = new Marker({ element: label, anchor: centered ? 'center' : 'left' });
      marker.setLngLat(position).addTo(map);
      displayed.set(key, marker);
      return true;
    }

    const bounds = map.getBounds();
    const candidates = frame.flatMap(({ geometry, properties }) => {
      const anchor = polityAnchor(geometry, bounds);
      return anchor ? [{ ...anchor, name: properties.label ?? properties.name, id: properties.visual }] : [];
    }).sort((a, b) => b.score - a.score);
    const shown = new Set();
    const polityLimit = Math.max(2, Math.min(zoom < 3 ? 5 : 9, Math.floor(width / 84)));
    for (const item of candidates) {
      if (shown.size >= polityLimit) break;
      if (!shown.has(item.name) && add('polity:' + item.id, item.name, item.position, 'polity')) shown.add(item.name);
    }

    let cities = 0;
    const cityLimit = Math.max(2, Math.min(zoom < 3 ? 5 : 14, Math.floor(width / 42)));
    const cityNames = new Set();
    for (const { place, name, coverage } of places) {
      if (cities >= cityLimit) break;
      if (!coverage) continue;
      const label = name?.name ?? place.name;
      if (!cityNames.has(label) && add('place:' + place.id, label, place.coordinates, 'place', !name)) {
        cityNames.add(label);
        cities++;
      }
    }

    const natural = new Set();
    for (const item of [...physical.mountains, ...physical.rivers]) {
      if (natural.size >= (width < 480 ? 3 : 6)) break;
      if (zoom < (item.labelZoom ?? item.minZoom ?? 0) || natural.has(item.name)) continue;
      if (add('natural:' + item.name, item.name, item.position, 'natural')) natural.add(item.name);
    }
    for (const [key, marker] of displayed) {
      if (!next.has(key)) { marker.remove(); displayed.delete(key); }
    }
  }

  async function refresh() {
    const request = ++revision;
    if (year === undefined) return;
    try {
      const result = await readPlaces(map, year);
      if (request !== revision) return;
      places = result;
      onStatus('');
      render();
    } catch {
      if (request !== revision) return;
      places = [];
      onStatus('历史地名资料缺失');
      render();
    }
  }

  return {
    setHistory(value, features = []) {
      year = value;
      frame = features;
      places = [];
      onStatus('');
      render();
      return refresh();
    },
    updatePhysical(rivers, mountains = []) {
      physical = { rivers: riverAnchors(rivers), mountains };
      render();
    },
    setPersonalPositions(positions) {
      personal = positions;
      render();
    },
    refresh,
  };
}
