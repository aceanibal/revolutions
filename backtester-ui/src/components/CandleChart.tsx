import { useEffect, useMemo, useRef } from "react";
import { ColorType, createChart, type IChartApi, type ISeriesApi, type LogicalRange, type Time } from "lightweight-charts";
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
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const volumeContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volumeChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLinesRef = useRef<Array<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>>>([]);
  const markerSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const indicatorSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const syncingRef = useRef(false);

  const hasVolume = useMemo(
    () => candles.some((c) => Number.isFinite(c.volume) && Number(c.volume) > 0),
    [candles]
  );

  const safelyRemoveMarkerSeries = (chart: IChartApi, markerSeries: ISeriesApi<"Line"> | null | undefined) => {
    if (!markerSeries) return;
    try {
      chart.removeSeries(markerSeries);
    } catch {
      // Series may already be detached after chart recreation/removal.
    }
  };

  useEffect(() => {
    if (!priceContainerRef.current || !volumeContainerRef.current) return;
    const chart = createChart(priceContainerRef.current, {
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
        visible: !hasVolume,
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
    const volumeChart = createChart(volumeContainerRef.current, {
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
        visible: true,
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
    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false
    });
    const syncRange = (target: IChartApi) => (logicalRange: LogicalRange | null) => {
      if (!logicalRange || syncingRef.current) return;
      syncingRef.current = true;
      target.timeScale().setVisibleLogicalRange(logicalRange);
      syncingRef.current = false;
    };
    const onPriceRangeChange = syncRange(volumeChart);
    const onVolumeRangeChange = syncRange(chart);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onPriceRangeChange);
    volumeChart.timeScale().subscribeVisibleLogicalRangeChange(onVolumeRangeChange);
    requestAnimationFrame(() => {
      chart.timeScale().fitContent();
      volumeChart.timeScale().fitContent();
    });
    chartRef.current = chart;
    volumeChartRef.current = volumeChart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      markerSeriesRef.current = [];
      indicatorSeriesRef.current = [];
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onPriceRangeChange);
      volumeChart.timeScale().unsubscribeVisibleLogicalRangeChange(onVolumeRangeChange);
      chart.remove();
      volumeChart.remove();
      chartRef.current = null;
      volumeChartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [hasVolume]);

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
    volumeSeriesRef.current?.setData(
      hasVolume
        ? candles
            .filter((c) => Number.isFinite(c.timeMs) && Number.isFinite(c.volume) && c.timeMs > 0 && c.volume > 0)
            .map((c) => ({
              time: Math.floor(c.timeMs / 1000) as Time,
              value: Number(c.volume || 0),
              color: c.close >= c.open ? "#16a34a80" : "#dc262680"
            }))
        : []
    );
    chartRef.current?.timeScale().fitContent();
    if (hasVolume) volumeChartRef.current?.timeScale().fitContent();
  }, [candles, hasVolume]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: {
        visible: !hasVolume
      }
    });
  }, [hasVolume]);

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

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: hasVolume ? 8 : 0 }}>
      <div ref={priceContainerRef} style={{ width: "100%", height: hasVolume ? "72%" : "100%" }} />
      <div
        ref={volumeContainerRef}
        style={{ width: "100%", height: hasVolume ? "28%" : "0%", overflow: "hidden", opacity: hasVolume ? 1 : 0 }}
      />
    </div>
  );
}
