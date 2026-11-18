const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const env = {
  Blob,
  WeakRef,
};
vm.createContext(env);
for (const file of ['geometry.js', 'assets.js', 'renderer.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env);
}
const assets = vm.runInContext('picQuineAssets', env);
const renderer = vm.runInContext('picQuineRenderer', env);
(async () => {
  let decodes = 0;
  let encodes = 0;
  const canvas = {width: 20, height: 10};
  const draws = [];
  env.picQuineImages = {
    decode: async () => {
      decodes++;
      return canvas;
    },
    canvasPNG: async () => {
      encodes++;
      return new Blob(['PNG']);
    },
  };
  env.makeCanvas = () =>
    ({getContext: () => ({drawImage: (...args) => draws.push(args)})});
  const file = new Blob(['source']);
  const [a, b] = await Promise.all([assets.decode(file), assets.decode(file)]);
  assert.equal(a, b);
  await assets.decode(file);
  assert.equal(decodes, 1);
  assert.equal(await assets.png(canvas), await assets.png(canvas));
  assert.equal(encodes, 1);
  assert.equal(assets.thumbnail(canvas), assets.thumbnail(canvas));
  assert.equal(draws.length, 1);
  assets.invalidate(canvas);
  await assets.png(canvas);
  assets.thumbnail(canvas);
  assert.equal(encodes, 2);
  assert.equal(draws.length, 2);
  assert.equal(assets.revision(canvas), 1);
  const png = new Blob(['original PNG'], {type: 'image/png'});
  await assets.decode(png);
  assert.equal(await assets.png(canvas), png);
  // A failed encoding is retried rather than poisoning the asset cache forever.
  let attempts = 0;
  const retryCanvas = {width: 2, height: 2};
  env.picQuineImages.canvasPNG = async () => {
    if (++attempts === 1) {
      throw Error('failed');
    }
    return new Blob(['ok']);
  };
  await assert.rejects(assets.png(retryCanvas), /failed/);
  assert.equal(await (await assets.png(retryCanvas)).text(), 'ok');
  // Keep the canvas backing buffer when its dimensions do not change.
  let resizes = 0;
  const context = new Proxy({}, {get: () => () => {}});
  const target = {
    _w: 100,
    _h: 50,
    get width() {
      return this._w;
    },
    set width(v) {
      resizes++;
      this._w = v;
    },
    get height() {
      return this._h;
    },
    set height(v) {
      resizes++;
      this._h = v;
    },
    getContext: () => context,
  };
  renderer.prepare(target, 100, 50);
  assert.equal(resizes, 0);
  renderer.prepare(target, 120, 50);
  assert.equal(resizes, 1);
  const frames = [];
  const paints = [];
  const request = renderer.scheduler(
      (fn) => frames.push(fn),
      (full) => paints.push(full),
  );
  request(false);
  request(true);
  request(false);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(paints, [true]);
  request(false);
  frames.shift()();
  assert.deepEqual(paints, [true, false]);
  console.log(
      'PASS: shared/in-flight asset decode, PNG and thumbnail caching/invalidation, original PNG reuse, failed-cache retry, canvas buffer reuse and animation-frame coalescing',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
