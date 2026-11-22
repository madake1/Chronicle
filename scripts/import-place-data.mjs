import { decodeHTML } from 'entities';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { chain } from 'stream-chain';
import { parser } from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';

const types = [
  [/settlement|inhabited place|city|cities|town|village|hamlet|polis|port/i, '历史聚落', 3.5],
  [/monaster|religious complex|archaeolog|ruin|tumulus|burial|cemetery|sanctuary|temple|site|fort|castle/i, '历史遗址', 5],
  [/^province$/, '历史行政区参考点', 5],
  [/^historical place$|^施設$/, '历史地点', 5],
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

const historicalAttestation = entry => entry.confidence === 'confident' &&
  !/^(modern|twentieth-ce|twenty-first-ce)$/.test(entry.timePeriod ?? 'modern');

export function fromPleiades(record) {
  if (!/^\d+$/.test(record.id ?? '')) return null;
  const pointIds = new Set((record.features ?? []).filter(feature =>
    feature.properties?.location_precision === 'precise' && feature.geometry?.type === 'Point' &&
    safePoint(feature.geometry.coordinates)).map(feature => feature.id));
  const points = (record.locations ?? []).filter(location => pointIds.has(location.id) &&
    location.associationCertainty === 'certain' &&
    !/openstreetmap|geonames/i.test(JSON.stringify([location.provenance, location.accuracy, location.references])));
  const point = points.find(location => (location.attestations ?? []).some(historicalAttestation)) ?? points[0];
  const coordinates = (record.features ?? []).find(feature => feature.id === point?.id)?.geometry.coordinates;
  const samePoint = points.filter(location => {
    const other = record.features.find(feature => feature.id === location.id)?.geometry.coordinates;
    return other?.[0] === coordinates?.[0] && other?.[1] === coordinates?.[1] &&
      location.attestations?.length;
  });
  const dates = samePoint.filter(location => location.attestations.length === 1 &&
    historicalAttestation(location.attestations[0]))
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
    details: pleiadesDetails(record, point),
    credits: [...record.creators ?? [], ...record.contributors ?? []].map(person => person.name).filter(Boolean),
    externalIds: [`https://pleiades.stoa.org/places/${record.id}`] };
}

// LPF uses ISO year numbering. Keep only explicitly bounded assertions on the map.
function isoYear(value) {
  if (Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^-?\d{1,6}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return undefined;
  const year = Number(value.match(/^-?\d+/)[0]);
  return year <= 0 ? year - 1 : year;
}

function lpfPeriods(when) {
  return (when?.timespans ?? []).map(({ start, end }) =>
    period(isoYear(start?.in ?? start?.earliest), isoYear(end ? end.in ?? end.latest : start?.in),
      start?.in && (!end || end.in) ? {} : { approximate: true })).filter(Boolean);
}

function lpfReference(value) {
  if (typeof value !== 'string') return undefined;
  const wikidata = /^wd:(Q[1-9]\d*)$/.exec(value);
  if (wikidata) return `https://www.wikidata.org/wiki/${wikidata[1]}`;
  const geonames = /^gn:([1-9]\d*)$/.exec(value);
  if (geonames) return `https://www.geonames.org/${geonames[1]}/`;
  return https(value);
}

function readableText(value) {
  if (typeof value !== 'string') return '';
  return decodeHTML(value.replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

function sourceUrl(...values) {
  return values.find(value => typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value));
}

function uniqueReferences(values) {
  return [...new Map(values.map(item => [JSON.stringify(item), item])).values()];
}

function pleiadesDetails(record, point) {
  const notes = [record.description, record.details].map(readableText).filter(Boolean);
  const citations = [record, ...(record.names ?? []), ...(record.locations ?? [])].flatMap(item =>
    (item.references ?? []).flatMap(ref => {
      const url = sourceUrl(ref.accessURI, ref.bibliographicURI, ref.alternateURI);
      const label = readableText(ref.formattedCitation || ref.shortTitle);
      return label || url ? [{ label: label || url, url }] : [];
    }));
  const relations = (record.connections ?? []).flatMap(item => {
    const url = sourceUrl(item.connectsTo);
    const label = readableText(item.title || item.description) || url;
    const date = pleiadesPeriod(item);
    return label ? [{ label, url, type: item.connectionType, dates: date ? [date] : [] }] : [];
  });
  const date = point && pleiadesPeriod(point);
  const location = point ? [{ label: readableText(point.description) || readableText(point.title),
    url: sourceUrl(point.uri), dates: date ? [date] : [] }].filter(item => item.label || item.url) : [];
  const links = (record.references ?? []).filter(ref => ['Wikidata', 'MANTO', 'TM', 'nomisma.org']
    .includes(ref.shortTitle) || ref.shortTitle?.startsWith('Wikipedia')).flatMap(ref => {
    const url = sourceUrl(ref.accessURI, ref.bibliographicURI);
    return url ? [{ label: ref.shortTitle, url }] : [];
  });
  return { notes: [...new Set(notes)], citations: uniqueReferences(citations), relations, location, links };
}

function lpfDetails(record, feature, point, names) {
  const list = (key, exportKey = key) => record[key] ?? feature[exportKey] ?? [];
  const notes = list('descriptions').map(item => readableText(item.value)).filter(Boolean);
  const relations = list('relations', 'related').flatMap(item => {
    if (typeof item.label !== 'string' || !item.label.trim()) return [];
    return [{ label: item.label, type: item.relationType ?? item.relation_type,
      url: lpfReference(item.relationTo ?? item.relation_to), dates: lpfPeriods(item.when) }];
  });
  const citations = [...list('citations'), ...names.flatMap(item => item.citations ?? []),
    ...[point?.citation].filter(Boolean)].flatMap(item => {
    const url = lpfReference(item['@id'] ?? item.id);
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    return label || url ? [{ label: label || url, url }] : [];
  });
  const links = list('links').flatMap(item => {
    const identifier = item.identifier ?? item['@id'];
    const url = lpfReference(identifier);
    return url ? [{ label: identifier, url, type: item.type, augmented: item.aug === true }] : [];
  });
  const depictions = list('depictions').flatMap(item => {
    const url = sourceUrl(item['@id'], item.id, item.url);
    if (!url) return [];
    return [{ label: [readableText(item.title ?? item.label) || '原始图像', readableText(item.license)].filter(Boolean).join(' · '), url }];
  });
  return { notes: [...new Set(notes)], relations, citations: uniqueReferences(citations), links, depictions };

}

export function fromLinkedPlaces(record, dataset) {
  const originalId = record['@id'] ?? record.id;
  const feature = record.properties ?? {};
  if (originalId == null) return null;
  const points = record.geometry?.type === 'GeometryCollection' ? record.geometry.geometries : [record.geometry];
  const singlePoints = points.filter(item =>
    item?.type === 'Point' && safePoint(item.coordinates) ||
    item?.type === 'MultiPoint' && item.coordinates?.length === 1 && safePoint(item.coordinates[0]));
  const certain = item => item.certainty === undefined || item.certainty === 'certain';
  const point = singlePoints.find(item => item.type === 'Point' && certain(item)) ??
    singlePoints.find(certain) ??
    (dataset.includeUncertainPoints && singlePoints.length === 1 &&
      singlePoints[0].certainty === 'less-certain' ? singlePoints[0] : undefined);
  const names = (record.names ?? feature.names ?? []).flatMap(entry => {
    const name = { name: entry.toponym, original: entry.toponym, language: entry.lang, sourceDates: entry.when, citations: entry.citations };
    const dates = lpfPeriods(entry.when);
    return dates.length ? dates.map(date => ({ ...name, ...date })) : [name];
  });
  const whens = point?.when?.timespans?.length ? [point.when]
    : record.when?.timespans?.length ? [record.when] : feature.whens ?? [];
  const labels = (record.types ?? feature.types ?? []).map(type => type.label || type.sourceLabel).filter(Boolean);
  const source = /^\/api\/place\/\d+\/$/.test(feature.url) ? 'https://whgazetteer.org' + feature.url : https(feature.url);
  const details = lpfDetails(record, feature, point, names);
  const uncertain = point?.certainty === 'less-certain';
  if (uncertain) details.notes.push('来源将该点位标为较不确定，仅供搜索和定位参照。');
  return { originalId: String(originalId), name: feature.title, coordinates: point?.type === 'MultiPoint'
      ? point.coordinates[0] : point?.coordinates,
    types: labels.length ? labels : dataset.allowUntyped ? ['historical place'] : [],
    url: https(originalId) ?? source ?? dataset.source, names,
    attestations: dataset.searchOnly || uncertain ? [] : whens.flatMap(lpfPeriods),
    sourceAttestations: whens,
    details,
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
      version: dataset.version, credits: [...new Set(candidate.credits ?? [dataset.credits].filter(Boolean))] },
    place: { id: sourceId, originalId: candidate.originalId, name: chinese?.name ?? candidate.name,
      originalName: candidate.name, type: label, sourceTypes: candidate.types,
      coordinates: candidate.coordinates.slice(0, 2), minZoom, sourceIds: [sourceId],
      names, attestations, coverage: attestations, existence: [], roles: [],
      sourceAttestations: candidate.sourceAttestations,
      datasetName: dataset.name, sourceDetails: candidate.details,
      externalIds: candidate.externalIds },
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
