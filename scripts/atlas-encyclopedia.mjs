const itemId = /^Q[1-9][0-9]*$/;
const titleKey = title => title.replaceAll('_', ' ').trim();
const article = (language, title) =>
  `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;

async function query(host, params) {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ format: 'json', maxlag: '5', ...params });
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ChronicleAtlas/1.0 (https://github.com/madake1/Chronicle)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${host}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`${host}: ${data.error.info}`);
  return data;
}

async function inBatches(values, action) {
  const unique = [...new Set(values)].sort();
  for (let i = 0; i < unique.length; i += 30) await action(unique.slice(i, i + 30).join('|'));
}

async function resolvePages(titles) {
  const pages = new Map();
  await inBatches(titles, async batch => {
    const { query: result } = await query('en.wikipedia.org', {
      action: 'query', prop: 'pageprops|langlinks', ppprop: 'wikibase_item|disambiguation',
      lllang: 'zh', lllimit: 'max', redirects: '1', formatversion: '2', titles: batch,
    });
    const canonical = new Map(result.pages.filter(page => page.ns === 0 &&
      !page.missing && page.pageprops?.disambiguation === undefined).map(page => [titleKey(page.title), page]));
    const aliases = new Map([...result.normalized ?? [], ...result.redirects ?? []]
      .map(({ from, to, tofragment }) => [titleKey(from), { title: titleKey(to), fragment: tofragment }]));
    for (const title of batch.split('|')) {
      let key = titleKey(title);
      let fragment;
      const seen = new Set();
      while (aliases.has(key) && !seen.has(key)) {
        seen.add(key);
        const alias = aliases.get(key);
        fragment ||= alias.fragment;
        key = alias.title;
      }
      const page = canonical.get(key);
      if (page) pages.set(title, { ...page, fragment });
    }
  });
  return pages;
}

async function resolveItems(ids) {
  const items = new Map();
  await inBatches(ids, async batch => {
    const result = await query('www.wikidata.org', {
      action: 'wbgetentities', props: 'sitelinks|labels', languages: 'zh-hans|zh',
      sitefilter: 'zhwiki|enwiki', redirects: 'yes', ids: batch,
    });
    for (const item of Object.values(result.entities)) {
      if (!Object.hasOwn(item, 'missing') && itemId.test(item.id)) items.set(item.id, item);
    }
    for (const { from, to } of result.redirects ?? []) {
      if (items.has(to)) items.set(from, items.get(to));
    }
  });
  return items;
}

export async function buildEncyclopedia(records) {
  const pages = await resolvePages(records.map(record => record.Wikipedia)
    .filter(title => typeof title === 'string' && title.trim() && !title.includes('|')));
  const ids = records.flatMap(record => [record.Wikidata, pages.get(record.Wikipedia)?.pageprops?.wikibase_item])
    .filter(id => itemId.test(id));
  const items = await resolveItems(ids);
  const entities = {};
  const byRecord = {};
  for (const { sourceIndex, Wikipedia, Wikidata } of records) {
    const page = pages.get(Wikipedia);
    const pageItem = items.get(page?.pageprops?.wikibase_item);
    const item = page && !page.fragment ? pageItem : items.get(Wikidata);
    const zh = (page?.fragment ? undefined : page?.langlinks?.find(link => link.lang === 'zh')?.title) ??
      item?.sitelinks?.zhwiki?.title;
    const en = page?.title ?? item?.sitelinks?.enwiki?.title;
    if (!zh && !en && !item) continue;
    const key = item?.id ?? `enwiki:${page.pageid}${page.fragment ? `#${page.fragment}` : ''}`;
    const chineseLabel = item?.labels?.['zh-hans']?.value ?? item?.labels?.zh?.value ?? zh;
    const url = zh ? article('zh', zh) : en ? article('en', en) +
      (page?.fragment ? `#${encodeURIComponent(page.fragment)}` : '') : `https://www.wikidata.org/wiki/${item.id}`;
    const priority = zh ? 3 : en ? 2 : 1;
    if (!entities[key] || entities[key].priority < priority) {
      entities[key] = { zh: chineseLabel, url, priority };
    }
    byRecord[sourceIndex] = key;
  }
  for (const value of Object.values(entities)) delete value.priority;
  return { byRecord, entities };
}
