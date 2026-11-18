'use strict';
const picQuineShapes = (() => {
  function drawShape(c, r, style, kind) {
    const path = (inset) => {
      c.beginPath();
      if (kind === 'ellipse') {
        c.ellipse(
            r.x + r.w / 2,
            r.y + r.h / 2,
            Math.max(0, r.w / 2 - inset),
            Math.max(0, r.h / 2 - inset),
            0,
            0,
            Math.PI * 2,
        );
      } else {
        c.rect(
            r.x + inset,
            r.y + inset,
            Math.max(0, r.w - 2 * inset),
            Math.max(0, r.h - 2 * inset),
        );
      }
    };
    c.save();
    if (style.mode !== 'stroke') {
      path(0);
      c.fillStyle = style.fill;
      c.fill();
    }
    if (style.mode !== 'fill') {
      const width = Math.min(style.strokeWidth, r.w, r.h);
      // Canvas centers strokes on the path; inset to keep entered bounds exact.
      path(width / 2);
      c.strokeStyle = style.stroke;
      c.lineWidth = width;
      c.lineJoin = 'miter';
      c.setLineDash([]);
      c.stroke();
    }
    c.restore();
  }
  return {drawShape};
})();
