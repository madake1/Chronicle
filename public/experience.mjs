export function isExperienceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function experienceError(experience) {
  if (!experience || typeof experience !== 'object' || Array.isArray(experience)) return '体验字段无效';
  const { startedOn, lastExperiencedOn, endedOn, durationMinutes } = experience;
  if ([startedOn, lastExperiencedOn, endedOn].some(value => value !== undefined && !isExperienceDate(value))) {
    return '请输入有效的体验日期';
  }
  if (startedOn && endedOn && endedOn < startedOn) return '结束日期不能早于开始日期';
  if (durationMinutes !== undefined && (!Number.isSafeInteger(durationMinutes) || durationMinutes < 0)) {
    return '实际时长请输入非负整数（分钟）';
  }
  return '';
}
