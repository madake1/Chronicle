import { parseYear } from './chronology.mjs';

export function timeFilter(mode, first, last) {
  if (!mode) return null;
  const start = parseYear(first);
  const end = mode === 'interval' ? parseYear(last) : start;
  if (end < start) throw new Error('结束年份不能早于起始年份');
  return { mode, start, end };
}

export function matchingAnnotations({ rows, tags }, filters) {
  const descendants = new Set(filters.tag ? [filters.tag] : []);
  for (const parent of descendants) {
    for (const tag of tags) if (tag.parentId === parent) descendants.add(tag.id);
  }
  const query = filters.query?.trim().toLowerCase();
  return rows.filter(row => {
    if (filters.type && row.entityType !== filters.type) return false;
    if (row.entityType === 'work' && filters.workType && row.workType !== filters.workType) return false;
    if (row.entityType === 'knowledge' && filters.tag && !row.tagIds.some(id => descendants.has(id))) return false;
    if (query && ![row.title, row.summary, row.place, row.description].some(text => text?.toLowerCase().includes(query))) return false;
    if (filters.bounds) {
      if (row.longitude === undefined) return false;
      const { west, east, north, south } = filters.bounds;
      const delta = ((row.longitude - west) % 360 + 360) % 360;
      if (delta > ((east - west) % 360 + 360) % 360 && east - west < 360 ||
          row.latitude < south || row.latitude > north) return false;
    }
    if (row.start === undefined) return filters.unknown;
    if (!filters.time) return true;
    const { mode, start, end } = filters.time;
    return row.start <= end && (mode === 'cumulative' || (row.end ?? row.start) >= start);
  });
}
