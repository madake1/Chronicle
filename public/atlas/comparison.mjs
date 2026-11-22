import { formatYear } from '../chronology.mjs';
import { sourceYearToAxis } from './years.mjs';

export function matchingSnapshot(snapshots, axisYear) {
  return snapshots.find(snapshot => sourceYearToAxis(snapshot.year) === axisYear);
}

export function bindMapSources(map, readData, currentYear, clearPolity, updatePlaces, palette) {
  const element = id => document.getElementById(id);
  const mode = element('atlas-map-source');
  const choices = element('atlas-snapshot');
  const status = element('atlas-comparison-status');
  const sourceLink = element('atlas-snapshot-source');
  const toolbar = document.querySelector('.atlas-toolbar');
  const snapshotCache = new Map();
  const comparing = () => mode.value === 'comparison';
  let manifest;
  let active;
  let request = 0;

  function visibility(ids, show) {
    for (const id of ids) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
    }
  }

  function syncLayers() {
    const borders = element('atlas-show-borders').checked;
    visibility(['polity-fill', 'polity-line', 'polity-highlight'], borders && !comparing());
    visibility(['comparison-fill', 'comparison-line'], borders && comparing() && Boolean(active));
    visibility(['major-rivers', 'detail-rivers'], element('atlas-show-rivers').checked);
    visibility(['mountains'], element('atlas-show-terrain').checked);
  }

  function updateYear() {
    updatePlaces(comparing() ? active && sourceYearToAxis(active.year) : currentYear());
  }

  async function selectSnapshot(snapshot) {
    const id = ++request;
    active = undefined;
    syncLayers();
    updateYear();
    sourceLink.hidden = true;
    const requested = `所选年份：${formatYear(currentYear())}`;
    if (!snapshot) {
      status.textContent = `${requested} · 请选择要查看的原始快照。`;
      return;
    }

    const label = formatYear(sourceYearToAxis(snapshot.year));
    status.textContent = `${requested} · 正在加载 ${label}快照…`;
    try {
      if (!snapshotCache.has(snapshot.file)) {
        snapshotCache.set(snapshot.file, readData(snapshot.file).then(data => ({
          ...data,
          features: data.features.filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type))
            .map((feature, index) => ({
              ...feature, properties: { color: palette[index % palette.length] },
            })),
        })).catch(error => {
          snapshotCache.delete(snapshot.file);
          throw error;
        }));
      }
      const data = await snapshotCache.get(snapshot.file);
      if (id !== request || !comparing()) return;
      await map.getSource('comparison').setData(data);
      if (id !== request || !comparing()) return;
      active = snapshot;
      syncLayers();
      updateYear();
      sourceLink.href = snapshot.source;
      sourceLink.hidden = false;
      const note = snapshot.year === -2000
        ? ' · 夏朝等疆域为该来源的历史重建示意，存在争议。' : '';
      status.textContent = `${requested} · 实际快照：${label} · Historical Basemaps${note}`;
    } catch {
      if (id === request) status.textContent = `${requested} · 快照无法读取，请重新准备对照数据。`;
    }
  }

  mode.onchange = async () => {
    const comparison = comparing();
    const id = ++request;
    active = undefined;
    toolbar.hidden = comparison;
    element('atlas-snapshot-control').hidden = !comparison;
    element('atlas-comparison-attribution').hidden = !comparison;
    status.hidden = !comparison;
    sourceLink.hidden = true;
    element('atlas-border-legend').lastChild.textContent = comparison
      ? ' Historical Basemaps 快照疆界' : ' Cliopatria 收录的历史疆界';
    map.getCanvas().style.cursor = '';
    clearPolity();
    syncLayers();
    updateYear();
    if (!comparison) return;
    choices.disabled = true;
    status.textContent = '正在读取本地对照资料…';
    try {
      manifest ??= await readData('comparison.json');
      if (id !== request) return;
      const match = matchingSnapshot(manifest.snapshots, currentYear());
      choices.replaceChildren(new Option('选择快照', ''),
        ...manifest.snapshots.map(snapshot => new Option(formatYear(sourceYearToAxis(snapshot.year)), snapshot.file)));
      choices.value = match?.file ?? '';
      choices.disabled = false;
      await selectSnapshot(match);
    } catch {
      if (id === request) status.textContent = '尚未下载对照资料。运行 npm run atlas:prepare -- --with-comparison 后重新打开地图。';
    }
  };
  choices.onchange = () => selectSnapshot(manifest.snapshots.find(snapshot => snapshot.file === choices.value));
  for (const id of ['atlas-show-borders', 'atlas-show-rivers', 'atlas-show-terrain']) {
    element(id).addEventListener('change', () => {
      if (!element('atlas-show-borders').checked) clearPolity();
      syncLayers();
    });
  }
  mode.disabled = false;
  return { comparing, updateYear };
}
