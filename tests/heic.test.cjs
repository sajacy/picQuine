// Run the exact packaged WASM worker against a real HEIC, with no network.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {Worker} = require('node:worker_threads');
const {createHash} = require('node:crypto');
const source = ['config.js', 'vendor/libheif-wasm.js', 'heic-worker.js']
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
const bridge =
    `const {parentPort}=require('node:worker_threads'); global.onmessage=null; global.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer); parentPort.on('message',data=>onmessage({data}));\n`;
const worker = new Worker(bridge + source, {eval: true});
const timer = setTimeout(() => {
  console.error('HEIC decode timed out');
  worker.terminate();
  process.exitCode = 1;
}, 15000);
const requests = new Map();
const ready = new Promise((resolve, reject) => {
  worker.on('error', reject);
  worker.on('message', (data) => {
    if (data.ready) {
      return resolve();
    }
    const request = requests.get(data.id);
    if (!request) {
      return reject(Error(data.error || 'Unexpected worker response'));
    }
    requests.delete(data.id);
    data.error ? request.reject(Error(data.error)) : request.resolve(data);
  });
});
let id = 0;
async function decode(bytes) {
  await ready;
  const requestID = ++id;
  const buffer = Uint8Array.from(bytes).buffer;
  return new Promise((resolve, reject) => {
    requests.set(requestID, {resolve, reject});
    worker.postMessage({id: requestID, buffer}, [buffer]);
  });
}
(async () => {
  try {
    const fixture = fs.readFileSync('../tests/orange.heic');
    const result = await decode(fixture);
    const pixels = new Uint8ClampedArray(result.pixels);
    assert.equal(result.width, 16);
    assert.equal(result.height, 16);
    assert(
        pixels[0] > 240 && pixels[1] > 110 && pixels[1] < 145 &&
        pixels[2] < 15);
    assert.equal(pixels[3], 255);
    assert.equal(
        createHash('sha256').update(pixels).digest('hex'),
        'f090187f3ed424ed938d19e0d5d51e405d7cc6d6248a6322ae49e4ffe57629cf',
        'Pixels match the previous heic-to decoder exactly');
    await assert.rejects(
        decode(Buffer.from('not a HEIC')), /image|HEIC|decode/i);
    const [again, concurrent] =
        await Promise.all([decode(fixture), decode(fixture)]);
    assert.deepEqual(Buffer.from(again.pixels), Buffer.from(result.pixels));
    assert.deepEqual(
        Buffer.from(concurrent.pixels), Buffer.from(result.pixels));
    console.log(
        'PASS: WASM HEIC decoding, dimensions/RGBA, malformed input recovery and concurrent requests; pixels SHA256=' +
        createHash('sha256').update(pixels).digest('hex'));
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
