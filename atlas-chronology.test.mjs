import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAtlasChronology } from './scripts/atlas-chronology.mjs';
import { createAtlasData, createPolitySearch } from './public/atlas/data.mjs';
import { formatYear, parseYear } from './public/chronology.mjs';
import { zoomYears } from './public/atlas/years.mjs';

test('任意年份按有效期选取记录，相同疆界共用几何且无需重绘', async () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] };
  const feature = (start, end) => ({ geometry, properties: {
    Type: 'POLITY', Name: 'Sample', SeshatID: 'sample', Wikidata: 'Q1', Wikipedia: 'Sample',
    FromYear: start, ToYear: end, Area: 100,
  } });
  const files = new Map();
  const meta = await buildAtlasChronology([feature(-3, 0), feature(1, 3), feature(6, 9)],
    { entities: {}, byRecord: {} }, (name, value) => files.set(name, value));
  assert.equal(meta.geometries, 1);
  let requests = 0;
  const data = createAtlasData(files.get('chronology.json'), async name => {
    requests++;
    return files.get(name);
  });
  const bce = data.frame(parseYear('公元前1年'));
  const ce = data.frame(parseYear('公元1年'));
  assert.equal(formatYear(parseYear('公元前1年') + 1), '1 年');
  assert.deepEqual([...bce.byRecord.keys()], [0]);
  assert.deepEqual([...ce.byRecord.keys()], [1]);
  assert.equal(bce.key, ce.key);
  assert.equal(data.frame(4).byRecord.size, 0);
  assert.equal(data.frame(9).byRecord.size, 1);
  assert.equal((await data.features(bce)).features[0].geometry, geometry);
  await data.features(ce);
  assert.equal(requests, 1);
});

test('时间轴缩放保留当前年份且不越过数据范围', () => {
  const bounds = [-3399, 2024];
  assert.deepEqual(zoomYears([1000, 1100], 1050, 0.4, bounds), [1030, 1070]);
  assert.deepEqual(zoomYears(bounds, 2024, 0.4, bounds), [-145, 2024]);
  assert.deepEqual(zoomYears([2000, 2024], 2024, 0.4, bounds), [2004, 2024]);
});

test('中英文搜索跳到已确认实体的最早记录，共用百科的北宋和南宋分开', () => {
  const north = { name: 'Northern Song', seshatId: 'cn_northern_song_dyn', fromYear: 960, sourceIndex: 1 };
  const south = { name: 'Southern Song', seshatId: 'cn_southern_song_dyn', fromYear: 1127, sourceIndex: 2 };
  const search = createPolitySearch({
    history: { groups: { north: [north, { ...north, fromYear: 1056, sourceIndex: 3 }], south: [south] } },
    encyclopedia: { byRecord: { 1: 'Q7462', 2: 'Q7462' }, entities: { Q7462: { zh: '宋朝' } } },
  });
  assert.deepEqual(search('北宋').map(result => result.first), [north]);
  assert.deepEqual(search('SOUTHERN SONG').map(result => result.first), [south]);
  assert.deepEqual(search('宋朝').map(result => result.first), [north, south]);
  assert.deepEqual(search('不存在'), []);
});
