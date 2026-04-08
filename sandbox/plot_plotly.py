import argparse
import os
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
from ta.momentum import RSIIndicator

def parse_args() -> argparse.Namespace:
    default_input = os.path.join(os.path.dirname(__file__), "cache", "xrp_paxg_ratio_5m.csv")
    ap = argparse.ArgumentParser(description="Plot interactive XRP/PAXG ratio candles with RSI using Plotly.")
    ap.add_argument("--input", default=default_input, help="Input CSV path")
    ap.add_argument("--last-bars", type=int, default=10000, help="Plot only the last N bars (default 10000)")
    ap.add_argument("--rsi-period", type=int, default=14, help="RSI period")
    return ap.parse_args()

def load_data(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    if "iso" in df.columns:
        df["Date"] = pd.to_datetime(df["iso"], utc=True, errors="coerce")
    elif "bucketStartMs" in df.columns:
        df["Date"] = pd.to_datetime(df["bucketStartMs"], unit="ms", utc=True, errors="coerce")
    
    df = df.dropna(subset=["Date"]).set_index("Date").sort_index()
    return df

def main() -> None:
    args = parse_args()
    
    print(f"Loading data from {args.input}...")
    df = load_data(args.input)
    
    # Calculate RSI on the full dataset so the initial bars are accurate
    df["RSI"] = RSIIndicator(close=df["close"], window=args.rsi_period).rsi()
    
    if args.last_bars and args.last_bars > 0:
        df = df.tail(args.last_bars)
        
    print(f"Plotting {len(df)} bars...")

    # Create figure with secondary y-axis
    fig = make_subplots(rows=2, cols=1, shared_xaxes=True, 
                        vertical_spacing=0.03, row_heights=[0.7, 0.3])

    # Candlestick
    fig.add_trace(go.Candlestick(x=df.index,
                open=df['open'],
                high=df['high'],
                low=df['low'],
                close=df['close'],
                name='Ratio'), 
                row=1, col=1)

    # RSI
    fig.add_trace(go.Scatter(x=df.index, y=df['RSI'], 
                             line=dict(color='purple', width=2), 
                             name=f'RSI ({args.rsi_period})'), 
                  row=2, col=1)

    # Add overbought/oversold lines
    fig.add_hline(y=70, line_dash="dash", line_color="red", row=2, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="green", row=2, col=1)
    
    # Overlay the ideal backtest signals
    df['long_entry'] = (df['RSI'].shift(1) < 30) & (df['RSI'].shift(2) >= 30)
    df['short_entry'] = (df['RSI'].shift(1) > 70) & (df['RSI'].shift(2) <= 70)
    
    longs = df[df['long_entry']]
    shorts = df[df['short_entry']]
    
    fig.add_trace(go.Scatter(x=longs.index, y=longs['low'] * 0.9995, 
                             mode='markers', marker=dict(symbol='triangle-up', size=12, color='lime'),
                             name='Long Signal'), row=1, col=1)
                             
    fig.add_trace(go.Scatter(x=shorts.index, y=shorts['high'] * 1.0005, 
                             mode='markers', marker=dict(symbol='triangle-down', size=12, color='red'),
                             name='Short Signal'), row=1, col=1)
    
    # Optional rangeslider
    fig.update_layout(
        title='XRP/PAXG Ratio (Interactive)',
        yaxis_title='Ratio',
        yaxis2_title='RSI',
        xaxis_rangeslider_visible=False,
        height=800,
        template='plotly_dark'
    )

    print("Opening interactive chart in Google Chrome...")
    out_html = os.path.join(os.path.dirname(args.input), "interactive_chart.html")
    fig.write_html(out_html)
    os.system(f"open -a 'Google Chrome' '{out_html}'")

if __name__ == "__main__":
    main()
