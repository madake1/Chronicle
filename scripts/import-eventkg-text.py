"""Process each EventKG TextEvent as a separately attributed catalogue record."""
import argparse
from collections import Counter, defaultdict
import gzip
import importlib
import json
import re
import unicodedata
from urllib.parse import quote, unquote, urlsplit

eventkg = importlib.import_module("import-eventkg")
FILE = "text_events.nq"
SHARD_COUNT = 128


def signature(text):
    return " ".join(re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold()))


def source_year(year):
    return year - 1 if year <= 0 else year


def staged_quads(raw):
    directory = raw / "text-stage"
    directory.mkdir(exist_ok=True)
    marker = directory / "complete.json"
    paths = [directory / f"{number:03}.nq" for number in range(SHARD_COUNT)]
    if not marker.exists() or not all(path.exists() for path in paths):
        handles = [path.open("wb") for path in paths]
        try:
            with (raw / FILE).open("rb") as source:
                for line in source:
                    head, delimiter, suffix = line.partition(b"/resource/event_")
                    if delimiter and len(head) < 75:
                        value = suffix.split(b">", 1)[0]
                        if value.isdigit():
                            handles[int(value) % SHARD_COUNT].write(line)
        finally:
            for handle in handles:
                handle.close()
        eventkg.write_json(marker, {"file": FILE, "size": (raw / FILE).stat().st_size, "shards": SHARD_COUNT})
    print(f"EventKG text checkpoint: {len(paths)} staging shards", flush=True)
    for path in paths:
        groups = defaultdict(list)
        for row in eventkg.quads(path):
            groups[row[0]].append(row)
        yield from groups.items()


def build(date):
    raw = eventkg.ROOT / "atlas-data/raw/eventkg-3.2"
    eventkg.check_snapshot(raw / FILE)
    dest = eventkg.ROOT / "atlas-data/events-catalog"
    published = dest / "eventkg-text"
    published.mkdir(parents=True, exist_ok=True)
    existing = defaultdict(set)
    for name in ("eventkg", "wikidata"):
        for file in (dest / name).glob("*.json"):
            if not re.fullmatch(r"-?\d+", file.stem):
                continue
            pack = json.loads(file.read_text(encoding="utf-8"))
            for event in pack["events"]:
                existing[signature(event["name"])].add((event["startYear"], event["endYear"], event["id"]))
    for name in eventkg.FEATURED:
        pack = json.loads((eventkg.ROOT / "public/atlas" / name).read_text(encoding="utf-8-sig"))
        for event in pack["events"]:
            existing[signature(event["name"])].add((event["startYear"], event["endYear"], event["id"]))
    buckets = defaultdict(list)
    counts, categories, reasons = Counter(), Counter(), Counter()
    seen = set()
    auxiliary = 0
    partial = raw / "text-outcomes.jsonl.gz.part"
    with gzip.open(partial, "wt", encoding="utf-8", compresslevel=3) as ledger:
        for event, lines in staged_quads(raw):
            key = event.decode()
            if not any(value.endswith(b"/schema/TextEvent>") and predicate.endswith(b"rdf-syntax-ns#type")
                       for _, predicate, value, _ in lines):
                auxiliary += 1
                continue
            seen.add(key)

            def outcome(status, reason=None, target=None):
                counts[status] += 1
                ledger.write(json.dumps({"id": key, "status": status, "reason": reason, "target": target},
                                        separators=(",", ":")) + "\n")
                if reason:
                    reasons[reason] += 1

            texts = defaultdict(set)
            pages = defaultdict(set)
            assertions = defaultdict(eventkg.date_sides)
            for _, predicate, value, graph in lines:
                eventkg.collect_date(assertions, predicate, value, graph)
                if predicate.endswith(b"/description"):
                    parsed = eventkg.literal(value)
                    if parsed and parsed[0].strip():
                        texts[graph].add(parsed)
                elif predicate.endswith(b"/extractedFrom") and value.startswith(b"<https://"):
                    url = value[1:-1].decode("utf-8")
                    if (urlsplit(url).hostname or "").endswith(".wikipedia.org"):
                        pages[graph].add(url)
            timing = eventkg.summarize_dates(assertions)
            if timing["status"] != "dated":
                outcome("deferred", timing["status"])
                continue
            first, last = timing["first"], timing["last"]
            if first > 2024 or last < -3399:
                outcome("excluded", "outside-timeline")
                continue
            valid = [(lang, " ".join(text.split()), graph) for graph, entries in texts.items()
                     if pages[graph] for text, lang in entries
                     if 12 <= len(text.strip()) <= 2000 and sum(char.isalpha() for char in text) >= 8]
            if not valid:
                outcome("deferred", "missing-attributable-event-text")
                continue
            lang, description, graph = min(valid, key=lambda entry: (
                not entry[0].startswith("zh"), entry[0] != "en", entry))
            first_year, last_year = source_year(first), source_year(last)
            fingerprint = signature(description)
            matches = sorted({event_id for begin, end, event_id in existing[fingerprint]
                              if first_year <= end and begin <= last_year})
            if matches:
                outcome("matched" if len(matches) == 1 else "deferred",
                        None if len(matches) == 1 else "ambiguous-text-match", matches)
                continue
            event_id = "eventkg-text-" + key.split("_")[1]
            existing[fingerprint].add((first_year, last_year, event_id))
            name = description if len(description) <= 120 else description[:117].rstrip() + "…"
            category = next((c for c, rule in eventkg.CATEGORY_RE if rule.search(description)), "other")
            precision = timing["precision"]
            record = {
                "id": event_id, "name": name, "startYear": first_year, "endYear": last_year,
                "datePrecision": "century" if precision == 100 else "approximate" if precision > 1 else "reported-year",
                "dateLabel": {10: "原目录十年精度", 100: "原目录世纪精度", 1000: "原目录千年精度"}
                .get(precision, "文本目录抽取日期"),
                "category": category, "quality": "catalogue", "description": description,
                "provenance": {"dataset": "EventKG 3.2 · TextEvent", "id": key, "retrievedOn": date,
                               "upstreamPrecision": timing["assertions"][0][3],
                               "locationBasis": "文本条目未提供可直接采用的事件点位",
                               "dateAssertions": timing["assertions"]},
                "sources": [{"title": f"EventKG 3.2 · TextEvent · {key} · CC BY 4.0", "url": eventkg.DOI},
                            *({"title": unquote(urlsplit(url).path.split("/")[-1]).replace("_", " ")
                                        + " · Wikipedia 贡献者 · CC BY-SA",
                               "url": quote(url, safe=":/%?=&+#")} for url in sorted(pages[graph]))],
            }
            for decade in range(max(-3400, first // 10 * 10), min(2020, last // 10 * 10) + 1, 10):
                buckets[decade].append(record)
            categories[category] += 1
            outcome("added")
    for decade in range(-3400, 2021, 10):
        eventkg.write_json(published / f"{decade}.json", {
            "version": "EventKG 3.2 TextEvent", "events": buckets[decade]})
    partial.replace(raw / "text-outcomes.jsonl.gz")
    report = {"version": "3.2", "retrievedOn": date, "records": len(seen), "counts": dict(counts),
              "reasonCounts": dict(reasons), "byCategory": dict(categories), "mapped": 0,
              "auxiliarySubjects": auxiliary}
    eventkg.write_json(raw / "text-report.json", report)
    print(json.dumps(report, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date")
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        parser.error("Expected YYYY-MM-DD")
    if args.download:
        raw = eventkg.ROOT / "atlas-data/raw/eventkg-3.2"
        raw.mkdir(parents=True, exist_ok=True)
        eventkg.download(raw, FILE)
    build(args.date)
