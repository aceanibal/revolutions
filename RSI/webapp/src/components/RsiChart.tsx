import { useEffect, useRef } from "react";
import { createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";

interface RsiChartProps {
  data: Array<{ timeMs: number; value: number }>;
  lowerBand?: number;
  upperBand?: number;
  fitKey?: string | number;
}

export function RsiChart({ data, lowerBand = 35, upperBand = 60, fitKey }: RsiChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bandRefs = useRef<Array<ReturnType<ISeriesApi<"Line">["createPriceLine"]>>>([]);
  const lastFitKeyRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    if (!rootRef.current || chartRef.current) return;
    const chart = createChart(rootRef.current, {
      width: rootRef.current.clientWidth || 1000,
      height: rootRef.current.clientHeight || 140,
      layout: { background: { color: "#fff" }, textColor: "#334155" },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" }
      },
      rightPriceScale: {
        borderColor: "#cbd5e1",
        scaleMargins: { top: 0.12, bottom: 0.12 }
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#cbd5e1" }
    });
    const line = chart.addLineSeries({
      color: "#2563eb",
      lineWidth: 2,
      priceLineVisible: false
    });
    chartRef.current = chart;
    lineRef.current = line;

    const ro = new ResizeObserver(() => {
      if (!rootRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: rootRef.current.clientWidth,
        height: rootRef.current.clientHeight
      });
    });
    ro.observe(rootRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = lineRef.current;
    if (!series) return;
    const sorted = [...data].filter((d) => Number.isFinite(d.timeMs)).sort((a, b) => a.timeMs - b.timeMs);
    series.setData(
      sorted.map((d) => ({
        time: Math.floor(d.timeMs / 1000) as Time,
        value: d.value
      }))
    );
    bandRefs.current.forEach((line) => series.removePriceLine(line));
    bandRefs.current = [
      series.createPriceLine({
        price: lowerBand,
        color: "rgba(220,38,38,0.75)",
        lineStyle: 2,
        lineWidth: 1,
        title: `RSI L ${lowerBand}`,
        axisLabelVisible: true
      }),
      series.createPriceLine({
        price: upperBand,
        color: "rgba(5,150,105,0.75)",
        lineStyle: 2,
        lineWidth: 1,
        title: `RSI H ${upperBand}`,
        axisLabelVisible: true
      })
    ];

    if (fitKey !== undefined && fitKey !== lastFitKeyRef.current) {
      chartRef.current?.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }
  }, [data, lowerBand, upperBand, fitKey]);

  return <div ref={rootRef} className="h-full w-full" />;
}
