#!/usr/bin/env python3
"""
Decades gold study using recurring-signal principle on monthly data.

Data source:
- Public monthly gold USD series from datasets/gold-prices
  https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv

Why monthly?
- True intraday data over many decades is harder to source freely/reliably.
- This script applies the same research pattern on a longer timescale:
  recurring anchor + context filters + walk-forward validation.
"""

from __future__ import annotations

import argparse
import csv
import io
import statistics
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

DATA_URL = "https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv"
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class Row:
    i: int
    d: datetime
    m: int
    price: float
    ret: float
    vol_ratio: float
    bull6: float
    ok: bool


def load_monthly_gold(start_year: int) -> list[tuple[datetime, float]]:
    raw = urllib.request.urlopen(DATA_URL, timeout=30).read().decode("utf-8")
    rows = list(csv.DictReader(io.StringIO(raw)))
    out: list[tuple[datetime, float]] = []
    for r in rows:
        d = datetime.strptime(r["Date"], "%Y-%m")
        if d.year < start_year:
            continue
        out.append((d, float(r["Price"])))
    out.sort(key=lambda x: x[0])
    return out


def build_rows(series: list[tuple[datetime, float]]) -> list[Row]:
    out: list[Row] = []
    for i in range(1, len(series)):
        d, p = series[i]
        prev = series[i - 1][1]
        ret = (p / prev) - 1.0
        if i >= 25:
            prev_abs = abs(out[-1].ret)
            abs24 = [abs(out[j].ret) for j in range(len(out) - 24, len(out))]
            vol_ratio = prev_abs / (statistics.mean(abs24) + 1e-12)
            last6 = [out[j].ret for j in range(len(out) - 6, len(out))]
            bull6 = sum(1 for x in last6 if x > 0) / 6.0
            ok = True
        else:
            vol_ratio = 0.0
            bull6 = 0.0
            ok = False
        out.append(Row(i=i, d=d, m=d.month, price=p, ret=ret, vol_ratio=vol_ratio, bull6=bull6, ok=ok))
    return out


def eval_rule(
    dataset: list[Row],
    series: list[tuple[datetime, float]],
    month: int,
    hold_months: int,
    side: str,
    filt: Callable[[Row], bool],
    min_n: int,
) -> dict | None:
    vals: list[float] = []
    for x in dataset:
        if x.m != month or not filt(x):
            continue
        if x.i + hold_months >= len(series):
            continue
        p0 = series[x.i][1]
        p1 = series[x.i + hold_months][1]
        r = (p1 / p0) - 1.0
        vals.append(r if side == "long" else -r)

    if len(vals) < min_n:
        return None

    n = len(vals)
    win = (sum(1 for v in vals if v > 0) / n) * 100.0
    avg = (sum(vals) / n) * 100.0
    gp = sum(v for v in vals if v > 0)
    gl = abs(sum(v for v in vals if v <= 0))
    pf = (gp / gl) if gl > 0 else 999.0
    return {"n": n, "win": win, "avg": avg, "pf": pf}


def main() -> None:
    ap = argparse.ArgumentParser(description="Decades monthly gold recurring-signal study.")
    ap.add_argument("--start-year", type=int, default=1973, help="Start year (default: post-Bretton-Woods 1973)")
    ap.add_argument("--train-split", type=float, default=0.70, help="Train ratio (time-ordered split)")
    ap.add_argument("--holds", default="1,3,6,9,12", help="Comma-separated hold horizons in months")
    ap.add_argument("--min-train-n", type=int, default=20)
    ap.add_argument("--min-test-n", type=int, default=8)
    ap.add_argument("--top-k", type=int, default=8)
    args = ap.parse_args()

    holds = [int(x.strip()) for x in args.holds.split(",") if x.strip()]
    series = load_monthly_gold(args.start_year)
    rows = build_rows(series)
    usable = [x for x in rows if x.ok]

    cut = int(len(usable) * args.train_split)
    train = usable[:cut]
    test = usable[cut:]

    vols = sorted(x.vol_ratio for x in train)
    q60 = vols[int(len(vols) * 0.60)]
    q70 = vols[int(len(vols) * 0.70)]

    filters: list[tuple[str, Callable[[Row], bool]]] = [
        ("none", lambda x: True),
        ("vol>=q60", lambda x: x.vol_ratio >= q60),
        ("vol>=q60 & bull6>=0.5", lambda x: x.vol_ratio >= q60 and x.bull6 >= 0.5),
        ("vol>=q60 & bull6<=0.5", lambda x: x.vol_ratio >= q60 and x.bull6 <= 0.5),
        ("vol>=q70 & bull6>=0.5", lambda x: x.vol_ratio >= q70 and x.bull6 >= 0.5),
        ("vol>=q70 & bull6<=0.5", lambda x: x.vol_ratio >= q70 and x.bull6 <= 0.5),
    ]

    print(f"Span: {series[0][0].strftime('%Y-%m')}..{series[-1][0].strftime('%Y-%m')} ({len(series)} months)")
    print(f"Usable rows: {len(usable)} | Train: {len(train)} | Test: {len(test)}")

    for hold in holds:
        cands: list[tuple] = []
        for month in range(1, 13):
            for side in ["long", "short"]:
                for fname, fn in filters:
                    tr = eval_rule(train, series, month, hold, side, fn, args.min_train_n)
                    if not tr:
                        continue
                    te = eval_rule(test, series, month, hold, side, fn, args.min_test_n)
                    if not te:
                        continue
                    if tr["avg"] <= 0 or te["avg"] <= 0:
                        continue
                    cands.append((te["avg"], te["pf"], tr["avg"], tr["pf"], month, side, fname, tr, te))

        cands.sort(reverse=True)
        print(f"\nBest generalized rules for hold={hold} month(s):")
        for x in cands[: args.top_k]:
            _, _, _, _, month, side, fname, tr, te = x
            print(
                f"{side.upper()} {MONTH_NAMES[month-1]} {fname} | "
                f"TRAIN n={tr['n']} win={tr['win']:.1f}% avg={tr['avg']:+.2f}% pf={tr['pf']:.2f} || "
                f"TEST n={te['n']} win={te['win']:.1f}% avg={te['avg']:+.2f}% pf={te['pf']:.2f}"
            )

    print("\nUnconditional month-of-year baseline (1m forward):")
    for m in range(1, 13):
        vals: list[float] = []
        for x in usable:
            if x.m != m:
                continue
            if x.i + 1 >= len(series):
                continue
            vals.append(((series[x.i + 1][1] / series[x.i][1]) - 1.0) * 100.0)
        up = (sum(1 for v in vals if v > 0) / len(vals)) * 100.0
        print(
            f"{MONTH_NAMES[m-1]} n={len(vals):2d} "
            f"mean={statistics.mean(vals):+5.2f}% median={statistics.median(vals):+5.2f}% up%={up:5.1f}%"
        )


if __name__ == "__main__":
    main()
