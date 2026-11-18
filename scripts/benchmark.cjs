'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '../src'));
const env = {};
vm.createContext(env);
vm.runInContext(fs.readFileSync('resample.js', 'utf8'), env);
const pixels = Uint8ClampedArray.from(
    {length: 512 * 512 * 4},
    (_, i) => i % 4 === 3 ? 255 : i % 251,
);
for (const rotation of [0, 90, 37]) {
  const start = performance.now();
  env.picQuineResample.resample({
    pixels: pixels.buffer,
    sw: 512,
    sh: 512,
    x: 100,
    y: 100,
    w: 512,
    h: 512,
    cw: 800,
    ch: 800,
    method: 'lanczos',
    rotation,
  });
  console.log(
      `${rotation}°: ${
        Math.round(
            performance.now() -
              start)} ms (Node VM; not a browser benchmark)`,
  );
}
