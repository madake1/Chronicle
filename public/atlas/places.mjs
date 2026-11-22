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
  return { place, coverage, name: place.names.find(period => includesYear(period, year)),
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
  return from === to ? from : `${from} 至 ${to}`;
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

export function bindPlaceSearch(places, currentYear, locate) {
  const input = document.querySelector('#atlas-place-input');
  const list = document.querySelector('#atlas-place-list');
  const results = document.querySelector('#atlas-place-results');
  const status = document.querySelector('#atlas-place-status');
  const search = createPlaceSearch(places);
  function render() {
    const query = input.value.trim();
    results.hidden = !query;
    list.replaceChildren();
    const matches = search(query, currentYear());
    status.textContent = matches.length ? (matches.length > 10 ? `显示前 10 项，共 ${matches.length} 项` : '')
      : '没有匹配的历史地点';
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
          const year = Math.max(sourceYearToAxis(period.fromYear), Math.min(currentYear(), sourceYearToAxis(period.toYear)));
          const historicalName = placeAt(item.place, year).name?.name ?? label;
          details.append(action(historicalName, placePeriod(period), year));
        }
        row.append(details);
      } else {
        row.append(action(label, '参考地点 · 年代未核实', undefined));
      }
      list.append(row);
    }
  }
  input.disabled = false;
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') results.hidden = true;
  });
  document.querySelector('#atlas-place-search').onsubmit = event => {
    event.preventDefault();
    render();
    list.querySelector('button, summary')?.focus();
  };
  return () => { if (!results.hidden) render(); };
}
