import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { atomicWrite } from '../atomic-write.mjs';
import { mergeEventDatasets } from '../public/atlas/event-data.mjs';

const retrievedOn = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn ?? '')) throw new Error('用法：node scripts/update-noaa-catalog.mjs YYYY-MM-DD');
const path = new URL(`../atlas-data/raw/noaa-${retrievedOn}/`, import.meta.url);
const output = new URL('../atlas-data/events-catalog/', import.meta.url);
const read = async url => JSON.parse(await readFile(url, 'utf8'));
const curl = promisify(execFile);
const endpoint = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes?minYear=-3400&maxYear=2024';
await mkdir(path, { recursive: true });
await mkdir(output, { recursive: true });

async function page(number) {
  const file = new URL(`page-${number}.json`, path);
  try {
    return await read(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { stdout } = await curl('curl.exe', ['-fsSL', '--retry', '4', '--max-time', '35', `${endpoint}&page=${number}`]);
  const data = JSON.parse(stdout);
  if (!Array.isArray(data.items) || !Number.isSafeInteger(data.totalItems)) throw new Error(`无效 NOAA 分页：${number}`);
  await atomicWrite(file, stdout);
  return data;
}

const first = await page(1);
const { totalItems } = first;
const pages = Math.ceil(totalItems / first.items.length);
if (!Number.isSafeInteger(pages) || pages < 1) throw new Error('无法确定 NOAA 页数');
const snapshots = [first];
for (let start = 2; start <= pages; start += 4) {
  const count = Math.min(4, pages - start + 1);
  snapshots.push(...await Promise.all(Array.from({ length: count }, (_, i) => page(start + i))));
  console.log(`NOAA 快照 ${snapshots.length}/${pages} 页`);
}
const rows = snapshots.flatMap(value => value.items);
if (snapshots.some(({ totalItems: total }) => total !== totalItems) || rows.length !== totalItems ||
    new Set(rows.map(row => row.id)).size !== totalItems) throw new Error('NOAA 分页总数或唯一编号不一致');

const featured = await read(new URL('../public/atlas/events-noaa.json', import.meta.url));
const featuredIds = new Set(featured.events.map(event => Number(event.provenance.id)));
const events = [];
const outcomes = [];
for (const row of rows) {
  const { id, year, country, locationName, longitude, latitude, month, day, eqMagnitude } = row;
  let status = 'added';
  let reason;
  if (!Number.isSafeInteger(id) || row.publish !== true || year < -3400 || year > 2024) status = 'excluded';
  else if (!Number.isInteger(year) || !year) {
    status = 'deferred';
    reason = '缺少可表达的非零年份';
  } else if (featuredIds.has(id)) status = 'matched';
  outcomes.push({ id, year, status, ...(reason && { reason }) });
  if (status !== 'added') continue;
  const placeName = locationName?.trim().replace(/\s+/g, ' ') || country?.trim();
  const mapped = Boolean(placeName) && year >= 1900 && Number.isFinite(longitude) && Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 && Math.abs(latitude) <= 85 && (longitude !== 0 || latitude !== 0);
  const fullDate = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31;
  const historical = year < 0 || !fullDate;
  events.push({
    id: `noaa-earthquake-${id}`, name: placeName ? `${placeName} · 地震` : `NOAA 地震 #${id}`,
    startYear: year, endYear: year, datePrecision: historical ? 'reported-year' : 'year',
    ...(historical && { dateLabel: year < 0 ? '目录记载年份，年代未独立核定' : '目录仅提供年或不完整日期' }),
    category: 'disaster', quality: 'catalogue',
    description: ['NOAA 显著地震记录。', fullDate && `目录日期 ${month} 月 ${day} 日。`,
      Number.isFinite(eqMagnitude) && `目录震级 ${eqMagnitude}。`].filter(Boolean).join(''),
    ...(placeName && { placeName }), ...(country?.trim() && { region: country.trim() }),
    ...(mapped && { location: [longitude, latitude] }),
    provenance: {
      dataset: 'NOAA NCEI · Global Significant Earthquake Database', id: String(id), retrievedOn,
      upstreamPrecision: fullDate ? 'day' : month ? 'month' : 'year',
      locationBasis: mapped ? 'NOAA 目录报告的震中，未经逐条独立复核' : '保留目录地名，未采用缺失或未经复核的历史点位',
    },
    sources: [{ title: `NOAA NCEI 显著地震目录 · ${id}`,
      url: `https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/event-more-info/${id}` }],
  });
}
const dataset = { version: `NOAA HazEL ${retrievedOn}`, events };
mergeEventDatasets(featured, dataset);
const count = status => outcomes.filter(row => row.status === status).length;
const byRegion = {};
for (const event of events) {
  const region = event.region ?? '未标地区';
  byRegion[region] = (byRegion[region] ?? 0) + 1;
}
const report = { retrievedOn, endpoint, totalItems, pages, added: count('added'), matched: count('matched'),
  deferred: count('deferred'), excluded: count('excluded'), mapped: events.filter(event => event.location).length,
  byCategory: { disaster: events.length }, byRegion };
await atomicWrite(new URL('noaa.json', output), JSON.stringify(dataset));
await atomicWrite(new URL('outcomes.json', path), JSON.stringify({ ...report, outcomes }));
console.log(JSON.stringify(report));
