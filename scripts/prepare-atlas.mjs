import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { atomicWrite } from '../note-storage.mjs';
import { atlasSources, atlasYears } from '../atlas-sources.mjs';

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
  await atomicWrite(new URL(name, output), JSON.stringify(value));
}

function collection(features) {
  return { type: 'FeatureCollection', features };
}

const [archive, land, lakes] = await Promise.all([
  sourceFile('cliopatria-v0.2.1.zip', atlasSources.cliopatria.download),
  sourceFile('natural-earth-v5.1.2-land.geojson', atlasSources.naturalEarth.downloads.land),
  sourceFile('natural-earth-v5.1.2-lakes.geojson', atlasSources.naturalEarth.downloads.lakes),
]);
const unpacked = unzipSync(archive);
const geojson = unpacked['cliopatria_polities_only_v021.geojson'];
if (!geojson) throw new Error('Missing Cliopatria GeoJSON');
const original = JSON.parse(Buffer.from(geojson.buffer, geojson.byteOffset, geojson.byteLength));
const slices = [];
for (const year of atlasYears) {
  const features = original.features.flatMap((feature, sourceIndex) => {
    const { Name, Type, FromYear, ToYear } = feature.properties;
    if (Type !== 'POLITY' || FromYear > year || ToYear < year) return [];
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
await save('manifest.json', {
  schemaVersion: 1,
  slices,
  sources: atlasSources,
  sha256: { cliopatriaArchive: digest(archive), naturalEarthLand: digest(land), naturalEarthLakes: digest(lakes) },
});
