import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { normalizeMarkers } from "../lib/chartMarkers";
import type { Candle, ChartMarker } from "../types";

function toChartTime(ms: number): Time {
  return Math.floor(ms / 1000) as Time;
}

export interface OhlcvRsiChartProps {
  candles: Candle[];
  markers?: ChartMarker[];
  rsi: {
    period: number;
    data: Array<{ timeMs: number; value: number }>;
    lower: number;
    upper: number;
  };
  fitKey?: string | number;
}

export function OhlcvRsiChart({ candles, markers = [], rsi, fitKey }: OhlcvRsiChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiBandRefs = useRef<Array<ReturnType<ISeriesApi<"Line">["createPriceLine"]>>>([]);
  const lastFitKeyRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    if (!rootRef.current || chartRef.current) return;
    const chart = createChart(rootRef.current, {
      width: rootRef.current.clientWidth || 1000,
      height: rootRef.current.clientHeight || 400,
      layout: { background: { color: "#fff" }, textColor: "#0f172a" },
      grid: {
        vertLines: { color: "#e2e8f0" },
        horzLines: { color: "#e2e8f0" }
      },
      leftPriceScale: {
        visible: true,
        borderColor: "#c7d2fe",
        scaleMargins: { top: 0.08, bottom: 0.2 }
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.06, bottom: 0.28 }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#cbd5e1"
      },
      crosshair: { mode: 0 }
    });

    const candlesSeries = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626"
    });
    const volumeSeries = chart.addHistogramSeries({
      color: "rgba(100, 116, 139, 0.45)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    const rsiSeries = chart.addLineSeries({
      color: "#4f46e5",
      lineWidth: 2,
      priceScaleId: "left",
      priceLineVisible: false,
      lastValueVisible: true
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.77, bottom: 0.02 }
    });

    const ro = new ResizeObserver(() => {
      if (!rootRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: rootRef.current.clientWidth,
        height: rootRef.current.clientHeight
      });
    });
    ro.observe(rootRef.current);

    chartRef.current = chart;
    candleRef.current = candlesSeries;
    volumeRef.current = volumeSeries;
    rsiRef.current = rsiSeries;

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      rsiRef.current = null;
      rsiBandRefs.current = [];
    };
  }, []);

  useEffect(() => {
    const series = candleRef.current;
    const volume = volumeRef.current;
    const rsiLine = rsiRef.current;
    if (!series || !volume || !rsiLine) return;

    const normalized = candles
      .filter((c) => Number.isFinite(c.timeMs))
      .sort((a, b) => a.timeMs - b.timeMs);

    series.setData(
      normalized.map((c) => ({
        time: toChartTime(c.timeMs),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }))
    );
    volume.setData(
      normalized.map((c) => ({
        time: toChartTime(c.timeMs),
        value: Number.isFinite(c.volume) ? c.volume : 0
      }))
    );

    (series as { setMarkers?: (m: unknown[]) => void }).setMarkers?.(normalizeMarkers(markers));

    const rsiSorted = [...rsi.data]
      .filter((d) => Number.isFinite(d.timeMs) && Number.isFinite(d.value))
      .sort((a, b) => a.timeMs - b.timeMs);
    rsiLine.setData(
      rsiSorted.map((d) => ({
        time: toChartTime(d.timeMs),
        value: d.value
      }))
    );

    rsiBandRefs.current.forEach((line) => rsiLine.removePriceLine(line));
    rsiBandRefs.current = [
      rsiLine.createPriceLine({
        price: rsi.upper,
        color: "rgba(5, 150, 105, 0.85)",
        lineStyle: 2,
        lineWidth: 1,
        title: `RSI high ${rsi.upper}`,
        axisLabelVisible: true
      }),
      rsiLine.createPriceLine({
        price: rsi.lower,
        color: "rgba(220, 38, 38, 0.85)",
        lineStyle: 2,
        lineWidth: 1,
        title: `RSI low ${rsi.lower}`,
        axisLabelVisible: true
      })
    ];

    if (fitKey !== undefined && fitKey !== lastFitKeyRef.current) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
  }, [candles, markers, rsi.data, rsi.lower, rsi.upper, rsi.period, fitKey]);

  return <div ref={rootRef} className="h-full w-full" />;
}
