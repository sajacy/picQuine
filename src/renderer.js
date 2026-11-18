'use strict';
const picQuineRenderer = (() => {
  const {angle} = picQuineGeometry;
  function prepare(target, width, height) {
    if (target.width !== width) {
      target.width = width;
    }
    if (target.height !== height) {
      target.height = height;
    }
    const context = target.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.setLineDash([]);
    context.clearRect(0, 0, width, height);
    return context;
  }
  function scheduler(requestFrame, paint) {
    let pending = false;
    let full = false;
    return function request(composition = true) {
      // Overlay requests must not downgrade an already queued full draw.
      full ||= composition;
      if (pending) {
        return;
      }
      pending = true;
      requestFrame(() => {
        const composite = full;
        pending = false;
        full = false;
        paint(composite);
      });
    };
  }
  function composite(target, state, background) {
    const context = prepare(target, state.w, state.h);
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, state.w, state.h);
    }
    for (const layer of state.layers) {
      if (!layer.visible) {
        continue;
      }
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = layer.blend;
      drawLayer(context, layer);
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    return target;
  }
  function drawLayer(context, layer) {
    if (!angle(layer)) {
      context.drawImage(layer.canvas, layer.x, layer.y, layer.w, layer.h);
      return;
    }
    context.save();
    context.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
    context.rotate((angle(layer) * Math.PI) / 180);
    context.drawImage(
        layer.canvas, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
    context.restore();
  }
  return {composite, drawLayer, prepare, scheduler};
})();
