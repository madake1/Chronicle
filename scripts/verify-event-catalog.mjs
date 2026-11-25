import { mkdir, readFile, readdir } from 'node:fs/promises';
import { atomicWrite } from '../atomic-write.mjs';
import { eventRegions, validateEventDataset } from '../public/atlas/event-data.mjs';

const root = new URL('../atlas-data/events-catalog/', import.meta.url);
const reports = new Map();
const seen = new Map();
const qids = new Map();
const mapped = new Set();
const categories = new Map();
const regions = new Map();
const byStartCentury = new Map();
const linkedPlaces = new Map();
let earliest = Infinity;
let latest = -Infinity;
const bump = (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1);
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const holdbacks = await read(new URL('wikidata/holdbacks.json', root)).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return {};
});

function check(dataset, catalogue) {
  const report = reports.get(catalogue) ?? { unique: 0, mapped: 0, supplements: 0, mappedSupplements: 0 };
  reports.set(catalogue, report);
  for (const event of validateEventDataset(dataset)) {
    if (Object.hasOwn(holdbacks, event.id)) continue;
    if (event.supplement) {
      const original = seen.get(event.id);
      if (original?.catalogue !== 'eventkg') throw new Error(`Wikidata 补充缺少 EventKG 原记录：${event.id}`);
      if (original.supplement) continue;
      original.supplement = true;
      ++report.supplements;
      if (event.location && !mapped.has(event.id)) {
        mapped.add(event.id);
        ++report.mappedSupplements;
      }
      if (event.placeId) linkedPlaces.set(event.id, event.placeId);
      if (event.region) {
        regions.set('未标地区', regions.get('未标地区') - 1);
        for (const region of eventRegions(event)) bump(regions, region);
      }
      continue;
    }
    const previous = seen.get(event.id);
    if (previous) {
      if (previous.catalogue !== catalogue) throw new Error(`来源之间重复事件 ID：${event.id}`);
      continue;
    }
    seen.set(event.id, { catalogue });
    const qid = event.provenance?.dataset === 'Wikidata' ? event.provenance.id :
      catalogue === 'eventkg' ? /^eventkg-(q[0-9]+)$/.exec(event.id)?.[1]?.toUpperCase() : undefined;
    if (qid) {
      if (qids.has(qid)) throw new Error(`重复的 Wikidata 编号：${qid}`);
      qids.set(qid, event.id);
    }
    ++report.unique;
    earliest = Math.min(earliest, event.startYear);
    latest = Math.max(latest, event.endYear);
    bump(byStartCentury, Math.floor(event.startYear / 100) * 100);
    if (event.placeId) linkedPlaces.set(event.id, event.placeId);
    bump(categories, event.category);
    for (const region of eventRegions(event)) bump(regions, region);
    if (event.location) {
      mapped.add(event.id);
      ++report.mapped;
    }
  }
}

const featured = new URL('../public/atlas/', import.meta.url);
const names = ['events.json', 'events-noaa.json', 'events-wikidata.json', 'events-milestones.json', 'events-regional.json'];
for (const file of names) check(await read(new URL(file, featured)), 'featured');
for (const [qid, id] of Object.entries(await read(new URL('../atlas-events/eventkg-crosswalk.json', import.meta.url)))) {
  if (!seen.has(id) || (qids.has(qid) && qids.get(qid) !== id)) throw new Error(`无效精选交叉索引：${qid}`);
  qids.set(qid, id);
}
for (const catalogue of ['noaa', 'eventkg', 'wikidata', 'eventkg-text']) {
  try {
    if (catalogue === 'noaa') {
      check(await read(new URL('noaa.json', root)), catalogue);
      continue;
    }
    const directory = new URL(catalogue + '/', root);
    for (const file of (await readdir(directory)).filter(name => /^-?\d+\.json$/.test(name))) {
      check(await read(new URL(file, directory)), catalogue);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const gazetteer = await read(new URL('../atlas-data/place-query-index.json', import.meta.url)).catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
if (gazetteer) {
  const places = new Set([...gazetteer.places, ...(gazetteer.referencePlaces ?? [])].map(place => place.id));
  for (const [event, place] of linkedPlaces) {
    if (!places.has(place)) throw new Error(`事件 ${event} 的地点索引缺少 ${place}`);
  }
}
const report = { unique: seen.size, mapped: mapped.size, sources: Object.fromEntries(reports),
  categories: Object.fromEntries(categories), regions: Object.fromEntries(regions),
  linkedPlaces: linkedPlaces.size, earliest, latest, byStartCentury: Object.fromEntries(byStartCentury),
  eventkgHoldbacks: Object.keys(holdbacks).length };
await mkdir(root, { recursive: true });
await atomicWrite(new URL('verification.json', root), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, regions: regions.size }));
