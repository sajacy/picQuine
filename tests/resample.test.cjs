const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const env = {};
vm.createContext(env);
vm.runInContext(fs.readFileSync('resample.js', 'utf8'), env);
const {resample, kernel} = env.picQuineResample;
function image(sw, sh, fn) {
  return Uint8ClampedArray.from(
      Array
          .from(
              {length: sw * sh},
              (_, i) => fn(i % sw, Math.floor(i / sw)),
          )
          .flat(),
  );
}
function scale(pixels, sw, sh, w, h, method, extra = {}) {
  return resample({
    pixels: pixels.buffer,
    sw,
    sh,
    w,
    h,
    x: 0,
    y: 0,
    cw: Math.ceil(w),
    ch: Math.ceil(h),
    method,
    ...extra,
  });
}
for (const method of ['bicubic', 'lanczos']) {
  // Identity preserves every channel, including RGB underneath completely
  // transparent pixels.
  const original = image(
      3, 2,
      (x, y) =>
        [x * 110,
          y * 190,
          213,
           x === 1 ? 0 : 128,
        ]);
  const copy = original.slice();
  assert.deepEqual(
      [...scale(original, 3, 2, 3, 2, method).pixels],
      [...original],
  );
  assert.deepEqual([...original], [...copy]);
  // Constant semi-transparent colors survive both minification and
  // magnification.
  for (const [w, h] of [[1, 1], [3, 5], [19, 23]]) {
    const r = scale(
        image(9, 7, () => [30, 100, 220, 128]),
        9,
        7,
        w,
        h,
        method,
    );
    for (let i = 0; i < r.pixels.length; i += 4) {
      assert.deepEqual([...r.pixels.slice(i, i + 4)], [30, 100, 220, 128]);
    }
  }
  // Fully transparent magenta must never bleed into an opaque red edge.
  const alpha =
      scale(
          image(4, 1, (x) => (x < 2 ? [255, 0, 0, 255] : [255, 0, 255, 0])),
          4,
          1,
          16,
          1,
          method,
      )
          .pixels;
  for (let i = 0; i < alpha.length; i += 4) {
    if (alpha[i + 3]) {
      assert.equal(alpha[i], 255);
      assert.equal(alpha[i + 1], 0);
      assert.equal(alpha[i + 2], 0);
    }
  }
  // Scale-aware support suppresses checkerboard aliasing when reducing to one
  // pixel.
  const small = scale(
      image(
          64, 64,
          (x, y) =>
            [((x + y) % 2) * 255,
              ((x + y) % 2) * 255,
              ((x + y) % 2) * 255,
              255,
            ]),
      64,
      64,
      1,
      1,
      method,
  )
      .pixels;
  assert(Math.abs(small[0] - 128) <= 1);
  assert.equal(small[3], 255);
  // Cropped rendering agrees with the same rectangle in a complete layer
  // render.
  const src = image(4, 3, (x, y) => [x * 80, y * 90, 50, 255]);
  const full = scale(src, 4, 3, 8, 6, method);
  const clipped = scale(src, 4, 3, 8, 6, method, {x: -3, y: -2, cw: 4, ch: 3});
  assert.equal(clipped.width, 4);
  assert.equal(clipped.height, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 4; x++) {
      assert.deepEqual(
          [...clipped.pixels.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4)],
          [
            ...full.pixels.slice(
                ((y + 2) * 8 + x + 3) * 4,
                ((y + 2) * 8 + x + 4) * 4,
            ),
          ],
      );
    }
  }
  const off = scale(src, 4, 3, 8, 6, method, {
    x: 100,
    y: 100,
    cw: 10,
    ch: 10,
  });
  assert.equal(off.pixels.length, 0);
  // Fractional placement gives geometric edge coverage instead of an opaque
  // extra pixel.
  const fractional = scale(
      image(1, 1, () => [255, 255, 255, 255]),
      1,
      1,
      1,
      1,
      method,
      {x: 0.5, y: 0.5, cw: 2, ch: 2},
  );
  for (let i = 3; i < fractional.pixels.length; i += 4) {
    assert.equal(fractional.pixels[i], 64);
  }
}
const step =
    scale(
        image(4, 1, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
        4,
        1,
        8,
        1,
        'bicubic',
    )
        .pixels;
assert.deepEqual(
    Array.from({length: 8}, (_, i) => step[i * 4]),
    [0, 0, 0, 52, 203, 255, 255, 255],
);
assert.equal(kernel(0, 'bicubic'), 1);
assert.equal(kernel(2, 'bicubic'), 0);
assert.equal(kernel(3, 'lanczos'), 0);
assert(Math.abs(kernel(0.5, 'lanczos') - 0.6079271018540267) < 1e-12);
// The exact standalone worker payload executes without importScripts, fetch, or
// a server.
let answer;
const worker = {
  self: {postMessage: (r) => (answer = r)},
};
vm.createContext(worker);
vm.runInContext(env.picQuineResample.workerSource(), worker);
const p = image(2, 2, () => [20, 40, 60, 255]);
worker.self.onmessage({
  data: {
    id: 1,
    pixels: p.buffer,
    sw: 2,
    sh: 2,
    w: 4,
    h: 4,
    x: 0,
    y: 0,
    cw: 4,
    ch: 4,
    method: 'lanczos',
  },
});
assert.equal(answer.id, 1);
assert.equal(answer.width, 4);
assert.equal(answer.pixels.length, 64);
assert.equal(answer.error, undefined);
console.log(
    'PASS: both filters, exact bicubic step response, minification anti-aliasing, premultiplied alpha, edge coverage, clipping, unchanged sources, offline worker payload',
);
// Rotation must be part of the explicit proof filter, not a subsequent browser
// draw.
for (const method of ['bicubic', 'lanczos']) {
  const src = image(2, 2, (x, y) => [(y * 2 + x + 1) * 40, 10, 20, 255]);
  for (const [rotation, expected] of [
    [90, [120, 40, 160, 80]],
    [180, [160, 120, 80, 40]],
    [270, [80, 160, 40, 120]],
  ]) {
    const r = scale(src, 2, 2, 2, 2, method, {rotation});
    assert.equal(r.width, 2);
    assert.equal(r.height, 2);
    assert.deepEqual(
        [0, 1, 2, 3].map((i) => r.pixels[i * 4]),
        expected,
    );
  }
  const tilted = scale(src, 2, 2, 4, 4, method, {
    x: 3,
    y: 3,
    cw: 10,
    ch: 10,
    rotation: 45,
  });
  assert(tilted.pixels.some((a, i) => i % 4 === 3 && a > 0 && a < 255));
  assert(tilted.pixels.some((a, i) => i % 4 === 3 && a === 0));
  const entering = scale(
      image(2, 10, () => [250, 0, 0, 255]),
      2,
      10,
      2,
      10,
      method,
      {x: -4, y: 0, cw: 10, ch: 10, rotation: 90},
  );
  assert(entering.width > 0);
  assert(entering.pixels.some((a, i) => i % 4 === 3 && a === 255));
}
console.log(
    'PASS: 90/180/270-degree exact rotation, arbitrary-angle alpha edges, rotated off-canvas clipping with both proof filters',
);
// Golden digest captured before the buffer-allocation optimizations, across
// both filters.
const golden = require('node:crypto').createHash('sha256');
const fixture = Uint8ClampedArray.from(
    {length: 21 * 17 * 4},
    (_, i) => (i * 31) % 256,
);
for (const method of ['bicubic', 'lanczos']) {
  for (const rotation of [17, 37, 89, 90, 123, 180, 270]) {
    const r = resample({
      pixels: fixture.buffer,
      sw: 21,
      sh: 17,
      x: -2.25,
      y: 1.75,
      w: 19,
      h: 15,
      cw: 30,
      ch: 30,
      rotation,
      method,
    });
    golden.update(JSON.stringify([r.x, r.y, r.width, r.height]));
    golden.update(r.pixels);
  }
}
assert.equal(
    golden.digest('hex'),
    'e235ced203eab6925a726e35be185be94c30f931b2bb2336fe5038c91b89cbff',
);
const nonSquare = image(2, 3, (x, y) => [(y * 2 + x + 1) * 40, 0, 0, 255]);
const turned = scale(nonSquare, 2, 3, 2, 3, 'lanczos', {
  x: 0.5,
  y: 0.5,
  cw: 5,
  ch: 5,
  rotation: 90,
});
assert.equal(turned.width, 3);
assert.equal(turned.height, 2);
assert.deepEqual(
    Array.from({length: 6}, (_, i) => turned.pixels[i * 4]),
    [200, 120, 40, 240, 160, 80],
);
assert.throws(
    () => scale(nonSquare, 2, 3, 2, 3, 'unsupported', {rotation: 90}),
    /Unknown/,
);
console.log(
    'PASS: pre-refactor golden pixels for 14 transformed proofs and non-square exact quarter turns',
);
