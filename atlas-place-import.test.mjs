import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { importPlacePack } from './scripts/import-place-data.mjs';
import { prepareQueryIndex } from './scripts/prepare-places.mjs';

test('Pleiades 与 WHG LPF 共用标准化流程，地名年代不产生地图记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chronicle-gazetteer-'));
  try {
    const point = { type: 'Point', coordinates: [23, 38] };
    const dataset = { id: 'pleiades-full', name: 'Test dataset', source: 'https://example.org/places',
      version: 'test', license: 'CC BY 4.0' };
    const pleiades = { id: '579885', title: 'Athenae', placeTypes: ['settlement'],
      features: [{ id: 'a', properties: { location_precision: 'precise' }, geometry: point }],
      locations: [{ id: 'a', associationCertainty: 'certain', start: -750, end: -500,
        attestations: [{ confidence: 'confident', timePeriod: 'archaic' }] }],
      names: [{ attested: 'Athenae', start: -740, end: -510 }] };
    const lpf = { '@id': 'test-whg-1', properties: { title: 'Athenae' }, types: [{ label: 'city' }],
      geometry: point, names: [{ toponym: 'Athenae', when: { timespans: [{ start: { in: '0050' } }] } }] };
    const lpfDated = { ...lpf, '@id': 'test-whg-2',
      when: { timespans: [{ start: { in: '0000' }, end: { in: '0001' } }] } };
    const a = join(dir, 'pleiades.json');
    const b = join(dir, 'whg.json');
    await writeFile(a, JSON.stringify({ '@graph': [pleiades] }));
    await writeFile(b, JSON.stringify({ type: 'FeatureCollection', features: [lpf, lpfDated] }));
    const [first, second] = await Promise.all([
      importPlacePack(a, 'pleiades', dataset), importPlacePack(b, 'lpf', { ...dataset, id: 'whg-test' }),
    ]);
    assert.equal(first.places[0].coverage[0].fromYear, -750);
    assert.equal(first.places[0].names[0].fromYear, -740);
    assert.deepEqual(first.places[0].existence, []);
    assert.deepEqual(first.places[0].roles, []);
    assert.equal(second.places[0].coverage.length, 0);
    assert.equal(second.places[0].names[0].fromYear, 50);
    assert.equal(second.places[1].coverage[0].fromYear, -1);
    const manual = { sources: { manual: { url: 'https://example.org/manual' } }, places: [{
      id: 'pleiades-579885', name: '雅典', type: '城邦', coordinates: [23, 38], minZoom: 0,
      names: [{ name: '雅典', fromYear: -550, toYear: -330 }], roles: [],
      coverage: [{ fromYear: -550, toYear: -330 }], sourceIds: ['manual'],
    }] };
    const index = prepareQueryIndex([manual], [first, second]);
    assert.equal(index.places.length, 2);
    assert.equal(index.referencePlaces.length, 1);
    assert.equal(index.places[0].coverage[0].fromYear, -550);
    assert.equal(index.places[0].names[0].name, '雅典');
    assert.ok(index.places[0].sourceIds.includes('pleiades-full:579885'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
