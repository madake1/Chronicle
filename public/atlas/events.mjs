import { formatYear } from '../chronology.mjs';
import { createEventIndex, eventCategories, eventRegions, eventSource, eventYears, groupEventMarkers } from './event-data.mjs';
import { readPlaceApi } from './place-api.mjs';
import { placePopup } from './geography.mjs';
import { placeAt } from './places.mjs';

function element(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function button(label, action) {
  const node = element('button', label);
  node.type = 'button';
  node.onclick = action;
  return node;
}

const metadata = event => [eventYears(event), eventCategories[event.category], event.placeName,
  event.quality === 'catalogue' && eventSource(event)].filter(Boolean).join(' · ');

export function bindEvents(map, Marker, dataset, closePlace) {
  const findEvents = createEventIndex(dataset);
  const toggle = document.querySelector('#atlas-show-events');
  const section = document.querySelector('#atlas-events');
  const category = document.querySelector('#atlas-event-category');
  const scope = document.querySelector('#atlas-event-scope');
  const region = document.querySelector('#atlas-event-region');
  const regionControl = document.querySelector('#atlas-event-region-control');
  const source = document.querySelector('#atlas-event-source');
  const mapped = document.querySelector('#atlas-event-mapped');
  const catalogueControls = [regionControl, document.querySelector('#atlas-event-source-control'),
    document.querySelector('#atlas-event-mapped-control')];
  const more = document.querySelector('#atlas-event-more');
  const search = document.querySelector('#atlas-event-search');
  const status = document.querySelector('#atlas-event-status');
  const list = document.querySelector('#atlas-event-list');
  const panel = document.querySelector('#atlas-event-panel');
  const content = document.querySelector('#atlas-event-content');
  const markers = new Map();
  let year;
  let visible = [];
  let selected;
  let parentGroup;
  let returnToEvent;
  let placeRequest = 0;
  let catalogue;
  let catalogueRequest;
  let limit = 60;

  category.append(...Object.entries(eventCategories).map(([id, label]) => new Option(label, id)));
  toggle.disabled = category.disabled = search.disabled = scope.disabled = false;
  section.hidden = false;

  function highlight() {
    for (const row of list.children) {
      row.firstElementChild.setAttribute('aria-pressed', String(row.dataset.eventId === selected?.id));
    }
  }

  function close() {
    ++placeRequest;
    selected = undefined;
    parentGroup = undefined;
    returnToEvent = undefined;
    panel.hidden = true;
    content.replaceChildren();
    highlight();
  }

  function backButton(label, action) {
    const back = button(label, action);
    back.className = 'atlas-event-back';
    return back;
  }

  function open(event, pan, group) {
    closePlace();
    ++placeRequest;
    selected = event;
    parentGroup = group;
    returnToEvent = undefined;
    const title = element('h2', event.name);
    title.tabIndex = -1;
    content.replaceChildren(title, element('p', metadata(event), 'meta'), element('p', event.description));
    if (group) content.prepend(backButton('← 返回邻近事件', () => choose(group, event)));
    if (!event.location) content.append(element('p', '没有可用于本事件的可靠地图点位。', 'meta'));
    if (event.provenance) {
      const { dataset, id, retrievedOn, locationBasis } = event.provenance;
      content.append(element('p', `${dataset} · ${id} · 获取于 ${retrievedOn}`, 'meta'),
        element('p', `定位依据 · ${locationBasis}`, 'meta'));
    }
    if (event.placeId) {
      const placeStatus = element('p', '', 'meta');
      placeStatus.setAttribute('role', 'status');
      const locate = button('查看关联地点', async () => {
        const request = ++placeRequest;
        locate.disabled = true;
        try {
          const { place, sources } = await readPlaceApi('detail', { id: event.placeId });
          if (request === placeRequest) {
            const camera = { center: map.getCenter(), zoom: map.getZoom() };
            returnToEvent = () => {
              map.stop();
              map.jumpTo(camera);
              open(event, false, group);
              content.querySelector('#atlas-event-related-place')?.focus({ preventScroll: true });
            };
            content.replaceChildren();
            placePopup(placeAt(place, year), sources, content);
            content.prepend(backButton('← 返回事件', returnToEvent));
            content.scrollTop = 0;
            map.stop();
            map.jumpTo({ center: place.coordinates });
            const heading = content.querySelector('h2');
            heading.tabIndex = -1;
            heading.focus({ preventScroll: true });
          }
        } catch {
          if (request === placeRequest) placeStatus.textContent = '本机地点索引暂时无法读取该关联地点。';
        } finally {
          locate.disabled = false;
        }
      });
      locate.id = 'atlas-event-related-place';
      content.append(locate, placeStatus);
    }
    content.append(element('h3', '资料来源'));
    const sources = document.createElement('ul');
    for (const { title, url } of event.sources) {
      const row = document.createElement('li');
      const link = element('a', title);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
      sources.append(row);
    }
    content.append(sources);
    panel.hidden = false;
    content.scrollTop = 0;
    highlight();
    if (pan && event.location) {
      map.stop();
      map.jumpTo({ center: event.location, zoom: Math.max(4, map.getZoom()) });
    }
    title.focus({ preventScroll: !pan });
  }

  function eventButton(event, pan, group) {
    const action = button(event.name, () => open(event, pan, group));
    action.append(element('small', metadata(event)));
    return action;
  }

  function choose(group, previous) {
    if (group.length === 1) {
      open(group[0], false);
      return;
    }
    closePlace();
    close();
    parentGroup = group;
    const title = element('h2', `${group.length} 项邻近事件`);
    title.tabIndex = -1;
    const choices = element('ul', '', 'atlas-event-choices');
    for (const event of group) {
      const row = document.createElement('li');
      const action = eventButton(event, false, group);
      if (event === previous) action.dataset.previous = 'true';
      row.append(action);
      choices.append(row);
    }
    content.append(title, choices);
    panel.hidden = false;
    content.scrollTop = 0;
    (choices.querySelector('[data-previous]') ?? title).focus({ preventScroll: true });
  }

  function drawMarkers() {
    const canvas = map.getCanvas();
    const groups = toggle.checked
      ? groupEventMarkers(visible, coordinate => map.project(coordinate), canvas.clientWidth, canvas.clientHeight)
      : [];
    const keys = new Set();
    for (const { location, events } of groups) {
      const key = events.map(event => event.id).join(',');
      keys.add(key);
      if (markers.has(key)) continue;
      const first = events[0];
      const grouped = events.length > 1;
      const pin = button(grouped ? String(events.length) : '◆', event => {
        event.stopPropagation();
        choose(events);
      });
      pin.className = 'atlas-event-marker';
      pin.dataset.category = grouped ? 'group' : first.category;
      const label = grouped ? `查看 ${events.length} 项邻近事件` : first.name;
      pin.setAttribute('aria-label', label);
      pin.title = label;
      pin.addEventListener('dblclick', event => event.stopPropagation());
      markers.set(key, new Marker({ element: pin }).setLngLat(location).addTo(map));
    }
    for (const [key, marker] of markers) {
      if (keys.has(key)) continue;
      marker.remove();
      markers.delete(key);
    }
  }

  function refresh() {
    const all = scope.value === 'all';
    visible = (all && catalogue ? catalogue : findEvents)(year, category.value, search.value,
      all && catalogue ? region.value : '', all && catalogue ? { source: source.value, mapped: mapped.checked } : undefined);
    if (!panel.hidden && (selected && !visible.includes(selected) ||
        parentGroup?.some(event => !visible.includes(event)))) close();
    list.replaceChildren(...visible.slice(0, limit).map(event => {
      const row = document.createElement('li');
      row.dataset.eventId = event.id;
      row.append(eventButton(event, true));
      return row;
    }));
    more.hidden = visible.length <= limit;
    status.textContent = year === undefined ? '选择对照快照后查看事件' :
      `${formatYear(year)} · ${visible.length ? `${visible.length} 项事件` : '没有匹配的事件'}`;
    highlight();
    drawMarkers();
  }

  function refreshFilters() {
    limit = 60;
    refresh();
  }

  async function loadCatalogue() {
    catalogueRequest?.abort();
    catalogue = undefined;
    refreshFilters();
    const all = scope.value === 'all';
    for (const control of catalogueControls) control.hidden = !all;
    if (!all || year === undefined) return;
    const request = new AbortController();
    catalogueRequest = request;
    status.textContent = `${formatYear(year)} · 正在读取全部事件…`;
    try {
      const response = await fetch(`/api/atlas/events?year=${year}`, { signal: request.signal });
      if (!response.ok) throw new Error('读取失败');
      const { events, sources } = await response.json();
      if (request.signal.aborted) return;
      if (!sources.length) throw new Error('没有本机目录');
      const allEvents = [...findEvents(year), ...events];
      catalogue = createEventIndex({ version: '本机历史事件库', events: allEvents });
      const previous = region.value;
      const regions = new Set(allEvents.flatMap(eventRegions));
      region.replaceChildren(new Option('全部地区', ''), ...[...regions].sort().map(name => new Option(name, name)));
      region.value = regions.has(previous) ? previous : '';
      const previousSource = source.value;
      const availableSources = new Set(allEvents.map(eventSource));
      source.replaceChildren(new Option('全部来源', ''), ...[...availableSources].sort().map(name => new Option(name, name)));
      source.value = availableSources.has(previousSource) ? previousSource : '';
      refreshFilters();
    } catch {
      if (request.signal.aborted) return;
      status.textContent = `${formatYear(year)} · 全部事件暂无法读取，当前显示精选`;
    }
  }

  document.querySelector('#atlas-event-close').onclick = close;
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (returnToEvent) returnToEvent();
    else if (selected && parentGroup) choose(parentGroup, selected);
    else close();
  });
  search.addEventListener('input', refreshFilters);
  category.addEventListener('change', refreshFilters);
  region.addEventListener('change', refreshFilters);
  source.addEventListener('change', refreshFilters);
  mapped.addEventListener('change', refreshFilters);
  scope.addEventListener('change', () => {
    close();
    void loadCatalogue();
  });
  more.addEventListener('click', () => {
    limit += 60;
    refresh();
  });
  toggle.addEventListener('change', () => {
    if (!toggle.checked && !selected) close();
    drawMarkers();
  });
  map.on('moveend', drawMarkers);
  map.on('resize', drawMarkers);
  return { close, updateYear(next) {
    if (next === year) return;
    close();
    year = next;
    void loadCatalogue();
  } };
}
