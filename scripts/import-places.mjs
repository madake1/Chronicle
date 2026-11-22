import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { atomicWrite } from '../note-storage.mjs';
import { importPlacePack } from './import-place-data.mjs';
import { preparePlaces } from './prepare-places.mjs';

const [format, file, metadataFile] = process.argv.slice(2);
if (!file || !['pleiades', 'lpf'].includes(format)) {
  throw new Error('Usage: npm run atlas:import-places -- pleiades <dump.json.gz> | lpf <local.json> <dataset-metadata.json>');
}
const dataset = format === 'pleiades' ? {
  id: 'pleiades-full', name: 'Pleiades · 历史地点', source: 'https://pleiades.stoa.org/downloads',
  license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
} : JSON.parse(await readFile(metadataFile, 'utf8'));
const allowedLicenses = new Map([
  ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
  ['CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/'],
  ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['CC BY-NC-SA 4.0', 'https://creativecommons.org/licenses/by-nc-sa/4.0/'],
  ['CC BY-NC 2.5', 'https://creativecommons.org/licenses/by-nc/2.5/'],
]);
const validLicense = (allowedLicenses.has(dataset.license) &&
  allowedLicenses.get(dataset.license) === dataset.licenseUrl) ||
  (dataset.license === 'Public Domain' && dataset.licenseUrl === dataset.licenseSource &&
    new URL(dataset.licenseUrl).protocol === 'https:');
if (!/^[a-z][a-z0-9-]{2,48}$/.test(dataset.id ?? '') || !dataset.name?.trim() ||
    new URL(dataset.source).protocol !== 'https:' ||
    !validLicense ||
    (format === 'lpf' && (dataset.id === 'pleiades-full' || !dataset.version || !dataset.credits || !dataset.licenseSource ||
      new URL(dataset.licenseSource).protocol !== 'https:'))) {
  throw new Error('Dataset metadata requires a source URL and a supported verified license; LPF also needs credits, version and license source.');
}
const hash = createHash('sha256');
await pipeline(createReadStream(file), hash);
dataset.sha256 = hash.digest('hex');
dataset.version ??= `SHA-256 ${dataset.sha256.slice(0, 12)}`;
dataset.changes = '筛选有坐标和类型的记录，分开记录地点资料、地名和身份的年代。';
const pack = await importPlacePack(file, format, dataset);
const directory = new URL('../atlas-data/place-packs/', import.meta.url);
await mkdir(directory, { recursive: true });
await atomicWrite(new URL(`${dataset.id}.json`, directory), JSON.stringify(pack));
await preparePlaces();
