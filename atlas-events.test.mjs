import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createEventIndex, eventYears, groupEventMarkers, mergeEventDatasets, validateEventDataset } from './public/atlas/event-data.mjs';
import { importNoaaSample } from './scripts/import-noaa-events.mjs';
import { sourceYearToAxis } from './public/atlas/years.mjs';

const json = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const dataset = await json('./public/atlas/events.json');
const wikidata = await json('./public/atlas/events-wikidata.json');
const noaa = await json('./public/atlas/events-noaa.json');
const milestones = await json('./public/atlas/events-milestones.json');
const expanded = mergeEventDatasets(dataset, wikidata, noaa, milestones);
const eventsAt = createEventIndex(dataset);
const ids = events => events.map(event => event.id);

test('所有事件有唯一 ID、来源、合法日期且地点引用可从仓库解析', async () => {
  const packs = await Promise.all([
    json('./atlas-places/curated.json'),
    json('./atlas-places/pleiades.json'),
    json('./public/atlas/northern-song-places.json'),
  ]);
  const placeIds = new Set(packs.flatMap(pack => pack.places.map(place => place.id)));
  const events = validateEventDataset(expanded);
  assert.equal(dataset.events.length, 26);
  assert.ok(events.every(event => !event.placeId || placeIds.has(event.placeId)));
  for (const invalid of [
    { startYear: 0 }, { endYear: -9999 }, { category: 'unknown' }, { sources: [] },
    { sources: [{ title: 'test', url: 'http://example.org' }] }, { location: [181, 45] },
  ]) assert.throws(() => validateEventDataset({ ...dataset, events: [{ ...events[0], ...invalid }] }));
  assert.throws(() => validateEventDataset({ ...dataset, events: [events[0], events[0]] }));
});

test('扩充包保留出处、拒绝相同上游 ID，并按公元前和跨纪元阶段筛选', () => {
  assert.ok(wikidata.events.every(event => event.category !== 'war' &&
    event.sources.some(source => !source.url.startsWith('https://www.wikidata.org/'))));
  const candidate = wikidata.events[0];
  assert.throws(() => mergeEventDatasets(wikidata, {
    version: '重复候选', events: [{ ...candidate, id: 'different-local-id' }],
  }), /重复的事件来源编号/);

  const find = createEventIndex(expanded);
  const earthquake = find(sourceYearToAxis(-2150), 'disaster');
  assert.deepEqual(ids(earthquake), ['noaa-earthquake-1']);
  assert.match(eventYears(earthquake[0]), /公元前 2150 年.*目录记载年份/);
  assert.deepEqual(groupEventMarkers(earthquake, () => ({ x: 1, y: 1 }), 10, 10), []);
  assert.deepEqual(find(sourceYearToAxis(-2149), 'disaster'), []);
  for (const year of [-800, -1, 1, 400]) {
    assert.ok(ids(find(sourceYearToAxis(year))).includes('wikidata-q241790'));
  }
  for (const year of [-801, 401]) assert.ok(!ids(find(sourceYearToAxis(year))).includes('wikidata-q241790'));
});

test('大事记按实际地图年份筛选，独立于旧事件包', () => {
  const find = createEventIndex(expanded);
  assert.ok(ids(find(sourceYearToAxis(-539))).includes('cyrus-enters-babylon'));
  assert.ok(!ids(find(sourceYearToAxis(-538))).includes('cyrus-enters-babylon'));
  assert.ok(ids(find(960)).includes('northern-song-founded'));
  for (const year of [1939, 1942, 1945]) assert.ok(ids(find(year, 'war')).includes('second-world-war'));
  for (const year of [1938, 1946]) assert.ok(!ids(find(year, 'war')).includes('second-world-war'));
  assert.ok(ids(find(1994)).includes('south-africa-election'));
  assert.ok(ids(find(sourceYearToAxis(-490), 'war')).includes('marathon-battle'));
  assert.ok(ids(find(1275)).includes('maori-early-settlement'));
  assert.ok(!ids(find(1301)).includes('maori-early-settlement'));
  assert.deepEqual(ids(find(1960, 'politics', '加蓬独立')), ['gabon-independence']);
  assert.ok(ids(find(2021, 'science')).includes('webb-launch'));
});

test('NOAA 批量导入对重复输入幂等，冲突记录和不公开记录均拒收', () => {
  const sample = { retrievedOn: '2026-11-23', events: [
    { id: 1, name: '古地震', placeName: '地区' },
    { id: 2, name: '现代地震', placeName: '海岸', mapEpicenter: true },
  ] };
  const ancient = { id: 1, year: -2150, longitude: 35.5, latitude: 31.1, publish: true };
  const modern = { id: 2, year: 1960, month: 5, day: 22, longitude: -73.41, latitude: -38.14, publish: true };
  const result = importNoaaSample(sample, [{ items: [ancient, modern] }]);
  assert.deepEqual(result, importNoaaSample(sample, [{ items: [modern] }, { items: [ancient, modern] }]));
  assert.equal(result.events[0].location, undefined);
  assert.deepEqual(result.events[1].location, [-73.41, -38.14]);
  assert.equal(result.events[1].provenance.upstreamPrecision, 'day');
  assert.throws(() => importNoaaSample(sample, [{ items: [ancient, modern, { ...modern, year: 1961 }] }]), /冲突/);
  assert.throws(() => importNoaaSample(sample, [{ items: [ancient, { ...modern, publish: false }] }]), /公开记录/);
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
