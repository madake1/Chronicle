import { createHash, randomUUID } from 'node:crypto';
import { NoteError } from './note-files.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Note pointers are preserved from the latest index on every work save.
export const worksVersion = works => '"' + hash(works.map(({ notePath, ...work }) => work)) + '"';

export function validAnnotation(item) {
  if (!item || typeof item !== 'object') return false;
  const { id, kind, start, end, confidence, longitude, latitude } = item;
  if (id !== undefined && (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) return false;
  if (['place', 'description', 'source'].some(key => item[key] !== undefined && typeof item[key] !== 'string')) return false;
  const hasCoordinates = longitude !== undefined || latitude !== undefined;
  if (hasCoordinates && !(Number.isFinite(longitude) && Math.abs(longitude) <= 180 &&
    Number.isFinite(latitude) && Math.abs(latitude) <= 90)) return false;
  if (start === undefined) return end === undefined && kind === undefined && Boolean(hasCoordinates || item.place?.trim());
  return Number.isInteger(start) && start >= -99999 && start <= 100000 &&
    ['确定', '推测', '约略'].includes(confidence) &&
    (kind === 'point' ? end === undefined || end === start :
      ['range', 'window'].includes(kind) && Number.isInteger(end) && end > start && end <= 100000);
}

export function validAnnotations(items) {
  if (!Array.isArray(items) || !items.every(validAnnotation)) return false;
  const ids = items.map(item => item.id).filter(Boolean);
  return new Set(ids).size === ids.length;
}

export function workAnnotations(work) {
  const occurrences = new Map();
  return work.segments.map(segment => {
    if (segment.id) return segment;
    const fingerprint = hash([work.id, Object.entries(segment).sort(([a], [b]) => a.localeCompare(b))]);
    const index = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, index + 1);
    return { ...segment, id: `legacy-${fingerprint}-${index}` };
  });
}

export function saveAnnotations(items) {
  if (!validAnnotations(items)) throw new NoteError(400, '时空标注、年代或坐标无效');
  return items.map(item => ({ ...item, id: item.id ?? randomUUID() }));
}

export function projectSpacetime(works, notes, tags) {
  const rows = [];
  function add(type, entity, annotations) {
    const entityId = `${type}:${entity.id}`;
    for (const annotation of annotations) {
      if (annotation.start === undefined && annotation.longitude === undefined) continue;
      rows.push({ ...annotation, key: `${entityId}:${annotation.id}`, entityId,
        entityType: type, title: entity.title, summary: entity.synopsis, workType: entity.type,
        tagIds: entity.tagIds, href: type === 'work' ? `/?work=${encodeURIComponent(entity.id)}` :
          `/knowledge?note=${encodeURIComponent(entity.id)}` });
    }
  }
  for (const work of works) add('work', work, workAnnotations(work));
  for (const note of notes) add('knowledge', note, note.annotations ?? []);
  return { rows, tags };
}
