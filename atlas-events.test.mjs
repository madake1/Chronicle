import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEventIndex, eventYears, groupEventMarkers, validateEventDataset } from './public/atlas/event-data.mjs';
import { sourceYearToAxis } from './public/atlas/years.mjs';

const json = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const dataset = await json('./public/atlas/events.json');
const eventsAt = createEventIndex(dataset);
const ids = events => events.map(event => event.id);

test('首批事件有唯一 ID、来源、合法日期且地点引用可从仓库解析', async () => {
  const packs = await Promise.all([
    json('./atlas-places/curated.json'),
    json('./atlas-places/pleiades.json'),
    json('./public/atlas/northern-song-places.json'),
  ]);
  const placeIds = new Set(packs.flatMap(pack => pack.places.map(place => place.id)));
  const events = validateEventDataset(dataset);
  assert.ok(events.length >= 20);
  assert.ok(events.every(event => !event.placeId || placeIds.has(event.placeId)));
  for (const invalid of [
    { startYear: 0 }, { endYear: -9999 }, { category: 'unknown' }, { sources: [] },
    { sources: [{ title: 'test', url: 'http://example.org' }] }, { location: [181, 45] },
  ]) assert.throws(() => validateEventDataset({ ...dataset, events: [{ ...events[0], ...invalid }] }));
  assert.throws(() => validateEventDataset({ ...dataset, events: [events[0], events[0]] }));
});

test('按实际地图年份、类别和关键词筛选瞬时、持续和不确定事件', () => {
  assert.ok(ids(eventsAt(1066, 'war', '诺曼征服')).includes('hastings-battle'));
  assert.ok(!ids(eventsAt(1065)).includes('hastings-battle'));
  assert.ok(!ids(eventsAt(1066, 'politics')).includes('hastings-battle'));
  for (const year of [1337, 1400, 1453]) assert.ok(ids(eventsAt(year)).includes('hundred-years-war'));
  for (const year of [1336, 1454]) assert.ok(!ids(eventsAt(year)).includes('hundred-years-war'));
  const early = eventsAt(sourceYearToAxis(-776)).find(event => event.id === 'early-olympic-games');
  assert.match(eventYears(early), /公元前8世纪.*可能范围/);
  assert.ok(!ids(eventsAt(sourceYearToAxis(-700))).includes(early.id));
  assert.deepEqual(eventsAt(undefined), []);
});

test('公元前 1 年和公元 1 年连续，源数据没有公元零年', () => {
  const event = { ...dataset.events[0], startYear: -1, endYear: 1, datePrecision: 'year' };
  const find = createEventIndex({ version: 'test', events: [event] });
  assert.deepEqual(find(-1), []);
  assert.deepEqual(find(0), [event]);
  assert.deepEqual(find(1), [event]);
  assert.deepEqual(find(2), []);
  assert.equal(eventYears(event), '公元前 1 年至 1 年');
});

test('邻近标记共享可访问事件组，无点位事件始终保留在列表', () => {
  const events = eventsAt(1066);
  assert.ok(ids(events).includes('stamford-bridge-battle'));
  const project = ([lon, lat]) => ({ x: (lon + 1) * 100, y: (lat - 50) * 100 });
  const groups = groupEventMarkers(events, project, 250, 250);
  assert.equal(groups.length, 2);
  assert.deepEqual(ids(groups.find(group => group.events.length === 2).events).sort(),
    ['edward-confessor-burial', 'william-coronation']);
  assert.ok(!ids(groups.flatMap(group => group.events)).includes('stamford-bridge-battle'));
});
