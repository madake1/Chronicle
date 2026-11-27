import assert from 'node:assert/strict';
import test from 'node:test';
import { navigation } from './public/app-shell.mjs';
import { groupMapPoints, layoutTimeline, timelineTicks } from './public/timeline-layout.mjs';

const point = (key, start, entityType = 'work') => ({ key, start, entityType, kind: 'point' });

test('共享导航四个入口按固定顺序排列', () => {
  assert.deepEqual(navigation.map(([path]) => path), ['/', '/knowledge', '/spacetime', '/atlas']);
});

test('同泳道容纳不冲突的卡片，知识独立分层，区间端点真实', () => {
  const rows = [point('bce', 0), point('later', 200), point('knowledge', 0, 'knowledge'),
    { ...point('range', -100), kind: 'range', end: 30 }];
  const layout = layoutTimeline(rows, [-50, 250], 900);
  const byId = Object.fromEntries(layout.items.map(item => [item.row.key, item]));
  assert.equal(byId.range.lane, byId.later.lane);
  assert.notEqual(byId.range.lane, byId.bce.lane);
  assert.equal(byId.knowledge.side, 'knowledge');
  assert.equal(byId.range.start, 0);
  assert.equal(byId.range.end, 240);
  assert.ok(timelineTicks(-50, 250, 900).minor.length > 0);
});

test('密集时间轴限制卡片数，聚合与卡片合计保留全部标注', () => {
  const rows = Array.from({ length: 100 }, (_, index) => point(String(index), 1));
  const layout = layoutTimeline(rows, [-10, 10], 390, '99');
  assert.equal(layout.items.length, 3);
  assert.equal(layout.items[0].row.key, '99');
  assert.equal(layout.clusters.length, 1);
  assert.equal(layout.clusters[0].rows.length, 97);
});

test('地图按当前图面距离聚合，放大可以展开相邻坐标', () => {
  const rows = [{ longitude: 0, latitude: 0 }, { longitude: .1, latitude: .1 }];
  const map = zoom => ({ project: ([x, y]) => ({ x: x * zoom, y: y * zoom }) });
  assert.equal(groupMapPoints(rows, map(10)).length, 1);
  assert.equal(groupMapPoints(rows, map(1000)).length, 2);
});
