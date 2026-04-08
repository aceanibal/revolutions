#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
from datetime import datetime, timezone


DEFAULT_DB = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")
DAY_MS = 24 * 60 * 60 * 1000


def utc_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def discover_longest_hist_session(conn: sqlite3.Connection, symbol: str, timeframe: str) -> str | None:
    row = conn.execute(
        """
        SELECT sc.session_id
        FROM session_candles sc
        JOIN sessions s ON s.id = sc.session_id
        WHERE s.session_type = 'historical'
          AND sc.symbol = ?
          AND sc.timeframe = ?
        GROUP BY sc.session_id
        ORDER BY COUNT(*) DESC
        LIMIT 1
        """,
        (symbol, timeframe),
    ).fetchone()
    return str(row[0]) if row else None


def load_candles_by_bucket(
    conn: sqlite3.Connection, session_id: str, symbol: str, timeframe: str
) -> dict[int, dict]:
    rows = conn.execute(
        """
        SELECT bucket_start_ms, open, high, low, close, volume, is_gap_fill
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = ?
        ORDER BY bucket_start_ms ASC
        """,
        (session_id, symbol, timeframe),
    ).fetchall()
    out: dict[int, dict] = {}
    for row in rows:
        bucket = int(row[0])
        out[bucket] = {
            "bucket_start_ms": bucket,
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5] or 0.0),
            "is_gap_fill": int(row[6] or 0),
        }
    return out


def build_ratio_rows(
    xrp_by_bucket: dict[int, dict],
    paxg_by_bucket: dict[int, dict],
    include_gap_fill: bool,
    volume_method: str,
) -> tuple[list[dict], dict]:
    common_buckets = sorted(set(xrp_by_bucket.keys()).intersection(paxg_by_bucket.keys()))
    dropped = {"gap_fill": 0, "invalid_divisor": 0, "invalid_ohlc": 0}
    rows: list[dict] = []

    for bucket in common_buckets:
        xrp = xrp_by_bucket[bucket]
        paxg = paxg_by_bucket[bucket]
        if not include_gap_fill and (xrp["is_gap_fill"] or paxg["is_gap_fill"]):
            dropped["gap_fill"] += 1
            continue

        paxg_open = paxg["open"]
        paxg_high = paxg["high"]
        paxg_low = paxg["low"]
        paxg_close = paxg["close"]
        if paxg_open <= 0 or paxg_high <= 0 or paxg_low <= 0 or paxg_close <= 0:
            dropped["invalid_divisor"] += 1
            continue

        open_px = xrp["open"] / paxg_open
        high_px = xrp["high"] / paxg_low
        low_px = xrp["low"] / paxg_high
        close_px = xrp["close"] / paxg_close
        if not all(math.isfinite(v) for v in (open_px, high_px, low_px, close_px)):
            dropped["invalid_ohlc"] += 1
            continue

        xrp_vol = max(0.0, float(xrp["volume"]))
        paxg_vol = max(0.0, float(paxg["volume"]))
        if volume_method == "min":
            vol = min(xrp_vol, paxg_vol)
        else:
            vol = 0.0 if xrp_vol <= 0 or paxg_vol <= 0 else math.sqrt(xrp_vol * paxg_vol)

        rows.append(
            {
                "bucketStartMs": bucket,
                "open": float(open_px),
                "high": float(max(high_px, open_px, close_px, low_px)),
                "low": float(min(low_px, open_px, close_px, high_px)),
                "close": float(close_px),
                "volume": float(vol),
            }
        )

    dropped["overlap_buckets"] = len(common_buckets)
    dropped["derived_buckets"] = len(rows)
    return rows, dropped


def save_rows(rows: list[dict], csv_path: str, ndjson_path: str, ratio_symbol: str, timeframe: str) -> None:
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    os.makedirs(os.path.dirname(ndjson_path), exist_ok=True)

    with open(csv_path, "w", newline="", encoding="utf-8") as f_csv:
        writer = csv.DictWriter(
            f_csv,
            fieldnames=["bucketStartMs", "iso", "open", "high", "low", "close", "volume"],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "bucketStartMs": row["bucketStartMs"],
                    "iso": utc_iso(int(row["bucketStartMs"])),
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "volume": row["volume"],
                }
            )

    with open(ndjson_path, "w", encoding="utf-8") as f_nd:
        for row in rows:
            payload = {
                "symbol": ratio_symbol,
                "timeframe": timeframe,
                **row,
            }
            f_nd.write(json.dumps(payload) + "\n")


def upsert_ratio_session(
    conn: sqlite3.Connection,
    session_id: str,
    ratio_symbol: str,
    timeframe: str,
    rows: list[dict],
    metadata: dict,
    replace: bool,
) -> None:
    start_ms = int(rows[0]["bucketStartMs"])
    end_ms = int(rows[-1]["bucketStartMs"])
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    with conn:
        existing = conn.execute("SELECT id, session_type FROM sessions WHERE id = ? LIMIT 1", (session_id,)).fetchone()
        if existing:
            if str(existing[1] or "live") != "historical":
                raise RuntimeError(f"Session {session_id} exists and is not historical.")
            if not replace:
                raise RuntimeError(f"Session {session_id} already exists. Use --replace to overwrite it.")
            tables = [
                ("session_ticks", "session_id"),
                ("session_candles", "session_id"),
                ("session_notes", "session_id"),
                ("session_trades", "session_id"),
                ("session_trade_state", "session_id"),
                ("session_external_metadata", "session_id"),
                ("sessions", "id"),
            ]
            for table, col in tables:
                conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (session_id,))

        conn.execute(
            """
            INSERT INTO sessions (
              id, market_window_start, market_window_end, started_at_ms, ended_at_ms, session_type, status,
              break_reason, asset_count, tick_count, candle_count, last_saved_at_ms, active_streams_json
            )
            VALUES (?, ?, ?, ?, ?, 'historical', 'imported', NULL, 1, 0, ?, ?, ?)
            """,
            (
                session_id,
                start_ms,
                end_ms,
                start_ms,
                end_ms,
                len(rows),
                now_ms,
                json.dumps([ratio_symbol]),
            ),
        )

        conn.executemany(
            """
            INSERT INTO session_candles (
              session_id, symbol, timeframe, bucket_start_ms, open, high, low, close, volume, source, is_gap_fill
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'history', 0)
            """,
            [
                (
                    session_id,
                    ratio_symbol,
                    timeframe,
                    int(r["bucketStartMs"]),
                    float(r["open"]),
                    float(r["high"]),
                    float(r["low"]),
                    float(r["close"]),
                    float(r["volume"]),
                )
                for r in rows
            ],
        )

        conn.execute(
            """
            INSERT INTO session_external_metadata (session_id, tool, source_id, payload_json, imported_at_ms)
            VALUES (?, 'ratio-builder', 'xrp-paxg-python', ?, ?)
            """,
            (session_id, json.dumps(metadata), now_ms),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build XRP/PAXG normalized 5m ratio candles from backtester DB.")
    parser.add_argument("--db", default=DEFAULT_DB, help="Path to backtester SQLite DB")
    parser.add_argument("--timeframe", default="5m", choices=["1m", "5m"])
    parser.add_argument("--xrp-session", default="", help="Optional source session id for XRPUSDT")
    parser.add_argument("--paxg-session", default="", help="Optional source session id for PAXGUSDT")
    parser.add_argument("--xrp-symbol", default="XRPUSDT")
    parser.add_argument("--paxg-symbol", default="PAXGUSDT")
    parser.add_argument("--ratio-symbol", default="XRPUSDT_PER_PAXGUSDT")
    parser.add_argument("--volume-method", default="geom_mean", choices=["geom_mean", "min"])
    parser.add_argument("--include-gap-fill", action="store_true")
    parser.add_argument("--session-id", default="")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument(
        "--out-csv",
        default=os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m.csv"),
    )
    parser.add_argument(
        "--out-ndjson",
        default=os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m.ndjson"),
    )
    args = parser.parse_args()

    db_path = os.path.abspath(args.db)
    conn = sqlite3.connect(db_path)
    try:
        xrp_symbol = args.xrp_symbol.strip().upper()
        paxg_symbol = args.paxg_symbol.strip().upper()
        ratio_symbol = args.ratio_symbol.strip().upper()
        timeframe = args.timeframe.strip().lower()

        xrp_session = args.xrp_session.strip() or discover_longest_hist_session(conn, xrp_symbol, timeframe)
        paxg_session = args.paxg_session.strip() or discover_longest_hist_session(conn, paxg_symbol, timeframe)
        if not xrp_session or not paxg_session:
            raise SystemExit(
                f"Missing historical session for {xrp_symbol if not xrp_session else paxg_symbol}. "
                f"Use --xrp-session/--paxg-session or import missing symbol first."
            )

        xrp_by_bucket = load_candles_by_bucket(conn, xrp_session, xrp_symbol, timeframe)
        paxg_by_bucket = load_candles_by_bucket(conn, paxg_session, paxg_symbol, timeframe)
        if not xrp_by_bucket or not paxg_by_bucket:
            raise SystemExit("No candles loaded for one or both source series.")

        rows, dropped = build_ratio_rows(
            xrp_by_bucket=xrp_by_bucket,
            paxg_by_bucket=paxg_by_bucket,
            include_gap_fill=bool(args.include_gap_fill),
            volume_method=args.volume_method,
        )
        if not rows:
            raise SystemExit("No derived ratio rows were produced.")

        save_rows(
            rows=rows,
            csv_path=os.path.abspath(args.out_csv),
            ndjson_path=os.path.abspath(args.out_ndjson),
            ratio_symbol=ratio_symbol,
            timeframe=timeframe,
        )

        start_ms = int(rows[0]["bucketStartMs"])
        end_ms = int(rows[-1]["bucketStartMs"])
        session_id = args.session_id.strip() or (
            f"hist-xrp-paxg-ratio-{timeframe}-"
            f"{datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc):%Y%m%d}-"
            f"{datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc):%Y%m%d}"
        )

        meta = {
            "ratioDefinition": f"{xrp_symbol}/{paxg_symbol}",
            "ratioSymbol": ratio_symbol,
            "timeframe": timeframe,
            "volumeMethod": args.volume_method,
            "includeGapFill": bool(args.include_gap_fill),
            "sourceSessions": {"xrp": xrp_session, "paxg": paxg_session},
            "overlapBuckets": int(dropped["overlap_buckets"]),
            "derivedBuckets": int(dropped["derived_buckets"]),
            "dropped": {
                "gapFill": int(dropped["gap_fill"]),
                "invalidDivisor": int(dropped["invalid_divisor"]),
                "invalidOhlc": int(dropped["invalid_ohlc"]),
            },
        }
        upsert_ratio_session(
            conn=conn,
            session_id=session_id,
            ratio_symbol=ratio_symbol,
            timeframe=timeframe,
            rows=rows,
            metadata=meta,
            replace=bool(args.replace),
        )

        print(
            json.dumps(
                {
                    "ok": True,
                    "db": db_path,
                    "sessionId": session_id,
                    "ratioSymbol": ratio_symbol,
                    "timeframe": timeframe,
                    "sourceSessions": {"xrp": xrp_session, "paxg": paxg_session},
                    "stats": {
                        "rows": len(rows),
                        "spanDays": round((end_ms - start_ms) / DAY_MS, 3),
                        "startMs": start_ms,
                        "endMs": end_ms,
                        "startIso": utc_iso(start_ms),
                        "endIso": utc_iso(end_ms),
                    },
                    "dropped": meta["dropped"],
                    "savedFiles": {
                        "csv": os.path.abspath(args.out_csv),
                        "ndjson": os.path.abspath(args.out_ndjson),
                    },
                },
                indent=2,
            )
        )
    finally:
        conn.close()


if __name__ == "__main__":
    main()
