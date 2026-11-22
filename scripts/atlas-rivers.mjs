const names = new Map([
  ['Yangtze', '长江'], ['Jinsha', '金沙江'], ['Yellow', '黄河'], ['Huang', '黄河'],
  ['Mekong', '湄公河'], ['Hongshui', '红水河'], ['Han', '汉江'], ['Dadu', '大渡河'],
]);

export function prepareRivers(data) {
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid rivers GeoJSON');
  return {
    type: 'FeatureCollection',
    features: data.features.filter(({ properties, geometry }) => properties.featurecla === 'River' &&
      geometry && Number.isFinite(properties.scalerank) && properties.scalerank <= 6).map(feature => {
      const { name, name_en, scalerank, min_label } = feature.properties;
      const label = names.get(name) ?? names.get(name_en) ?? name_en ?? name ?? '';
      return { type: 'Feature', geometry: feature.geometry, properties: {
        name: label, rank: scalerank, labelZoom: Math.max(4, min_label ?? 5),
      } };
    }),
  };
}
