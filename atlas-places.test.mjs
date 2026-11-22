import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mergePlaces } from './scripts/prepare-places.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const packs = await Promise.all(['./public/atlas/northern-song-places.json',
  './atlas-places/curated.json', './atlas-places/pleiades.json'].map(read));

test('历史地点索引保留北宋和来源，拒绝重复 ID 或公元 0 年', () => {
  const index = mergePlaces(packs);
  assert.equal(index.places.length, 18);
  assert.equal(index.places.filter(place => place.id.startsWith('song-')).length, 4);
  assert.ok(index.sources['pleiades-579885'].credits.length);
  const extra = structuredClone(packs[1]);
  extra.places = [extra.places[0]];
  assert.throws(() => mergePlaces([extra, { sources: {}, places: extra.places }]), /duplicate place/);
  extra.places[0].coverage[0].fromYear = 0;
  assert.throws(() => mergePlaces([extra]), /Invalid or duplicate place/);
  extra.places[0].coverage = [];
  assert.equal(mergePlaces([extra]).referencePlaces.length, 1);
});
