"""Import EventKG 3.2 named events from the publisher's N-Quads files."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import gzip
import itertools
import json
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parent.parent
BASE = "https://eventkg.l3s.uni-hannover.de/data/v3_2/output/"
DOI = "https://doi.org/10.5281/zenodo.10424118"
FILES = ("events.nq", "relations_events_base.nq", "types_wikidata.nq")
FILE_SIZES = dict(zip((*FILES, "text_events.nq"), (2002943869, 2070257755, 4468699185, 1872627913)))
FEATURED = ("events.json", "events-wikidata.json", "events-noaa.json", "events-milestones.json")
QUAD = re.compile(rb'^<[^>]+/(event_[0-9]+)> <([^>]+)> (.+?)(?: <[^>]+/graph/([^>]+)>)? \.[\r\n]*$')
LABEL = re.compile(rb'^("(?:[^"\\]|\\.)*")(?:@([a-zA-Z0-9-]+))?$')
TIMESTAMP = re.compile(rb'^"(-?\d+)-(\d{2})-(\d{2})"')
QID = re.compile(rb'/entity/(Q[1-9][0-9]*)>$')
PLACE = re.compile(rb'/resource/(entity_[0-9]+)>$')
UNIT = {b"unitDay": 1, b"unitMonth": 1, b"unitYear": 1, b"unitDecade": 10,
        b"unitCentury": 100, b"unitMillennium": 1000}
CATEGORIES = (
    ("war", r"\b(battle|siege|war|massacre|offensive|invasion|mutiny|military campaign)\b|战役|战争|攻占"),
    ("disaster", r"\b(earthquake|flood|tsunami|hurricane|typhoon|cyclone|eruption|tornado)\b|地震|海啸"),
    ("politics", r"\b(election|referendum|treaty|coup|cabinet|convention|independence|parliament)\b|选举|公投|条约"),
    ("economy", r"\b(recession|financial crisis|bankruptcy|trade|strike|stock market)\b|经济危机|贸易"),
    ("science", r"\b(spaceflight|spacecraft|satellite|space mission|launch|discovery|invention|eclipse)\b|发射|卫星"),
    ("religion", r"\b(papal|council of bishops|pilgrimage|canonization|church council)\b|朝觐"),
    ("sports", r"\b(league|sports|olympics|paralympics|championship|tournament|grand prix|world cup|football|tennis)\b|奥运|联赛"),
    ("culture", r"\b(festival|concert|exhibition|film|premiere|literary|arts)\b|电影节|艺术节"),
    ("society", r"\b(protest|strike|riot|demonstration|pandemic|epidemic|famine)\b|抗议|瘟疫"),
)
CATEGORY_RE = [(category, re.compile(pattern, re.I)) for category, pattern in CATEGORIES]
TYPE_CATEGORIES = {
    "Q178561": "war", "Q198": "war", "Q188055": "war", "Q831663": "war",
    "Q40231": "politics", "Q43109": "politics", "Q131569": "politics", "Q45382": "politics",
    "Q7944": "disaster", "Q3839081": "disaster", "Q8065": "disaster",
    "Q290178": "economy", "Q114380": "economy", "Q1020018": "economy",
    "Q2133344": "science", "Q3887": "science", "Q797476": "science",
    "Q132241": "culture", "Q464980": "culture", "Q172754": "culture",
    "Q51645": "religion", "Q186431": "religion", "Q301585": "religion",
    "Q273120": "society", "Q175331": "society", "Q49776": "society", "Q44512": "society",
    "Q1656682": "other", "Q16510064": "sports", "Q13406554": "sports",
}
NON_EVENT_TYPES = {
    "Q5", "Q4167410", "Q13406463", "Q13442814", "Q571", "Q47461344",
    "Q11424", "Q3305213", "Q16521", "Q5633421",
}


def download(raw, name):
    target = raw / name
    if target.exists():
        check_snapshot(target)
        return
    partial = raw / (name + ".part")
    subprocess.run(["curl.exe", "-fLsS", "--retry", "4", "--retry-delay", "2", "-C", "-",
                    BASE + name, "-o", str(partial)], check=True)
    check_snapshot(partial, name)
    partial.replace(target)


def check_snapshot(path, name=None):
    size = path.stat().st_size
    expected = FILE_SIZES[name or path.name]
    if size != expected:
        raise ValueError(f"Unexpected length for {path.name}: {size:,} bytes, expected {expected:,}")


def quads(path):
    with path.open("rb") as source:
        for line in source:
            if b"/resource/event_" not in line[:90]:
                continue
            match = QUAD.match(line)
            if not match:
                raise ValueError(f"Unrecognized event quad in {path.name}: {line[:160]!r}")
            yield match.groups()


def literal(value):
    match = LABEL.fullmatch(value)
    if match:
        try:
            return json.loads(match[1]), (match[2] or b"").decode()
        except (UnicodeError, ValueError):
            return None
    return None


def axis(year):
    return year + 1 if year < 0 else year


def historical_year(year):
    # RDF date literals follow the XML Schema lexical calendar: negative years
    # are BC and lexical zero is invalid in the 1.0 datatype used by the export.
    return year if year else None


def date_bounds(date, unit):
    year = int(date[0])
    if unit > 1:
        # EventKG may store a rounded boundary or the first/last year of a
        # period. Preserve the reported precision and use its decimal bucket.
        first = year // unit * unit
        last = first + unit - 1
        return axis(first) if first else 1, axis(last)
    year = historical_year(year)
    return (axis(year), axis(year)) if year is not None else None


def summarize_dates(assertions):
    independent = {graph: data for graph, data in assertions.items() if graph and graph != b"event_kg"}
    recognized = []
    for graph, data in independent.items():
        spans = []
        for side in ("start", "end"):
            dates, units = data[side]
            if len(dates) > 1 or len(units) > 1:
                return {"status": "conflicting-dates"}
            if dates:
                date = next(iter(dates))
                unit = next(iter(units), b"unitYear")
                bound = date_bounds(date, UNIT[unit])
                if bound:
                    spans.append((side, date, unit, bound))
        if spans:
            recognized.append((graph, spans))
    if not recognized:
        return {"status": "missing-date"}

    result = {}
    for side in ("start", "end"):
        candidates = [entry for _, entries in recognized for entry in entries if entry[0] == side]
        if not candidates:
            continue
        low = max(entry[3][0] for entry in candidates)
        high = min(entry[3][1] for entry in candidates)
        if low > high:
            return {"status": "conflicting-dates"}
        result[side] = (low, high)
    start = result.get("start") or result["end"]
    end = result.get("end") or result["start"]
    if start[0] > end[1]:
        return {"status": "conflicting-dates"}
    precision = max(UNIT[unit] for _, entries in recognized for _, _, unit, _ in entries)
    return {"status": "dated", "first": start[0], "last": end[1], "precision": precision,
            "graphs": [graph.decode() for graph, _ in recognized],
            "assertions": [[graph.decode(), side, "-".join(part.decode() for part in date), unit.decode()]
                           for graph, entries in recognized for side, date, unit, _ in entries]}


def collect_date(assertions, predicate, value, graph):
    if predicate.endswith((b"hasBeginTimeStamp", b"hasEndTimeStamp")):
        date = TIMESTAMP.match(value)
        if date:
            side = "start" if predicate.endswith(b"hasBeginTimeStamp") else "end"
            assertions[graph][side][0].add(date.groups())
    elif predicate.endswith((b"startUnitType", b"endUnitType")):
        unit = re.split(rb"[/#]", value.rstrip(b">"))[-1]
        if unit in UNIT:
            side = "start" if predicate.endswith(b"startUnitType") else "end"
            assertions[graph][side][1].add(unit)


def date_sides():
    return {"start": (set(), set()), "end": (set(), set())}


def date_records(path):
    for event, lines in itertools.groupby(quads(path), key=lambda row: row[0]):
        assertions = defaultdict(date_sides)
        places = set()
        for _, predicate, value, graph in lines:
            collect_date(assertions, predicate, value, graph)
            if predicate.endswith(b"hasPlace") and graph and graph != b"event_kg":
                place = PLACE.search(value)
                if place:
                    places.add(place[1].decode())
        if assertions:
            yield event.decode(), {**summarize_dates(assertions), "places": sorted(places)}


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".part")
    temp.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temp.replace(path)


def build(raw, date, dates_only=False):
    cache = raw / "date-checkpoint.json.gz"
    relation = raw / FILES[1]
    for name in (FILES[1:2] if dates_only else FILES):
        check_snapshot(raw / name)
    signature = [5, relation.stat().st_size, relation.stat().st_mtime_ns]
    timings = None
    if cache.exists():
        with gzip.open(cache, "rt", encoding="utf-8") as stream:
            snapshot = json.load(stream)
        if snapshot["signature"] == signature:
            timings = snapshot["events"]
    if timings is None:
        timings = {}
        for key, timing in date_records(relation):
            if key in timings and timings[key] != timing:
                timings[key] = {"status": "conflicting-dates"}
            else:
                timings[key] = timing
        partial = cache.with_suffix(".part")
        with gzip.open(partial, "wt", encoding="utf-8", compresslevel=3) as stream:
            json.dump({"signature": signature, "events": timings}, stream, separators=(",", ":"))
        partial.replace(cache)
    print(f"EventKG date checkpoint: {len(timings):,} candidate IDs", flush=True)
    if dates_only:
        return

    type_choices = {}
    non_events = {}
    for key, _, value, _ in quads(raw / FILES[2]):
        item = QID.search(value)
        if item:
            qid = item[1].decode()
            if qid in NON_EVENT_TYPES:
                non_events.setdefault(key, qid)
            category = TYPE_CATEGORIES.get(qid)
            if category and category != "other":
                type_choices.setdefault(key, category)

    local_ids = {}
    for file in FEATURED:
        path = ROOT / "public" / "atlas" / file
        for event in json.loads(path.read_text(encoding="utf-8-sig"))["events"]:
            if event.get("provenance", {}).get("dataset") == "Wikidata":
                local_ids[event["provenance"]["id"]] = event["id"]
    crosswalk = ROOT / "atlas-events" / "eventkg-crosswalk.json"
    if crosswalk.exists():
        local_ids.update(json.loads(crosswalk.read_text(encoding="utf-8")))

    out = ROOT / "atlas-data" / "events-catalog"
    out.mkdir(parents=True, exist_ok=True)
    published = out / "eventkg"
    published.mkdir(exist_ok=True)
    decades = defaultdict(list)
    counts = Counter()
    categories = Counter()
    dated_ranges = Counter()
    reasons = Counter()
    seen_events = set()
    seen_qids = {}
    outcome_tmp = raw / "outcomes.jsonl.gz.part"
    with gzip.open(outcome_tmp, "wt", encoding="utf-8", compresslevel=3) as ledger:
        def outcome(key, status, qids, timing=None, details=None):
            counts[status] += 1
            if status in {"deferred", "excluded"} and details:
                reasons[details] += 1
            ledger.write(json.dumps({"eventkg": key, "status": status, "qid": qids,
                                     **({"time": timing} if timing else {}),
                                     **({"detail": details} if details else {})},
                                    ensure_ascii=False, separators=(",", ":")) + "\n")

        for event, lines in itertools.groupby(quads(raw / FILES[0]), key=lambda row: row[0]):
            key = event.decode()
            if key in seen_events:
                raise ValueError(f"Event labels are not grouped contiguously: {key}")
            seen_events.add(key)
            labels = {}
            qids = set()
            for _, predicate, value, graph in lines:
                if predicate.endswith(b"#sameAs") and graph == b"wikidata":
                    match = QID.search(value)
                    if match:
                        qids.add(match[1].decode())
                elif predicate.endswith(b"#label"):
                    label = literal(value)
                    if label and label[0].strip():
                        text, lang = label
                        rank = (0 if lang.startswith("zh") else 1 if lang == "en" else 2,
                                0 if graph == b"wikidata" else 1)
                        labels.setdefault(rank, text.strip())
            qids = sorted(qids)
            timing = timings.get(key)
            qid = qids[0] if len(qids) == 1 else None
            if qid in local_ids:
                outcome(key, "matched", qids, details=local_ids[qid])
                continue
            if event in non_events and event not in type_choices:
                outcome(key, "excluded", qids, details="wikidata-non-event-type")
                continue
            if not timing or timing["status"] != "dated":
                outcome(key, "deferred", qids, timing, (timing or {}).get("status", "missing-date"))
                continue
            first, last = timing["first"], timing["last"]
            if last < -3399 or first > 2024:
                outcome(key, "excluded", qids, details="outside-timeline")
                continue
            if last > 2100:
                outcome(key, "deferred", qids, timing, "implausible-end-year")
                continue
            dated_ranges[str(first // 100 * 100)] += 1
            if len(qids) > 1:
                outcome(key, "deferred", qids, timing, "ambiguous-wikidata-id")
                continue
            if not labels:
                outcome(key, "deferred", qids, timing, "missing-label")
                continue
            name = labels[min(labels)]
            if qid in seen_qids:
                previous = seen_qids[qid]
                status = "matched" if previous[1:] == (first, last) else "deferred"
                outcome(key, status, qids, timing if status == "deferred" else None,
                        "conflicting-qid-record" if status == "deferred" else previous[0])
                continue
            category = type_choices.get(event) or next(
                (category for category, rule in CATEGORY_RE if any(rule.search(label) for label in labels.values())), "other")
            precision = timing["precision"]
            info = {"1": "源记录年级展示", "10": "十年范围", "100": "世纪范围", "1000": "千年范围"}
            event_id = f"eventkg-{qid.lower()}" if qid else key.replace("_", "kg-")
            value = {
                "id": event_id, "name": name,
                "startYear": first - 1 if first <= 0 else first,
                "endYear": last - 1 if last <= 0 else last,
                "datePrecision": "century" if precision == 100 else "approximate" if precision > 1 else "year",
                "category": category, "quality": "catalogue",
                "description": "EventKG 3.2 结构化记录。日期来自该版本所列原始数据图。",
                "provenance": {"dataset": "EventKG 3.2", "id": key, "retrievedOn": date,
                               "upstreamPrecision": info[str(precision)], "locationBasis": "未取得可核验的事件点位",
                               "dateAssertions": timing["assertions"], "placeIds": timing["places"]},
                "sources": [{"title": f"EventKG 3.2 · {key} · CC BY 4.0", "url": DOI}],
            }
            if precision > 1:
                value["dateLabel"] = info[str(precision)]
            if qid:
                value["sources"].insert(0, {"title": f"Wikidata · {qid}", "url": "https://www.wikidata.org/wiki/" + qid})
                seen_qids[qid] = (event_id, first, last)
            for decade in range(max(-3400, first // 10 * 10), min(2020, last // 10 * 10) + 1, 10):
                decades[decade].append(value)
            categories[category] += 1
            outcome(key, "added", qids, {"first": value["startYear"], "last": value["endYear"]})
    outcome_tmp.replace(raw / "outcomes.jsonl.gz")
    for decade in range(-3400, 2021, 10):
        write_json(published / f"{decade}.json", {"version": "EventKG 3.2", "events": decades[decade]})
    report = {"version": "3.2", "retrievedOn": date, "namedEvents": len(seen_events),
              "counts": dict(counts), "resolvedInRange": sum(dated_ranges.values()),
              "byCentury": dict(dated_ranges), "byCategory": dict(categories), "mapped": 0,
              "reasonCounts": dict(reasons), "files": {name: (raw / name).stat().st_size for name in FILES}}
    write_json(raw / "report.json", report)
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date", help="Date of the fixed local download, YYYY-MM-DD")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--dates-only", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        parser.error("Expected YYYY-MM-DD")
    raw = ROOT / "atlas-data" / "raw" / "eventkg-3.2"
    raw.mkdir(parents=True, exist_ok=True)
    if args.download:
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(lambda file: download(raw, file), FILES))
    build(raw, args.date, args.dates_only)
