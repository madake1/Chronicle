import { readFile, mkdir, readdir } from 'node:fs/promises';
import { atomicWrite } from '../atomic-write.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const output = new URL('../atlas-data/', import.meta.url);
const validPeriod = ({ fromYear, toYear }) =>
  [fromYear, toYear].every(year => Number.isInteger(year) && year !== 0) && fromYear <= toYear;

export function mergePlaces(packs) {
  const index = { version: '3.8.0', datasets: [], sources: {}, places: [], referencePlaces: [] };
  const ids = new Set();
  for (const pack of packs) {
    for (const [id, source] of Object.entries(pack.sources)) {
      if (Object.hasOwn(index.sources, id) || new URL(source.url).protocol !== 'https:') {
        throw new Error(`Invalid or duplicate place source: ${id}`);
      }
      index.sources[id] = source;
    }
    if (pack.dataset) index.datasets.push(pack.dataset);
  }
  for (const pack of packs) {
    for (const place of [...pack.places, ...(pack.referencePlaces ?? [])]) {
      const coverage = place.coverage ?? (place.attested ? [place.attested] : []);
      const [lon, lat] = place.coordinates ?? [];
      const dated = [...coverage, ...(place.existence ?? []), ...(place.attestations ?? []),
        ...place.names.filter(name => name.fromYear !== undefined || name.toYear !== undefined), ...place.roles];
      const sources = [...place.sourceIds, ...[...dated, ...place.names].map(item => item.sourceId).filter(Boolean)];
      if (!place.id || ids.has(place.id) || !place.name || !place.type ||
          !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
          !Number.isFinite(place.minZoom) || dated.some(period => !validPeriod(period)) ||
          !sources.length || sources.some(id => !Object.hasOwn(index.sources, id))) {
        throw new Error(`Invalid or duplicate place: ${place.id}`);
      }
      ids.add(place.id);
      (coverage.length ? index.places : index.referencePlaces).push({ ...place, coverage });
    }
  }
  return index;
}

const matchedPleiades = new Map([
  ['579885', 'pleiades-579885'], ['423025', 'pleiades-423025'], ['570182', 'pleiades-570182'],
  ['462503', 'pleiades-462503'], ['520998', 'constantinople-istanbul'],
]);

export function prepareQueryIndex(packs, imported) {
  packs = packs.map(pack => ({ ...pack, places: pack.places.map(place => ({ ...place,
    sourceIds: [...place.sourceIds], names: [...place.names],
  })) }));
  const curated = new Map(packs.flatMap(pack => pack.places).map(place => [place.id, place]));
  const stats = [];
  const adjusted = imported.map(pack => {
    const places = [];
    let linked = 0;
    for (const place of pack.places) {
      const verified = pack.dataset.id === 'pleiades-full' && curated.get(matchedPleiades.get(place.originalId));
      if (!verified) {
        places.push(place);
        continue;
      }
      linked++;
      verified.sourceIds.push(...place.sourceIds);
      verified.externalIds = [...new Set([...(verified.externalIds ?? []), ...place.externalIds])];
      verified.names.push(...place.names);
      verified.attestations = [...(verified.attestations ?? []), ...place.attestations];
    }
    const dated = places.filter(place => place.coverage.length).length;
    stats.push({ source: pack.dataset.id, accepted: pack.places.length, primary: places.length,
      dated, searchOnly: places.length - dated, linked, rejected: pack.rejected });
    return { ...pack, places };
  });
  return { ...mergePlaces([...packs, ...adjusted]), stats };
}

export async function preparePlaces() {
  const packs = await Promise.all([
    read('../public/atlas/northern-song-places.json'),
    read('../atlas-places/curated.json'),
    read('../atlas-places/pleiades.json'),
  ]);
  const directory = new URL('place-packs/', output);
  const names = await readdir(directory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return [];
  });
  const imported = await Promise.all(names.filter(name => /^[a-z][a-z0-9-]+\.json$/.test(name)).sort()
    .map(async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'))));
  const curated = mergePlaces(packs);
  const index = prepareQueryIndex(packs, imported);
  await mkdir(output, { recursive: true });
  await atomicWrite(new URL('places.json', output), JSON.stringify(curated));
  await atomicWrite(new URL('place-query-index.json', output), JSON.stringify(index));
  console.log(`Historical places: ${index.places.length} dated, ${index.referencePlaces.length} search-only`);
  for (const stats of index.stats) console.log(JSON.stringify(stats));
}
