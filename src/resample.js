/* Explicit separable, scale-aware resampling. Shared by the local worker and
 * tests. */
((root) => {
  'use strict';
  function kernel(x, method) {
    x = Math.abs(x);
    if (method === 'bicubic') {
      // Keys cubic convolution, a = -0.5 (Catmull–Rom).
      if (x < 1) {
        return 1.5 * x * x * x - 2.5 * x * x + 1;
      }
      if (x < 2) {
        return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2;
      }
      return 0;
    }
    if (x === 0) {
      return 1;
    }
    if (x >= 3) {
      return 0;
    }
    const p = Math.PI * x;
    return ((Math.sin(p) / p) * Math.sin(p / 3)) / (p / 3);
  }
  function axisWeights(sourceSize, targetSize, offset, count, method) {
    const stretch = Math.max(1, sourceSize / targetSize);
    const radius = (method === 'bicubic' ? 2 : 3) * stretch;
    const table = [];
    for (let i = 0; i < count; i++) {
      const center = ((offset + i + 0.5) * sourceSize) / targetSize - 0.5;
      const weights = new Map();
      let sum = 0;
      const first = Math.max(0, Math.ceil(center - radius));
      const last = Math.min(sourceSize - 1, Math.floor(center + radius));
      for (let j = first; j <= last; j++) {
        const w = kernel((j - center) / stretch, method);
        if (w === 0) {
          continue;
        }
        const index = Math.max(0, Math.min(sourceSize - 1, j));
        weights.set(index, (weights.get(index) || 0) + w);
        sum += w;
      }
      if (Math.abs(sum) < 1e-12) {
        table.push([
          [Math.max(0, Math.min(sourceSize - 1, Math.round(center))), 1],
        ]);
        continue;
      }
      table.push([...weights].map(([j, w]) => [j, w / sum]));
    }
    return table;
  }
  function resample({
    pixels,
    sw,
    sh,
    x,
    y,
    w,
    h,
    cw,
    ch,
    method,
    rotation = 0,
  }) {
    if (!['bicubic', 'lanczos'].includes(method)) {
      throw Error('Unknown resampling filter.');
    }
    if (rotation % 360) {
      const exact = quarterTurn({
        pixels,
        sw,
        sh,
        x,
        y,
        w,
        h,
        cw,
        ch,
        rotation,
      });
      if (exact) {
        return exact;
      }
      return resampleRotated({
        pixels,
        sw,
        sh,
        x,
        y,
        w,
        h,
        cw,
        ch,
        method,
        rotation,
      });
    }
    if (!['bicubic', 'lanczos'].includes(method)) {
      throw Error('Unknown resampling filter.');
    }
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(cw, Math.ceil(x + w));
    const bottom = Math.min(ch, Math.ceil(y + h));
    if (right <= left || bottom <= top) {
      return {
        x: left,
        y: top,
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(0),
      };
    }
    const width = right - left;
    const height = bottom - top;
    const src = new Uint8ClampedArray(pixels);
    const out = new Uint8ClampedArray(width * height * 4);
    if (sw === w && sh === h && Number.isInteger(x) && Number.isInteger(y)) {
      for (let row = 0; row < height; row++) {
        const start = ((top + row - y) * sw + left - x) * 4;
        out.set(src.subarray(start, start + width * 4), row * width * 4);
      }
      return {x: left, y: top, width, height, pixels: out};
    }
    const xs = axisWeights(sw, w, left - x, width, method);
    const ys = axisWeights(sh, h, top - y, height, method);
    const rows = new Map();
    const rowLimit =
        Math.max(1, Math.floor((16 * 1024 * 1024) / (width * 4 * 4)));
    function horizontal(sy) {
      if (rows.has(sy)) {
        return rows.get(sy);
      }
      const row = new Float32Array(width * 4);
      for (let dx = 0; dx < width; dx++) {
        const dst = dx * 4;
        for (const [sx, weight] of xs[dx]) {
          const i = (sy * sw + sx) * 4;
          const alpha = src[i + 3] / 255;
          row[dst] += src[i] * alpha * weight;
          row[dst + 1] += src[i + 1] * alpha * weight;
          row[dst + 2] += src[i + 2] * alpha * weight;
          row[dst + 3] += alpha * weight;
        }
      }
      if (rows.size >= rowLimit) {
        rows.delete(rows.keys().next().value);
      }
      rows.set(sy, row);
      return row;
    }
    for (let dy = 0; dy < height; dy++) {
      const accum = new Float32Array(width * 4);
      for (const [sy, weight] of ys[dy]) {
        const row = horizontal(sy);
        for (let i = 0; i < accum.length; i++) {
          accum[i] += row[i] * weight;
        }
      }
      for (let dx = 0; dx < width; dx++) {
        const a = dx * 4;
        const i = (dy * width + dx) * 4;
        const alpha = Math.max(0, Math.min(1, accum[a + 3]));
        if (alpha > 1e-7) {
          out[i] = Math.max(0, Math.min(255, accum[a] / alpha));
          out[i + 1] = Math.max(0, Math.min(255, accum[a + 1] / alpha));
          out[i + 2] = Math.max(0, Math.min(255, accum[a + 2] / alpha));
          const coverageX = Math.max(
              0,
              Math.min(left + dx + 1, x + w) - Math.max(left + dx, x),
          );
          const coverageY = Math.max(
              0,
              Math.min(top + dy + 1, y + h) - Math.max(top + dy, y),
          );
          out[i + 3] = alpha * coverageX * coverageY * 255;
        }
      }
    }
    return {x: left, y: top, width, height, pixels: out};
  }
  // Exact right-angle permutations do not require interpolation or floating
  // buffers.
  function quarterTurn({pixels, sw, sh, x, y, w, h, cw, ch, rotation}) {
    const turn = ((rotation % 360) + 360) % 360;
    if (![90, 180, 270].includes(turn) || sw !== w || sh !== h) {
      return null;
    }
    const dw = turn === 180 ? sw : sh;
    const dh = turn === 180 ? sh : sw;
    const bx = x + w / 2 - dw / 2;
    const by = y + h / 2 - dh / 2;
    if (!Number.isInteger(bx) || !Number.isInteger(by)) {
      return null;
    }
    const left = Math.max(0, bx);
    const top = Math.max(0, by);
    const right = Math.min(cw, bx + dw);
    const bottom = Math.min(ch, by + dh);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const out = new Uint8ClampedArray(width * height * 4);
    const src = new Uint8ClampedArray(pixels);
    if (!width || !height) {
      return {x: left, y: top, width: 0, height: 0, pixels: out};
    }
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const dx = left + col - bx;
        const dy = top + row - by;
        const sx = turn === 90 ? dy : turn === 180 ? sw - 1 - dx : sw - 1 - dy;
        const sy = turn === 90 ? sh - 1 - dx : turn === 180 ? sh - 1 - dy : dx;
        const source = (sy * sw + sx) * 4;
        const target = (row * width + col) * 4;
        out[target] = src[source];
        out[target + 1] = src[source + 1];
        out[target + 2] = src[source + 2];
        out[target + 3] = src[source + 3];
      }
    }
    return {x: left, y: top, width, height, pixels: out};
  }
  // Inverse-map final pixels; filtering a browser-rotated raster loses detail.
  // Coverage antialiasing handles the transparent geometric edges.
  function resampleRotated({
    pixels,
    sw,
    sh,
    x,
    y,
    w,
    h,
    cw,
    ch,
    method,
    rotation,
  }) {
    if (!['bicubic', 'lanczos'].includes(method)) {
      throw Error('Unknown resampling filter.');
    }
    const radians = (rotation * Math.PI) / 180;
    const snap = (n) => Math.abs(n) < 1e-12 ? 0 :
        Math.abs(Math.abs(n) - 1) < 1e-12 ? Math.sign(n) :
                                              n;
    const c = snap(Math.cos(radians));
    const s = snap(Math.sin(radians));
    const cx = x + w / 2;
    const cy = y + h / 2;
    const corners = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
    const bx = Math.min(...corners.map((p) => p[0]));
    const by = Math.min(...corners.map((p) => p[1]));
    const br = Math.max(...corners.map((p) => p[0]));
    const bb = Math.max(...corners.map((p) => p[1]));
    const left = Math.max(0, Math.floor(bx));
    const top = Math.max(0, Math.floor(by));
    const right = Math.min(cw, Math.ceil(br));
    const bottom = Math.min(ch, Math.ceil(bb));
    if (right <= left || bottom <= top) {
      return {
        x: left,
        y: top,
        width: 0,
        height: 0,
        pixels: new Uint8ClampedArray(0),
      };
    }
    const width = right - left;
    const height = bottom - top;
    const out = new Uint8ClampedArray(width * height * 4);
    const src = new Uint8ClampedArray(pixels);
    const stretchX = Math.max(1, sw / w);
    const stretchY = Math.max(1, sh / h);
    const radius = method === 'bicubic' ? 2 : 3;
    const xIndices = new Int32Array(
        Math.min(sw, 2 * Math.ceil(radius * stretchX) + 1),
    );
    const xValues = new Float64Array(xIndices.length);
    const yIndices = new Int32Array(
        Math.min(sh, 2 * Math.ceil(radius * stretchY) + 1),
    );
    const yValues = new Float64Array(yIndices.length);
    function weights(center, size, stretch, indices, values) {
      let count = 0;
      let sum = 0;
      for (let j = Math.max(0, Math.ceil(center - radius * stretch));
        j <= Math.min(size - 1, Math.floor(center + radius * stretch));
        j++) {
        const weight = kernel((j - center) / stretch, method);
        if (Math.abs(weight) < 1e-12) {
          continue;
        }
        indices[count] = j;
        values[count++] = weight;
        sum += weight;
      }
      if (Math.abs(sum) < 1e-12) {
        indices[0] = Math.max(0, Math.min(size - 1, Math.round(center)));
        values[0] = 1;
        return 1;
      }
      for (let i = 0; i < count; i++) {
        values[i] /= sum;
      }
      return count;
    }
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const px = left + col;
        const py = top + row;
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const u = dx * c + dy * s + w / 2;
        const v = -dx * s + dy * c + h / 2;
        let coverage = 0;
        const extent = (Math.abs(c) + Math.abs(s)) / 2;
        if (u < -extent || u > w + extent || v < -extent || v > h + extent) {
          continue;
        }
        if (rotation % 90 === 0) {
          coverage = Math.max(0, Math.min(px + 1, br) - Math.max(px, bx)) *
              Math.max(0, Math.min(py + 1, bb) - Math.max(py, by));
        } else if (
          u >= extent && u <= w - extent && v >= extent && v <= h - extent) {
          coverage = 1;
        } else {
          for (let yy = 0; yy < 4; yy++) {
            for (let xx = 0; xx < 4; xx++) {
              const qx = px + (xx + 0.5) / 4 - cx;
              const qy = py + (yy + 0.5) / 4 - cy;
              const a = qx * c + qy * s + w / 2;
              const b = -qx * s + qy * c + h / 2;
              if (a >= 0 && a < w && b >= 0 && b < h) {
                coverage += 1 / 16;
              }
            }
          }
        }
        if (!coverage) {
          continue;
        }
        const nx = weights(
            (Math.max(0, Math.min(w, u)) * sw) / w - 0.5,
            sw,
            stretchX,
            xIndices,
            xValues,
        );
        const ny = weights(
            (Math.max(0, Math.min(h, v)) * sh) / h - 0.5,
            sh,
            stretchY,
            yIndices,
            yValues,
        );
        let red = 0;
        let green = 0;
        let blue = 0;
        let alpha = 0;
        for (let yi = 0; yi < ny; yi++) {
          for (let xi = 0; xi < nx; xi++) {
            const i = (yIndices[yi] * sw + xIndices[xi]) * 4;
            const weight = xValues[xi] * yValues[yi];
            const a = src[i + 3] / 255;
            red += src[i] * a * weight;
            green += src[i + 1] * a * weight;
            blue += src[i + 2] * a * weight;
            alpha += a * weight;
          }
        }
        alpha = Math.max(0, Math.min(1, alpha));
        if (alpha > 1e-7) {
          const i = (row * width + col) * 4;
          out[i] = Math.max(0, Math.min(255, red / alpha));
          out[i + 1] = Math.max(0, Math.min(255, green / alpha));
          out[i + 2] = Math.max(0, Math.min(255, blue / alpha));
          out[i + 3] = alpha * coverage * 255;
        }
      }
    }
    return {x: left, y: top, width, height, pixels: out};
  }
  function handleMessage({data}) {
    try {
      const result = resample(data);
      // Transfer the output buffer instead of cloning proof pixels.
      self.postMessage({id: data.id, ...result}, [result.pixels.buffer]);
    } catch (error) {
      self.postMessage({id: data.id, error: error.message || String(error)});
    }
  }
  function workerSource() {
    return [
      kernel.toString(),
      axisWeights.toString(),
      quarterTurn.toString(),
      resampleRotated.toString(),
      resample.toString(),
      `self.onmessage = ${handleMessage.toString()};`,
    ].join('\n');
  }
  root.picQuineResample = {
    kernel,
    axisWeights,
    resample,
    workerSource,
    resampleRotated,
    quarterTurn,
  };
})(typeof self !== 'undefined' ? self : globalThis);
