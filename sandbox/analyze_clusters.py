#!/usr/bin/env python3
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from ta.momentum import RSIIndicator

# Load data
csv_path = "cache/xrp_paxg_ratio_5m.csv"
df = pd.read_csv(csv_path)
if "iso" in df.columns:
    df["Date"] = pd.to_datetime(df["iso"], utc=True, errors="coerce")
elif "bucketStartMs" in df.columns:
    df["Date"] = pd.to_datetime(df["bucketStartMs"], unit="ms", utc=True, errors="coerce")
df = df.dropna(subset=["Date"]).set_index("Date").sort_index()

df["RSI"] = RSIIndicator(close=df["close"], window=20).rsi()
df = df.dropna(subset=["RSI"]).copy()

open_arr = df['open'].values
high_arr = df['high'].values
low_arr = df['low'].values
rsi_arr = df['RSI'].values

rsi_low = 30
rsi_high = 70
sl_n = 0
r_multi = 5.0
sl_buffer = 0.0

trades = []
position = 0
entry_price = 0.0
stop_loss = 0.0
take_profit = 0.0

n = len(open_arr)
start_idx = max(2, sl_n + 1)

for i in range(start_idx, n):
    if position == 1:
        if low_arr[i] <= stop_loss:
            trades[-1]['exit_i'] = i
            trades[-1]['pnl_r'] = -1.0
            position = 0
        elif high_arr[i] >= take_profit:
            trades[-1]['exit_i'] = i
            trades[-1]['pnl_r'] = r_multi
            position = 0
            
    elif position == -1:
        if high_arr[i] >= stop_loss:
            trades[-1]['exit_i'] = i
            trades[-1]['pnl_r'] = -1.0
            position = 0
        elif low_arr[i] <= take_profit:
            trades[-1]['exit_i'] = i
            trades[-1]['pnl_r'] = r_multi
            position = 0

    if position == 0:
        if rsi_arr[i-1] < rsi_low and rsi_arr[i-2] >= rsi_low:
            entry_price = open_arr[i]
            orig_sl = np.min(low_arr[i-1-sl_n : i])
            orig_risk = entry_price - orig_sl
            if orig_risk > 0:
                stop_loss = orig_sl - (orig_risk * sl_buffer)
                risk = entry_price - stop_loss
                take_profit = entry_price + (risk * r_multi)
                position = 1
                trades.append({'entry_i': i, 'type': 'long', 'pnl_r': 0.0})
                
        elif rsi_arr[i-1] > rsi_high and rsi_arr[i-2] <= rsi_high:
            entry_price = open_arr[i]
            orig_sl = np.max(high_arr[i-1-sl_n : i])
            orig_risk = orig_sl - entry_price
            if orig_risk > 0:
                stop_loss = orig_sl + (orig_risk * sl_buffer)
                risk = stop_loss - entry_price
                take_profit = entry_price - (risk * r_multi)
                position = -1
                trades.append({'entry_i': i, 'type': 'short', 'pnl_r': 0.0})


valid_trades = [t for t in trades if 'exit_i' in t]

clusters = []
current_cluster = []
current_type = None

# A cluster is broken when the RSI crosses the 50 neutral line
for t in valid_trades:
    if len(current_cluster) > 0:
        prev_i = current_cluster[-1]['exit_i']
        curr_i = t['entry_i']
        
        # If type switches, it's a new cluster
        if t['type'] != current_type:
            clusters.append(current_cluster)
            current_cluster = [t]
            current_type = t['type']
        else:
            crossed_50 = False
            # Check if between previous trade exit and current trade entry, the RSI crossed 50
            if t['type'] == 'long':
                if curr_i > prev_i and np.max(rsi_arr[prev_i:curr_i]) >= 50:
                    crossed_50 = True
            else: # short
                if curr_i > prev_i and np.min(rsi_arr[prev_i:curr_i]) <= 50:
                    crossed_50 = True
                    
            if crossed_50:
                clusters.append(current_cluster)
                current_cluster = [t]
                current_type = t['type']
            else:
                current_cluster.append(t)
    else:
        current_cluster = [t]
        current_type = t['type']
        
if current_cluster:
    clusters.append(current_cluster)

single_trades = sum(1 for c in clusters if len(c) == 1)
multi_trade_clusters = [c for c in clusters if len(c) > 1]
total_clusters = len(clusters)

print(f"Total Valid Trades: {len(valid_trades)}")
print(f"Total Unique RSI Swings (Trade Sequences): {total_clusters}")
print(f"Swings triggering exactly ONE trade: {single_trades}")
print(f"Swings triggering MULTIPLE trades (Clusters): {len(multi_trade_clusters)}")

pnl_single = sum(c[0]['pnl_r'] for c in clusters if len(c) == 1)
pnl_multi_total = sum(sum(t['pnl_r'] for t in c) for c in multi_trade_clusters)

multi_winners = 0
multi_losers = 0
multi_cluster_sizes = []
loss_then_win_clusters = 0

for c in multi_trade_clusters:
    multi_cluster_sizes.append(len(c))
    wins = sum(1 for t in c if t['pnl_r'] > 0)
    
    if wins > 0:
        multi_winners += 1
        found_loss = False
        loss_then_win = False
        for t in c:
            if t['pnl_r'] < 0:
                found_loss = True
            elif t['pnl_r'] > 0 and found_loss:
                loss_then_win = True
                break
        if loss_then_win:
            loss_then_win_clusters += 1
    else:
        multi_losers += 1

print(f"\nNet PnL from completely isolated trades (1 trade per swing): {pnl_single:.2f} R")
print(f"Net PnL from multi-trigger cluster events: {pnl_multi_total:.2f} R")

print(f"\nOut of the {len(multi_trade_clusters)} multi-trigger events:")
# Count only valid lengths. Some might be empty if malformed but shouldn't be.
print(f"   They generated a total of {sum(multi_cluster_sizes)} individual trades")
print(f"   Events where EVERY trade was consecutively stopped out: {multi_losers}")
print(f"   Events where at least ONE trade eventually hit the 5.0R winner: {multi_winners}")
print(f"     -> Of those {multi_winners} winning events, how many were multiple losses FINALLY followed by a 5.0R win: {loss_then_win_clusters}")
