import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { atomicWrite } from '../note-storage.mjs';
import { atlasSources, atlasYears } from '../atlas-sources.mjs';
import { buildEncyclopedia } from './atlas-encyclopedia.mjs';
import { buildAtlasChronology } from './atlas-chronology.mjs';
import { prepareGeography } from './prepare-geography.mjs';
import { prepareRivers } from './atlas-rivers.mjs';

const output = new URL('../atlas-data/', import.meta.url);
const raw = new URL('raw/', output);
await mkdir(raw, { recursive: true });

async function sourceFile(name, url) {
  const file = new URL(name, raw);
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log(`Downloading ${name}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await atomicWrite(file, bytes);
  return bytes;
}

async function save(name, value) {
  const json = JSON.stringify(value);
  await atomicWrite(new URL(name, output), json);
  if (name === 'geography-10.json' || name === 'geography-50.json') {
    await atomicWrite(new URL(`${name}.gz`, output), gzipSync(json));
  }
}

function collection(features) {
  return { type: 'FeatureCollection', features };
}

if (process.argv.includes('--with-comparison')) {
  const revision = '4b5039e50d8d2464b065bd76ad6086cd4597108d';
  const source = `https://github.com/aourednik/historical-basemaps/tree/${revision}`;
  const download = `https://raw.githubusercontent.com/aourednik/historical-basemaps/${revision}`;
  const license = await sourceFile('historical-basemaps-LICENSE.txt', `${download}/LICENSE`);
  if (!license.includes('GNU GENERAL PUBLIC LICENSE')) throw new Error('Historical Basemaps license is missing');
  await atomicWrite(new URL('historical-basemaps-LICENSE.txt', output), license);
  const snapshots = [];
  for (const [year, upstream] of [[-2000, 'world_bc2000'], [-500, 'world_bc500'], [1200, 'world_1200']]) {
    const bytes = await sourceFile(`${revision}-${upstream}.geojson`, `${download}/geojson/${upstream}.geojson`);
    const data = JSON.parse(bytes);
    if (data.type !== 'FeatureCollection' || !data.features?.length) throw new Error(`Invalid snapshot ${upstream}`);
    const file = `comparison-${year}.geojson`;
    await atomicWrite(new URL(file, output), bytes);
    snapshots.push({ year, file, source: `${source.replace('/tree/', '/blob/')}/geojson/${upstream}.geojson`,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await save('comparison.json', { source, revision, snapshots });
}

const [archive, land, lakes, rivers] = await Promise.all([
  sourceFile('cliopatria-v0.2.1.zip', atlasSources.cliopatria.download),
  sourceFile('natural-earth-v5.1.2-land.geojson', atlasSources.naturalEarth.downloads.land),
  sourceFile('natural-earth-v5.1.2-lakes.geojson', atlasSources.naturalEarth.downloads.lakes),
  sourceFile('natural-earth-v5.1.2-rivers.geojson', atlasSources.naturalEarth.downloads.rivers),
]);
const unpacked = unzipSync(archive);
const geojson = unpacked['cliopatria_polities_only_v021.geojson'];
if (!geojson) throw new Error('Missing Cliopatria GeoJSON');
const original = JSON.parse(Buffer.from(geojson.buffer, geojson.byteOffset, geojson.byteLength));
const slices = [];
const encyclopediaRecords = new Map();
for (const year of atlasYears) {
  const features = original.features.flatMap((feature, sourceIndex) => {
    const { Name, Type, FromYear, ToYear, Wikipedia, Wikidata } = feature.properties;
    if (Type !== 'POLITY' || FromYear > year || ToYear < year) return [];
    encyclopediaRecords.set(sourceIndex, { sourceIndex, Wikipedia, Wikidata });
    return [{ type: 'Feature', geometry: feature.geometry, properties: {
      name: Name, fromYear: FromYear, toYear: ToYear, sourceIndex,
    } }];
  });
  if (features.length === 0) throw new Error(`No polity records for ${year}`);
  const file = `year-${year}.geojson`;
  await save(file, collection(features));
  slices.push({ year, file, features: features.length });
  console.log(`${year}: ${features.length} polity records`);
}

for (const [name, bytes] of Object.entries({ land, lakes })) {
  const data = JSON.parse(bytes);
  if (data.type !== 'FeatureCollection' || !data.features?.length) throw new Error(`Invalid ${name} GeoJSON`);
  await save(`${name}.geojson`, collection(data.features.map(feature => ({
    type: 'Feature', geometry: feature.geometry, properties: {},
  }))));
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
await save('rivers.geojson', prepareRivers(JSON.parse(rivers)));
const geography = await prepareGeography(sourceFile, save, atlasSources.naturalEarth.detailBase, digest);
const encyclopediaFile = new URL('../atlas-encyclopedia.json', import.meta.url);
if (process.argv.includes('--refresh-encyclopedia')) {
  console.log('Resolving Wikipedia and Wikidata links…');
  const index = await buildEncyclopedia([...encyclopediaRecords.values()]);
  await atomicWrite(encyclopediaFile, JSON.stringify({
    archiveSha256: digest(archive), ...index,
  }, null, 2) + '\n');
}
const encyclopedia = JSON.parse(await readFile(encyclopediaFile, 'utf8'));
if (encyclopedia.archiveSha256 !== digest(archive)) throw new Error('百科索引与 Cliopatria 原始包版本不匹配');
const overrides = JSON.parse(await readFile(new URL('../atlas-polity-aliases.json', import.meta.url), 'utf8'));
const chronology = await buildAtlasChronology(original.features, encyclopedia, save, overrides);
console.log(`${chronology.polityRecords} records, ${chronology.geometries} unique geometries, ${chronology.shards} shards`);
await save('manifest.json', {
  schemaVersion: 1,
  slices,
  sources: atlasSources,
  chronology,
  geography,
  sha256: { cliopatriaArchive: digest(archive), naturalEarthLand: digest(land),
    naturalEarthLakes: digest(lakes), naturalEarthRivers: digest(rivers) },
});
