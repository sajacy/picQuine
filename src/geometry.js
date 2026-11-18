'use strict';
const picQuineGeometry = (() => {
  function angle(l) {
    return (l.rotation || 0) % 360;
  }
  function layerCorners(l) {
    const a = (angle(l) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    return [
      [-l.w / 2, -l.h / 2],
      [l.w / 2, -l.h / 2],
      [l.w / 2, l.h / 2],
      [-l.w / 2, l.h / 2],
    ].map(([x, y]) => ({x: cx + x * c - y * s, y: cy + x * s + y * c}));
  }
  function layerPoint(l, p) {
    const a = (-angle(l) * Math.PI) / 180;
    const dx = p.x - l.x - l.w / 2;
    const dy = p.y - l.y - l.h / 2;
    return {
      x: ((dx * Math.cos(a) - dy * Math.sin(a) + l.w / 2) * l.canvas.width) /
          l.w,
      y: ((dx * Math.sin(a) + dy * Math.cos(a) + l.h / 2) * l.canvas.height) /
          l.h,
    };
  }
  function normalRect(r) {
    return {
      x: Math.min(r.x, r.x + r.w),
      y: Math.min(r.y, r.y + r.h),
      w: Math.abs(r.w),
      h: Math.abs(r.h),
    };
  }
  function resizeDimensions(ow, oh, width, height, unit) {
    return unit === 'percent' ? {
      w: Math.round((ow * width) / 100),
      h: Math.round((oh * height) / 100),
    } :
                                {w: Math.round(width), h: Math.round(height)};
  }
  return {angle, layerCorners, layerPoint, normalRect, resizeDimensions};
})();
