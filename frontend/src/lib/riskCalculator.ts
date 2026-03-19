export interface RiskFirstInputs {
  accountBalance: number;
  riskPercentage: number;
  entryPrice: number;
  stopLossPrice: number;
  isLong: boolean;
  makerFeeRate: number;
  takerFeeRate: number;
  maxExchangeLeverage?: number;
}

export interface RiskFirstMetrics {
  riskAmount: number;
  priceDistance: number;
  positionSize: number;
  notionalValue: number;
  leverage: number;
  entryFee: number;
  exitFee: number;
  totalFees: number;
  breakEvenPrice: number;
  leverageTooHigh: boolean;
  maxExchangeLeverage: number;
}

function sanitize(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function calculateRiskFirstMetrics(inputs: RiskFirstInputs): RiskFirstMetrics {
  const accountBalance = Math.max(0, sanitize(inputs.accountBalance));
  const riskPercentage = Math.max(0, sanitize(inputs.riskPercentage));
  const entryPrice = Math.max(0, sanitize(inputs.entryPrice));
  const stopLossPrice = Math.max(0, sanitize(inputs.stopLossPrice));
  const makerFeeRate = Math.max(0, sanitize(inputs.makerFeeRate));
  const takerFeeRate = Math.max(0, sanitize(inputs.takerFeeRate));
  void makerFeeRate;
  const maxExchangeLeverage =
    sanitize(inputs.maxExchangeLeverage ?? 0) > 0 ? sanitize(inputs.maxExchangeLeverage ?? 0) : 50;

  const riskAmount = accountBalance * (riskPercentage / 100);
  const priceDistance = Math.abs(entryPrice - stopLossPrice);
  const positionSize = priceDistance > 0 ? riskAmount / priceDistance : 0;
  const notionalValue = positionSize * entryPrice;
  const leverage = accountBalance > 0 ? notionalValue / accountBalance : 0;

  const entryFee = notionalValue * takerFeeRate;
  const exitFee = positionSize * stopLossPrice * takerFeeRate;
  const totalFees = entryFee + exitFee;

  const breakEvenPrice =
    entryPrice > 0
      ? inputs.isLong
        ? entryPrice * ((1 + takerFeeRate) / Math.max(1e-12, 1 - takerFeeRate))
        : entryPrice * ((1 - takerFeeRate) / (1 + takerFeeRate))
      : 0;

  return {
    riskAmount,
    priceDistance,
    positionSize,
    notionalValue,
    leverage,
    entryFee,
    exitFee,
    totalFees,
    breakEvenPrice,
    leverageTooHigh: leverage > maxExchangeLeverage,
    maxExchangeLeverage
  };
}
