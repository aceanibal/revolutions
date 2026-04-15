"""
Simulation Rules — Agent Specification
=======================================
Every strategy and study written in this lab MUST follow these rules.
Read this entire file before writing any simulation code.

These rules exist because we are simulating with OHLCV candle data, which
gives us less information than a real trading system would have. Each rule
explains what the data limitation is, what the correct assumption is, and
what the wrong assumption looks like (and why it inflates results).

The standard data source is 5-minute candles. Entry signals may come from
higher timeframes (4h, 1h, etc.) that are resampled from the 5m data.

═══════════════════════════════════════════════════════════════════════════
SECTION A — WHAT OHLCV CANDLE DATA TELLS YOU (AND WHAT IT DOESN'T)
═══════════════════════════════════════════════════════════════════════════

A candle gives you:
  Open  — the exact price at the START of the bar (a specific transaction)
  High  — the HIGHEST price reached at any point during the bar
  Low   — the LOWEST price reached at any point during the bar
  Close — the exact price at the END of the bar (a specific transaction)
  Volume — total traded volume during the bar

A candle does NOT give you:
  - The ORDER in which High and Low occurred (did H come before L, or after?)
  - How many times price crossed any level during the bar
  - The path between Open and Close
  - Whether price was closer to High or Low for more of the bar
  - Whether both a SL and TP were touched and in what sequence

This is the core limitation that drives Rules 4 and 5 below. When in doubt,
assume the worst realistic sequence for your position (conservative).

═══════════════════════════════════════════════════════════════════════════
SECTION B — SIGNAL TIMING: ONLY ACT ON CLOSED BARS
═══════════════════════════════════════════════════════════════════════════

RULE 1 — A signal is only valid after the bar that generated it has CLOSED.

You cannot know a bar's Close, High, or final RSI value until that bar
closes. If your signal fires based on bar i's close (e.g., RSI crossed a
threshold), you can only act on it at bar i+1's open.

  CORRECT:  signal detected at bar i-1 close → entry at bar i open
  WRONG:    signal detected at bar i close → entry at bar i close (same bar)
  WRONG:    signal detected at bar i close → entry mid-bar i

In code (4h bars, RSI cross):
  CORRECT:  if rsi[i-1] < rsi_low and rsi[i-2] >= rsi_low → entry at open[i]
  WRONG:    if rsi[i] < rsi_low and rsi[i-1] >= rsi_low → entry at close[i]

WHY: If you act on bar i's signal at bar i's close, you have look-ahead bias —
you're using information (the close) that wasn't available when you would
have needed to place the order.

═══════════════════════════════════════════════════════════════════════════
SECTION C — MULTI-TIMEFRAME TIMING: 5M CANDLES AS THE GROUND TRUTH
═══════════════════════════════════════════════════════════════════════════

RULE 2 — All higher timeframe bars are derived from 5m candles. Never load
HTF bars independently. Resample from 5m using resample_ohlcv().

WHY: An independently loaded 4h bar and a 4h bar resampled from 5m may
disagree on exact timestamps, volumes, or open/close prices due to data
gaps or session boundaries. Using a single source (5m) eliminates this.

RULE 3 — Entry execution always happens on a 5m bar open, not a 4h bar open.

When your signal fires at the end of a 4h bar (e.g., at 08:00 UTC after
the 04:00–08:00 bar closes), your entry is at the open of the next 4h bar.
In 5m terms, this is the open of the 5m bar timestamped 08:00 UTC.

  4h bar close at 08:00 = first 5m bar of next 4h period = 08:00 5m bar open
  entry_price = df4h["open"].iloc[entry_idx]
             = df5m.loc["08:00:00"]["open"]   ← same value

This means entry_price is always a real, observable price — the open of a
5m bar — not an average or estimate.

RULE 4 — The signal bar's HIGH and LOW are NOT available when you place your
stop at entry.

When you enter at the open of bar i (in 4h terms), bar i has just started.
Its high and low are unknown. Your stop must be constructed from bars
0 through i-1 only.

  CORRECT:  stop = min(low[i - sl_n : i])    ← bars up to i-1 (not i)
  WRONG:    stop = min(low[i - sl_n : i+1])  ← includes bar i's low (future!)

For ATR-based stops: use ATR computed through bar i-1, not bar i.

═══════════════════════════════════════════════════════════════════════════
SECTION D — ENTRY: FILL MODEL
═══════════════════════════════════════════════════════════════════════════

RULE 5 — Fill price is the open of the bar after the signal bar. Full fill
assumed. No slippage modeled by default.

  entry_price = open_arr[entry_bar_idx]

If you want to model slippage, add an explicit parameter (e.g., slippage_bps)
and document it. Never silently assume zero slippage and then claim "realistic."

One position per symbol at a time. If a signal fires while a position is
already open on that symbol, skip it. No pyramiding.

═══════════════════════════════════════════════════════════════════════════
SECTION E — STOP LOSS: PLACEMENT AND FILL
═══════════════════════════════════════════════════════════════════════════

RULE 6 — The stop is live from the FIRST 5m bar at or after the entry time.

  CORRECT:  first management bar = df5.loc[df5.index >= entry_ts]
  WRONG:    first management bar = df5.loc[df5.index >= entry_ts + 4h]

The original code in this project used skip=4.0 (a 4h grace period). This
was a bug: it prevented stop-outs during the entry 4h candle, which inflated
results significantly. The stop order is live the moment you place it.

When skip > 0 is acceptable:
  - You are explicitly modeling a delayed stop placement (manual trading lag)
  - You set skip = your estimated lag in hours and document it
  - Default must always be 0.0

RULE 7 — SL is simulated as a stop-limit order: fill at exactly the stop
price when the candle reaches it.

  Long SL triggered:  bar.low  <= stop_price → fill at stop_price
  Short SL triggered: bar.high >= stop_price → fill at stop_price

Fill at the stop price, not at the bar's extreme. If stop is 20,100 and
bar.low reaches 20,000, you fill at 20,100 — not 20,000.

This is a known optimism (see K1): in reality a stop-market order may fill
worse than the stop price if price gaps through it. For crypto 24/7 data
gaps are rare; the stop-limit model is acceptable. If you need to model
gap slippage, add a gap_slippage_bps parameter explicitly.

═══════════════════════════════════════════════════════════════════════════
SECTION F — TAKE PROFIT: PLACEMENT AND FILL
═══════════════════════════════════════════════════════════════════════════

RULE 8 — TP is simulated as a limit order: fill at exactly the TP price
when the candle reaches it.

  Long TP triggered:  bar.high >= tp_price → fill at tp_price
  Short TP triggered: bar.low  <= tp_price → fill at tp_price

Fill at the TP price, not at the bar's extreme. If TP is 25,000 and
bar.high reaches 25,500, you fill at 25,000 — not 25,500.

Both SL and TP fill at their exact specified price. The candle high/low
touching the level is sufficient to consider the order filled. This is
the standard limit-order simulation model.

═══════════════════════════════════════════════════════════════════════════
SECTION G — SAME-BAR AMBIGUITY: SL AND TP BOTH HIT
═══════════════════════════════════════════════════════════════════════════

RULE 9 — When both SL and TP are reachable within the same bar, SL wins.

  Long:  bar.low <= SL and bar.high >= TP → exit at SL (conservative)
  Short: bar.high >= SL and bar.low <= TP → exit at SL (conservative)

This is the conservative assumption: when we don't know the intrabar order,
we assume the adverse move came first. This slightly penalizes the strategy
vs optimistic assumptions, which is the correct direction for avoiding
overfitted results.

Bar-level exit check order (within each 5m bar):
  1. Check SL
  2. If not stopped: check TP
  3. If not exited: check MFE ladder triggers, update stop
  4. If stop moved: check if new stop is immediately hit (same-bar activation)

For longs: check low before high.
For shorts: check high before low.

═══════════════════════════════════════════════════════════════════════════
SECTION H — TRADE MANAGEMENT: MFE LADDER AND STOP UPDATES
═══════════════════════════════════════════════════════════════════════════

RULE 10 — MFE (Maximum Favorable Excursion) is tracked cumulatively from
entry. MFE is expressed in R-units: mfe_r = (peak_price - entry) / risk.

RULE 11 — When an MFE threshold triggers a stop update, the new stop is
active IMMEDIATELY in the same bar (same-bar activation).

  CORRECT (same-bar):
    bar.high >= entry + mfe_r * risk
    → update stop to entry + lock_r * risk
    → check if bar.low <= new stop in the SAME bar
    → if yes: exit at new stop price

  WRONG (deferred, the original bug):
    bar.high >= mfe_r threshold
    → queue new stop for NEXT bar
    → bar can whipsaw without hitting new stop

WHY: In the original code, a whipsaw bar (price moves to +1R then drops to
+0.8R in the same 5m candle) would NOT trigger the lock — the stop only moved
at the next bar. This gave trades a free pass through whipsaw bars, inflating
managed R. Same-bar activation is more realistic: the lock fires when price
trades there, regardless of when in the bar it happened.

RULE 12 — MFE cap: lock level cannot exceed MFE actually reached.

  lock_eff = min(lock_r, mfe_max_r)   ← cap_lock_by_mfe = True (default)

You cannot lock in +0.8R if price has only moved +0.5R. The stop update
is: max(current_stop, entry + min(lock_r, mfe_max_r) * risk) for longs.

WHY: Without this cap, a stage defined as (mfe=1.0R, lock=0.8R) would move
your stop to +0.8R even if the MFE was only 1.0R by 1 tick. With the cap,
lock_eff = min(0.8, 1.0) = 0.8R. In practice this rarely differs, but at
exactly the threshold it prevents an unrealistic exact-tick lock.

═══════════════════════════════════════════════════════════════════════════
SECTION I — FEE MODEL
═══════════════════════════════════════════════════════════════════════════

RULE 13 — Fee is round-trip (entry + exit combined), expressed in R-units.

  fee_r = entry_price * fee_bps / 10_000 / risk

This fee is subtracted from the gross R at the end of the trade.
Default: 3.0 bps RT. This is approximate for liquid crypto spot/perp markets.

Deduct fee once per trade regardless of how many stop updates happened.
Fee does not change when the stop moves (we are not modeling re-hedging costs).

═══════════════════════════════════════════════════════════════════════════
SECTION J — DATA SOURCE AND QUALITY
═══════════════════════════════════════════════════════════════════════════

RULE 14 — All 5m candles come from the shared SQLite DB via core/db.py.
Use load_merged_5m(db_path, symbol) — never query the DB directly in
strategy code. This ensures consistent deduplication across sessions.

RULE 15 — Data coverage must be validated before a simulation run.

Before running a strategy, check:
  - Symbol has data from at least start_utc
  - No large gaps (>= 2h of missing 5m bars) in the backtest window
  - Minimum bar count: at least sl_n + rsi_window + 10 bars in the HTF series

Trades that start outside the validated data window must be excluded.

RULE 16 — The backtest window is [start_utc, end_utc). Half-open interval.
Trades are assigned to time chunks by their EXIT timestamp, not entry.

═══════════════════════════════════════════════════════════════════════════
SECTION K — KNOWN OPTIMISMS (ACCEPTABLE TRADE-OFFS)
═══════════════════════════════════════════════════════════════════════════

The following are known ways the simulation is still more favorable than
live trading. They are accepted trade-offs, not bugs. Document any that
significantly affect your strategy's edge.

K1 — Zero slippage: fills assumed at exact open/SL/TP prices.
     Real fills may be worse, especially in fast markets.

K2 — Infinite liquidity: full fill assumed at all levels.
     Real fills may be partial for large sizes or at illiquid levels.

K3 — Bid/ask spread not modeled: fee_bps approximates this but
     spread can be higher in volatile periods.

K4 — Bar high/low order unknown: we assume conservative order (adverse first)
     but sometimes the favorable move does come first in reality.

K5 — No funding rate (for perpetual futures strategies): if modeling perps,
     funding must be added as a periodic cost.

K6 — 5m bar resolution: intrabar path is unknown. Events that happen
     between 5m bar opens cannot be modeled. Tight stops near the entry
     price may produce different results in reality than in simulation.

═══════════════════════════════════════════════════════════════════════════
SECTION L — COMMON BUGS TO AVOID
═══════════════════════════════════════════════════════════════════════════

L1 — Using bar i's close to both generate a signal AND enter at bar i.
     Fix: signal at close[i-1] → entry at open[i].

L2 — Using bar i's high/low in the structural stop when entering at open[i].
     Fix: stop = min(low[i-sl_n : i]) — slice ends before i (not i+1).

L3 — Starting the 5m replay after the 4h entry candle (skip=4h).
     Fix: skip_entry_bucket_hours=0.0. Stop is live from entry.

L4 — Deferring stop updates to the next bar (pending_stop pattern).
     Fix: apply MFE lock immediately and check same-bar exit.

L5 — Checking TP before SL on the same bar.
     Fix: always check SL first (Rule 9). For longs: low before high.

L6 — Exiting at bar.low (long) or bar.high (short) instead of the order price.
     Both SL and TP are limit orders: fill at stop_price or tp_price exactly.
     Fix: compute R from the order price, never from the bar extreme.

L7 — Loading 4h candles independently from the DB instead of resampling 5m.
     Fix: always build_4h_rsi(df5m) — never query 4h directly.

L8 — Using ATR or any indicator from the entry bar to set stop or size.
     Fix: all indicator values used at entry must be from bars[0..i-1].

L9 — Not excluding trades whose exit falls outside the backtest window.
     Fix: filter trades by exit timestamp, not entry timestamp.

L10 — Pyramiding: entering a second position while the first is open.
      Fix: skip signals when position > 0 on that symbol.
"""

# ── Constants encoding the rules above ────────────────────────────────────
# Import these in strategy code instead of hardcoding magic numbers.

ENTRY_FILL: str = "next_bar_open"           # Rules 1, 5
EXIT_ORDER: str = "sl_before_tp"            # Rule 9
DEFAULT_FEE_BPS: float = 3.0               # Rule 13
DEFAULT_SKIP_ENTRY_BUCKET_H: float = 0.0   # Rule 6 — stop is live from entry
DEFAULT_STOP_UPDATE: str = "same_bar"       # Rule 11 — no deferral
DEFAULT_MFE_CAP: bool = True                # Rule 12
MAX_POSITIONS_PER_SYMBOL: int = 1           # Rule 5
CANDLE_RESOLUTION: str = "5m"              # Rule 14
HTF_SOURCE: str = "resampled_from_5m"      # Rule 2
