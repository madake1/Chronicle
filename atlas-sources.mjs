export const atlasYears = [-431, 1066, 1191, 1453];

const cliopatria = 'https://github.com/Seshat-Global-History-Databank/cliopatria';
const naturalEarth = 'https://github.com/nvkelso/natural-earth-vector';
const naturalEarthRaw = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';

export const atlasSources = {
  cliopatria: {
    name: 'Cliopatria · Seshat Global History Databank',
    version: 'v0.2.1',
    source: `${cliopatria}/releases/tag/v0.2.1`,
    citation: 'Bennett et al. (2025), Scientific Data 12, 247. DOI: 10.1038/s41597-025-04516-9',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    download: 'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.1/cliopatria.geojson.zip',
    changes: 'Indexed POLITY records by inclusive source years; identical geometries are stored once.',
  },
  naturalEarth: {
    name: 'Natural Earth',
    version: 'v5.1.2 · 1:110m / 1:50m / 1:10m · 自然地理',
    source: `${naturalEarth}/tree/v5.1.2`,
    license: 'Public domain',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    downloads: {
      land: `${naturalEarthRaw}ne_110m_land.geojson`,
      lakes: `${naturalEarthRaw}ne_110m_lakes.geojson`,
      rivers: `${naturalEarthRaw}ne_50m_rivers_lake_centerlines.geojson`,
    },
    detailBase: naturalEarthRaw,
    changes: 'Selected physical layers; coordinates rounded to four decimal places.',
  },
};
