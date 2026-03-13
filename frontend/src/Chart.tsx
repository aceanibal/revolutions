import { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData } from "lightweight-charts";
import type { Candle } from "./types";

interface ChartProps {
  candles: Candle[];
}

export function Chart({ candles }: ChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth || 800,
      height: containerRef.current.clientHeight || 400,
      layout: { background: { color: "#0b1220" }, textColor: "#e5e7eb" },
      timeScale: { timeVisible: true, secondsVisible: false }
    });

    const series = chart.addCandlestickSeries();

    chartRef.current = chart;
    seriesRef.current = series;

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
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;

    const data: CandlestickData[] = candles
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
        close: c.close
      }));

    seriesRef.current.setData(data);
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

