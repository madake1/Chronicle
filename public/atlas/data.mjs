import { changeIndex, sourceYearToAxis } from './years.mjs';

export function searchKey(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function recordAtYear(records, year) {
  return records.find(record => sourceYearToAxis(record.fromYear) <= year &&
    year <= sourceYearToAxis(record.toYear));
}

export function createPolitySearch({ history, names }) {
  const entries = Object.entries(history.groups).map(([key, records]) => ({
    ...names[key], original: records[0].name, records,
  }));
  return (query, year) => {
    const key = searchKey(query);
    if (!key) return [];
    return entries.flatMap(entry => {
      const rank = Math.min(...entry.aliases.map(alias =>
        alias === key ? 0 : alias.startsWith(key) ? 1 : alias.includes(key) ? 2 : Infinity));
      if (!Number.isFinite(rank)) return [];
      return [{ ...entry, rank, current: recordAtYear(entry.records, year) }];
    }).sort((a, b) => a.rank - b.rank || Number(Boolean(b.current)) - Number(Boolean(a.current)) ||
      Number(a.composite) - Number(b.composite) || a.records[0].fromYear - b.records[0].fromYear ||
      a.name.localeCompare(b.name, 'zh-CN'));
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
        properties: { visual: item.visual, name: item.record.name,
          label: index.names?.[index.history.byRecord?.[item.record.sourceIndex]]?.name ?? item.record.name },
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
