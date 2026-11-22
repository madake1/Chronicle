import { formatYear } from '../chronology.mjs';
import { searchKey } from './data.mjs';
import { sourceYearToAxis } from './years.mjs';

export const eventCategories = Object.freeze({
  politics: '政治', war: '战争', economy: '经济', religion: '宗教',
  science: '科学与技术', culture: '文化与艺术', society: '社会',
});
const precisions = new Set(['year', 'century', 'approximate']);
const validYear = year => Number.isSafeInteger(year) && year !== 0;
const hasText = value => typeof value === 'string' && Boolean(value.trim());
const secureUrl = value => URL.canParse(value) && new URL(value).protocol === 'https:';

export function validateEventDataset({ version, events }) {
  if (!hasText(version) || !Array.isArray(events)) throw new Error('事件数据须包含版本和事件列表');
  const ids = new Set();
  for (const event of events) {
    const { id, name, startYear, endYear, datePrecision, dateLabel, category, description,
      placeId, placeName, location, sources } = event;
    if (!hasText(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) ||
        !hasText(name) || !hasText(description) || !validYear(startYear) || !validYear(endYear) ||
        startYear > endYear || !precisions.has(datePrecision) || !Object.hasOwn(eventCategories, category) ||
        (datePrecision !== 'year' && !hasText(dateLabel)) ||
        (placeId !== undefined && (!hasText(placeId) || !hasText(placeName))) ||
        (location !== undefined && (!hasText(placeName) || !Array.isArray(location) || location.length !== 2 ||
          !location.every(Number.isFinite) || Math.abs(location[0]) > 180 || Math.abs(location[1]) > 85)) ||
        !Array.isArray(sources) || !sources.length || sources.some(source => !hasText(source?.title) || !secureUrl(source.url))) {
      throw new Error(`无效或重复的历史事件：${id}`);
    }
    ids.add(id);
  }
  return events;
}

export function eventYears(event) {
  const first = formatYear(sourceYearToAxis(event.startYear));
  const last = formatYear(sourceYearToAxis(event.endYear));
  const range = first === last ? first : `${first}至 ${last}`;
  return event.datePrecision === 'year' ? range : `${event.dateLabel}（可能范围：${range}）`;
}

export function createEventIndex(dataset) {
  const records = validateEventDataset(dataset).map(event => ({
    event,
    start: sourceYearToAxis(event.startYear),
    end: sourceYearToAxis(event.endYear),
    key: searchKey([event.name, event.placeName, event.description, ...(event.aliases ?? [])].filter(Boolean).join(' ')),
  })).sort((a, b) => a.start - b.start || a.event.name.localeCompare(b.event.name, 'zh-CN'));
  return (year, category, query = '') => {
    if (!Number.isInteger(year)) return [];
    const key = searchKey(query);
    return records.filter(record => record.start <= year && year <= record.end &&
      (!category || record.event.category === category) && record.key.includes(key)).map(record => record.event);
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
