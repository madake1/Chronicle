import { searchKey } from '../public/atlas/data.mjs';

export function buildPolityNames(history, features, encyclopedia, overrides) {
  return Object.fromEntries(Object.entries(history.groups).map(([key, records]) => {
    const rows = records.map(record => features[record.sourceIndex].properties);
    const first = rows[0];
    const local = overrides.find(override => override.seshatId === first.SeshatID &&
      override.originalNames.includes(first.Name) &&
      (!override.wikidata || rows.every(row => row.Wikidata === override.wikidata)));
    const verified = [...new Set(records.map(record => encyclopedia.byRecord[record.sourceIndex]))]
      .map(id => encyclopedia.entities[id]).filter(Boolean);
    const chinese = local?.displayName ?? verified.find(item => item.zh)?.zh;
    const url = local?.wikipedia?.zh ?? verified.find(item => item.url?.startsWith('https://zh.wikipedia.org/wiki/'))?.url ??
      local?.wikipedia?.en ?? verified.find(item => item.url?.startsWith('https://en.wikipedia.org/wiki/'))?.url;
    const aliases = [...new Set([
      first.Name, ...rows.map(row => row.Wikipedia?.replaceAll('_', ' ')),
      ...verified.map(item => item.zh), ...(local?.aliases ?? []), chinese,
    ].filter(Boolean).map(searchKey))];
    return [key, { name: chinese ?? first.Name, chinese: Boolean(chinese), url,
      composite: rows.every(row => Boolean(row.Components)), aliases }];
  }));
}
