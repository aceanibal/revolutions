import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { normalizeMarkers } from "../lib/chartMarkers";
import type { Candle, ChartMarker, PriceLevel } from "../types";

interface CandleChartProps {
  candles: Candle[];
  markers?: ChartMarker[];
  levels?: PriceLevel[];
  fitKey?: string | number;
  onCrosshairTimeSec?: (timeSec: number | null) => void;
}

function toChartTime(ms: number): Time {
  return Math.floor(ms / 1000) as Time;
}

export function CandleChart({
  candles,
  markers = [],
  levels = [],
  fitKey,
  onCrosshairTimeSec
}: CandleChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const levelRefs = useRef<Array<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>>>([]);
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
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#cbd5e1"
      },
      rightPriceScale: {
        borderColor: "#cbd5e1"
      },
      crosshair: {
        mode: 0
      }
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

    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.06, bottom: 0.28 }
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

    const handleCrosshair = (param: { time?: Time }) => {
      if (!param.time) {
        onCrosshairTimeSec?.(null);
        return;
      }
      if (typeof param.time === "number") {
        onCrosshairTimeSec?.(param.time);
        return;
      }
      onCrosshairTimeSec?.(null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    chartRef.current = chart;
    seriesRef.current = candlesSeries;
    volumeRef.current = volumeSeries;

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, [onCrosshairTimeSec]);

  useEffect(() => {
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!series || !volume) return;

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

    (series as any).setMarkers?.(normalizeMarkers(markers));

    levelRefs.current.forEach((line) => series.removePriceLine(line));
    levelRefs.current = levels
      .filter((level) => Number.isFinite(level.price) && level.price > 0)
      .map((level) =>
        series.createPriceLine({
          price: level.price,
          color: level.color,
          lineWidth: 2,
          lineStyle: level.style ?? 2,
          axisLabelVisible: true,
          title: level.title
        })
      );

    if (fitKey !== undefined && fitKey !== lastFitKeyRef.current) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
  }, [candles, markers, levels, fitKey]);

  return <div ref={rootRef} className="h-full w-full" />;
}
