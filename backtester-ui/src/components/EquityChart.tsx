import { useEffect, useRef } from "react";
import { ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";

interface EquityChartProps {
  equity: Array<{ ts: number; value: number }>;
}

export function EquityChart({ equity }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#334155"
      },
      grid: {
        vertLines: { color: "#f1f5f9" },
        horzLines: { color: "#f1f5f9" }
      }
    });
    const series = chart.addLineSeries({
      color: "#4f46e5",
      lineWidth: 2
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(
      equity.map((point) => ({
        time: Math.floor(point.ts / 1000) as Time,
        value: point.value
      }))
    );
    chartRef.current?.timeScale().fitContent();
  }, [equity]);

  return <div ref={containerRef} className="h-full w-full" />;
}
