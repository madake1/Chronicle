import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSpacetime, validAnnotations, workAnnotations } from './spacetime.mjs';
import { matchingAnnotations, timeFilter } from './public/spacetime-query.mjs';

test('旧片段身份可重现，保留重复片段和公元前一年', () => {
  const segment = { kind: 'point', start: 0, confidence: '确定' };
  const work = { id: 'one', segments: [segment, { ...segment }] };
  const first = workAnnotations(work);
  assert.deepEqual(workAnnotations(structuredClone(work)), first);
  assert.notEqual(first[0].id, first[1].id);
  const mixed = workAnnotations({ ...work, segments: [first[0], segment] });
  assert.deepEqual(mixed, first);
  assert.equal(projectSpacetime([work], [], []).rows[0].start, 0);
  assert.equal(work.segments[0].id, undefined);
  assert.ok(validAnnotations([{ place: '虚构地名' }, { longitude: 0, latitude: 0 }, segment]));
  for (const invalid of [{}, { longitude: 0 }, { longitude: 181, latitude: 0 },
    { longitude: NaN, latitude: 0 }, { kind: 'range', start: 1, end: 0, confidence: '确定' }]) {
    assert.equal(validAnnotations([invalid]), false);
  }
});

test('同条标注匹配时空条件，三种年代模式和未知年代独立', () => {
  const tag = { id: 'child', parentId: 'parent' };
  const knowledge = { id: 'one', title: '', tagIds: [tag.id], annotations: [
    { id: 'bc', kind: 'point', start: 0 },
    { id: 'window', kind: 'window', start: 1, end: 8, longitude: 0, latitude: 0 },
    { id: 'unknown', longitude: 0, latitude: 0 },
  ] };
  const work = { id: 'one', type: '游戏', title: '测试作品', segments: [{ id: 'ad', kind: 'point', start: 1 }] };
  const data = projectSpacetime([work], [knowledge], [tag]);
  const bounds = { west: -10, east: 10, south: -10, north: 10 };
  const matches = filters => matchingAnnotations(data, { tag: 'parent', workType: '游戏', ...filters }).map(row => row.id);
  assert.deepEqual(matches({ time: timeFilter('snapshot', '公元前1年') }), ['bc']);
  assert.deepEqual(matches({ time: timeFilter('snapshot', '公元前1年'), bounds }), []);
  assert.deepEqual(matches({ time: timeFilter('interval', '8', '9') }), ['window']);
  assert.deepEqual(matches({ time: timeFilter('snapshot', '9') }), []);
  assert.deepEqual(matches({ time: timeFilter('cumulative', '9') }), ['ad', 'bc', 'window']);
  assert.deepEqual(matches({ time: timeFilter('snapshot', '1'), bounds, unknown: true }), ['window', 'unknown']);
  assert.deepEqual(matches({ workType: '小说', query: '测试' }), []);
  assert.throws(() => timeFilter('interval', '1', '公元前1年'));
});
