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
        borderColor: "#cbd5f5"
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
      }))
      .sort((a, b) => a.time - b.time)
      .reduce<CandlestickData[]>((acc, point) => {
        const last = acc[acc.length - 1];
        if (last && last.time === point.time) {
          acc[acc.length - 1] = point;
        } else {
          acc.push(point);
        }
        return acc;
      }, []);

    seriesRef.current.setData(data);
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

