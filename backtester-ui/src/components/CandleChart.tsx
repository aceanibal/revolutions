import { useEffect, useRef } from "react";
import { ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { Candle, IndicatorSeries } from "../types";

type ChartCandle = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
};

interface CandleChartProps {
  candles: Candle[];
  priceLevels?: Array<{
    title: string;
    price: number;
    color: string;
    lineStyle?: 0 | 1 | 2 | 3;
  }>;
  timeMarkers?: Array<{
    title: string;
    timeMs: number;
    price: number;
    color: string;
  }>;
  indicatorSeries?: IndicatorSeries[];
}

export function CandleChart({ candles, priceLevels = [], timeMarkers = [], indicatorSeries = [] }: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<Array<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>>>([]);
  const markerSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const indicatorSeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  const safelyRemoveMarkerSeries = (chart: IChartApi, markerSeries: ISeriesApi<"Line"> | null | undefined) => {
    if (!markerSeries) return;
    try {
      chart.removeSeries(markerSeries);
    } catch {
      // Series may already be detached after chart recreation/removal.
    }
  };

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
      },
      rightPriceScale: {
        borderColor: "#cbd5e1"
      },
      timeScale: {
        borderColor: "#cbd5e1",
        timeVisible: true,
        secondsVisible: false
      },
      localization: {
        timeFormatter: (time: Time) => {
          const asNumber = Number(time);
          if (!Number.isFinite(asNumber) || asNumber <= 0) return "";
          return new Date(asNumber * 1000).toLocaleString("en-US", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          });
        }
      }
    });
    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626"
    });
    requestAnimationFrame(() => {
      chart.timeScale().fitContent();
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      markerSeriesRef.current = [];
      indicatorSeriesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const data: ChartCandle[] = candles
      .filter(
        (c) =>
          Number.isFinite(c.timeMs) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
      )
      .map((c) => ({
        time: Math.floor(c.timeMs / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!series || !chart) return;
    for (const markerSeries of markerSeriesRef.current) {
      safelyRemoveMarkerSeries(chart, markerSeries);
    }
    markerSeriesRef.current = [];
    for (const marker of timeMarkers) {
      if (!Number.isFinite(marker.timeMs) || !Number.isFinite(marker.price) || marker.timeMs <= 0) continue;
      const markerSeries = chart.addLineSeries({
        color: marker.color,
        lineVisible: false,
        pointMarkersVisible: true,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 5,
        crosshairMarkerBorderColor: marker.color,
        crosshairMarkerBackgroundColor: marker.color,
        title: marker.title
      });
      const markerTime = Math.floor(marker.timeMs / 1000);
      if (!Number.isFinite(markerTime) || markerTime <= 0) continue;
      markerSeries.setData([
        {
          time: markerTime as Time,
          value: marker.price
        }
      ]);
      markerSeriesRef.current.push(markerSeries);
    }
  }, [timeMarkers]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const lineSeries of indicatorSeriesRef.current) {
      safelyRemoveMarkerSeries(chart, lineSeries);
    }
    indicatorSeriesRef.current = [];
    for (const indicator of indicatorSeries) {
      const lineSeries = chart.addLineSeries({
        color: indicator.color,
        lineWidth: 2,
        title: indicator.title,
        crosshairMarkerVisible: false,
        lastValueVisible: true,
        priceLineVisible: false
      });
      lineSeries.setData(
        indicator.values
          .filter((point) => Number.isFinite(point.timeMs) && Number.isFinite(point.value) && point.timeMs > 0)
          .map((point) => ({
            time: Math.floor(point.timeMs / 1000) as Time,
            value: point.value
          }))
      );
      indicatorSeriesRef.current.push(lineSeries);
    }
  }, [indicatorSeries]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    return () => {
      for (const markerSeries of markerSeriesRef.current) {
        safelyRemoveMarkerSeries(chart, markerSeries);
      }
      markerSeriesRef.current = [];
      for (const lineSeries of indicatorSeriesRef.current) {
        safelyRemoveMarkerSeries(chart, lineSeries);
      }
      indicatorSeriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      series.removePriceLine(line);
    }
    priceLinesRef.current = [];
    for (const level of priceLevels) {
      if (!Number.isFinite(level.price)) continue;
      const line = series.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 2,
        lineStyle: level.lineStyle ?? 0,
        axisLabelVisible: true,
        title: level.title
      });
      priceLinesRef.current.push(line);
    }
  }, [priceLevels]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
