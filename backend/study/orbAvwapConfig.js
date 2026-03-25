const DEFAULT_STUDY_CONFIG = {
  timezone: "America/New_York",
  orb: {
    startTime: "09:30",
    endTime: "10:00",
    timeframe: "5m",
    breakoutSource: "wick"
  },
  avwap: {
    anchorTime: "10:00",
    endTime: "13:00",
    priceSource: "close"
  },
  execution: {
    directionMode: "both",
    maxTradesPerDay: 1,
    stopLossMode: "orb_opposite",
    takeProfitR: 1.5,
    feeBps: 2.5,
    slippageBps: 3
  },
  validation: {
    walkForwardSplitPct: 0.7,
    minTradesForTrust: 30
  }
};

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeTime(raw, fallback) {
  const value = String(raw || fallback || "").trim();
  if (!/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hh, mm] = value.split(":").map((v) => Number(v));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeStudyConfig(raw = {}) {
  const orbRaw = raw?.orb || {};
  const avwapRaw = raw?.avwap || {};
  const executionRaw = raw?.execution || {};
  const validationRaw = raw?.validation || {};
  const timezone = String(raw?.timezone || DEFAULT_STUDY_CONFIG.timezone).trim() || DEFAULT_STUDY_CONFIG.timezone;

  const orbTimeframe = String(orbRaw?.timeframe || DEFAULT_STUDY_CONFIG.orb.timeframe).toLowerCase();
  const breakoutSource = String(orbRaw?.breakoutSource || DEFAULT_STUDY_CONFIG.orb.breakoutSource).toLowerCase();
  const avwapPriceSource = String(avwapRaw?.priceSource || DEFAULT_STUDY_CONFIG.avwap.priceSource).toLowerCase();
  const directionMode = String(executionRaw?.directionMode || DEFAULT_STUDY_CONFIG.execution.directionMode).toLowerCase();
  const stopLossMode = String(executionRaw?.stopLossMode || DEFAULT_STUDY_CONFIG.execution.stopLossMode).toLowerCase();

  return {
    timezone,
    orb: {
      startTime: normalizeTime(orbRaw?.startTime, DEFAULT_STUDY_CONFIG.orb.startTime),
      endTime: normalizeTime(orbRaw?.endTime, DEFAULT_STUDY_CONFIG.orb.endTime),
      timeframe: orbTimeframe === "1m" || orbTimeframe === "5m" ? orbTimeframe : DEFAULT_STUDY_CONFIG.orb.timeframe,
      breakoutSource: breakoutSource === "close" ? "close" : "wick"
    },
    avwap: {
      anchorTime: normalizeTime(avwapRaw?.anchorTime, DEFAULT_STUDY_CONFIG.avwap.anchorTime),
      endTime: normalizeTime(avwapRaw?.endTime, DEFAULT_STUDY_CONFIG.avwap.endTime),
      priceSource: avwapPriceSource === "hlc3" ? "hlc3" : "close"
    },
    execution: {
      directionMode:
        directionMode === "long_only" || directionMode === "short_only" ? directionMode : "both",
      maxTradesPerDay: Math.floor(clampNumber(executionRaw?.maxTradesPerDay, 1, 1, 10)),
      stopLossMode: stopLossMode === "avwap_cross" ? "avwap_cross" : "orb_opposite",
      takeProfitR: clampNumber(executionRaw?.takeProfitR, 1.5, 0.2, 10),
      feeBps: clampNumber(executionRaw?.feeBps, 2.5, 0, 100),
      slippageBps: clampNumber(executionRaw?.slippageBps, 3, 0, 100)
    },
    validation: {
      walkForwardSplitPct: clampNumber(validationRaw?.walkForwardSplitPct, 0.7, 0.5, 0.95),
      minTradesForTrust: Math.floor(clampNumber(validationRaw?.minTradesForTrust, 30, 5, 500))
    }
  };
}

module.exports = {
  DEFAULT_STUDY_CONFIG,
  normalizeStudyConfig
};
