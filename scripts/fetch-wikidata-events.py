"""Save complete, resumable Wikidata SPARQL shards for a fixed event-type scope."""
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import gzip
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
CLASSES = {
    "war": ("Q178561", "Q198", "Q188055", "Q831663"),
    "politics": ("Q40231", "Q43109", "Q10931", "Q131569", "Q45382"),
    "economy": ("Q290178", "Q114380", "Q1020018"),
    "science": ("Q2133344", "Q3887"),
    "culture": ("Q132241", "Q464980"),
    "religion": ("Q51645", "Q186431"),
    "society": ("Q273120", "Q175331", "Q124734", "Q49776", "Q44512"),
    "disaster": ("Q7944", "Q3839081", "Q8065"),
}
RANGES = ((-3400, -1001), (-1000, -1), (1, 499), (500, 999), (1000, 1499),
          (1500, 1799), (1800, 1899), (1900, 1949), (1950, 1999), (2000, 2024))
LIMIT = 2500


def stamp(year):
    return f'{"-" if year < 0 else ""}{abs(year):04}-01-01T00:00:00Z'


def query(classes, start, end):
    values = " ".join("wd:" + key for key in classes)
    return f"""
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT DISTINCT ?item ?class ?role ?t ?precision ?calendar ?circumstance ?finish ?finishPrecision
                ?itemLabel ?place ?placeLabel ?country ?countryLabel ?coord WHERE {{
  VALUES ?class {{ {values} }}
  VALUES (?predicate ?valuePredicate ?role) {{ (p:P585 psv:P585 "point") (p:P580 psv:P580 "start") }}
  ?item wdt:P31 ?class; ?predicate ?claim .
  ?claim a wikibase:BestRank; ?valuePredicate ?time .
  ?time wikibase:timeValue ?t; wikibase:timePrecision ?precision; wikibase:timeCalendarModel ?calendar .
  FILTER(?t >= "{stamp(start)}"^^xsd:dateTime && ?t < "{stamp(end + 1 or 1)}"^^xsd:dateTime)
  OPTIONAL {{ ?claim pq:P1480 ?circumstance }}
  OPTIONAL {{
    ?item p:P582 ?endClaim .
    ?endClaim a wikibase:BestRank; psv:P582 ?endTime .
    ?endTime wikibase:timeValue ?finish; wikibase:timePrecision ?finishPrecision .
  }}
  OPTIONAL {{ ?item wdt:P276 ?place }}
  OPTIONAL {{ ?item wdt:P17 ?country }}
  OPTIONAL {{ ?item wdt:P625 ?coord }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "zh,en,mul,es,fr,ar,pt,de,ru,ja". }}
}}
LIMIT {LIMIT}
"""


def write(path, value):
    temporary = path.with_suffix(".part")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def fetch(directory, category, classes, start, end):
    path = directory / f"{category}.{start}.{end}.json"
    split = path.with_suffix(".split.json")
    if path.exists():
        return path.name, []
    if not split.exists():
        split_ahead = start >= 1500 and category in {"war", "politics"} and end - start > 20
        for attempt in range(0 if split_ahead else 2):
            try:
                response = subprocess.run([
                    "curl.exe", "-fsSL", "--max-time", "40", "-H", "Accept-Encoding: gzip", "-G", "-A",
                    "Chronicle/4 (personal historical catalog; https://www.wikidata.org/)",
                    "https://query.wikidata.org/sparql", "--data-urlencode", "query=" + query(classes, start, end),
                    "--data-urlencode", "format=json",
                ], check=True, capture_output=True)
                content = response.stdout
                if content.startswith(b"\x1f\x8b"):
                    content = gzip.decompress(content)
                rows = json.loads(content)["results"]["bindings"]
                if len(rows) >= LIMIT:
                    break
                write(path, {"category": category, "classes": classes, "first": start, "last": end, "rows": rows})
                print(f"Wikidata {category} {start}..{end}: {len(rows)} rows", flush=True)
                return path.name, []
            except (subprocess.CalledProcessError, ValueError, KeyError, EOFError, gzip.BadGzipFile) as error:
                detail = error.stderr.decode(errors="replace").strip() if hasattr(error, "stderr") else str(error)
                print(f"Wikidata {category} {start}..{end} retry {attempt + 1}: {detail}", flush=True)
                if "timed out" in detail and end - start >= 10:
                    break
                time.sleep(15 if "429" in detail else 2)
        if start == end and len(classes) == 1:
            raise RuntimeError(f"Unfinished Wikidata shard {category} {start}, {classes}")
        write(split, {"first": start, "last": end, "classes": classes, "category": category})
    if start == end:
        mid = len(classes) // 2
        children = [(category + "-" + group[0], group, start, end) for group in (classes[:mid], classes[mid:])]
    else:
        mid = (start + end) // 2
        children = [(category, classes, start, mid), (category, classes, mid + 1, end)]
    return None, children


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date")
    parser.add_argument("--workers", type=int, default=3, choices=(1, 2, 3))
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.date):
        parser.error("Expected YYYY-MM-DD")
    directory = ROOT / "atlas-data" / "raw" / ("wikidata-events-v2-" + args.date)
    directory.mkdir(parents=True, exist_ok=True)
    ready = [(category, classes, start, end) for start, end in RANGES for category, classes in CLASSES.items()]
    blocked = []
    errors = {}
    completed = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = {}
        while ready or tasks:
            ready.sort(key=lambda job: (job[0] in {"war", "politics"} and job[2] >= 1500, job[2], job[0]))
            while ready and len(tasks) < args.workers:
                job = ready.pop(0)
                tasks[pool.submit(fetch, directory, *job)] = job
            done, _ = wait(tasks, return_when=FIRST_COMPLETED)
            for future in done:
                job = tasks.pop(future)
                try:
                    filename, children = future.result()
                    if filename:
                        completed.append(filename)
                    ready.extend(children)
                except RuntimeError as error:
                    blocked.append(job)
                    errors[str(job)] = str(error)
            pending = [[category, start, end, classes] for category, classes, start, end
                       in (*ready, *tasks.values(), *blocked)]
            write(directory / "manifest.json", {"date": args.date, "classes": CLASSES, "ranges": RANGES,
                                                 "completed": sorted(completed), "pending": pending, "errors": errors})
    if blocked:
        raise SystemExit(1)
