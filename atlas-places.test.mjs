import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPlaceSearch, placesAt } from './public/atlas/places.mjs';
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

test('历史地点搜索优先当前年代，并按年代切换同一地点的名称和身份', () => {
  const { places, referencePlaces } = mergePlaces(packs);
  const search = createPlaceSearch([...places, ...referencePlaces]);
  assert.equal(search('Athenai', -499)[0].name.name, '雅典');
  assert.equal(search('长安', 650)[0].place.id, 'tang-changan');
  assert.equal(search('长安', -100)[0].place.id, 'han-changan');
  const medieval = search('Istanbul', 1453)[0];
  const modern = search('君士坦丁堡', 2022)[0];
  assert.equal(medieval.place.id, modern.place.id);
  assert.equal(medieval.name.name, '君士坦丁堡');
  assert.equal(medieval.role.label, '拜占庭帝国首都');
  assert.equal(modern.name.name, '伊斯坦布尔');
  assert.equal(modern.role, undefined);
  assert.equal(search('Istanbul', 1700)[0].coverage, undefined);
  assert.equal(search('Istanbul', 1700)[0].dates.length, 2);
  const unknown = { ...medieval.place, coverage: [], names: [], roles: [] };
  assert.deepEqual(placesAt([unknown], 1453, 6), []);
  assert.equal(createPlaceSearch([unknown])('Istanbul', 1453)[0].dates.length, 0);
});
