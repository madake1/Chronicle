export function parseYear(input) {
  const match = String(input).trim().match(/^(?:(公元前|公元)\s*)?(-?\d+)\s*(?:年)?$/u);
  if (!match) throw new Error('请输入年份，例如 公元前431 或 1191');
  const year = Number(match[2]);
  if (!year || Math.abs(year) > 100000 || (match[1] && year < 0)) {
    throw new Error('年份须在公元前 100000 年至公元 100000 年之间，且没有公元 0 年');
  }
  return match[1] === '公元前' ? 1 - year : year < 0 ? 1 + year : year;
}

export function formatYear(year) {
  return year < 1 ? `公元前 ${1 - year} 年` : `${year} 年`;
}

export function timelineBounds(segments = []) {
  let left = parseYear('公元前3000');
  let right = 2100;
  for (const { start, end = start } of segments) {
    if (start < left) left = start;
    if (end > right) right = end;
  }
  return [left, right];
}

export function constrainView([left, right], [minimum, maximum]) {
  const width = Math.min(maximum - minimum, right - left);
  const nextLeft = Math.max(minimum, Math.min(maximum - width, left));
  return [nextLeft, nextLeft + width];
}

export function zoomView([left, right], factor, fraction, bounds = timelineBounds()) {
  const span = right - left;
  const width = Math.min(bounds[1] - bounds[0], Math.max(2, span * factor));
  const anchor = left + span * fraction;
  const nextLeft = anchor - width * fraction;
  return constrainView([nextLeft, nextLeft + width], bounds);
}

export function ticks(left, right, width) {
  const ideal = Math.max(1, (right - left) * 125 / width);
  const magnitude = 10 ** Math.floor(Math.log10(ideal));
  const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= ideal);
  const result = [];
  for (let year = Math.ceil(left / step) * step; year <= right; year += step) {
    result.push(year);
  }
  return result;
}

export function formatSegmentYears({ kind, start, end }) {
  return kind === 'point' ? formatYear(start) : `${formatYear(start)} — ${formatYear(end)}`;
}

export function describe(segment) {
  const { kind, confidence } = segment;
  const date = formatSegmentYears(segment);
  if (kind === 'window') return `${date}（可能发生范围）`;
  return confidence === '确定' ? date : `${date}（${confidence}）`;
}
