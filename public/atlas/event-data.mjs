import { formatYear } from '../chronology.mjs';
import { searchKey } from './data.mjs';
import { sourceYearToAxis } from './years.mjs';

export const eventCategories = Object.freeze({
  politics: '政治', war: '战争', economy: '经济', religion: '宗教',
  science: '科学与技术', culture: '文化与艺术', society: '社会', disaster: '自然灾害',
  sports: '体育', other: '其他事件',
});
const precisions = new Set(['year', 'century', 'approximate', 'reported-year']);
const validYear = year => Number.isSafeInteger(year) && year !== 0;
const hasText = value => typeof value === 'string' && Boolean(value.trim());
const secureUrl = value => URL.canParse(value) && new URL(value).protocol === 'https:';
export const eventRegions = event => event.regions ?? [event.region ?? '未标地区'];
export const eventSource = event => ({
  'EventKG 3.2': 'EventKG 结构化',
  'EventKG 3.2 · TextEvent': 'EventKG 文本摘录',
  'Wikidata': 'Wikidata 结构化',
  'NOAA NCEI · Global Significant Earthquake Database': 'NOAA 地震目录',
})[event.quality === 'catalogue' ? event.provenance?.dataset : ''] ?? '人工精选';

export function validateEventDataset({ version, events }) {
  if (!hasText(version) || !Array.isArray(events)) throw new Error('事件数据须包含版本和事件列表');
  const ids = new Set();
  const upstreamIds = new Set();
  for (const event of events) {
    const { id, name, startYear, endYear, datePrecision, dateLabel, temporalKind, category, description,
      placeId, placeName, location, sources } = event;
    if (!hasText(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) ||
        !hasText(name) || !hasText(description) || !validYear(startYear) || !validYear(endYear) ||
        startYear > endYear || !precisions.has(datePrecision) || !Object.hasOwn(eventCategories, category) ||
        (datePrecision !== 'year' && !hasText(dateLabel)) ||
        (temporalKind !== undefined && (temporalKind !== 'phase' || startYear === endYear)) ||
        (placeId !== undefined && (!hasText(placeId) || !hasText(placeName))) ||
        (location !== undefined && (!hasText(placeName) || !Array.isArray(location) || location.length !== 2 ||
          !location.every(Number.isFinite) || Math.abs(location[0]) > 180 || Math.abs(location[1]) > 85)) ||
        !Array.isArray(sources) || !sources.length || sources.some(source => !hasText(source?.title) || !secureUrl(source.url))) {
      throw new Error(`无效或重复的历史事件：${id}`);
    }
    ids.add(id);
    if (event.provenance !== undefined) {
      const { dataset, id: upstreamId, retrievedOn, locationBasis, upstreamPrecision } = event.provenance ?? {};
      const key = JSON.stringify([dataset, upstreamId]);
      if (!hasText(dataset) || !hasText(upstreamId) || !/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn ?? '') ||
          !hasText(locationBasis) || !hasText(upstreamPrecision) || upstreamIds.has(key)) {
        throw new Error(`无效或重复的事件来源编号：${id}`);
      }
      upstreamIds.add(key);
    }
  }
  return events;
}

export function mergeEventDatasets(...datasets) {
  const merged = {
    version: datasets.map(dataset => dataset.version).join(' + '),
    events: datasets.flatMap(validateEventDataset),
  };
  validateEventDataset(merged);
  return merged;
}

export function eventYears(event) {
  const first = formatYear(sourceYearToAxis(event.startYear));
  const last = formatYear(sourceYearToAxis(event.endYear));
  const range = first === last ? first : `${first}至 ${last}`;
  if (event.datePrecision === 'reported-year') return `${range}（${event.dateLabel}）`;
  if (event.temporalKind === 'phase') return `${range}（${event.dateLabel}的持续阶段）`;
  return event.datePrecision === 'year' ? range : `${event.dateLabel}（可能范围：${range}）`;
}

export function createEventIndex(dataset) {
  const records = validateEventDataset(dataset).map(event => ({
    event,
    start: sourceYearToAxis(event.startYear),
    end: sourceYearToAxis(event.endYear),
    key: searchKey([event.name, event.region, event.placeName, event.description, ...(event.aliases ?? [])].filter(Boolean).join(' ')),
  })).sort((a, b) => Number(a.event.quality === 'catalogue') - Number(b.event.quality === 'catalogue') ||
    a.start - b.start || a.event.name.localeCompare(b.event.name, 'zh-CN'));
  return (year, category, query = '', region = '', { source, mapped } = {}) => {
    if (!Number.isInteger(year)) return [];
    const key = searchKey(query);
    return records.filter(record => record.start <= year && year <= record.end &&
      (!category || record.event.category === category) && (!region || eventRegions(record.event).includes(region)) &&
      (!source || eventSource(record.event) === source) && (!mapped || record.event.location) &&
      record.key.includes(key)).map(record => record.event);
  };
}

// Group visible points in screen space. At closer zooms nearby sites separate,
// while records for the same site continue to share a marker.
export function groupEventMarkers(events, project, width, height) {
  const groups = [];
  for (const event of events) {
    if (!event.location) continue;
    const { x, y } = project(event.location);
    if (x < 0 || x > width || y < 0 || y > height) continue;
    const group = groups.find(item => Math.hypot(item.x - x, item.y - y) < 36);
    if (group) group.events.push(event);
    else groups.push({ x, y, location: event.location, events: [event] });
  }
  return groups;
}
