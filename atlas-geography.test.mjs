import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { placesAt } from './public/atlas/geography.mjs';
import { prepareRivers } from './scripts/atlas-rivers.mjs';

test('北宋试验地点按视野级别和年代筛选，陪都身份单独变化', async () => {
  const { places, sources } = JSON.parse(await readFile(new URL('./public/atlas/northern-song-places.json', import.meta.url)));
  assert.equal(placesAt(places, 1066, 3).length, 0);
  assert.deepEqual(placesAt(places, 1066, 4).map(({ place }) => place.id), ['song-kaifeng']);
  assert.equal(placesAt(places, 1066, 5).length, 3);
  const daming = year => placesAt(places, year, 5).find(({ place }) => place.id === 'song-daming');
  assert.equal(daming(1041).role, undefined);
  assert.equal(daming(1042).role.label, '北宋陪都 · 北京');
  assert.equal(placesAt(places, 1127, 5)[0].role, undefined);
  assert.equal(placesAt(places, 1300, 5).length, 0);
  assert.ok(places.every(place => place.sourceIds.every(id => sources[id]) &&
    place.roles.every(role => sources[role.sourceId])));
});

test('自然地理只导入选定尺度的河流，保留原始几何和缩放规则', () => {
  const geometry = { type: 'LineString', coordinates: [[109, 35], [112, 35]] };
  const make = (featurecla, scalerank) => ({ geometry, properties: {
    name: 'Huang', name_en: 'Yellow', min_label: 4, scalerank, featurecla,
  } });
  const rivers = prepareRivers({ type: 'FeatureCollection',
    features: [make('River', 3), make('Lake Centerline', 2), make('River', 7)] });
  assert.deepEqual(rivers.features, [{ type: 'Feature', geometry,
    properties: { name: '黄河', rank: 3, labelZoom: 4 } }]);
});
