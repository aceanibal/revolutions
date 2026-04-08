#!/usr/bin/env python3
import warnings
warnings.filterwarnings('ignore')
import argparse
import os
import time
import sqlite3
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator
import itertools

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backtester", "data", "backtest.sqlite")

def list_sessions_with_symbol(db_path: str, symbol: str) -> list[tuple[str, int]]:
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
    conn = sqlite3.connect(db_path)
    df = pd.read_sql_query(
        """
        SELECT bucket_start_ms, open, high, low, close, volume
        FROM session_candles
        WHERE session_id = ? AND symbol = ? AND timeframe = '5m'
        ORDER BY bucket_start_ms
        """,
        conn,
        params=(session_id, symbol)
    )
    conn.close()
    
    if len(df) == 0:
        return df
        
    df["Date"] = pd.to_datetime(df["bucket_start_ms"], unit="ms", utc=True)
    df = df.set_index("Date").sort_index()
    return df

def run_simulation(open_arr, high_arr, low_arr, rsi_arr, rsi_low, rsi_high, sl_n, r_multi, fee_bps=9.0):
    trades = []
    position = 0  # 0: flat, 1: long, -1: short
    entry_price = 0.0
    stop_loss = 0.0
    take_profit = 0.0
    entry_idx = 0
    
    n = len(open_arr)
    start_idx = max(2, sl_n + 1)
    
    for i in range(start_idx, n):
        # 1. Exits
        if position == 1:
            fee_r = (entry_price * (fee_bps / 10000.0)) / (entry_price - stop_loss) if entry_price > stop_loss else 0.0
            if low_arr[i] <= stop_loss:
                trades.append({'pnl_r': -1.0 - fee_r, 'reason': 'SL', 'bars': i - entry_idx})
                position = 0
            elif high_arr[i] >= take_profit:
                trades.append({'pnl_r': r_multi - fee_r, 'reason': 'TP', 'bars': i - entry_idx})
                position = 0
                
        elif position == -1:
            fee_r = (entry_price * (fee_bps / 10000.0)) / (stop_loss - entry_price) if stop_loss > entry_price else 0.0
            if high_arr[i] >= stop_loss:
                trades.append({'pnl_r': -1.0 - fee_r, 'reason': 'SL', 'bars': i - entry_idx})
                position = 0
            elif low_arr[i] <= take_profit:
                trades.append({'pnl_r': r_multi - fee_r, 'reason': 'TP', 'bars': i - entry_idx})
                position = 0

        # 2. Entries
        elif position == 0:
            if rsi_arr[i-1] < rsi_low and rsi_arr[i-2] >= rsi_low:
                entry_price = open_arr[i]
                stop_loss = np.min(low_arr[i-1-sl_n : i])
                risk = entry_price - stop_loss
                if risk > 0:
                    take_profit = entry_price + (risk * r_multi)
                    position = 1
                    entry_idx = i
                    
            elif rsi_arr[i-1] > rsi_high and rsi_arr[i-2] <= rsi_high:
                entry_price = open_arr[i]
                stop_loss = np.max(high_arr[i-1-sl_n : i])
                risk = stop_loss - entry_price
                if risk > 0:
                    take_profit = entry_price - (risk * r_multi)
                    position = -1
                    entry_idx = i
                    
    if len(trades) == 0:
        return 0.0, 0.0, 0.0, 0, 0.0, 0, 0
    
    pnl_array = np.array([t['pnl_r'] for t in trades])
    bars_array = np.array([t['bars'] for t in trades])
    
    total_pnl = np.sum(pnl_array)
    win_rate = np.mean(pnl_array > 0) * 100
    avg_bars = np.mean(bars_array)
    min_bars = int(np.min(bars_array))
    max_bars = int(np.max(bars_array))
    
    cum_pnl = np.cumsum(pnl_array)
    peak = np.maximum.accumulate(cum_pnl)
    drawdowns = peak - cum_pnl
    max_dd = np.max(drawdowns)
    
    return total_pnl, win_rate, max_dd, len(trades), avg_bars, min_bars, max_bars


def run_simulation_trades(
    open_arr, high_arr, low_arr, rsi_arr, rsi_low, rsi_high, sl_n, r_multi, fee_bps=9.0
):
    """
    Same logic as run_simulation but returns each closed trade for LTF replay / management studies.

    Each trade dict: entry_idx, exit_idx, side (+1 long / -1 short), entry_price, stop_loss,
    take_profit, risk (price distance), pnl_r, reason ('SL'|'TP'), fee_r, bars.
    """
    trades = []
    position = 0
    entry_price = 0.0
    stop_loss = 0.0
    take_profit = 0.0
    entry_idx = 0

    n = len(open_arr)
    start_idx = max(2, sl_n + 1)

    for i in range(start_idx, n):
        if position == 1:
            risk_d = entry_price - stop_loss
            fee_r = (
                (entry_price * (fee_bps / 10000.0)) / risk_d if risk_d > 0 else 0.0
            )
            if low_arr[i] <= stop_loss:
                trades.append(
                    {
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "side": 1,
                        "entry_price": entry_price,
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "risk": risk_d,
                        "pnl_r": -1.0 - fee_r,
                        "reason": "SL",
                        "fee_r": fee_r,
                        "bars": i - entry_idx,
                    }
                )
                position = 0
            elif high_arr[i] >= take_profit:
                trades.append(
                    {
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "side": 1,
                        "entry_price": entry_price,
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "risk": risk_d,
                        "pnl_r": r_multi - fee_r,
                        "reason": "TP",
                        "fee_r": fee_r,
                        "bars": i - entry_idx,
                    }
                )
                position = 0

        elif position == -1:
            risk_d = stop_loss - entry_price
            fee_r = (
                (entry_price * (fee_bps / 10000.0)) / risk_d if risk_d > 0 else 0.0
            )
            if high_arr[i] >= stop_loss:
                trades.append(
                    {
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "side": -1,
                        "entry_price": entry_price,
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "risk": risk_d,
                        "pnl_r": -1.0 - fee_r,
                        "reason": "SL",
                        "fee_r": fee_r,
                        "bars": i - entry_idx,
                    }
                )
                position = 0
            elif low_arr[i] <= take_profit:
                trades.append(
                    {
                        "entry_idx": entry_idx,
                        "exit_idx": i,
                        "side": -1,
                        "entry_price": entry_price,
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "risk": risk_d,
                        "pnl_r": r_multi - fee_r,
                        "reason": "TP",
                        "fee_r": fee_r,
                        "bars": i - entry_idx,
                    }
                )
                position = 0

        elif position == 0:
            if rsi_arr[i - 1] < rsi_low and rsi_arr[i - 2] >= rsi_low:
                entry_price = open_arr[i]
                stop_loss = np.min(low_arr[i - 1 - sl_n : i])
                risk = entry_price - stop_loss
                if risk > 0:
                    take_profit = entry_price + (risk * r_multi)
                    position = 1
                    entry_idx = i

            elif rsi_arr[i - 1] > rsi_high and rsi_arr[i - 2] <= rsi_high:
                entry_price = open_arr[i]
                stop_loss = np.max(high_arr[i - 1 - sl_n : i])
                risk = stop_loss - entry_price
                if risk > 0:
                    take_profit = entry_price - (risk * r_multi)
                    position = -1
                    entry_idx = i

    return trades


def load_asset_data(assets: list[str]) -> dict:
    asset_data = {}
    for symbol in assets:
        sessions = list_sessions_with_symbol(DB_PATH, symbol)
        if not sessions:
            continue
        session_id = sessions[0][0]
        df_5m = load_5m_candles(DB_PATH, session_id, symbol)
        if len(df_5m) == 0:
            continue

        df_4h = df_5m.resample('4h').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()

        df_4h["RSI"] = RSIIndicator(close=df_4h["close"], window=20).rsi()
        df_4h = df_4h.dropna(subset=["RSI"]).copy()

        asset_data[symbol] = {
            'open': df_4h['open'].values,
            'high': df_4h['high'].values,
            'low': df_4h['low'].values,
            'RSI': df_4h['RSI'].values
        }
    return asset_data


def report_fixed_universal_rule(asset_data: dict, fee_bps: float, rl: int, rh: int, sln: int, rm: float) -> None:
    """Print per-asset stats for a single rule (no grid). Hold times are 4h-bar counts × 4 hours."""
    rows = []
    for sym, d in asset_data.items():
        pnl, wr, maxdd, n_trades, avg_b, min_b, max_b = run_simulation(
            d['open'], d['high'], d['low'], d['RSI'], rl, rh, sln, rm, fee_bps
        )
        rows.append({
            'Symbol': sym,
            'PnL': pnl,
            'WinRate': wr,
            'Trades': n_trades,
            'AvgHoldH': avg_b * 4.0,
            'MinHoldH': min_b * 4.0,
            'MaxHoldH': max_b * 4.0,
        })
    rows.sort(key=lambda x: x['PnL'], reverse=True)
    total_all = sum(r['PnL'] for r in rows)
    legacy_top4_syms = {'BTCUSDT', 'LINKUSDT', 'SOLUSDT', 'XRPUSDT'}
    total_legacy_top4 = sum(r['PnL'] for r in rows if r['Symbol'] in legacy_top4_syms)
    total_ex_doge = sum(r['PnL'] for r in rows if r['Symbol'] != 'DOGEUSDT')

    print(f"\nFixed rule: RSI {rl}/{rh} | SL_N={sln} | TP={rm}R | fee={fee_bps} bps RT\n")
    print(f"{'Symbol':<12} {'PnL (R)':>10} {'Win%':>8} {'Trades':>8} {'AvgH(h)':>10} {'MinH(h)':>10} {'MaxH(h)':>10}")
    print("-" * 82)
    for r in rows:
        print(
            f"{r['Symbol']:<12} {r['PnL']:>10.2f} {r['WinRate']:>7.1f}% {r['Trades']:>8} "
            f"{r['AvgHoldH']:>10.1f} {r['MinHoldH']:>10.1f} {r['MaxHoldH']:>10.1f}"
        )
    print("-" * 82)
    print(
        f"Sum (all listed): {total_all:.2f} R | "
        f"Sum (BTC+LINK+SOL+XRP): {total_legacy_top4:.2f} R | "
        f"Sum (ex-DOGE): {total_ex_doge:.2f} R\n"
    )


def main():
    ap = argparse.ArgumentParser(description="4h RSI universal grid or fixed-rule report (DB-backed)")
    ap.add_argument("--fee-bps", type=float, default=9.0, help="Round-trip fee in basis points")
    ap.add_argument(
        "--fixed-rule-report",
        action="store_true",
        help="Skip grid; print RSI 35/60 | SL_N=3 | TP=5R for each asset",
    )
    args = ap.parse_args()
    fee_bps = args.fee_bps

    assets = [
        "BTCUSDT",
        "LINKUSDT",
        "DOGEUSDT",
        "SOLUSDT",
        "XRPUSDT",
        "ETHUSDT",
        "PAXGUSDT",
    ]

    rsi_lows = [25, 30, 35, 40]
    rsi_highs = [60, 65, 70, 75]
    sl_ns = [0, 1, 2, 3, 5]
    r_multis = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0]

    grid = list(itertools.product(rsi_lows, rsi_highs, sl_ns, r_multis))

    # 1. Preload all Dataframes
    asset_data = load_asset_data(assets)
    if not asset_data:
        print("No asset data loaded; check DB and symbols.")
        return
    missing = sorted(set(assets) - set(asset_data.keys()))
    if missing:
        print(f"Warning: no historical 5m session for: {', '.join(missing)}\n")

    if args.fixed_rule_report:
        report_fixed_universal_rule(asset_data, fee_bps, 35, 60, 3, 5.0)
        return

    print(f"Beginning Universal Rule Multi-Asset Analysis...")
    print(f"Combinations to Test: {len(grid)}")
    print(f"Execution Fees: {fee_bps} bps RT\n")

    # 2. Score Universal Rules
    universal_scores = []
    
    n_assets = len(asset_data)
    print(f"Scoring all Parameter Sets across exactly {n_assets} assets universally...")
    for (rl, rh, sln, rm) in grid:
        total_grid_pnl = 0
        total_grid_trades = 0
        grid_wins = []
        valid_assets = 0
        
        for sym, d in asset_data.items():
            pnl, wr, maxdd, n_trades, avg_b, _min_b, _max_b = run_simulation(
                d['open'], d['high'], d['low'], d['RSI'], rl, rh, sln, rm, fee_bps
            )
            total_grid_pnl += pnl
            total_grid_trades += n_trades
            if n_trades > 0:
                valid_assets += 1
                grid_wins.append(wr)
                
        if total_grid_trades >= 30 and valid_assets == len(asset_data):
            universal_scores.append({
                'RSI_L': rl, 'RSI_H': rh, 'SL_N': sln, 'R_Mult': rm,
                'Total_PnL': total_grid_pnl,
                'Avg_WinRate': np.mean(grid_wins) if grid_wins else 0,
                'Total_Trades': total_grid_trades
            })
            
    universal_scores.sort(key=lambda x: x['Total_PnL'], reverse=True)
    best_universal = universal_scores[0]
    
    print("\n=======================================================")
    print(f"THE BEST UNIVERSAL RULE SET FOUND:")
    print(f"RSI: {best_universal['RSI_L']} / {best_universal['RSI_H']} | SL_N: {best_universal['SL_N']} | TP Multi: {best_universal['R_Mult']}x")
    print(f"Combined PnL across all assets: {best_universal['Total_PnL']:.2f} R")
    print(f"Avg Asset Win Rate: {best_universal['Avg_WinRate']:.1f}% | Total Operations: {best_universal['Total_Trades']}")
    print("=======================================================\n")
    
    # 3. Apply the Best Universal Rule to each Individual Asset
    print(f"ASSET RANKING UNDER UNIVERSAL RULES:")
    results_by_asset = []
    for sym, d in asset_data.items():
        pnl, wr, maxdd, n_trades, avg_b, min_b, max_b = run_simulation(
            d['open'], d['high'], d['low'], d['RSI'], 
            best_universal['RSI_L'], best_universal['RSI_H'], 
            best_universal['SL_N'], best_universal['R_Mult'], fee_bps
        )
        results_by_asset.append({
            'Symbol': sym, 'PnL': pnl, 'WinRate': wr, 'MaxDD': maxdd, 'Trades': n_trades,
            'AvgHoldHours': avg_b * 4.0, 'MinHoldHours': min_b * 4.0, 'MaxHoldHours': max_b * 4.0,
        })
        
    results_by_asset.sort(key=lambda x: x['PnL'], reverse=True)
    
    for i, res in enumerate(results_by_asset):
        print(f"#{i+1}. {res['Symbol']:<10} | PnL: {res['PnL']:>7.2f} R | Win: {res['WinRate']:>4.1f}% | DD: {res['MaxDD']:>6.2f} R | Trades: {res['Trades']} | Avg Hold: {res['AvgHoldHours']:.1f} hrs")

if __name__ == "__main__":
    main()
