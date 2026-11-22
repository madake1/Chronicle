import { readFile, mkdir } from 'node:fs/promises';
import { atomicWrite } from '../note-storage.mjs';

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
    for (const place of [...pack.places, ...(pack.referencePlaces ?? [])]) {
      const coverage = place.coverage ?? (place.attested ? [place.attested] : []);
      const [lon, lat] = place.coordinates ?? [];
      const dated = [...coverage, ...(place.existence ?? []), ...place.names, ...place.roles];
      const sources = [...place.sourceIds, ...dated.map(item => item.sourceId).filter(Boolean)];
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

export async function preparePlaces() {
  const index = mergePlaces(await Promise.all([
    read('../public/atlas/northern-song-places.json'),
    read('../atlas-places/curated.json'),
    read('../atlas-places/pleiades.json'),
  ]));
  await mkdir(output, { recursive: true });
  await atomicWrite(new URL('places.json', output), JSON.stringify(index));
  console.log(`Historical places: ${index.places.length} dated, ${index.referencePlaces.length} undated`);
}
