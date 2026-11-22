import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPolityHistory } from './scripts/atlas-history.mjs';

function feature(name, seshat, wikidata, from, to, area = 100, type = 'POLITY') {
  return { properties: { Name: name, SeshatID: seshat, Wikidata: wikidata, FromYear: from, ToYear: to,
    Area: area, Type: type } };
}

test('政权索引保留重复年份与原记录，且不合并共用百科条目的北宋和南宋', () => {
  const features = [
    feature('Northern Song', 'north', 'Q7462', 1056, 1125),
    feature('Southern Song', 'south', 'Q7462', 1139, 1240),
    feature('Northern Song', 'north', 'Q7462', 1056, 1125),
    feature('Northern Song', '', 'Q7462', 1000, 1055),
    feature('Principality of Kiev', '', 'Q1483430', 1188, 1201),
    feature('Principality of Kiev', '', 'Q1483430', 1056, 1084, null),
    feature('Principality of Kiev', '', 'Q1483430', 1001, 1055, 100, 'RELATION'),
  ];
  const { byRecord, groups } = buildPolityHistory(features, new Set([0, 1, 3, 4]));
  assert.notEqual(byRecord[0], byRecord[1]);
  assert.notEqual(byRecord[0], byRecord[3]);
  assert.deepEqual(groups[byRecord[0]].map(row => row.sourceIndex), [0, 2]);
  assert.deepEqual(groups[byRecord[4]].map(row => [row.sourceIndex, row.areaKm2]), [[5, null], [4, 100]]);
});
