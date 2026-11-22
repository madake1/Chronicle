import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAtlasChronology } from './scripts/atlas-chronology.mjs';
import { buildPolityNames } from './scripts/atlas-names.mjs';
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

test('中文别名保留当前年份，普通疆界优先且共用百科的实体保持分开', () => {
  const north = { name: 'Northern Song', seshatId: 'cn_northern_song_dyn', fromYear: 960, sourceIndex: 1 };
  const south = { name: 'Southern Song', seshatId: 'cn_southern_song_dyn', fromYear: 1127, sourceIndex: 2 };
  const normal = { name: 'Russian Federation', seshatId: 'ru', fromYear: 2014, toYear: 2023, sourceIndex: 4 };
  const aggregate = { ...normal, name: '(Russian Federation)', sourceIndex: 5 };
  const prc = { name: "People's Republic of China", seshatId: 'cn', fromYear: 2000, toYear: 2023, sourceIndex: 6 };
  const roc = { name: 'Republic of China', fromYear: 1950, toYear: 2023, sourceIndex: 7 };
  const history = { groups: {
    north: [{ ...north, toYear: 1055 }, { ...north, fromYear: 1056, toYear: 1125, sourceIndex: 3 }],
    south: [{ ...south, toYear: 1279 }], normal: [normal], aggregate: [aggregate], prc: [prc], roc: [roc],
  } };
  const features = [];
  for (const [key, records] of Object.entries(history.groups)) for (const record of records) {
    features[record.sourceIndex] = { properties: { Name: record.name, SeshatID: record.seshatId,
      Wikidata: key === 'prc' || key === 'roc' ? 'Q148' : undefined,
      Wikipedia: key === 'normal' || key === 'aggregate' ? 'Russia' : record.name,
      Components: key === 'aggregate' ? 'A;B' : '' } };
  }
  const names = buildPolityNames(history, features,
    { byRecord: { 1: 'Q7462', 2: 'Q7462' }, entities: { Q7462: { zh: '宋朝', url: 'https://www.wikidata.org/wiki/Q7462' } } },
    [
      { seshatId: north.seshatId, originalNames: [north.name], displayName: '北宋' },
      { seshatId: south.seshatId, originalNames: [south.name], displayName: '南宋' },
      { seshatId: 'ru', originalNames: [normal.name, aggregate.name], displayName: '俄罗斯联邦', aliases: ['俄罗斯'] },
      { seshatId: 'cn', originalNames: [prc.name], wikidata: 'Q148', displayName: '中华人民共和国', aliases: ['中国'] },
    ]);
  const search = createPolitySearch({ history, names });
  assert.equal(search('北宋', 1066)[0].current.sourceIndex, 3);
  assert.equal(search('SOUTHERN SONG', 1066)[0].current, undefined);
  assert.deepEqual(search('宋朝', 1066).map(result => result.name), ['北宋', '南宋']);
  assert.deepEqual(search('俄罗斯', 2022).map(result => result.current), [normal, aggregate]);
  assert.deepEqual(search('Russia', 2022).map(result => result.current), [normal, aggregate]);
  assert.deepEqual(search('中国', 2022).map(result => result.current), [prc]);
  assert.equal(search('Republic of China', 2022)[0].current, roc);
  assert.equal(names.north.url, undefined);
  assert.deepEqual(search('不存在'), []);
});
