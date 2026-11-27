import assert from 'node:assert/strict';
import test from 'node:test';
import { labelSpace, physicalMapLayers } from './public/atlas/geography.mjs';
import { createReferenceLabels, polityAnchor } from './public/map-reference.mjs';

const bounds = { getWest: () => 0, getEast: () => 20, getSouth: () => 0, getNorth: () => 20,
  contains: ([x, y]) => x >= 0 && x <= 20 && y >= 0 && y <= 20 };
const map = { getBounds: () => bounds, getCanvas: () => ({ clientWidth: 400, clientHeight: 400 }),
  getZoom: () => 5, project: ([x, y]) => ({ x: x * 20, y: y * 20 }) };
const box = (a, b) => [[a,a], [b,a], [b,b], [a,b], [a,a]];

test('政权锚点在当前视野和多面有效区域内，避开空洞与跨日期变更线', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[box(0, 10), box(2, 8)], [box(12, 18)]] };
  const { position: [x, y] } = polityAnchor(geometry, bounds);
  assert.ok(x >= 12 && x <= 18 && y >= 12 && y <= 18);
  const hole = polityAnchor({ type: 'Polygon', coordinates: [box(0, 10), box(2, 8)] }, bounds).position;
  assert.ok(hole[0] < 2 || hole[0] > 8 || hole[1] < 2 || hole[1] > 8);
  assert.equal(polityAnchor({ type: 'Polygon', coordinates: [[[175, 0], [-175, 0], [-175, 10], [175, 0]]] }, bounds), undefined);
});

test('历史与个人地图共享自然地理层，地理标签避让个人标记和彼此', () => {
  assert.deepEqual(physicalMapLayers('#abc').map(layer => layer.id), ['major-rivers', 'detail-rivers', 'lakes']);
  const reserve = labelSpace(map, [[5, 5]]);
  assert.equal(reserve([5, 5], '地名'), false);
  assert.equal(reserve([5, 8], '地名'), true);
  assert.equal(reserve([5, 8.1], '河名'), false);
  assert.equal(reserve([19.9, 8], '地图外'), false);
});

test('异步视野结果只应用当前参考年，支持内部年 0 和缺资料降级', async t => {
  const displayed = new Set();

  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ dataset: {} }) };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  class Marker {
    constructor({ element }) { this.element = element; }
    setLngLat() { return this; }
    addTo() { displayed.add(this.element); return this; }
    remove() { displayed.delete(this.element); }
  }
  const calls = new Map();
  const messages = [];
  const layer = createReferenceLabels(map, Marker, {
    readPlaces: (_, year) => new Promise((resolve, reject) => calls.set(year, { resolve, reject })),
    onStatus: message => messages.push(message),
  });
  const item = name => ({ place: { id: name, name, coordinates: [5,5] }, coverage: { fromYear: -1, toYear: 1 } });
  const prior = layer.setHistory(0);
  const latest = layer.setHistory(1);
  calls.get(1).resolve([item('新地点'), { ...item('无年代'), coverage: undefined }]);
  await latest;
  calls.get(0).resolve([item('旧地点')]);
  await prior;
  assert.deepEqual([...displayed].map(node => node.textContent), ['新地点']);
  const fail = layer.setHistory(3);
  assert.equal(displayed.size, 0);
  calls.get(3).reject(Error('missing'));
  await fail;
  assert.equal(messages.at(-1), '历史地名资料缺失');
  await layer.setHistory(undefined);
  assert.equal(displayed.size, 0);
  assert.equal(messages.at(-1), '');
});
