import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCatalogueYear } from './atlas-event-catalog.mjs';

test('全库保留公元前及跨纪元记录，并按同一 ID 合并上游补充', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chronicle-events-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = pathToFileURL(root + sep);
  const event = { id: 'eventkg-q1', name: '原始标题', startYear: -2, endYear: 2,
    sources: [{ url: 'https://example.org/eventkg' }], provenance: { id: 'event_1' } };
  const supplement = { ...event, name: '补充显示名称', location: [34, 21], region: '地区',
    supplement: true, sources: [{ url: 'https://www.wikidata.org/wiki/Q1' }],
    provenance: { id: 'Q1', locationBasis: '事件坐标' } };
  const catalogues = {
    'eventkg/-10.json': [event], 'eventkg/0.json': [event, { ...event, id: 'eventkg-q3' }],
    'wikidata/0.json': [supplement, { ...supplement, id: 'eventkg-q2' }],
    'noaa.json': [{ id: 'noaa-earthquake-1', startYear: -1, endYear: -1 }],
  };
  await Promise.all(['eventkg', 'wikidata'].map(path => mkdir(join(root, path))));
  await Promise.all(Object.entries(catalogues).map(([path, events]) =>
    writeFile(new URL(path, directory), JSON.stringify({ version: path, events }))));
  await writeFile(new URL('wikidata/holdbacks.json', directory), JSON.stringify({ 'eventkg-q3': [1] }));
  assert.deepEqual((await readCatalogueYear(-1, directory)).events.map(item => item.id), ['eventkg-q1']);
  const bce = (await readCatalogueYear(0, directory)).events;
  assert.deepEqual(bce.map(item => item.id), ['noaa-earthquake-1', 'eventkg-q1']);
  assert.equal(bce[0].location, undefined);
  assert.deepEqual(bce[1].location, [34, 21]);
  assert.deepEqual(bce[1].aliases, ['补充显示名称']);
  assert.equal(bce[1].sources.length, 2);
  assert.equal((await readCatalogueYear(2, directory)).events.length, 1);
  assert.equal((await readCatalogueYear(3, directory)).events.length, 0);
});
