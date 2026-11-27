import { ticks } from './chronology.mjs';

export function layoutTimeline(rows, [left, right], width, selected) {
  const x = year => (year - left) / (right - left) * width;
  const clamp = value => Math.max(0, Math.min(width, value));
  const cardWidth = Math.min(146, Math.max(112, width / 4));
  const laneLimit = width < 500 ? 3 : 4;
  const tracks = { work: [], knowledge: [] };
  const visible = rows.filter(row => row.start !== undefined && row.start <= right && (row.end ?? row.start) >= left)
    .map(row => {
      const start = clamp(x(row.start));
      const end = clamp(x(row.end ?? row.start));
      const anchor = (start + end) / 2;
      const card = Math.max(0, Math.min(width - cardWidth, anchor - cardWidth / 2));
      return { row, start, end, anchor, card, cardWidth,
        left: Math.min(start, card), right: Math.max(end, card + cardWidth) };
    });
  visible.sort((a, b) => Number(b.row.key === selected) - Number(a.row.key === selected) || a.left - b.left);
  const items = [];
  const dense = { work: new Map(), knowledge: new Map() };
  for (const item of visible) {
    const side = item.row.entityType;
    const lanes = tracks[side];
    let lane = lanes.findIndex(spans => spans.every(span => span.right + 8 <= item.left || item.right + 8 <= span.left));
    if (lane === -1 && lanes.length < laneLimit) {
      lane = lanes.length;
      lanes.push([]);
    }
    if (lane >= 0) {
      lanes[lane].push(item);
      items.push({ ...item, lane, side });
    } else {
      const bucketWidth = width / Math.max(1, Math.floor(width / 90));
      const bucket = Math.min(Math.floor(item.anchor / bucketWidth), Math.ceil(width / bucketWidth) - 1);
      if (!dense[side].has(bucket)) dense[side].set(bucket, { side, x: (bucket + .5) * bucketWidth, rows: [] });
      dense[side].get(bucket).rows.push(item.row);
    }
  }
  return { items, clusters: [...dense.work.values(), ...dense.knowledge.values()],
    workLanes: tracks.work.length, knowledgeLanes: tracks.knowledge.length };
}

export function timelineTicks(left, right, width) {
  const major = ticks(left, right, width);
  const step = major[1] - major[0];
  const spacing = step / (right - left) * width;
  const minor = [];
  if (Number.isFinite(step) && step >= 2 && spacing >= 75) {
    const stepMinor = step % 5 === 0 ? step / 5 : step % 2 === 0 ? step / 2 : step;
    for (let year = Math.ceil(left / stepMinor) * stepMinor; year <= right; year += stepMinor) {
      if (year % step !== 0) minor.push(year);
    }
  }
  return { major, minor };
}

export function groupMapPoints(rows, map, radius = 38) {
  const buckets = new Map();
  for (const row of rows) {
    const point = map.project([row.longitude, row.latitude]);
    const x = Math.floor(point.x / radius);
    const y = Math.floor(point.y / radius);
    const key = x + ':' + y;
    if (!buckets.has(key)) buckets.set(key, { key, rows: [] });
    buckets.get(key).rows.push(row);
  }
  return [...buckets.values()];
}
