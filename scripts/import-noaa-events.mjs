import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { atomicWrite } from '../atomic-write.mjs';
import { validateEventDataset } from '../public/atlas/event-data.mjs';

export function importNoaaSample(sample, snapshots) {
  const rows = new Map();
  const reviewed = new Set(sample.events.map(row => row.id));
  for (const { items } of snapshots) {
    for (const row of items) {
      if (!reviewed.has(row.id)) continue;
      const previous = rows.get(row.id);
      if (previous && ['year', 'month', 'day', 'longitude', 'latitude', 'eqMagnitude', 'publish']
        .some(key => previous[key] !== row[key])) throw new Error(`NOAA 记录存在冲突：${row.id}`);
      rows.set(row.id, row);
    }
  }
  const events = sample.events.map(({ id, name, placeName, mapEpicenter }) => {
    const row = rows.get(id);
    if (!row || row.publish !== true) throw new Error(`找不到 NOAA 已公开记录：${id}`);
    const { year, month, day, longitude, latitude, eqMagnitude } = row;
    const historical = year < 0;
    const date = month && day ? `${month} 月 ${day} 日` : '';
    const description = [
      `NOAA NCEI 显著地震目录收录的${placeName}地震。`,
      date && `目录记载日期为 ${date}。`,
      Number.isFinite(eqMagnitude) && `目录所列震级为 ${eqMagnitude}。`,
    ].filter(Boolean).join('');
    return {
      id: `noaa-earthquake-${id}`, name, startYear: year, endYear: year,
      datePrecision: historical ? 'reported-year' : 'year',
      ...(historical && { dateLabel: '目录记载年份，年代未独立核定' }),
      category: 'disaster', description, placeName,
      ...(mapEpicenter && { location: [longitude, latitude] }),
      provenance: {
        dataset: 'NOAA NCEI · Global Significant Earthquake Database',
        id: String(id), retrievedOn: sample.retrievedOn,
        upstreamPrecision: date ? 'day' : 'year',
        locationBasis: mapEpicenter ? 'NOAA 目录震中坐标' : '采用目录地区描述，未采用目录代表点作为震中',
      },
      sources: [{
        title: `NOAA NCEI · 显著地震目录第 ${id} 条`,
        url: `https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/event-more-info/${id}`,
      }],
    };
  });
  const dataset = { version: `NOAA 样本 ${sample.retrievedOn}`, events };
  validateEventDataset(dataset);
  return dataset;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error('用法：node scripts/import-noaa-events.mjs <HazEL JSON> [...]');
  const read = async file => JSON.parse(await readFile(file, 'utf8'));
  const sample = await read(new URL('../atlas-events/noaa-sample.json', import.meta.url));
  const dataset = importNoaaSample(sample, await Promise.all(paths.map(read)));
  const target = new URL('../public/atlas/events-noaa.json', import.meta.url);
  const json = JSON.stringify(dataset, null, 2) + '\n';
  const previous = await readFile(target, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (previous !== json) await atomicWrite(target, json);
  console.log(`NOAA 样本：${dataset.events.length} 条（${previous === json ? '内容一致' : '已写入'}）`);
}
