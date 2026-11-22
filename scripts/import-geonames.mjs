import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { atomicWrite } from '../note-storage.mjs';
import { preparePlaces } from './prepare-places.mjs';

const root = new URL('../atlas-data/', import.meta.url);
const archive = new URL('raw/geonames-cities15000.zip', root);
const source = 'https://download.geonames.org/export/dump/';
const id = 'geonames-cities15000';
const bytes = await readFile(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const dataset = {
  id, name: 'GeoNames · 全球现代城市', source, sha256,
  version: `SHA-256 ${sha256.slice(0, 12)}`,
  credits: 'GeoNames', license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  licenseSource: 'https://www.geonames.org/export/',
  changes: '保留现代坐标、首都分类和别名，作为可搜索的地点参照。',
};
const files = unzipSync(bytes, { filter: file => file.name === 'cities15000.txt' });
if (!files['cities15000.txt']) throw new Error('GeoNames archive is missing cities15000.txt');

const places = [];
const countryCodes = new Set();
let capitals = 0;
for (const line of strFromU8(files['cities15000.txt']).trimEnd().split(/\r?\n/)) {
  const [originalId, originalName, ascii, variants, lat, lon, featureClass, code, country] = line.split('\t');
  const coordinates = [Number(lon), Number(lat)];
  if (!/^\d+$/.test(originalId) || !originalName || !lat || !lon || featureClass !== 'P' ||
      !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) {
    throw new Error(`Invalid GeoNames record: ${originalId}`);
  }
  const capital = code === 'PPLC';
  const aliases = [...new Set([ascii, ...variants.split(',')].filter(alias => alias && alias !== originalName))];
  const url = `https://www.geonames.org/${originalId}/`;
  places.push({
    id: `geonames-${originalId}`, originalId, name: originalName, aliases, coordinates,
    type: capital ? '现代首都' : '现代城市', minZoom: capital ? 3 : 5,
    sourceIds: [id], sourceTypes: [code, country].filter(Boolean),
    datasetName: dataset.name, externalIds: [`geonames:${originalId}`],
    names: [], roles: [], coverage: [],
    confidence: '现代地理参照。城市分类来自 GeoNames 快照，身份起止年代待考。',
    sourceDetails: { links: [{ url, label: `GeoNames · ${originalName}` }] },
  });
  if (country) countryCodes.add(country);
  if (capital) capitals++;
}
if (!places.length) throw new Error('GeoNames archive contains no cities');

const directory = new URL('place-packs/', root);
await mkdir(directory, { recursive: true });
await atomicWrite(new URL(`${id}.json`, directory), JSON.stringify({
  dataset, places, sources: { [id]: {
    url: source, title: dataset.name, license: dataset.license, version: dataset.version, credits: ['GeoNames'],
  } },
}));
await preparePlaces();
console.log(`GeoNames: ${places.length} cities, ${capitals} PPLC records, ${countryCodes.size} country codes`);
