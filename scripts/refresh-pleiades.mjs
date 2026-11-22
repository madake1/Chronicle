import { atomicWrite } from '../note-storage.mjs';

const selected = [
  { id: '579885', name: '雅典', types: '城邦', aliases: ['Athens', 'Athenai'], original: 'Ἀθῆναι', minZoom: 0 },
  { id: '423025', name: '罗马', types: '历史城市', aliases: ['Rome'], original: 'Roma', minZoom: 0 },
  { id: '570182', name: '科林斯', types: '城邦', aliases: ['Corinth', 'Korinthos'], original: 'Κόρινθος', minZoom: 4 },
  { id: '462503', name: '叙拉古', types: '城邦', aliases: ['Syracuse', 'Syracusae'], original: 'Συράκουσαι', minZoom: 3.5 },
];
const dataset = { name: 'Pleiades · 地中海精选', version: new Date().toISOString().slice(0, 10) + ' 单条记录摘录',
  source: 'https://pleiades.stoa.org/downloads', license: 'CC BY 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
  changes: '精选条目、坐标四舍五入、添加中文名称和缩放级别。' };
const pack = { dataset, places: [], sources: {} };
for (const item of selected) {
  const url = `https://pleiades.stoa.org/places/${item.id}`;
  const response = await fetch(`${url}/json`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const record = await response.json();
  const name = record.names.find(entry => entry.attested === item.original &&
    Number.isInteger(entry.start) && Number.isInteger(entry.end));
  const sourceId = `pleiades-${item.id}`;
  if (!name) throw new Error(`Review name selection: ${url}`);
  const credits = [...record.creators, ...record.contributors].map(person => person.name).filter(Boolean);
  pack.sources[sourceId] = { title: `Pleiades · ${record.title}`, url,
    version: record.history[0]?.modified, license: dataset.license, credits: [...new Set(credits)] };
  const period = { fromYear: name.start, toYear: name.end, sourceId };
  pack.places.push({ id: sourceId, name: item.name, type: item.types, aliases: item.aliases,
    coordinates: record.reprPoint.map(value => Math.round(value * 10000) / 10000),
    minZoom: item.minZoom, coverage: [period], names: [{ name: item.name, original: name.attested, ...period }],
    roles: [], sourceIds: [sourceId], confidence: '年代采用 Pleiades 所列地名资料范围。点位为代表位置。' });
}
await atomicWrite(new URL('../atlas-places/pleiades.json', import.meta.url), JSON.stringify(pack, null, 2) + '\n');
