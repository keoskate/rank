import React, { useEffect, useRef } from 'react';

/**
 * VolumeProfileOverlay
 *
 * Canvas overlay that paints a horizontal volume profile on top of a
 * lightweight-charts v3.8 chart (v3.8 has no custom-series API, hence
 * canvas).
 *
 * Bars are right-anchored; widths scale to the max-bin volume (25% of
 * canvas width), and the POC bin is drawn brighter. Repaints on profile
 * change, container resize, visible-time-range change, and (via a
 * throttled rAF loop) whenever the price scale moves the POC coordinate
 * by >0.5px — v3.8 has no price-scale-change event.
 *
 * Props:
 * - chart: lightweight-charts chart instance
 * - series: price series used for price->coordinate conversion
 * - profile: { bins: [{pLo, pHi, vol}], pocPrice, ... } from /api/volume-profile
 * - containerRef: ref to the chart container div (must be position:relative)
 */
const VolumeProfileOverlay = ({ chart, series, profile, containerRef }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef?.current;
    if (!canvas || !container || !chart || !series) return;
    if (!profile || !Array.isArray(profile.bins) || profile.bins.length === 0)
      return;

    const bins = profile.bins;
    const maxVol = bins.reduce((max, bin) => Math.max(max, bin.vol || 0), 0);
    // POC = highest-volume bin (same definition as quant-core's pocIndex)
    let pocIndex = 0;
    bins.forEach((bin, i) => {
      if ((bin.vol || 0) > (bins[pocIndex].vol || 0)) pocIndex = i;
    });

    let rafId = null;
    let lastPocY = null;
    let disposed = false;

    const draw = () => {
      if (disposed) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (maxVol <= 0) return;

      const maxBarWidth = width * 0.25;
      try {
        bins.forEach((bin, i) => {
          const yMid = series.priceToCoordinate((bin.pLo + bin.pHi) / 2);
          if (yMid === null || yMid === undefined) return;
          const yLo = series.priceToCoordinate(bin.pLo);
          const yHi = series.priceToCoordinate(bin.pHi);
          const barHeight =
            yLo !== null &&
            yHi !== null &&
            yLo !== undefined &&
            yHi !== undefined
              ? Math.max(1, Math.abs(yLo - yHi))
              : 1;
          const barWidth = ((bin.vol || 0) / maxVol) * maxBarWidth;
          if (barWidth <= 0) return;
          ctx.fillStyle =
            i === pocIndex
              ? 'rgba(245, 158, 11, 0.6)'
              : 'rgba(245, 158, 11, 0.25)';
          ctx.fillRect(
            width - barWidth,
            yMid - barHeight / 2,
            barWidth,
            barHeight
          );
        });
        lastPocY = series.priceToCoordinate(profile.pocPrice);
      } catch (e) {
        // Series disposed mid-paint (chart torn down); stop quietly.
        disposed = true;
      }
    };

    // rAF loop, throttled: only repaint when the POC's pixel coordinate has
    // moved >0.5px since the last paint (price-scale changes have no event
    // in v3.8).
    const tick = () => {
      if (disposed) return;
      try {
        const pocY = series.priceToCoordinate(profile.pocPrice);
        if (
          pocY !== null &&
          pocY !== undefined &&
          (lastPocY === null ||
            lastPocY === undefined ||
            Math.abs(pocY - lastPocY) > 0.5)
        ) {
          draw();
        }
      } catch (e) {
        disposed = true;
        return;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    const handleRangeChange = () => draw();
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleTimeRangeChange(handleRangeChange);

    const resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(container);

    draw();
    rafId = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      try {
        timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange);
      } catch (e) {
        // Chart already removed
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [chart, series, profile, containerRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    />
  );
};

export default VolumeProfileOverlay;
