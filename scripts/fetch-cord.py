"""Fetch CORD v2's ground truth (no images) for every split into one cached file.

DuckDB reads only the ground_truth column of the dataset's Parquet files over HTTP range
requests, so the receipt images are never downloaded.    python fetch-cord.py <out.json>
"""
import json, sys, urllib.request
import duckdb

con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs;")
out = {}
for split in ("train", "validation", "test"):
    urls = json.load(urllib.request.urlopen(f"https://huggingface.co/api/datasets/naver-clova-ix/cord-v2/parquet/default/{split}"))
    rows = con.execute(f"select ground_truth from read_parquet({urls!r})").fetchall()
    out[split] = [r[0] for r in rows]
    print(f"  CORD {split}: {len(rows)} receipts", file=sys.stderr)
json.dump(out, open(sys.argv[1], "w"))
