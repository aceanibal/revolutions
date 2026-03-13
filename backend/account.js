const HYPERLIQUID_INFO_URL = "https://api.hyperliquid-testnet.xyz/info";
const HYPERLIQUID_ACCOUNT = "0xREPLACE_WITH_TESTNET_ADDRESS";
const RISK_PERCENT = 2;
const BALANCE_REFRESH_MS = 20_000;

function computePositionSize(balance, lastPrice) {
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    return 0;
  }
  return (balance * (RISK_PERCENT / 100)) / lastPrice;
}

function emitHudUpdate(io, { stopLossPrice, balance, lastPrice }) {
  io.emit("hudUpdate", {
    stopLossPrice,
    balance,
    positionSize: computePositionSize(balance, lastPrice)
  });
}

async function fetchAccountBalance({ onBalance, onError } = {}) {
  try {
    const response = await fetch(HYPERLIQUID_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "clearinghouseState",
        user: HYPERLIQUID_ACCOUNT
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const parsedBalance = Number(
      payload?.marginSummary?.accountValue ??
        payload?.crossMarginSummary?.accountValue ??
        payload?.withdrawable ??
        0
    );

    if (Number.isFinite(parsedBalance) && parsedBalance >= 0) {
      if (typeof onBalance === "function") {
        onBalance(parsedBalance);
      }
    }
  } catch (error) {
    if (typeof onError === "function") {
      onError(error);
    }
  }
}

function getBalanceRefreshMs() {
  return BALANCE_REFRESH_MS;
}

function hasAccountConfigured() {
  return HYPERLIQUID_ACCOUNT && !HYPERLIQUID_ACCOUNT.includes("REPLACE_WITH");
}

module.exports = {
  computePositionSize,
  emitHudUpdate,
  fetchAccountBalance,
  getBalanceRefreshMs,
  hasAccountConfigured
};

