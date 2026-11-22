import { changeIndex, sourceYearToAxis } from './years.mjs';

function searchKey(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const polityNameOverrides = new Map([['cn_northern_song_dyn', '北宋'], ['cn_southern_song_dyn', '南宋']]);

export function createPolitySearch({ history, encyclopedia }) {
  const entries = Object.values(history.groups).map(records => {
    const first = records[0];
    const names = new Set(records.map(record => record.name));
    const chineseNames = records.map(record => encyclopedia.entities[encyclopedia.byRecord[record.sourceIndex]]?.zh)
      .filter(Boolean);
    const specificName = polityNameOverrides.get(first.seshatId);
    if (specificName) chineseNames.unshift(specificName);
    for (const name of chineseNames) names.add(name);
    return {
      name: chineseNames[0] ?? first.name, original: first.name, first,
      aliases: [...names].map(searchKey),
    };
  });
  return query => {
    const key = searchKey(query);
    if (!key) return [];
    return entries.flatMap(entry => {
      const rank = Math.min(...entry.aliases.map(alias =>
        alias === key ? 0 : alias.startsWith(key) ? 1 : alias.includes(key) ? 2 : Infinity));
      return Number.isFinite(rank) ? [{ entry, rank }] : [];
    }).sort((a, b) => a.rank - b.rank || a.entry.first.fromYear - b.entry.first.fromYear ||
      a.entry.name.localeCompare(b.entry.name, 'zh-CN')).map(({ entry }) => entry);
  };
}

export function createAtlasData(index, readData) {
  const records = Object.values(index.history.groups).flat().sort((a, b) => a.sourceIndex - b.sourceIndex);
  const intervals = records.map(record =>
    [sourceYearToAxis(record.fromYear), sourceYearToAxis(record.toYear), record]);
  const frames = new Map();
  const shards = new Map();

  function frame(year) {
    const step = changeIndex(index.changes, year);
    let result = frames.get(step);
    if (result) {
      frames.delete(step);
      frames.set(step, result);
      return result;
    }
    const byVisual = new Map();
    const byRecord = new Map();
    const boundary = index.changes[step];
    for (const [start, end, record] of intervals) {
      if (start > boundary || end < boundary) continue;
      const [shard, geometry] = index.geometryByRecord[record.sourceIndex];
      const visual = `${geometry}:${record.name}`;
      const item = { record, shard, geometry, visual };
      if (!byVisual.has(visual)) byVisual.set(visual, item);
      byRecord.set(record.sourceIndex, item);
    }
    result = { step, byVisual, byRecord, key: JSON.stringify([...byVisual.keys()].sort()) };
    frames.set(step, result);
    if (frames.size > 12) frames.delete(frames.keys().next().value);
    return result;
  }

  function loadShard(id) {
    const existing = shards.get(id);
    if (existing) {
      shards.delete(id);
      shards.set(id, existing);
      return existing;
    }
    const request = readData(`geometry-${id}.json`);
    shards.set(id, request);
    request.catch(() => { if (shards.get(id) === request) shards.delete(id); });
    if (shards.size > 48) shards.delete(shards.keys().next().value);
    return request;
  }

  async function geometries(target) {
    const ids = new Set([...target.byVisual.values()].map(item => item.shard));
    return new Map(await Promise.all([...ids].map(async id => [id, await loadShard(id)])));
  }

  async function features(target) {
    const loaded = await geometries(target);
    return {
      type: 'FeatureCollection',
      features: [...target.byVisual.values()].map(item => ({
        type: 'Feature',
        properties: { visual: item.visual, name: item.record.name },
        geometry: loaded.get(item.shard)[item.geometry],
      })),
    };
  }

  function prefetch(target) {
    for (const step of [target.step - 1, target.step + 1]) {
      const year = index.changes[step];
      if (year >= index.bounds[0] && year <= index.bounds[1]) void geometries(frame(year)).catch(() => {});
    }
  }

  return { frame, features, prefetch };
}
