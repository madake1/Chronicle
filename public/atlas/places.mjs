import { formatYear } from '../chronology.mjs';
import { searchKey } from './data.mjs';
import { sourceYearToAxis } from './years.mjs';

export function includesYear(period, year) {
  return sourceYearToAxis(period.fromYear) <= year && year <= sourceYearToAxis(period.toYear);
}

function coverageOf(place) {
  return place.coverage ?? (place.attested ? [place.attested] : []);
}

export function placeAt(place, year) {
  const coverage = coverageOf(place).find(period => includesYear(period, year));
  const names = place.names.filter(period => includesYear(period, year));
  const name = names.find(item => /^zh(?:-|$)/i.test(item.language ?? '')) ?? names[0];
  return { place, coverage, name,
    role: place.roles.find(period => includesYear(period, year)) };
}

export function placesAt(places, year, zoom) {
  return places.filter(place => zoom >= place.minZoom).map(place => placeAt(place, year))
    .filter(item => item.coverage)
    .sort((a, b) => a.place.minZoom - b.place.minZoom || Number(Boolean(b.role)) - Number(Boolean(a.role)));
}

export function placePeriod(period) {
  const from = formatYear(sourceYearToAxis(period.fromYear));
  const to = formatYear(sourceYearToAxis(period.toYear));
  const label = from === to ? from : `${from} 至 ${to}`;
  return period.approximate ? `约 ${label}` : label;
}

export function createPlaceSearch(places) {
  const entries = places.map(place => ({ place, aliases: [place.name, place.originalName,
    ...(place.aliases ?? []), ...place.names.flatMap(name => [name.name, name.original, ...(name.aliases ?? [])])]
    .filter(Boolean).map(searchKey) }));
  return (query, year) => {
    const key = searchKey(query);
    if (!key) return [];
    return entries.flatMap(({ place, aliases }) => {
      const rank = Math.min(...aliases.map(alias =>
        alias === key ? 0 : alias.startsWith(key) ? 1 : alias.includes(key) ? 2 : Infinity));
      return Number.isFinite(rank) ? [{ ...placeAt(place, year), dates: coverageOf(place), rank }] : [];
    }).sort((a, b) => Number(Boolean(b.coverage)) - Number(Boolean(a.coverage)) || a.rank - b.rank ||
      a.place.minZoom - b.place.minZoom || a.place.name.localeCompare(b.place.name, 'zh-CN'));
  };
}

export function bindPlaceSearch(search, currentYear, locate) {
  const input = document.querySelector('#atlas-place-input');
  const list = document.querySelector('#atlas-place-list');
  const results = document.querySelector('#atlas-place-results');
  const status = document.querySelector('#atlas-place-status');
  let request = 0;
  let timer;
  async function render(focus = false) {
    clearTimeout(timer);
    const id = ++request;
    const query = input.value.trim();
    results.hidden = !query;
    list.replaceChildren();
    if (!query) return;
    status.textContent = '正在搜索地点…';
    let matches, total;
    try {
      ({ items: matches, total } = await search(query, currentYear()));
    } catch {
      if (id === request) status.textContent = '地点搜索暂不可用，请重试';
      return;
    }
    if (id !== request || results.hidden) return;
    status.textContent = total ? (total > 10 ? `显示前 10 项，共 ${total} 项` : '')
      : '没有匹配的地点';
    for (const item of matches.slice(0, 10)) {
      const row = document.createElement('li');
      const label = item.name?.name ?? item.place.name;
      function action(title, detail, year) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = title;
        const meta = document.createElement('small');
        meta.textContent = detail;
        button.append(meta);
        button.onclick = async () => {
          results.hidden = true;
          input.focus();
          await locate(item.place, year);
        };
        return button;
      }
      if (item.coverage) {
        row.append(action(label, `${item.place.type} · 当前年份可定位`, currentYear()));
      } else if (item.dates.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `${label} · 查看有资料的年代`;
        details.append(summary);
        for (const period of item.dates) {
          if (period.available === false) {
            const unavailable = document.createElement('small');
            unavailable.textContent = `${placePeriod(period)} · 超出地图可选年份`;
            details.append(unavailable);
          } else {
            details.append(action(period.label ?? label, placePeriod(period), period.targetYear));
          }
        }
        row.append(details);
      } else {
        row.append(action(label, `${item.place.type} · 参考地点`, undefined));
      }
      list.append(row);
    }
    if (focus) list.querySelector('button, summary')?.focus();
  }
  input.disabled = false;
  input.addEventListener('input', () => {
    ++request;
    clearTimeout(timer);
    results.hidden = true;
    timer = setTimeout(render, 120);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      clearTimeout(timer);
      ++request;
      results.hidden = true;
    }
  });
  document.querySelector('#atlas-place-search').onsubmit = event => {
    event.preventDefault();
    void render(true);
  };
  return () => { if (!results.hidden) render(); };
}
