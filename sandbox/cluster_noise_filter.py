#!/usr/bin/env python3
import warnings
warnings.filterwarnings('ignore')
import os
import pandas as pd
import numpy as np
from ta.momentum import RSIIndicator
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans

# 1. Load Data & Compute Features
csv_path = "cache/xrp_paxg_ratio_5m.csv"
print("Loading data and computing ML features...")
df = pd.read_csv(csv_path)
if "iso" in df.columns:
    df["Date"] = pd.to_datetime(df["iso"], utc=True, errors="coerce")
elif "bucketStartMs" in df.columns:
    df["Date"] = pd.to_datetime(df["bucketStartMs"], unit="ms", utc=True, errors="coerce")
df = df.dropna(subset=["Date"]).set_index("Date").sort_index()

df["RSI"] = RSIIndicator(close=df["close"], window=20).rsi()

# Features
high_low = np.abs(df['high'] - df['low'])
high_pc = np.abs(df['high'] - df['close'].shift())
low_pc = np.abs(df['low'] - df['close'].shift())
df['TR'] = pd.concat([high_low, high_pc, low_pc], axis=1).max(axis=1)
df['ATR_20'] = df['TR'].rolling(20).mean()
df['ATR_ratio'] = df['TR'] / df['ATR_20']

df['RSI_slope'] = df['RSI'] - df['RSI'].shift(5)

df['SMA_50'] = df['close'].rolling(50).mean()
df['SMA_slope'] = df['SMA_50'] - df['SMA_50'].shift(10)
df['SMA_100'] = df['close'].rolling(100).mean()
df['dist_SMA_100'] = (df['close'] - df['SMA_100']) / df['SMA_100']

df['Vol_MA'] = df['volume'].rolling(288).mean() # 24 hrs
df['Vol_ratio'] = df['volume'] / df['Vol_MA']

df = df.dropna().copy()

open_arr = df['open'].values
high_arr = df['high'].values
low_arr = df['low'].values
rsi_arr = df['RSI'].values

rsi_low = 30
rsi_high = 70
sl_n = 0
r_multi = 5.0
sl_buffer = 0.0

# Extract Backtest Trades
trades = []
position = 0
entry_price = 0.0
stop_loss = 0.0
take_profit = 0.0
start_idx = 2

for i in range(start_idx, len(open_arr)):
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
                stop_loss = orig_sl
                risk = entry_price - stop_loss
                take_profit = entry_price + (risk * r_multi)
                position = 1
                trades.append({'entry_i': i, 'type': 'long', 'pnl_r': 0.0})
                
        elif rsi_arr[i-1] > rsi_high and rsi_arr[i-2] <= rsi_high:
            entry_price = open_arr[i]
            orig_sl = np.max(high_arr[i-1-sl_n : i])
            orig_risk = orig_sl - entry_price
            if orig_risk > 0:
                stop_loss = orig_sl
                risk = stop_loss - entry_price
                take_profit = entry_price - (risk * r_multi)
                position = -1
                trades.append({'entry_i': i, 'type': 'short', 'pnl_r': 0.0})

valid_trades = [t for t in trades if 'exit_i' in t]

# Cluster trades into swings
clusters = []
current_cluster = []
current_type = None

for t in valid_trades:
    if len(current_cluster) > 0:
        prev_i = current_cluster[-1]['exit_i']
        curr_i = t['entry_i']
        if t['type'] != current_type:
            clusters.append(current_cluster)
            current_cluster = [t]
            current_type = t['type']
        else:
            crossed_50 = False
            if t['type'] == 'long':
                if curr_i > prev_i and np.max(rsi_arr[prev_i:curr_i]) >= 50:
                    crossed_50 = True
            else:
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

# Assign Outcomes & Gather Features from the FIRST trade of each swing
print("Structuring ML dataset...")
dataset = []

for c in clusters:
    first_trade_idx = c[0]['entry_i']
    
    # 1. Determine the outcome label of this swing
    if len(c) == 1:
        if c[0]['pnl_r'] > 0:
            outcome = "CLEAN_WIN"
        else:
            outcome = "CLEAN_LOSS"
    else:
        wins = sum(1 for t in c if t['pnl_r'] > 0)
        if wins > 0:
            outcome = "CHOPPY_WIN"
        else:
            outcome = "CHOPPY_LOSS"
            
    # 2. Extract features right before the first trade is entered
    features = {
        'outcome': outcome,
        'trades_in_swing': len(c),
        'total_pnl': sum(t['pnl_r'] for t in c),
        'ATR_20': df.iloc[first_trade_idx - 1]['ATR_20'],
        'ATR_ratio': df.iloc[first_trade_idx - 1]['ATR_ratio'],
        'RSI_slope': df.iloc[first_trade_idx - 1]['RSI_slope'],
        'SMA_slope': df.iloc[first_trade_idx - 1]['SMA_slope'],
        'dist_SMA_100': df.iloc[first_trade_idx - 1]['dist_SMA_100'],
        'Vol_ratio': df.iloc[first_trade_idx - 1]['Vol_ratio']
    }
    dataset.append(features)

ml_df = pd.DataFrame(dataset)

# KMeans Clustering
print("Running KMeans Clustering with 5 clusters...")
feature_cols = ['ATR_20', 'ATR_ratio', 'RSI_slope', 'SMA_slope', 'dist_SMA_100', 'Vol_ratio']
X = ml_df[feature_cols].copy()

# Scale features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

kmeans = KMeans(n_clusters=5, random_state=42)
ml_df['Cluster'] = kmeans.fit_predict(X_scaled)

# Results By Cluster
for cl in range(5):
    subset = ml_df[ml_df['Cluster'] == cl]
    print(f"\n[{'='*40}]")
    print(f"CLUSTER {cl}  |  Total Swings: {len(subset)}")
    print(f"[{'='*40}]")
    
    # Outcome counts
    outcomes = subset['outcome'].value_counts()
    for k, v in outcomes.items():
        print(f"  {k}: {v} ({v/len(subset)*100:.1f}%)")
    
    print(f"  --> PnL contribution: {subset['total_pnl'].sum():.2f} R")
    print("\n  Average Features:")
    for col in feature_cols:
        print(f"    - {col}: {subset[col].mean():.5f}")
