#!/usr/bin/env python3
import argparse
import csv
import glob
import json
import os
import sys
import zipfile
from datetime import datetime, timezone


FIVE_MINUTES_MS = 5 * 60 * 1000


def to_iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def discover_zip_files(paths):
    out = []
    for base in paths:
        expanded = glob.glob(os.path.join(base, "*.zip"))
        out.extend(expanded)
    return sorted(set(out))


def parse_zip_rows(zip_path, symbol, timeframe, start_ms, end_ms):
    rows = []
    with zipfile.ZipFile(zip_path, "r") as archive:
        for name in archive.namelist():
            if not name.lower().endswith(".csv"):
                continue
            with archive.open(name, "r") as raw:
                decoded = (line.decode("utf-8", errors="replace") for line in raw)
                reader = csv.reader(decoded)
                for record in reader:
                    if not record:
                        continue
                    first = str(record[0]).strip().lower()
                    if first == "open_time":
                        continue
                    try:
                        bucket_start_ms = int(record[0])
                        open_price = float(record[1])
                        high_price = float(record[2])
                        low_price = float(record[3])
                        close_price = float(record[4])
                        volume = float(record[5])
                    except (ValueError, IndexError):
                        continue
                    if bucket_start_ms < start_ms or bucket_start_ms > end_ms:
                        continue
                    rows.append(
                        {
                            "symbol": symbol,
                            "timeframe": timeframe,
                            "bucketStartMs": bucket_start_ms,
                            "open": open_price,
                            "high": high_price,
                            "low": low_price,
                            "close": close_price,
                            "volume": volume,
                        }
                    )
    return rows


def validate_continuity(sorted_timestamps):
    gaps = []
    for prev, current in zip(sorted_timestamps, sorted_timestamps[1:]):
        diff = current - prev
        if diff != FIVE_MINUTES_MS:
            gaps.append((prev, current, diff))
    return gaps


def main():
    parser = argparse.ArgumentParser(
        description="Convert Binance klines zip files into backtester candle NDJSON."
    )
    parser.add_argument("--symbol", required=True, help="Backtester/Binance symbol (e.g. XRPUSDT)")
    parser.add_argument("--timeframe", default="5m", choices=["1m", "5m"])
    parser.add_argument("--start-ms", required=True, type=int)
    parser.add_argument("--end-ms", required=True, type=int)
    parser.add_argument("--input-dir", action="append", required=True, help="Directory containing zip files; pass multiple times")
    parser.add_argument("--output", required=True, help="Output NDJSON file path")
    args = parser.parse_args()

    zip_files = discover_zip_files(args.input_dir)
    if not zip_files:
        raise SystemExit("No .zip files found in --input-dir values.")

    deduped = {}
    duplicates = 0
    scanned_rows = 0
    for zip_path in zip_files:
        for row in parse_zip_rows(
            zip_path=zip_path,
            symbol=args.symbol.upper(),
            timeframe=args.timeframe,
            start_ms=args.start_ms,
            end_ms=args.end_ms,
        ):
            scanned_rows += 1
            key = row["bucketStartMs"]
            if key in deduped:
                duplicates += 1
            deduped[key] = row

    if not deduped:
        raise SystemExit("No rows remained after parsing/filtering.")

    ordered_rows = [deduped[k] for k in sorted(deduped.keys())]
    timestamps = [row["bucketStartMs"] for row in ordered_rows]
    gaps = validate_continuity(timestamps)

    output_dir = os.path.dirname(os.path.abspath(args.output))
    os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        for row in ordered_rows:
            handle.write(json.dumps(row, separators=(",", ":")))
            handle.write("\n")

    summary = {
        "ok": True,
        "zipFiles": len(zip_files),
        "scannedRowsInRange": scanned_rows,
        "dedupedRows": len(ordered_rows),
        "duplicateRows": duplicates,
        "firstBucketStartMs": timestamps[0],
        "firstBucketISO": to_iso(timestamps[0]),
        "lastBucketStartMs": timestamps[-1],
        "lastBucketISO": to_iso(timestamps[-1]),
        "continuityGapCount": len(gaps),
        "output": os.path.abspath(args.output),
    }
    if gaps:
        summary["continuityGapSamples"] = [
            {
                "prevMs": prev,
                "prevISO": to_iso(prev),
                "currentMs": current,
                "currentISO": to_iso(current),
                "deltaMs": diff,
            }
            for prev, current, diff in gaps[:20]
        ]
    json.dump(summary, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
