"""Normalize saved Wikidata query shards and reconcile them with EventKG."""
import argparse
from collections import Counter, defaultdict
import gzip
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
QID = re.compile(r"Q[1-9][0-9]*$")
DATE = re.compile(r"^(-?\d+)-(\d\d)-(\d\d)")
POINT = re.compile(r"Point\(([-.\d]+) ([-.\d]+)\)")


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path, value):
    partial = path.with_suffix(".part")
    partial.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    partial.replace(path)


def values(rows, key, labeled=False):
    return sorted({row[key]["value"] for row in rows if key in row
                   and (not labeled or not QID.fullmatch(row[key]["value"]))})


def bounds(timestamp, precision, approximate):
    match = DATE.match(timestamp)
    if not match:
        return None
    year = int(match[1])
    if precision < 6 or not year:
        return None
    if precision < 9:
        unit = 10 ** (9 - precision)
        first = year // unit * unit
        last = first + unit - 1
    elif approximate:
        first = year - 2 if year != 1 else -2
        last = year + 2 if year != -1 else 2
    else:
        first = last = year
    return first or 1, last or -1


def dates(rows):
    starts, finishes, assertions = set(), set(), set()
    approximate = False
    for row in rows:
        start = row["t"]["value"]
        precision = int(row["precision"]["value"])
        calendar = row["calendar"]["value"].rsplit("/", 1)[-1]
        qualifier = row.get("circumstance", {}).get("value", "").rsplit("/", 1)[-1]
        if calendar not in {"Q1985727", "Q1985786"} or (qualifier and qualifier != "Q5727902"):
            return None, "ambiguous-calendar-or-date-qualifier"
        approximate |= bool(qualifier) or precision < 9
        chosen = bounds(start, precision, bool(qualifier))
        if not chosen:
            return None, "unsupported-date-precision"
        starts.add(chosen)
        assertions.add((row["role"]["value"], start, precision, calendar, qualifier))
        if "finish" in row:
            finish = row["finish"]["value"]
            end_precision = int(row["finishPrecision"]["value"])
            approximate |= end_precision < 9
            chosen = bounds(finish, end_precision, False)
            if not chosen:
                return None, "unsupported-end-precision"
            finishes.add(chosen)
            assertions.add(("end", finish, end_precision, "as-reported", ""))
    if len(starts) > 1 or len(finishes) > 1:
        return None, "conflicting-dates"
    first, last = next(iter(starts))
    if finishes:
        last = next(iter(finishes))[1]
    if first > last:
        return None, "inverted-range"
    least = min(item[2] for item in assertions)
    return (first, last, least, approximate, sorted(assertions)), None


def get_matches(raw, featured_path):
    featured = read(featured_path / "atlas-events/eventkg-crosswalk.json")
    for path in (featured_path / "public/atlas").glob("events*.json"):
        for event in read(path)["events"]:
            provenance = event.get("provenance", {})
            if provenance.get("dataset") == "Wikidata":
                featured[provenance["id"]] = event["id"]
    existing = {}
    ledger = raw / "eventkg-3.2/outcomes.jsonl.gz"
    if ledger.exists():
        with gzip.open(ledger, "rt", encoding="utf-8") as stream:
            for line in stream:
                row = json.loads(line)
                if row["status"] == "added" and len(row["qid"]) == 1:
                    qid = row["qid"][0]
                    existing[qid] = row.get("time", {})
    return featured, existing


def noaa_candidates(raw, date):
    index = defaultdict(list)
    for file in (raw / ("noaa-" + date)).glob("page-*.json"):
        for row in read(file)["items"]:
            if all(isinstance(row.get(k), (int, float)) for k in ("latitude", "longitude", "year", "month", "day")):
                key = row["year"], row["month"], row["day"]
                index[key].append(row)
    return index


def gazetteer_links(root):
    path = root / "atlas-data/place-query-index.json"
    if not path.exists():
        return {}
    index = read(path)
    places = defaultdict(set)
    for place in index["places"]:
        for link in place.get("sourceDetails", {}).get("links", ()):
            url = link.get("url", "")
            qid = url.rsplit("/", 1)[-1]
            if link.get("label") == "Wikidata" and url.startswith("https://www.wikidata.org/wiki/") and QID.fullmatch(qid):
                places[qid].add((place["id"], place["name"]))
    return {qid: next(iter(matches)) for qid, matches in places.items() if len(matches) == 1}


def close_to_noaa(rows, location, candidates):
    if not location:
        return []
    lon, lat = location
    matches = set()
    for row in rows:
        if row["precision"]["value"] != "11":
            continue
        date = DATE.match(row["t"]["value"])
        if not date:
            continue
        reported = tuple(map(int, date.groups()))
        for candidate in candidates.get(reported, ()):
            distance = math.hypot(candidate["latitude"] - lat,
                                  ((candidate["longitude"] - lon + 180) % 360 - 180)
                                  * math.cos(math.radians(lat)))
            if distance <= .6:
                matches.add(candidate["id"])
    return sorted(matches)


def build(date, root=ROOT):
    raw = root / "atlas-data/raw"
    directory = raw / ("wikidata-events-v2-" + date)
    featured, existing = get_matches(raw, root)
    noaa = noaa_candidates(raw, date)
    gazetteer = gazetteer_links(root)
    grouped = defaultdict(list)
    binding_count = 0
    shards = sorted(file for file in directory.glob("*.json")
                    if re.fullmatch(r"[a-z]+(?:-[a-z]+)*(?:-Q\d+)*\.-?\d+\.-?\d+\.json", file.name))
    for shard in shards:
        data = read(shard)
        for row in data["rows"]:
            qid = row["item"]["value"].rsplit("/", 1)[-1]
            row["category"] = data["category"].split("-")[0]
            grouped[qid].append(row)
            binding_count += 1
    decade_events = defaultdict(list)
    counts, categories, regions, reasons = Counter(), Counter(), Counter(), Counter()
    ledger = []
    holdbacks = {}
    for qid, rows in sorted(grouped.items()):
        outcome = {"qid": qid}
        ledger.append(outcome)

        def mark(status, **details):
            counts[status] += 1
            outcome.update(status=status, **details)
            if details.get("reason"):
                reasons[details["reason"]] += 1

        if qid in featured:
            mark("matched", eventId=featured[qid], target="featured")
            continue
        timing, reason = dates(rows)
        if not timing:
            mark("deferred", reason=reason)
            continue
        first, last, least, approximate, assertions = timing
        if first > 2024 or last < -3400:
            mark("excluded", reason="outside-timeline")
            continue
        labels = [(row["itemLabel"].get("xml:lang", ""), row["itemLabel"]["value"])
                  for row in rows if "itemLabel" in row and row["itemLabel"]["value"] != qid]
        if not labels and qid not in existing:
            mark("deferred", reason="missing-label")
            continue
        ordered = sorted(set(labels), key=lambda entry: (not entry[0].startswith("zh"), entry[0] != "en", entry))
        places, countries, points = (values(rows, name, name.endswith("Label"))
                                     for name in ("placeLabel", "countryLabel", "coord"))
        upstream_places = values(rows, "place")
        linked = gazetteer.get(upstream_places[0].rsplit("/", 1)[-1]) if len(upstream_places) == 1 else None
        place = " / ".join(places)
        region = countries[0] if len(countries) == 1 else " / ".join(countries)
        point_match = POINT.fullmatch(points[0]) if len(points) == 1 else None
        location = list(map(float, point_match.groups())) if point_match else None
        if location and (not any(location) or abs(location[0]) > 180 or abs(location[1]) > 85):
            location = None
        category = rows[0]["category"]
        if any(row["class"]["value"].endswith("/Q7944") for row in rows):
            candidates = close_to_noaa(rows, location, noaa)
            if candidates:
                mark("deferred", reason="possible-noaa-overlap", noaa=candidates)
                if qid in existing:
                    holdbacks["eventkg-" + qid.lower()] = candidates
                continue
        match = existing.get(qid)
        if match is not None and (match.get("first", first) > last or match.get("last", last) < first):
            mark("deferred", reason="date-conflicts-with-eventkg", eventkgDate=match)
            continue
        event_id = ("eventkg-" if match is not None else "wikidata-catalog-") + qid.lower()
        title = ordered[0][1] if ordered else qid
        event = {
            "id": event_id, "name": title, "startYear": first, "endYear": last,
            "datePrecision": "century" if least == 7 else "approximate" if approximate else "year",
            "category": category, "quality": "catalogue", "description": "Wikidata 结构化事件记录。",
            "provenance": {"dataset": "Wikidata", "id": qid, "retrievedOn": date,
                           "upstreamPrecision": f"Wikidata 时间精度 {least}",
                           "locationBasis": "Wikidata 事件自身坐标 P625" if location else "仅保留源记录的地点或地区",
                           "dateAssertions": assertions, "placeIds": upstream_places,
                           "countryIds": values(rows, "country")},
            "sources": [{"title": "Wikidata · " + qid + " · CC0", "url": "https://www.wikidata.org/wiki/" + qid}],
        }
        if approximate:
            event["dateLabel"] = {6: "千年精度", 7: "世纪精度", 8: "十年精度"}.get(least, "约略年代")
        if place or location:
            event["placeName"] = place or region or "Wikidata 所载地点"
        if linked:
            event["placeId"], linked_name = linked
            event.setdefault("placeName", linked_name)
            event["provenance"]["locationBasis"] += "；P276 与本地点库 Wikidata 链接一致"
            counts["linkedPlace"] += 1
        if region:
            event["region"] = region
            event["regions"] = countries
        if location:
            event["location"] = location
        if len(ordered) > 1:
            event["aliases"] = sorted({value for _, value in ordered[1:] if value != title})
        if match is not None:
            event["supplement"] = True
        first_axis = first + (first < 0)
        last_axis = last + (last < 0)
        for decade in range(max(-3400, first_axis // 10 * 10), min(2020, last_axis // 10 * 10) + 1, 10):
            decade_events[decade].append(event)
        if match is not None:
            mark("matched", eventId=event_id, target="EventKG")
        else:
            mark("added", eventId=event_id)
            categories[category] += 1
            regions[region or "未标地区"] += 1
        if location:
            counts["mappedSupplement" if match is not None else "mapped"] += 1
    dest = root / "atlas-data/events-catalog/wikidata"
    dest.mkdir(parents=True, exist_ok=True)
    for decade in range(-3400, 2021, 10):
        write(dest / f"{decade}.json", {"version": "Wikidata " + date, "events": decade_events[decade]})
    write(dest / "holdbacks.json", holdbacks)
    report = {"retrievedOn": date, "shards": len(shards), "bindings": binding_count, "uniqueQids": len(grouped),
              "counts": dict(counts), "deferredReasons": dict(reasons),
              "byCategory": dict(categories), "byRegion": dict(regions), "eventkgHoldbacks": len(holdbacks)}
    write(directory / "outcomes.json", {"report": report, "outcomes": ledger})
    print(json.dumps({**report, "byRegion": len(regions)}, ensure_ascii=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        parser.error("Expected YYYY-MM-DD")
    build(args.date)
