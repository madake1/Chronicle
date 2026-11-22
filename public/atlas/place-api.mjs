const cache = new Map();

export function readPlaceApi(kind, params = {}) {
  const url = `/api/atlas/places/${kind}?${new URLSearchParams(params)}`;
  if (cache.has(url)) {
    const cached = cache.get(url);
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }
  const pending = fetch(url).then(response => {
    if (!response.ok) throw new Error('地点资料无法读取');
    return response.json();
  }).catch(error => {
    if (cache.get(url) === pending) cache.delete(url);
    throw error;
  });
  cache.set(url, pending);
  if (cache.size > 48) cache.delete(cache.keys().next().value);
  return pending;
}

export function readViewportPlaces(map, year) {
  const bounds = map.getBounds();
  const zoom = Math.floor(map.getZoom() * 20) / 20;
  const step = zoom < 2 ? 5 : zoom < 4.5 ? 1 : 0.25;
  const min = value => Math.floor(value / step) * step;
  const max = value => Math.ceil(value / step) * step;
  return readPlaceApi('viewport', {
    year, zoom, west: min(bounds.getWest()), east: max(bounds.getEast()),
    south: Math.max(-90, min(bounds.getSouth())), north: Math.min(90, max(bounds.getNorth())),
  });
}
