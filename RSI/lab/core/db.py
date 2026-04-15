"""
Database access utilities.

Single source of truth for loading candle data from the shared SQLite DB.
db_path is always a parameter — no module-level path constants.
"""
from __future__ import annotations

import sqlite3

import pandas as pd


def list_sessions_with_symbol(db_path: str, symbol: str) -> list[tuple[str, int]]:
    """Return (session_id, candle_count) for all historical 5m sessions, ordered by count desc."""
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        """
        SELECT sc.session_id, COUNT(*) AS cnt
        FROM session_candles sc
        JOIN sessions s ON s.id = sc.session_id
        WHERE sc.symbol = ? AND sc.timeframe = '5m'
          AND s.session_type = 'historical'
        GROUP BY sc.session_id
        ORDER BY cnt DESC
        """,
        (symbol,),
    )
    rows = [(r[0], r[1]) for r in cur.fetchall()]
    conn.close()
    return rows


def load_5m_candles(db_path: str, session_id: str, symbol: str) -> pd.DataFrame:
    """Load raw 5m candles for one session. Returns DataFrame with UTC DatetimeIndex."""
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query(
        """
        SELECT bucket_start_ms, open, high, low, close, volume
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = '5m'
        ORDER BY bucket_start_ms
        """,
        conn,
        params=(session_id, symbol),
    )
    conn.close()
    if len(df) == 0:
        return df
    df["Date"] = pd.to_datetime(df["bucket_start_ms"], unit="ms", utc=True)
    return df.set_index("Date").sort_index()[["open", "high", "low", "close", "volume"]]


def load_merged_5m(db_path: str, symbol: str) -> pd.DataFrame:
    """
    Merge all historical 5m sessions for a symbol and deduplicate by bar timestamp.

    Dedup rule: when two sessions share a timestamp, keep the first occurrence
    (equivalent to lowest session_id). Matches the backtest engine's behavior.
    """
    sessions = list_sessions_with_symbol(db_path, symbol)
    frames: list[pd.DataFrame] = []
    for session_id, _ in sessions:
        df = load_5m_candles(db_path, session_id, symbol)
        if len(df) > 0:
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames).sort_index()
    return out[~out.index.duplicated(keep="first")]


def load_candles_window(
    db_path: str,
    symbol: str,
    start_ms: int,
    end_ms: int,
) -> pd.DataFrame:
    """
    Load deduplicated 5m candles in a specific millisecond window.
    Used by the Streamlit app for trade chart rendering.
    """
    conn = sqlite3.connect(db_path)
    sql = """
        WITH ranked AS (
            SELECT
                sc.bucket_start_ms, sc.open, sc.high, sc.low, sc.close, sc.volume,
                ROW_NUMBER() OVER (
                    PARTITION BY sc.bucket_start_ms ORDER BY sc.session_id ASC
                ) AS rn
            FROM session_candles sc
            JOIN sessions s ON s.id = sc.session_id
            WHERE sc.timeframe = '5m'
              AND s.session_type = 'historical'
              AND sc.symbol = ?
              AND sc.bucket_start_ms >= ?
              AND sc.bucket_start_ms <= ?
        )
        SELECT bucket_start_ms, open, high, low, close, volume
        FROM ranked WHERE rn = 1
        ORDER BY bucket_start_ms
    """
    try:
        df = pd.read_sql_query(sql, conn, params=(symbol, start_ms, end_ms))
    except Exception:
        # Fallback for simpler DB schemas without the sessions JOIN
        df = pd.read_sql_query(
            """
            SELECT bucket_start_ms, open, high, low, close, volume
            FROM session_candles
            WHERE symbol = ? AND timeframe = '5m'
              AND bucket_start_ms >= ? AND bucket_start_ms <= ?
            ORDER BY bucket_start_ms
            """,
            conn,
            params=(symbol, start_ms, end_ms),
        )
    conn.close()
    if len(df) == 0:
        return pd.DataFrame()
    df["ts"] = pd.to_datetime(df["bucket_start_ms"], unit="ms", utc=True)
    return df.set_index("ts").sort_index()[["open", "high", "low", "close", "volume"]]
