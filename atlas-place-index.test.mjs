import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceIndex, handlePlaceQuery } from './atlas-place-index.mjs';

test('地点查询按地图范围和年份筛选，并保留搜索专用记录', () => {
  const record = (id, lon, years) => ({ id, name: id, type: '历史聚落', coordinates: [lon, 1], minZoom: 0,
    names: [], roles: [], coverage: years, sourceIds: [] });
  const years = [{ fromYear: -2, toYear: -1 }];
  const dated = [record('East', 179, years), record('West', -179, years), record('Outside', 0, years)];
  const undated = record('Reference', 179, []);
  const index = createPlaceIndex({ places: dated, referencePlaces: [undated], sources: {} });
  const region = { west: 170, east: 190, south: -5, north: 5, zoom: 5 };
  assert.deepEqual(index.viewport({ ...region, year: 0 }).map(row => row.place.id), ['East', 'West']);
  assert.deepEqual(index.viewport({ ...region, year: 1 }), []);
  assert.equal(index.search('Reference', 0).items[0].dates.length, 0);
  assert.equal(index.search('East', 1).items[0].dates[0].targetYear, 0);
  assert.equal(index.detail('Reference').place.id, 'Reference');
  assert.equal(index.detail('missing'), null);
});

test('地点 API 会拒绝缺少或无效的边界和年份', async () => {
  const url = path => new URL(path, 'http://localhost/api/atlas/places/');
  assert.equal((await handlePlaceQuery(url('viewport?year=1066')))[0], 400);
  assert.equal((await handlePlaceQuery(url('search?year=5000&q=Rome')))[0], 400);
});
