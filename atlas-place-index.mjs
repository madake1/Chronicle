import { readFile } from 'node:fs/promises';
import { createPlaceSearch, placeAt } from './public/atlas/places.mjs';
import { sourceYearToAxis } from './public/atlas/years.mjs';

const directory = new URL('./atlas-data/', import.meta.url);
const placesFile = new URL('place-query-index.json', directory);
const baseFile = new URL('places.json', directory);
const originalFile = new URL('./public/atlas/northern-song-places.json', import.meta.url);

async function readIndex(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (file === placesFile) return readIndex(baseFile);
    if (file === baseFile) return readIndex(originalFile);
    throw error;
  }
}

const axisBounds = [-3399, 2024];
const wrap = longitude => ((longitude + 180) % 360 + 360) % 360 - 180;
const cell = (lon, lat) => `${Math.floor(wrap(lon) / 10)},${Math.floor(lat / 10)}`;
const validYear = year => Number.isInteger(year) && year >= axisBounds[0] && year <= axisBounds[1];
const summary = ({ id, name, originalName, type, coordinates, minZoom }) =>
  ({ id, name, originalName, type, coordinates, minZoom });

export function createPlaceIndex(index) {
  const all = [...index.places, ...index.referencePlaces ?? []];
  const byId = new Map(all.map(place => [place.id, place]));
  const search = createPlaceSearch(all);
  const grid = new Map();
  for (const place of index.places) {
    const key = cell(...place.coordinates);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(place);
  }

  function viewport({ year, west, south, east, north, zoom }) {
    const start = wrap(west);
    const span = east - west;
    const width = Math.min(360, span);
    const stop = start + width;
    const height = Math.max(north - south, 0.01);
    const bounds = new Set();
    for (let x = Math.floor(start / 10); x <= Math.floor(stop / 10); x++) {
      for (let y = Math.floor(south / 10); y <= Math.floor(north / 10); y++) {
        bounds.add(cell(x * 10, y * 10));
      }
    }
    const target = zoom < 3 ? 6 : zoom < 4.5 ? 60 : 180;
    const bands = zoom < 3 ? 3 : 6;
    const binLimit = Math.max(1, Math.ceil(target / (bands * bands)));
    const found = [];
    for (const key of bounds) {
      for (const place of grid.get(key) ?? []) {
        if (zoom < place.minZoom) continue;
        const [lon, lat] = place.coordinates;
        const offset = (wrap(lon) - start + 360) % 360;
        if (offset > width || lat < south || lat > north) continue;
        const item = placeAt(place, year);
        if (!item.coverage) continue;
        const bucket = `${Math.min(bands - 1, Math.floor(offset / Math.max(width, 0.01) * bands))},${Math.min(bands - 1, Math.floor((lat - south) / height * bands))}`;
        found.push({ item, bucket });
      }
    }
    found.sort((a, b) => a.item.place.minZoom - b.item.place.minZoom ||
      Number(Boolean(b.item.role)) - Number(Boolean(a.item.role)) ||
      a.item.place.id.localeCompare(b.item.place.id));
    const counts = new Map();
    const result = [];
    for (const { item, bucket } of found) {
      const used = counts.get(bucket) ?? 0;
      if (used >= binLimit) continue;
      counts.set(bucket, used + 1);
      const { place, coverage, name, role } = item;
      result.push({ place: summary(place), coverage: { fromYear: coverage.fromYear, toYear: coverage.toYear },
        name: name && { name: name.name }, role: role && { label: role.label } });
      if (result.length >= target) break;
    }
    return result;
  }

  return {
    viewport,
    search(query, year) {
      const found = search(query, year);
      return { total: found.length, items: found.slice(0, 10).map(({ place, coverage, name, dates }) => ({
        place: summary(place), coverage, name: name && { name: name.name },
        dates: dates.map(period => {
          const low = Math.max(axisBounds[0], sourceYearToAxis(period.fromYear));
          const high = Math.min(axisBounds[1], sourceYearToAxis(period.toYear));
          if (low > high) return { ...period, available: false };
          const targetYear = Math.min(high, Math.max(low, year));
          return { ...period, targetYear, label: placeAt(place, targetYear).name?.name };
        }),
      })) };
    },
    detail(id) {
      const place = byId.get(id);
      if (!place) return null;
      const sourceIds = new Set([...place.sourceIds, ...[
        ...place.names, ...place.roles, ...(place.coverage ?? []), ...(place.existence ?? []), ...(place.attestations ?? []),
      ].map(period => period.sourceId).filter(Boolean)]);
      return { place, sources: Object.fromEntries([...sourceIds].map(key => [key, index.sources[key]])) };
    },
    meta: { datasets: index.datasets ?? [] },
  };
}

let loading;
function getIndex() {
  loading ??= readIndex(placesFile).then(createPlaceIndex).catch(error => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export async function handlePlaceQuery(url) {
  const params = url.searchParams;
  const kind = url.pathname.split('/').at(-1);
  if (kind === 'meta') return [200, (await getIndex()).meta];
  if (kind === 'detail') {
    const id = params.get('id') ?? '';
    if (!id || id.length > 512) return [400, { error: '无效的地点 ID' }];
    const detail = (await getIndex()).detail(id);
    return detail ? [200, detail] : [404, { error: '地点不存在' }];
  }
  const year = Number(params.get('year'));
  if (!params.has('year') || !params.get('year').trim() || !validYear(year)) {
    return [400, { error: '年份超出地图范围' }];
  }
  if (kind === 'search') {
    const query = (params.get('q') ?? '').trim();
    if (!query || query.length > 120) return [400, { error: '请输入有效的地名' }];
    return [200, (await getIndex()).search(query, year)];
  }
  const keys = ['west', 'south', 'east', 'north', 'zoom'];
  const values = Object.fromEntries(keys.map(key => [key, Number(params.get(key))]));
  const { west, south, east, north, zoom } = values;
  if (keys.some(key => !params.get(key)?.trim() || !Number.isFinite(values[key])) ||
      east <= west || Math.abs(west) > 1080 || Math.abs(east) > 1080 ||
      south < -90 || north > 90 || north <= south || zoom < -2 || zoom > 24) {
    return [400, { error: '无效的地图视野' }];
  }
  return [200, (await getIndex()).viewport({ year, ...values })];
}
