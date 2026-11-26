import { readFile, stat } from 'node:fs/promises';
import { sourceYearToAxis } from './public/atlas/years.mjs';

const defaultDirectory = new URL('./atlas-data/events-catalog/', import.meta.url);
const recentPacks = new Map();
const read = async (directory, file) => {
  const url = new URL(file, directory);
  const key = directory.href + (file.endsWith('holdbacks.json') ? file : file.split('/')[0]);
  const load = async () => JSON.parse(await readFile(url, 'utf8'));
  try {
    const { mtimeMs, size } = await stat(url);
    const previous = recentPacks.get(key);
    if (previous?.file === file && previous.mtimeMs === mtimeMs && previous.size === size) {
      return await previous.pending;
    }
    const pending = load();
    recentPacks.set(key, { file, mtimeMs, size, pending });
    return await pending;
  } catch (error) {
    if (recentPacks.get(key)?.file === file) recentPacks.delete(key);
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
};

export async function readCatalogueYear(year, directory = defaultDirectory) {
  const decade = Math.floor(year / 10) * 10;
  const [holdbacks, ...packs] = await Promise.all([
    read(directory, 'wikidata/holdbacks.json'),
    read(directory, 'noaa.json'), read(directory, `eventkg/${decade}.json`),
    read(directory, `wikidata/${decade}.json`),
    read(directory, `eventkg-text/${decade}.json`),
  ]);
  const inYear = event => sourceYearToAxis(event.startYear) <= year && year <= sourceYearToAxis(event.endYear);
  const events = new Map();
  for (const pack of packs) {
    for (const event of pack?.events ?? []) {
      if (!inYear(event) || (holdbacks && Object.hasOwn(holdbacks, event.id))) continue;
      if (!event.supplement) {
        events.set(event.id, event);
        continue;
      }
      const original = events.get(event.id);
      if (original) events.set(event.id, mergeSupplement(original, event));
    }
  }
  return { events: [...events.values()], sources: packs.filter(Boolean).map(pack => pack.version) };
}

function mergeSupplement(original, event) {
  const { name, aliases, placeId, placeName, location, region, regions, sources, provenance } = event;
  return {
    ...original,
    aliases: [...new Set([name, ...(aliases ?? []), ...(original.aliases ?? [])])].filter(alias => alias !== original.name),
    ...(placeName && { placeName }),
    ...(placeId && { placeId }),
    ...(location && { location }),
    ...(region && { region }),
    ...(regions && { regions }),
    provenance: { ...original.provenance, locationBasis: provenance.locationBasis, wikidata: provenance },
    sources: [...new Map([...original.sources, ...sources].map(source => [source.url, source])).values()],
  };
}
