import { prepareRivers } from './atlas-rivers.mjs';

const rounded = value => Array.isArray(value) ? value.map(rounded) : Math.round(value * 10_000) / 10_000;

function physicalCollection(data, keepProperties = false) {
  return { type: 'FeatureCollection', features: data.features.map(({ geometry, properties }) => ({
    type: 'Feature', geometry: { type: geometry.type, coordinates: rounded(geometry.coordinates) },
    properties: keepProperties ? properties : {},
  })) };
}

const names = [
  [/^himalaya/i, '喜马拉雅山'],
  [/^(the |european )?alps$/i, '阿尔卑斯山'],
  [/^(qin|tsin)[ -]?ling/i, '秦岭'],
];

export async function prepareGeography(sourceFile, save, base, digest) {
  const checksums = {};
  async function get(filename) {
    const bytes = await sourceFile(`natural-earth-v5.1.2-${filename}`, base + filename);
    checksums[filename] = digest(bytes);
    return JSON.parse(bytes);
  }
  for (const scale of [50, 10]) {
    const [land, lakes, rivers] = await Promise.all(['land', 'lakes', 'rivers_lake_centerlines']
      .map(layer => get(`ne_${scale}m_${layer}.geojson`)));
    await save(`geography-${scale}.json`, {
      land: physicalCollection(land), lakes: physicalCollection(lakes),
      rivers: physicalCollection(prepareRivers(rivers), true),
    });
  }
  const regions = await get('ne_10m_geography_regions_polys.geojson');
  const features = [];
  const labels = [];
  for (const { geometry, properties } of regions.features) {
    const match = names.find(([pattern]) => pattern.test(properties.NAME));
    if (!match) continue;
    const points = geometry.coordinates.flat(geometry.type === 'MultiPolygon' ? 2 : 1);
    const midpoint = axis => {
      const values = points.map(point => point[axis]);
      return (Math.min(...values) + Math.max(...values)) / 2;
    };
    labels.push({ name: match[1], position: rounded([midpoint(0), midpoint(1)]), minZoom: 3.5 });
    features.push({ geometry, properties: {} });
  }
  await save('mountains.json', { labels, areas: physicalCollection({ features }) });
  return { checksums };
}
