const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  market_window_start INTEGER NOT NULL,
  market_window_end INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  session_type TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL,
  break_reason TEXT,
  asset_count INTEGER NOT NULL DEFAULT 0,
  tick_count INTEGER NOT NULL DEFAULT 0,
  candle_count INTEGER NOT NULL DEFAULT 0,
  last_saved_at_ms INTEGER,
  active_streams_json TEXT
);

CREATE TABLE IF NOT EXISTS session_ticks (
  session_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  price REAL NOT NULL,
  size REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (session_id, symbol, ts_ms, source)
);

CREATE TABLE IF NOT EXISTS session_candles (
  session_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'live',
  is_gap_fill INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, symbol, timeframe, bucket_start_ms)
);

CREATE TABLE IF NOT EXISTS session_notes (
  session_id TEXT PRIMARY KEY,
  notes TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_trades (
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  coin TEXT NOT NULL,
  side TEXT NOT NULL,
  dir TEXT NOT NULL DEFAULT '',
  px REAL NOT NULL,
  sz REAL NOT NULL,
  time_ms INTEGER NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  fee_token TEXT NOT NULL DEFAULT 'USDC',
  closed_pnl REAL NOT NULL DEFAULT 0,
  crossed INTEGER NOT NULL DEFAULT 0,
  oid TEXT NOT NULL DEFAULT '',
  tid TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, mode, time_ms, coin, side, px, sz, oid, tid)
);

CREATE TABLE IF NOT EXISTS session_trade_state (
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'FLAT',
  side TEXT NOT NULL DEFAULT '',
  size REAL NOT NULL DEFAULT 0,
  entry_px REAL NOT NULL DEFAULT 0,
  stop_loss REAL NOT NULL DEFAULT 0,
  stop_loss_from_pending_orders REAL NOT NULL DEFAULT 0,
  take_profit_from_pending_orders REAL NOT NULL DEFAULT 0,
  stop_order_ref_json TEXT NOT NULL DEFAULT '',
  pending_orders_json TEXT NOT NULL DEFAULT '[]',
  execution_meta_json TEXT NOT NULL DEFAULT '{}',
  last_action TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, mode, symbol)
);

CREATE TABLE IF NOT EXISTS session_external_metadata (
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  imported_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, tool, source_id, imported_at_ms)
);

CREATE TABLE IF NOT EXISTS session_candle_features (
  session_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  bucket_start_ms INTEGER NOT NULL,
  feature_set TEXT NOT NULL,
  feature_version TEXT NOT NULL DEFAULT 'v1',
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, symbol, timeframe, bucket_start_ms, feature_set, feature_version)
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at_ms ON sessions (started_at_ms);
CREATE INDEX IF NOT EXISTS idx_session_ticks_lookup ON session_ticks (session_id, symbol, ts_ms);
CREATE INDEX IF NOT EXISTS idx_session_candles_lookup ON session_candles (session_id, symbol, timeframe, bucket_start_ms);
CREATE INDEX IF NOT EXISTS idx_session_trades_lookup ON session_trades (session_id);
CREATE INDEX IF NOT EXISTS idx_session_trade_state_lookup ON session_trade_state (session_id, mode, symbol);
CREATE INDEX IF NOT EXISTS idx_session_external_metadata_lookup ON session_external_metadata (session_id, tool, imported_at_ms);
CREATE INDEX IF NOT EXISTS idx_session_candle_features_lookup
  ON session_candle_features (session_id, timeframe, bucket_start_ms, feature_set);
`;

module.exports = {
  BASE_SCHEMA_SQL
};
