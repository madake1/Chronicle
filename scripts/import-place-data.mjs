import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';

const types = [
  [/settlement|inhabited place|city|cities|town|village|hamlet|polis|port/i, '历史聚落', 3.5],
  [/archaeolog|ruin|tumulus|burial|cemetery|sanctuary|temple|site|fort|castle/i, '历史遗址', 5],
];
const safePoint = point => Array.isArray(point) && point.length >= 2 &&
  point.slice(0, 2).every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const https = value => typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value) ? value : undefined;

function period(fromYear, toYear, context = {}) {
  return Number.isSafeInteger(fromYear) && Number.isSafeInteger(toYear) && fromYear !== 0 &&
    toYear !== 0 && fromYear <= toYear ? { fromYear, toYear, ...context } : null;
}

function pleiadesPeriod(entry) {
  return period(entry.start, entry.end, { periods: (entry.attestations ?? []).map(item => ({
    label: item.timePeriod, confidence: item.confidence,
  })) });
}

export function fromPleiades(record) {
  if (!/^\d+$/.test(record.id ?? '')) return null;
  const pointIds = new Set((record.features ?? []).filter(feature =>
    feature.properties?.location_precision === 'precise' && feature.geometry?.type === 'Point' &&
    safePoint(feature.geometry.coordinates)).map(feature => feature.id));
  const points = (record.locations ?? []).filter(location => pointIds.has(location.id) &&
    location.associationCertainty === 'certain' &&
    !/openstreetmap|geonames/i.test(JSON.stringify([location.provenance, location.accuracy, location.references])));
  const point = points.find(location => (location.attestations ?? []).some(entry =>
    entry.confidence === 'confident' && entry.timePeriod !== 'modern')) ?? points[0];
  const coordinates = (record.features ?? []).find(feature => feature.id === point?.id)?.geometry.coordinates;
  const samePoint = points.filter(location => {
    const other = record.features.find(feature => feature.id === location.id)?.geometry.coordinates;
    return other?.[0] === coordinates?.[0] && other?.[1] === coordinates?.[1] &&
      location.attestations?.length;
  });
  const dates = samePoint.filter(location => location.attestations.length === 1 &&
    location.attestations[0].confidence === 'confident' && location.attestations[0].timePeriod !== 'modern')
    .map(pleiadesPeriod).filter(Boolean);
  const names = (record.names ?? []).flatMap(entry => {
    const label = entry.attested || entry.romanized;
    if (!label) return [];
    const date = pleiadesPeriod(entry);
    return [{ name: label, original: label, aliases: entry.romanized ? entry.romanized.split(/,\s*/) : [],
      language: entry.language, citation: https(entry.uri),
      sourceDates: { start: entry.start, end: entry.end }, ...date }];
  });
  return { originalId: String(record.id), name: record.title, coordinates, types: record.placeTypes,
    url: `https://pleiades.stoa.org/places/${record.id}`, names, attestations: dates,
    sourceAttestations: samePoint.map(location => ({ start: location.start, end: location.end,
      citation: https(location.uri), periods: location.attestations.map(item => ({
        label: item.timePeriod, confidence: item.confidence,
      })) })),
    credits: [...record.creators ?? [], ...record.contributors ?? []].map(person => person.name).filter(Boolean),
    externalIds: [`https://pleiades.stoa.org/places/${record.id}`] };
}

// LPF uses ISO year numbering. Keep only explicitly bounded assertions on the map.
function isoYear(value) {
  if (typeof value !== 'string' || !/^-?\d{1,6}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return undefined;
  const year = Number(value.match(/^-?\d+/)[0]);
  return year <= 0 ? year - 1 : year;
}

function lpfPeriods(when) {
  return (when?.timespans ?? []).map(({ start, end }) =>
    period(isoYear(start?.in), isoYear(end ? end.in : start?.in))).filter(Boolean);
}

export function fromLinkedPlaces(record, dataset) {
  const originalId = record['@id'] ?? record.id;
  const feature = record.properties ?? {};
  if (originalId == null) return null;
  const points = record.geometry?.type === 'GeometryCollection' ? record.geometry.geometries : [record.geometry];
  const point = points.filter(Boolean).find(item => item.type === 'Point' && safePoint(item.coordinates) &&
    (item.certainty === undefined || item.certainty === 'certain'));
  const names = (record.names ?? []).flatMap(entry => {
    const name = { name: entry.toponym, original: entry.toponym, language: entry.lang, sourceDates: entry.when, citations: entry.citations };
    const dates = lpfPeriods(entry.when);
    return dates.length ? dates.map(date => ({ ...name, ...date })) : [name];
  });
  return { originalId: String(originalId), name: feature.title, coordinates: point?.coordinates,
    types: (record.types ?? []).map(type => type.label ?? type.sourceLabel),
    url: https(originalId) ?? dataset.source, names,
    attestations: lpfPeriods(point?.when ?? record.when),
    sourceAttestations: [point?.when ?? record.when].filter(Boolean),
    externalIds: https(originalId) ? [originalId] : [] };
}

export function normalizePlace(candidate, dataset) {
  if (!candidate || !candidate.name?.trim() || !safePoint(candidate.coordinates) || !https(candidate.url)) return null;
  const type = types.find(([pattern]) => (candidate.types ?? []).some(label => typeof label === 'string' && pattern.test(label)));
  if (!type) return null;
  const [, label, minZoom] = type;
  const sourceId = `${dataset.id}:${candidate.originalId}`;
  const scoped = items => items.map(item => ({ ...item, sourceId }));
  const attestations = scoped(candidate.attestations);
  const names = scoped(candidate.names.filter(item => item.name?.trim()));
  const chinese = names.find(item => /^zh(?:-|$)/i.test(item.language ?? ''));
  return {
    source: { title: `${dataset.name} · ${candidate.name}`, url: candidate.url, license: dataset.license,
      version: dataset.version, credits: [...new Set(candidate.credits ?? [])] },
    place: { id: sourceId, originalId: candidate.originalId, name: chinese?.name ?? candidate.name,
      originalName: candidate.name, type: label, sourceTypes: candidate.types,
      coordinates: candidate.coordinates.slice(0, 2), minZoom, sourceIds: [sourceId],
      names, attestations, coverage: attestations, existence: [], roles: [],
      sourceAttestations: candidate.sourceAttestations,
      externalIds: candidate.externalIds, confidence: '地图时段采用来源对地点或点位的记载，名称与存在年代分开记录。' },
  };
}

export async function importPlacePack(file, format, dataset) {
  if (!['pleiades', 'lpf'].includes(format)) throw new Error('Supported formats: pleiades, lpf');
  const stream = chain([createReadStream(file), ...(file.endsWith('.gz') ? [createGunzip()] : []),
    parser(), pick({ filter: format === 'pleiades' ? '@graph' : 'features' }), streamArray()]);
  const pack = { dataset, places: [], sources: {}, rejected: 0 };
  let count = 0;
  for await (const { value } of stream) {
    count++;
    const candidate = format === 'pleiades' ? fromPleiades(value) : fromLinkedPlaces(value, dataset);
    const result = normalizePlace(candidate, dataset);
    if (!result) {
      pack.rejected++;
      continue;
    }
    if (Object.hasOwn(pack.sources, result.place.id)) throw new Error(`Duplicate source ID: ${result.place.id}`);
    pack.places.push(result.place);
    pack.sources[result.place.id] = result.source;
  }
  if (!count) throw new Error('No records found in selected input format');
  return pack;
}
