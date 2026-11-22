import assert from 'node:assert/strict';
import test from 'node:test';
import { describe, formatYear, parseYear, ticks, zoomView } from './public/chronology.mjs';

test('缩放改变可见跨度并保留指针下的年份', () => {
  assert.deepEqual(zoomView([-500, 1500], 0.5, 0.75), [250, 1250]);
  assert.deepEqual(zoomView([250, 1250], 2, 0.75), [-500, 1500]);
  assert.deepEqual(zoomView([100, 102], 0.5, 0.5), [100, 102]);
});

test('公元前 1 年与公元 1 年相邻，拒绝公元 0 年', () => {
  assert.equal(parseYear('公元 1 年') - parseYear('公元前1年'), 1);
  assert.equal(parseYear('-431'), parseYear('公元前431'));
  assert.equal(formatYear(0), '公元前 1 年');
  assert.throws(() => parseYear('公元0年'));
});

test('按视口密度切换刻度', () => {
  assert.deepEqual(ticks(1135, 1139, 800), [1135, 1136, 1137, 1138, 1139]);
  assert.deepEqual(ticks(-500, 1500, 800), [-500, 0, 500, 1000, 1500]);
});

test('区分可能发生范围和持续区间', () => {
  assert.match(describe({ kind: 'window', start: 1101, end: 1200 }), /可能发生范围/);
  assert.match(describe({ kind: 'range', start: 1135, end: 1154, confidence: '确定' }), /1135 年 — 1154 年/);
});
