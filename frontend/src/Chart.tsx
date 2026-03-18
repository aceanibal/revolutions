import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  HistogramData,
  Time,
  TickMarkType
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

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
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
        const sourceKey = source === "history" || source === "mixed" ? source : "live";
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

