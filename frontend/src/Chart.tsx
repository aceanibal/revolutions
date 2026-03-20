import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  HistogramData,
  Time,
  TickMarkType,
  CreatePriceLineOptions
} from "lightweight-charts";
import type { Candle, GapRange } from "./types";
import { normalizeCandles } from "./chart/logic/candles";
import { calculateEmaData, calculateVwapData } from "./chart/logic/indicators";

interface ChartProps {
  candles: Candle[];
  gaps?: GapRange[];
  vwapEnabled?: boolean;
  vwapPeriod?: number;
  emaEnabled?: boolean;
  emaPeriod?: number;
  entryPrice?: number;
  stopLossPrice?: number;
  breakEvenPrice?: number;
  isLong?: boolean;
  enableStopLossDrag?: boolean;
  onStopLossPriceChange?: (nextPrice: number) => void;
  onCrosshairTimeChange?: (timeSec: number | null) => void;
}

function toEpochSeconds(time: Time): number | null {
  if (typeof time === "number") return time;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  if (time && typeof time === "object" && "year" in time) {
    const parsed = Date.UTC(time.year, time.month - 1, time.day);
    return Math.floor(parsed / 1000);
  }
  return null;
}

export function Chart({
  candles,
  gaps = [],
  vwapEnabled = true,
  vwapPeriod = 20,
  emaEnabled = true,
  emaPeriod = 9,
  entryPrice = 0,
  stopLossPrice = 0,
  breakEvenPrice = 0,
  isLong = true,
  enableStopLossDrag = false,
  onStopLossPriceChange,
  onCrosshairTimeChange
}: ChartProps) {
  const palette = {
    live: { up: "#16a34a", down: "#dc2626" },
    history: { up: "#166534", down: "#991b1b" },
    mixed: { up: "#15803d", down: "#b91c1c" },
    gaps: "#c2410c"
  } as const;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stopLossLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const breakEvenLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const entryLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const draggingStopLossRef = useRef(false);
  const latestStopLossRef = useRef(stopLossPrice);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 800,
      height: containerRef.current.clientHeight || 400,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#0f172a"
      },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" }
      },
      rightPriceScale: {
        borderColor: "#cbd5f5"
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#cbd5f5",
        ticksVisible: true,
        barSpacing: 12,
        minBarSpacing: 8,
        tickMarkFormatter: (time: Time, _tickMarkType: TickMarkType, locale: string) => {
          const timeSec = toEpochSeconds(time);
          if (!timeSec) return "";
          return new Date(timeSec * 1000).toLocaleTimeString(locale, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
        }
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: "#0f172a",
          style: 1,
          width: 1,
          labelBackgroundColor: "#0f172a"
        },
        horzLine: {
          color: "#0f172a",
          style: 1,
          width: 1,
          labelBackgroundColor: "#0f172a"
        }
      }
    });

    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626"
    });
    chart.priceScale("right").applyOptions({
      // Reserve lower space so volume feels like a separate panel.
      scaleMargins: {
        top: 0.08,
        bottom: 0.28
      }
    });
    const volumeSeries = chart.addHistogramSeries({
      color: "rgba(107, 127, 153, 0.55)",
      priceFormat: {
        type: "volume"
      },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: {
        top: 0.76,
        bottom: 0.02
      }
    });
    const vwapSeries = chart.addLineSeries({
      color: "#0284c7",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });
    const emaSeries = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    vwapSeriesRef.current = vwapSeries;
    emaSeriesRef.current = emaSeries;
    const handleCrosshairMove = (param: { time?: Time }) => {
      if (!onCrosshairTimeChange || !param.time) {
        onCrosshairTimeChange?.(null);
        return;
      }
      onCrosshairTimeChange(toEpochSeconds(param.time));
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
      vwapSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, [onCrosshairTimeChange]);

  useEffect(() => {
    if (!seriesRef.current) return;

    const data = normalizeCandles(candles);

    seriesRef.current.setData(
      data.map(({ time, open, high, low, close, source }) => {
        const isUp = close >= open;
        const sourceKey = source === "mixed" ? "mixed" : source === "live" ? "live" : "history";
        const color = isUp ? palette[sourceKey].up : palette[sourceKey].down;
        return {
          time: time as Time,
          open,
          high,
          low,
          close,
          color,
          wickColor: color,
          borderColor: color
        };
      })
    );
    volumeSeriesRef.current?.setData(
      data.map(
        ({ time, volume }) =>
          ({
            time: time as Time,
            value: volume
          }) satisfies HistogramData
      )
    );

    if (vwapEnabled) {
      const vwapData = calculateVwapData(data, vwapPeriod);
      vwapSeriesRef.current?.setData(vwapData);
    } else {
      vwapSeriesRef.current?.setData([]);
    }

    if (emaEnabled) {
      const emaData = calculateEmaData(data, emaPeriod);
      emaSeriesRef.current?.setData(emaData);
    } else {
      emaSeriesRef.current?.setData([]);
    }

    const markers = gaps.map((gap) => ({
      time: Math.floor(gap.fromTimeMs / 1000),
      position: "aboveBar" as const,
      color: palette.gaps,
      shape: "circle" as const,
      text: `Gap (${gap.missingBuckets})`
    }));
    (seriesRef.current as any)?.setMarkers?.(markers);
  }, [candles, gaps, vwapEnabled, vwapPeriod, emaEnabled, emaPeriod]);

  useEffect(() => {
    latestStopLossRef.current = stopLossPrice;
  }, [stopLossPrice]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !enableStopLossDrag || !onStopLossPriceChange) return;

    const proximityPx = 8;
    const onPointerDown = (event: PointerEvent) => {
      if (!latestStopLossRef.current || latestStopLossRef.current <= 0) return;
      const rect = container.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const slCoordinate = series.priceToCoordinate(latestStopLossRef.current);
      if (slCoordinate === null) return;
      if (Math.abs(y - slCoordinate) <= proximityPx) {
        draggingStopLossRef.current = true;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!draggingStopLossRef.current) return;
      const rect = container.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const nextPrice = series.coordinateToPrice(y);
      if (nextPrice && Number.isFinite(nextPrice) && nextPrice > 0) {
        onStopLossPriceChange(nextPrice);
      }
    };

    const stopDragging = () => {
      draggingStopLossRef.current = false;
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [enableStopLossDrag, onStopLossPriceChange]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const overlapThreshold = entryPrice > 0 ? entryPrice * 0.000001 : 0.000001;
    const entryOverlapsStopLoss =
      entryPrice > 0 &&
      stopLossPrice > 0 &&
      Math.abs(entryPrice - stopLossPrice) <= overlapThreshold;

    if (stopLossLineRef.current) {
      series.removePriceLine(stopLossLineRef.current);
      stopLossLineRef.current = null;
    }
    if (breakEvenLineRef.current) {
      series.removePriceLine(breakEvenLineRef.current);
      breakEvenLineRef.current = null;
    }
    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }

    if (entryPrice > 0 && !entryOverlapsStopLoss) {
      entryLineRef.current = series.createPriceLine({
        price: entryPrice,
        color: "rgba(139, 92, 246, 0.95)",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "Entry Px"
      });
    }

    if (stopLossPrice > 0) {
      const slLineOpts: CreatePriceLineOptions = {
        price: stopLossPrice,
        color: "rgba(96, 165, 250, 0.8)",
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: entryOverlapsStopLoss ? "SL / Entry" : "SL"
      };
      stopLossLineRef.current = series.createPriceLine(slLineOpts);
    }

    if (breakEvenPrice > 0) {
      breakEvenLineRef.current = series.createPriceLine({
        price: breakEvenPrice,
        color: isLong ? "rgba(251, 146, 60, 0.95)" : "rgba(250, 204, 21, 0.95)",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Break-even"
      });
    }
  }, [entryPrice, stopLossPrice, breakEvenPrice, isLong]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

