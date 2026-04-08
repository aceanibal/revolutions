#!/usr/bin/env python3

import argparse
import os
import time
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator
import itertools

def parse_args():
    default_input = os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m.csv")
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=default_input, help="Input CSV path")
    ap.add_argument("--rsi-period", type=int, default=20, help="RSI period")
    ap.add_argument("--tf", type=str, default="4h", help="Timeframe to resample (e.g. 5m, 1h, 4h)")
    return ap.parse_args()

def load_data(csv_path: str, rsi_period: int, timeframe: str) -> pd.DataFrame:
    print(f"Loading data from {csv_path}...")
    df = pd.read_csv(csv_path)
    if "iso" in df.columns:
        df["Date"] = pd.to_datetime(df["iso"], utc=True, errors="coerce")
    elif "bucketStartMs" in df.columns:
        df["Date"] = pd.to_datetime(df["bucketStartMs"], unit="ms", utc=True, errors="coerce")
    df = df.dropna(subset=["Date"]).set_index("Date").sort_index()
    
    if timeframe.lower() != "5m":
        print(f"Resampling data to {timeframe} timeframe...")
        df = df.resample(timeframe).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna()
        
    print(f"Calculating RSI({rsi_period})...")
    df["RSI"] = RSIIndicator(close=df["close"], window=rsi_period).rsi()
    df = df.dropna(subset=["RSI"]).copy()
    return df

def run_simulation(open_arr, high_arr, low_arr, rsi_arr, rsi_low, rsi_high, sl_n, r_multi, fee_bps=9.0):
    trades = []
    position = 0  # 0: flat, 1: long, -1: short
    entry_price = 0.0
    stop_loss = 0.0
    take_profit = 0.0
    stop_loss_orig = 0.0
    
    n = len(open_arr)
    start_idx = max(2, sl_n + 1)
    
    for i in range(start_idx, n):
        # 1. Check open positions for Exits FIRST before entering anything new
        if position == 1:
            fee_r = (entry_price * (fee_bps / 10000.0)) / (entry_price - stop_loss) if entry_price > stop_loss else 0.0
            if low_arr[i] <= stop_loss:
                trades.append({'pnl_r': -1.0 - fee_r, 'reason': 'SL'})
                position = 0
            elif high_arr[i] >= take_profit:
                trades.append({'pnl_r': r_multi - fee_r, 'reason': 'TP'})
                position = 0
                
        elif position == -1:
            fee_r = (entry_price * (fee_bps / 10000.0)) / (stop_loss - entry_price) if stop_loss > entry_price else 0.0
            if high_arr[i] >= stop_loss:
                trades.append({'pnl_r': -1.0 - fee_r, 'reason': 'SL'})
                position = 0
            elif low_arr[i] <= take_profit:
                trades.append({'pnl_r': r_multi - fee_r, 'reason': 'TP'})
                position = 0

        # 2. Check for new entries if flat
        elif position == 0:
            if rsi_arr[i-1] < rsi_low and rsi_arr[i-2] >= rsi_low:
                entry_price = open_arr[i]
                stop_loss = np.min(low_arr[i-1-sl_n : i])
                risk = entry_price - stop_loss
                if risk > 0:
                    take_profit = entry_price + (risk * r_multi)
                    position = 1
                    stop_loss_orig = stop_loss
                    
            elif rsi_arr[i-1] > rsi_high and rsi_arr[i-2] <= rsi_high:
                entry_price = open_arr[i]
                stop_loss = np.max(high_arr[i-1-sl_n : i])
                risk = stop_loss - entry_price
                if risk > 0:
                    take_profit = entry_price - (risk * r_multi)
                    position = -1
                    stop_loss_orig = stop_loss
                    
    if len(trades) == 0:
        return 0.0, 0.0, 0.0, 0
    
    pnl_array = np.array([t['pnl_r'] for t in trades])
    total_pnl = np.sum(pnl_array)
    win_rate = np.mean(pnl_array > 0) * 100
    
    cum_pnl = np.cumsum(pnl_array)
    peak = np.maximum.accumulate(cum_pnl)
    drawdowns = peak - cum_pnl
    max_dd = np.max(drawdowns)
    
    return total_pnl, win_rate, max_dd, len(trades)

def main():
    args = parse_args()
    df = load_data(args.input, args.rsi_period, args.tf)
    
    open_arr = df['open'].values
    high_arr = df['high'].values
    low_arr = df['low'].values
    rsi_arr = df['RSI'].values
    
    print(f"Data loaded. Valid bars for backtesting: {len(open_arr)}")

    # Grid mapping with new friction calculations
    rsi_lows = [25, 30, 35, 40]
    rsi_highs = [60, 65, 70, 75]
    sl_ns = [0, 1, 2, 3, 5]
    r_multis = [1.0, 1.5, 2.0, 3.0, 4.0, 5.0]
    fee_bps_to_test = 9.0  # Taker/Taker Full Loop 0.09%
    
    grid = list(itertools.product(rsi_lows, rsi_highs, sl_ns, r_multis))
    print(f"Running Optimization Grid with {fee_bps_to_test} bps friction: {len(grid)} combinations...\n")
    
    results = []
    
    t0 = time.time()
    for (rl, rh, sln, rm) in grid:
        pnl, wr, maxdd, n_trades = run_simulation(
            open_arr, high_arr, low_arr, rsi_arr, rl, rh, sln, rm, fee_bps_to_test
        )
        if n_trades >= 10:
            results.append({
                'RSI_L': rl, 'RSI_H': rh, 'SL_N': sln, 'R_Mult': rm, 'BPS': fee_bps_to_test,
                'Total_PnL_R': pnl, 'Win%': wr, 'Max_DD_R': maxdd, 'Trades': n_trades
            })
            
    t1 = time.time()
    
    if not results:
        print("No valid combinations returned 10 or more trades.")
        return

    results.sort(key=lambda x: x['Total_PnL_R'], reverse=True)
    
    print(f"Optimization finished in {t1-t0:.2f} seconds.")
    print("-" * 90)
    print(f"{'RSI_L':<6} {'RSI_H':<6} {'SL_N':<5} {'R_Mult':<8} {'Fee_BPS':<8} | {'PnL (R)':<10} {'WinRate':<8} {'Max DD':<8} {'Trades':<8}")
    print("-" * 90)
    
    for r in results[:40]:
        print(f"{r['RSI_L']:<6} {r['RSI_H']:<6} {r['SL_N']:<5} {r['R_Mult']:<8} {r['BPS']:<8} | "
              f"{r['Total_PnL_R']:<10.2f} {r['Win%']:<7.1f}% {r['Max_DD_R']:<8.2f} {r['Trades']:<8}")

if __name__ == "__main__":
    main()
