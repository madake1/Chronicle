"""Convert vetted Viabundus v2 settlement and town nodes into Linked Places JSON."""
import argparse
from collections import defaultdict
import csv
import json
from pathlib import Path


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def integer_year(value):
    return value if value.isascii() and value.isdecimal() and 0 < int(value) <= 2024 else None


def timespan(start, end):
    first, last = integer_year(start), integer_year(end)
    if not (first or last) or (first and last and int(first) > int(last)):
        return None
    # A single endpoint supports an attested year, not open-ended continuity.
    return {"start": {"in": first or last}, "end": {"in": last or first}}


def convert(nodes, alternative_names):
    names = defaultdict(list)
    for row in rows(alternative_names):
        label = " ".join(text for value in (row["prefix"], row["name"])
                         if (text := value.strip()) and text != "null")
        if not label:
            continue
        name = {"toponym": label}
        if row["language"] not in ("", "null"):
            name["lang"] = row["language"]
        date = timespan(row["year1"], row["year2"])
        if date:
            name["when"] = {"timespans": [date]}
        names[row["nodesid"]].append(name)

    for row in rows(nodes):
        if row["ready"] != "y":
            continue
        types = [kind for kind in ("Settlement", "Town") if row["Is_" + kind] == "y"]
        if not types:
            continue
        dates, notes = [], []
        for kind in types:
            date = timespan(row[kind + "_From"], row[kind + "_To"])
            if date and date not in dates:
                dates.append(date)
            description = row[kind + "_Description"]
            if description not in ("", "null"):
                notes.append({"value": description})
        try:
            geometry = {"type": "Point", "coordinates": [float(row["longitude"]), float(row["latitude"])]}
        except ValueError:
            geometry = None
        label = row["name"] if row["name"] != "null" else ""
        links = sorted({value for value in row["links"].split(";") if value.startswith(("wd:", "gn:"))})
        yield {"type": "Feature", "id": row["id"], "properties": {"title": label},
               "geometry": geometry, "types": [{"label": kind} for kind in types],
               "names": names[row["id"]], "descriptions": notes,
               "when": {"timespans": dates}, "links": [{"identifier": link} for link in links]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("nodes", type=Path)
    parser.add_argument("alternative_names", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    features = list(convert(args.nodes, args.alternative_names))
    args.output.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                     ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"Viabundus vetted settlements and towns: {len(features)}")


if __name__ == "__main__":
    main()
