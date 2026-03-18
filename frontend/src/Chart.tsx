import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  TickMarkType
} from "lightweight-charts";
import type { Candle } from "./types";

interface ChartProps {
  candles: Candle[];
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
  vwapPeriod = 20,
  emaEnabled = true,
  emaPeriod = 9,
  onCrosshairTimeChange
}: ChartProps) {
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

    const normalizedCandles = candles
      .filter(
        (c) =>
          Number.isFinite(c.timeMs) &&
          [c.open, c.high, c.low, c.close].every(Number.isFinite)
      )
      .map((c) => ({
        time: Math.floor(c.timeMs / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number.isFinite(c.volume) && c.volume >= 0 ? c.volume : 0
      }))
      .sort((a, b) => a.time - b.time);

    const data = normalizedCandles.reduce<
      Array<
        CandlestickData & {
          volume: number;
        }
      >
    >((acc, point) => {
        const last = acc[acc.length - 1];
        if (last && last.time === point.time) {
          acc[acc.length - 1] = point;
        } else {
          acc.push(point);
        }
        return acc;
      }, []);

    seriesRef.current.setData(
      data.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }))
    );
    volumeSeriesRef.current?.setData(
      data.map(
        ({ time, volume }) =>
          ({
            time,
            value: volume
          }) satisfies HistogramData
      )
    );

    const period = Math.max(1, Math.floor(vwapPeriod));
    const pvWindow: number[] = [];
    const volumeWindow: number[] = [];
    let rollingPV = 0;
    let rollingVolume = 0;
    const vwapData: LineData[] = [];
    for (const point of data) {
      const typicalPrice = (point.high + point.low + point.close) / 3;
      const volume = Number.isFinite(point.volume) ? point.volume : 0;
      const pv = typicalPrice * volume;
      pvWindow.push(pv);
      volumeWindow.push(volume);
      rollingPV += pv;
      rollingVolume += volume;
      if (pvWindow.length > period) {
        rollingPV -= pvWindow.shift() ?? 0;
        rollingVolume -= volumeWindow.shift() ?? 0;
      }
      vwapData.push({
        time: point.time,
        value: rollingVolume > 0 ? rollingPV / rollingVolume : typicalPrice
      });
    }
    vwapSeriesRef.current?.setData(vwapData);

    if (!emaEnabled) {
      emaSeriesRef.current?.setData([]);
    } else {
      const period = Math.max(1, Math.floor(emaPeriod));
      const multiplier = 2 / (period + 1);
      const emaData: LineData[] = [];
      let emaValue: number | null = null;
      for (const point of data) {
        if (emaValue == null) {
          emaValue = point.close;
        } else {
          emaValue = (point.close - emaValue) * multiplier + emaValue;
        }
        emaData.push({ time: point.time, value: emaValue });
      }
      emaSeriesRef.current?.setData(emaData);
    }
  }, [candles, vwapPeriod, emaEnabled, emaPeriod]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

