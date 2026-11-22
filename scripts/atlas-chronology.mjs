import { createHash } from 'node:crypto';
import { sourceYearToAxis } from '../public/atlas/years.mjs';
import { buildPolityHistory } from './atlas-history.mjs';

const shardLimit = 1024 * 1024;

export async function buildAtlasChronology(features, encyclopedia, save) {
  const indices = features.flatMap((feature, index) => feature.properties.Type === 'POLITY' ? [index] : []);
  const history = buildPolityHistory(features, new Set(indices));
  const geometryByRecord = {};
  const known = new Map();
  const changes = new Set();
  const encyclopediaAliases = new Map();
  const aliasKey = row => JSON.stringify([row.Name, row.Wikidata, row.Wikipedia]);
  for (const [index, key] of Object.entries(encyclopedia.byRecord)) {
    const alias = aliasKey(features[index].properties);
    if (!encyclopediaAliases.has(alias)) encyclopediaAliases.set(alias, key);
    else if (encyclopediaAliases.get(alias) !== key) encyclopediaAliases.set(alias, null);
  }
  const byRecord = { ...encyclopedia.byRecord };
  let shard = {};
  let shardSize = 0;
  let shardNumber = 0;
  async function flush() {
    await save(`geometry-${shardNumber++}.json`, shard);
    shard = {};
    shardSize = 0;
  }

  indices.sort((a, b) => features[a].properties.FromYear - features[b].properties.FromYear || a - b);
  const bounds = [Infinity, -Infinity];
  for (const index of indices) {
    const { geometry, properties: row } = features[index];
    const from = sourceYearToAxis(row.FromYear);
    const to = sourceYearToAxis(row.ToYear);
    bounds[0] = Math.min(bounds[0], from);
    bounds[1] = Math.max(bounds[1], to);
    changes.add(from);
    changes.add(to + 1);
    const serialized = JSON.stringify(geometry);
    const hash = createHash('sha256').update(serialized).digest('hex');
    let ref = known.get(hash);
    if (!ref) {
      if (shardSize && shardSize + serialized.length > shardLimit) await flush();
      const id = known.size;
      ref = [shardNumber, id];
      known.set(hash, ref);
      shard[id] = geometry;
      shardSize += serialized.length;
    }
    geometryByRecord[index] = ref;
    const encyclopediaKey = encyclopediaAliases.get(aliasKey(row));
    if (encyclopediaKey && !byRecord[index]) byRecord[index] = encyclopediaKey;
  }
  if (shardSize) await flush();
  await save('chronology.json', {
    bounds, changes: [...changes].sort((a, b) => a - b), geometryByRecord, history,
    encyclopedia: { byRecord, entities: encyclopedia.entities },
  });
  return { polityRecords: indices.length, geometries: known.size, shards: shardNumber };
}
