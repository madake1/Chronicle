export function buildPolityHistory(features, visibleRecords) {
  const groups = new Map();
  const namesByWikidata = new Map();
  for (const { properties: row } of features) {
    if (row.Type !== 'POLITY' || !row.Wikidata) continue;
    const names = namesByWikidata.get(row.Wikidata) ?? new Set();
    names.add(row.Name);
    namesByWikidata.set(row.Wikidata, names);
  }
  const byRecord = {};
  const visibleGroups = new Set();
  features.forEach(({ properties: row }, sourceIndex) => {
    if (row.Type !== 'POLITY') return;
    const { Name, SeshatID, Wikidata, FromYear, ToYear, Area } = row;
    // A shared external article can cover multiple polities, such as Northern and Southern Song.
    const key = SeshatID ? JSON.stringify(['seshat', SeshatID, Name]) :
      /^Q[1-9]\d*$/.test(Wikidata) && namesByWikidata.get(Wikidata)?.size === 1
        ? JSON.stringify(['wikidata', Wikidata, Name]) : `record:${sourceIndex}`;
    const records = groups.get(key) ?? [];
    records.push({ sourceIndex, name: Name, seshatId: SeshatID || null, wikidata: Wikidata || null,
      fromYear: FromYear, toYear: ToYear, areaKm2: Number.isFinite(Area) && Area > 0 ? Area : null });
    groups.set(key, records);
    if (visibleRecords.has(sourceIndex)) {
      visibleGroups.add(key);
      byRecord[sourceIndex] = key;
    }
  });
  return {
    byRecord,
    groups: Object.fromEntries([...visibleGroups].map(key => [key, groups.get(key)
      .sort((a, b) => a.fromYear - b.fromYear || a.toYear - b.toYear || a.sourceIndex - b.sourceIndex)])),
  };
}
