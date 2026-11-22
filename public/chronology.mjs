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

export function describe(segment) {
  const { kind, start, end, confidence } = segment;
  const date = kind === 'point' ? formatYear(start) : `${formatYear(start)} — ${formatYear(end)}`;
  if (kind === 'window') return `${date}（可能发生范围）`;
  return confidence === '确定' ? date : `${date}（${confidence}）`;
}
