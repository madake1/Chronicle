"""Convert the published Chandler and ancient Modelski CSV snapshots to Linked Places."""
import csv
import hashlib
import io
import json
from pathlib import Path
import re


RAW = Path(__file__).resolve().parent.parent / "atlas-data" / "raw"
SOURCES = (
    ("chandler", "chandlerV2.csv", "aeff29534fb11c4f320cd79fbcba9c8b", "2059494"),
    ("modelski-ancient", "modelskiAncientV2.csv", "f5757dbeeeacb6dc33c26522866eff57", "2059497"),
)


def features():
    for source, filename, checksum, doi in SOURCES:
        data = (RAW / filename).read_bytes()
        if hashlib.md5(data).hexdigest() != checksum:
            raise ValueError(f"Unexpected checksum for {filename}")
        records = csv.DictReader(io.StringIO(data.decode("cp1252")))
        year_columns = {}
        for column in records.fieldnames:
            match = re.fullmatch(r"(BC|AD)_(\d+)", column)
            if match:
                era, year = match.groups()
                year_columns[column] = int(year) if era == "AD" else 1 - int(year)
        for row_id, row in enumerate(records, 1):
            if row["Certainty"] not in {"1", "2"} or not row["City"].strip():
                continue
            years = sorted(year for column, year in year_columns.items()
                           if re.fullmatch(r"[1-9]\d*", row[column].strip()))
            if not years:
                continue
            aliases = dict.fromkeys(item.strip() for item in row["OtherName"].split(",") if item.strip())
            yield {
                "type": "Feature",
                "id": f"{source}-{row_id}",
                "properties": {"title": row["City"].strip(), "url": f"https://doi.org/10.6084/m9.figshare.{doi}"},
                "geometry": {"type": "Point", "coordinates": [float(row["Longitude"]), float(row["Latitude"])]},
                "types": [{"label": "city"}],
                "names": [{"toponym": alias} for alias in aliases],
                "when": {"timespans": [{"start": {"in": str(year)}} for year in years]},
                "descriptions": [{"value": f"人口资料的观测年份；点位置信等级 {row['Certainty']}/3（1 为最高）。地名可能采用现代拼法。"}],
            }


if __name__ == "__main__":
    records = list(features())
    (RAW / "historical-cities.lpf").write_text(
        json.dumps({"type": "FeatureCollection", "features": records}, ensure_ascii=False, allow_nan=False),
        encoding="utf-8",
    )
    print(f"Historical city records: {len(records)}")
