export function AboutWorkspace() {
  return (
    <>
      <section className="grid2">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>How the Simulator Works</h3>
          <p style={{ marginBottom: 12 }}>
            The backtester replays recorded market data through a strategy to produce simulated
            trades, an equity curve, and performance metrics. The system is split into three layers,
            each with a distinct responsibility.
          </p>
        </div>
      </section>

      <section className="grid2">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Architecture: Runner &rarr; Engine &rarr; Simulator</h3>

          <div style={{ overflowX: "auto" }}>
            <pre style={{ fontSize: 12, lineHeight: 1.6, padding: "12px 16px", background: "#f1f5f9", borderRadius: 4, whiteSpace: "pre", margin: "8px 0 16px", color: "#1e293b" }}>
{`┌─────────────────────────────────────────────────────────────┐
│  RUNNER  (cli.js / server.js)                               │
│  Collects parameters, loads raw data from SQLite             │
│                                                              │
│  getCandles(session, symbol, timeframe) ─┐                   │
│  getTicks(session, symbol) ──────────────┤                   │
│                                          ▼                   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  ENGINE  (runBacktest.js)                              │   │
│  │                                                        │   │
│  │  1. buildEvents()                                      │   │
│  │     Merges candles + ticks into a single sorted stream  │   │
│  │     Applies tick policy (real / synthetic / fallback)   │   │
│  │     Optional ET market-day filters (weekends/holidays)  │   │
│  │  2. runBacktest()                                      │   │
│  │     Synchronous for-loop over events                   │   │
│  │     strategy.onEvent() → enter/exit actions            │   │
│  │     Tracks position, equity, P&L per event             │   │
│  │     Force-closes any open position at stream end       │   │
│  │                                                        │   │
│  │  Output: equity curve, trade list, metrics             │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  SIMULATOR  (replay.js)                               │   │
│  │  Wraps the same event stream in a timer for UI replay  │   │
│  │  step() / play() / pause() / seek()                    │   │
│  │  Visualization only — no P&L calculation               │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘`}
            </pre>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Layer</th>
                <th>What It Does</th>
                <th>Key Files</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Runner</strong></td>
                <td>
                  The entry point. Receives your parameters (session, symbol, timeframe, mode,
                  strategy), opens the SQLite database, queries both candles and ticks, and passes
                  the raw arrays to the engine. It does not process or merge the data — it just
                  loads and hands off.
                </td>
                <td><code>runner/cli.js</code>, <code>server.js</code></td>
              </tr>
              <tr>
                <td><strong>Engine</strong></td>
                <td>
                  The simulation core. First, <code>buildEvents()</code> transforms raw candles and
                  ticks into a unified, time-sorted event stream based on the replay mode. Then,{" "}
                  <code>runBacktest()</code> iterates that stream synchronously, feeding each event
                  to the strategy and tracking position, equity, and P&amp;L. Outputs the full run
                  result with metrics.
                </td>
                <td><code>engine/runBacktest.js</code>, <code>engine/strategies.js</code></td>
              </tr>
              <tr>
                <td><strong>Simulator</strong></td>
                <td>
                  The visualization layer. Wraps the same event array from{" "}
                  <code>buildEvents()</code> in a timer-driven controller so the UI can step through
                  events one at a time or play them back at a configurable speed. This is purely for
                  replay visualization — it does not run strategies or compute P&amp;L.
                </td>
                <td><code>simulator/replay.js</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid2">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Replay Modes</h3>
          <p style={{ marginBottom: 12 }}>
            The replay mode controls how market data is transformed into the event stream that
            drives the simulation.{" "}
            <strong>Mixed mode is the default and recommended for all use cases</strong> because
            it provides the most realistic simulation.
          </p>

          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Mode</th>
                <th>Event Stream</th>
                <th>Uses Candles</th>
                <th>Uses Ticks</th>
                <th>Intra-bar Stops</th>
                <th>Candle Indicators</th>
                <th>Best For</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>mixed</strong></td>
                <td>Ticks + candle-close events merged and time-sorted</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>Default — most realistic</td>
              </tr>
              <tr>
                <td><strong>candle</strong></td>
                <td>One event per bar close</td>
                <td>Yes</td>
                <td>No</td>
                <td>No</td>
                <td>Yes</td>
                <td>Fast iteration, simple strategies</td>
              </tr>
              <tr>
                <td><strong>tick</strong></td>
                <td>One event per trade print</td>
                <td>No</td>
                <td>Yes</td>
                <td>Yes</td>
                <td>No</td>
                <td>Microstructure, precise timing</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid2">
        <div className="card">
          <h3>Mixed Mode in Detail</h3>
          <p style={{ marginBottom: 8 }}>
            Mixed mode merges both tick and candle data into a single chronological stream.
            Here is what one 5-minute bar looks like as events:
          </p>
          <pre style={{ fontSize: 12, lineHeight: 1.5, overflowX: "auto", padding: "8px 12px", background: "#f1f5f9", borderRadius: 4, color: "#1e293b" }}>
{`09:30:00.000  tick         price=100.00
09:31:15.000  tick         price=101.00
09:33:42.000  tick         price=99.00
09:34:59.999  candle_close O=100 H=101 L=99 C=100.5
09:35:00.000  tick         price=100.7  (next bar starts)`}
          </pre>
          <p style={{ marginTop: 12 }}>
            The candle-close timestamp is set to{" "}
            <code>bucket_start + interval - 1ms</code> so it always sorts{" "}
            <strong>after</strong> every intra-bar tick. This guarantees the strategy sees the full
            tick-by-tick price movement within a bar before the "bar closed" signal arrives.
          </p>
          <p style={{ marginTop: 8 }}>A strategy in mixed mode can:</p>
          <ul style={{ paddingLeft: 20, marginTop: 4, lineHeight: 1.7 }}>
            <li>React to <strong>ticks mid-bar</strong> — check stop-loss and take-profit hits in real time</li>
            <li>Act on <strong>candle closes</strong> — update VWAP, compute moving averages, confirm bar patterns</li>
            <li>Get a <strong>tick-granularity equity curve</strong> even if decisions only happen on bar closes</li>
          </ul>
          <p style={{ marginTop: 8 }}>
            This mirrors how the live trading app processes data: ticks stream in continuously,
            and candle bars close on a fixed schedule.
          </p>
        </div>

        <div className="card">
          <h3>Candle Mode</h3>
          <p style={{ marginBottom: 8 }}>
            Only candle data is used. Each bar produces a single event.
          </p>
          <pre style={{ fontSize: 12, lineHeight: 1.5, overflowX: "auto", padding: "8px 12px", background: "#f1f5f9", borderRadius: 4, color: "#1e293b" }}>
{`09:30:00  candle_close  O=100 H=105 L=98 C=103
09:35:00  candle_close  O=103 H=106 L=102 C=104
09:40:00  candle_close  O=104 H=104 L=99 C=100`}
          </pre>
          <p style={{ marginTop: 12 }}>
            The strategy only sees the close price once every bar interval. All intra-bar movement
            is invisible. If price spiked to your stop loss and recovered within the bar, the
            simulation would never detect it.
          </p>
          <p style={{ marginTop: 8 }}>
            Best for fast iteration and strategies that only care about confirmed bar closes.
          </p>

          <h3 style={{ marginTop: 24 }}>Tick Mode</h3>
          <p style={{ marginBottom: 8 }}>
            Only tick data is used. Each trade print produces one event.
          </p>
          <pre style={{ fontSize: 12, lineHeight: 1.5, overflowX: "auto", padding: "8px 12px", background: "#f1f5f9", borderRadius: 4, color: "#1e293b" }}>
{`09:30:00.000  tick  price=100.00
09:30:00.150  tick  price=100.02
09:30:00.310  tick  price=99.98
09:30:01.022  tick  price=100.05
...`}
          </pre>
          <p style={{ marginTop: 12 }}>
            Maximum granularity — the strategy sees every individual price change. However, it
            never receives OHLCV candle data, so candle-based indicators (VWAP, moving averages,
            Bollinger Bands) cannot be computed.
          </p>
        </div>
      </section>

      <section className="grid2">
        <div className="card">
          <h3>Tick Policy</h3>
          <p style={{ marginBottom: 8 }}>
            When sessions have real ticks (from exchange websockets), the simulator uses those
            directly. When real ticks are unavailable (e.g. historical candle-only data), it can
            generate synthetic ticks from OHLC values. The tick policy controls this behavior:
          </p>
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>real_then_synthetic</code></td>
                <td>
                  Use real exchange ticks if available, otherwise synthesize from candle OHLC.{" "}
                  <strong>Default.</strong>
                </td>
              </tr>
              <tr>
                <td><code>real_only</code></td>
                <td>Only use actual exchange trade prints. If none were recorded, there are no tick events.</td>
              </tr>
              <tr>
                <td><code>synthetic_only</code></td>
                <td>Always generate ticks from candles, even if real ticks exist. Produces deterministic results.</td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginTop: 16 }}>Synthetic Tick Path Model</h4>
          <p>
            Each candle is decomposed into 4&ndash;20 ticks (configurable via{" "}
            <code>syntheticTicksPerCandle</code>) following a deterministic intra-bar path:
          </p>
          <ul style={{ paddingLeft: 20, marginTop: 4, lineHeight: 1.7 }}>
            <li><strong>Bullish bar</strong> (close &ge; open): Open &rarr; Low &rarr; High &rarr; Close</li>
            <li><strong>Bearish bar</strong> (close &lt; open): Open &rarr; High &rarr; Low &rarr; Close</li>
          </ul>
          <p style={{ marginTop: 4 }}>
            Prices are linearly interpolated between anchors. Volume is split equally across ticks.
            This is a heuristic — the real intra-bar path is unknown from candle data alone.
          </p>
        </div>

        <div className="card">
          <h3>Data Storage</h3>
          <p style={{ marginBottom: 8 }}>
            All data lives in a single SQLite database at{" "}
            <code>backtester/data/backtest.sqlite</code>, opened with WAL mode for performance.
          </p>
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Contents</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>sessions</code></td><td>Session metadata — time windows, status, asset/tick/candle counts</td></tr>
              <tr><td><code>session_candles</code></td><td>1m and 5m OHLCV bars, keyed by (session, symbol, timeframe, timestamp)</td></tr>
              <tr><td><code>session_ticks</code></td><td>Raw trade prints — price, size, timestamp per symbol</td></tr>
              <tr><td><code>session_trades</code></td><td>Actual exchange fills imported from the live trading app</td></tr>
              <tr><td><code>session_trade_state</code></td><td>Position snapshots per symbol (status, stops, pending orders)</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 12 }}>
            Data is imported from the live app's database via the <strong>Data</strong> tab. Each
            session is identified by a <code>YYYY-MM-DD_HHMM-random</code> ID and all tables are
            partitioned by <code>session_id</code>. Session candles and ticks are loaded entirely
            into memory before the simulation loop begins.
          </p>
        </div>
      </section>

      <section className="grid2">
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Available Strategies</h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Strategy</th>
                <th>Description</th>
                <th>Acts On</th>
                <th>Parameters</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>noop</code></td>
                <td>Does nothing. Useful for verifying the data pipeline produces events without opening any trades.</td>
                <td>Nothing</td>
                <td>None</td>
              </tr>
              <tr>
                <td><code>simple-momentum</code></td>
                <td>Reference strategy: enters long on green bars, exits on red bars (body exceeds a threshold in basis points).</td>
                <td>Candle events only</td>
                <td><code>minBodyBps</code> (default 2)</td>
              </tr>
              <tr>
                <td><code>orb-avwap-930</code></td>
                <td>
                  Opening Range Breakout with Anchored VWAP from 9:30 ET. Enters on AVWAP crossover
                  after a configurable confirmation time. Uses candle high/low for stop loss and a
                  risk-reward ratio for take profit. Resets state per calendar day. Optional params
                  can skip weekends and US market holidays/early-close days.
                </td>
                <td>Candle events only</td>
                <td>
                  <code>rr</code>, <code>anchorHHMM</code>, <code>activeStartHHMM</code>,{" "}
                  <code>activeEndHHMM</code>, <code>ignoreWeekends</code>,{" "}
                  <code>ignoreUsHolidays</code>
                </td>
              </tr>
              <tr>
                <td><code>orb-avwap-930-open-avwap-sl</code></td>
                <td>
                  Clone of <code>orb-avwap-930</code> with configurable stop-loss source. Uses the
                  candle <code>open</code> or <code>anchoredVwap</code> as stop loss (instead of
                  high/low), while keeping the same AVWAP crossover entries and RR take-profit
                  model.
                </td>
                <td>Candle events only</td>
                <td>
                  <code>rr</code>, <code>anchorHHMM</code>, <code>activeStartHHMM</code>,{" "}
                  <code>activeEndHHMM</code>, <code>stopLossSource</code>,{" "}
                  <code>ignoreWeekends</code>, <code>ignoreUsHolidays</code>
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: 12 }}>
            Strategies implement <code>onEvent({"{ event, state }"})</code> and return{" "}
            <code>null</code> (no action) or an action object:{" "}
            <code>{"{ type: \"enter\"|\"exit\", side, price, size, stopLoss?, takeProfit? }"}</code>.
            In mixed mode, even strategies that only act on candle events benefit from tick-level
            equity curve precision.
          </p>
        </div>
      </section>
    </>
  );
}
