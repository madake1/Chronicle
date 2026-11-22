"""Convert the official CODH POI CSV to LPF; the CSV supplies no historical dates."""
import argparse
import csv
import json
import math
from pathlib import Path


def convert(source):
    with source.open(encoding="utf-8-sig", newline="") as file:
        rows = csv.DictReader(file)
        required = {"id", "名称", "読み", "住所", "緯度", "経度", "分類1", "分類2", "分類3"}
        if not required.issubset(rows.fieldnames or []):
            raise ValueError("Unexpected CODH CSV columns")
        for row in rows:
            geometry = None
            try:
                lon, lat = float(row["経度"]), float(row["緯度"])
                if math.isfinite(lon) and math.isfinite(lat) and abs(lon) <= 180 and abs(lat) <= 90:
                    geometry = {"type": "Point", "coordinates": [lon, lat]}
            except ValueError:
                pass
            categories = list(dict.fromkeys(row[key] for key in ("分類1", "分類2", "分類3") if row[key]))
            yield {
                "type": "Feature", "id": row["id"], "properties": {"title": row["名称"]},
                "geometry": geometry, "types": [{"label": item} for item in categories],
                "names": [{"toponym": row["読み"], "lang": "ja"}] if row["読み"] else [],
                "descriptions": [{"value": "原始分类：" + " / ".join(categories)}]
                + ([{"value": "来源中的现址：" + row["住所"]}] if row["住所"] else []),
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    features = list(convert(args.source))
    args.output.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                     ensure_ascii=False), encoding="utf-8")
    print(f"CODH records read: {len(features)}")


if __name__ == "__main__":
    main()
