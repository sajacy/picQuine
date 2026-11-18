const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const env = {
  Blob,
  File,
  Response,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  atob,
  btoa,
};
let sequence = 0;
env.uid = () => `asset-${++sequence}`;
vm.createContext(env);
for (const file
  of ['config.js', 'json.js', 'archive.js', 'geometry.js', 'document.js',
    'runtime.js', 'standalone.js', 'project.js', 'demo.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env);
}
const api = vm.runInContext('picQuineStandalone', env);
const runtime = vm.runInContext('picQuineRuntime', env);
const io = vm.runInContext('picQuineProject', env);
const json = vm.runInContext('picQuineJSON', env);
const source = require('./editor-source.cjs');
env.document = {
  documentElement: {cloneNode: () => ({querySelector: () => ({})})},
};
assert.throws(() => runtime.capture(), /npm run build/);
env.document = {
  documentElement: {cloneNode: source.root},
};
runtime.capture();
(async () => {
  const fileStem = vm.runInContext('picQuineDocument.fileStem', env);
  for (const [input, output] of [
    ['CON.txt...', '_CON.txt'], ['aux', '_aux'], ['LPT9', '_LPT9'],
    ['COM¹', '_COM¹'], ['...', 'Untitled']]) {
    assert.equal(fileStem(input), output);
  }
  assert.equal(fileStem('x'.repeat(300)).length, 200);
  assert.equal(
      new TextEncoder().encode(fileStem('🌱'.repeat(200))).length, 240);
  for (const text
    of ['{"x":1,"x":2}', '{"x":{"a":1,"\\u0061":2}}',
      '{"value":1e999}']) {
    assert.throws(() => json.parse(text), /Duplicate|finite/);
  }
  assert.equal(json.parse('{"s":"{},\\\"x\\\":1","a":[{},{}]}').a.length, 2);
  const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="red"/></svg>';
  const file = new File([svg], '原图.svg', {type: 'image/svg+xml'});
  const layer = {
    id: 'one',
    name: '</script><script>alert("bad")</script> 🌱',
    canvas: {width: 4, height: 3},
    x: 1.5,
    y: 2,
    w: 8,
    h: 6,
    opacity: .65,
    visible: true,
    blend: 'multiply',
    rotation: 37,
    original: {blob: file, name: file.name, type: file.type},
    pixelsEdited: false,
  };
  const doc = {
    w: 40,
    h: 30,
    name: 'A </script> & 🌱',
    selected: 'one',
    layers: [layer, {...layer, id: 'two'}],
  };
  env.makeCanvas = (width, height) => ({width, height});
  env.assets = {
    decode: async () => ({width: 4, height: 3}),
    png: () => {
      throw Error('SVG must remain original');
    },
  };
  env.picQuineImages = {imageMime: () => file.type};
  const data = await io.buildData(doc);
  const id = data.composition.layers[0].content;
  assert.equal(data.version, 3);
  assert.equal(data.composition.version, undefined);
  assert.equal(Object.keys(data.assets).length, 1);
  assert.equal(data.composition.layers[1].content, id);
  assert.equal(Buffer.from(data.assets[id].base64, 'base64').toString(), svg);
  const saved = await io.buildProject(doc);
  assert.equal(saved.type, 'application/zip');
  const html = await (await vm.runInContext('picQuineArchive', env).open(saved))
      .blob.text();
  assert(!/<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=/i.test(html));
  assert(!html.includes('alert("bad")</script>'));
  assert.equal(api.extract(html).composition.name, doc.name);
  const reopened = await io.readProject(saved);
  assert.equal(await reopened.layers[0].original.blob.text(), svg);
  assert.equal(
      reopened.layers[0].original.blob, reopened.layers[1].original.blob);
  assert.deepEqual(
      JSON.parse(JSON.stringify(await io.buildData(reopened))),
      JSON.parse(JSON.stringify(data)));
  assert.equal((await io.readProject(new Blob([html]))).selected, 'one');
  // Unknown fields, extension payloads and their own non-image files survive
  // edits.
  const fork = JSON.parse(JSON.stringify(data));
  fork.future = {keep: [1, 2]};
  fork.composition.futureLabel = 'keep';
  fork.composition.layers[0].futureLayer = {x: 3};
  fork.extensions = {
    'io.github.test.print': {
      version: 1,
      required: false,
      assetRefs: ['preset'],
      data: {preset: 'preset', bleed: 3},
    },
  };
  fork.assets.preset = {
    name: 'preset.json',
    type: 'application/json',
    base64: btoa('{}'),
    futureFile: 'keep',
  };
  const imported = await api.restore(fork);
  imported.layers[0].x = 9;
  const after = await io.buildData(imported);
  assert.deepEqual(
      JSON.parse(JSON.stringify(after.extensions)), fork.extensions);
  assert.deepEqual(JSON.parse(JSON.stringify(after.assets)), fork.assets);
  assert.equal(after.composition.layers[0].x, 9);
  assert.equal(after.composition.layers[0].futureLayer.x, 3);
  assert.equal(after.future.keep[1], 2);
  const required = JSON.parse(JSON.stringify(fork));
  required.extensions['io.github.test.print'].required = true;
  const readonly = await api.restore(required);
  assert.equal(readonly.readOnly, true);
  assert.equal(await io.buildData(readonly), required);
  assert.throws(() => runtime.render(required), /required support/);
  const missing = JSON.parse(JSON.stringify(data));
  missing.composition.layers[0].content = 'absent';
  await assert.rejects(api.restore(missing), /Missing/);
  const orphan = JSON.parse(JSON.stringify(data));
  orphan.assets.orphan = {...orphan.assets[id]};
  await assert.rejects(api.restore(orphan), /Unreferenced/);
  const bad = JSON.parse(JSON.stringify(data));
  bad.assets[id].base64 = '????';
  await assert.rejects(api.restore(bad), /Base64/);
  const wrongScope = JSON.parse(JSON.stringify(data));
  wrongScope.extensions = {
    'org.picquine.heic':
        {version: 1, required: false, assetRefs: [], data: {imageIndex: 0}},
  };
  await assert.rejects(api.restore(wrongScope), /belong on assets/);
  const old = {
    composition: {format: 'picquine-project', version: 2},
    layers: [],
  };
  await assert.rejects(api.restore(old), /v3/);
  // Optional future codec data is preserved, not downgraded to the installed v1
  // codec.
  const optionalHEIC = JSON.parse(fs.readFileSync(
      '../docs/examples/project-v3-heic-original.json', 'utf8'));
  optionalHEIC.assets['asset-heic-1'].extensions['org.picquine.heic'].version =
      2;
  optionalHEIC.assets['asset-heic-1'].extensions['org.picquine.heic'].data = {
    futureDecoderSetting: true,
  };
  const futureCodec = await api.restore(optionalHEIC);
  assert.equal(futureCodec.readOnly, false);
  const preservedCodec = await io.buildData(futureCodec);
  assert.deepEqual(
      JSON.parse(JSON.stringify(preservedCodec.assets['asset-heic-1'])),
      optionalHEIC.assets['asset-heic-1']);
  // Actual bundled WASM bytes are present and only loaded on demand.
  for (const [, attrs, code] of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!attrs.includes('application/json') && !attrs.includes('text/plain')) {
      new vm.Script(code);
    }
  }
  const encoded =
      JSON.parse(/globalThis.picQuineHEICSource=("[^"]+");/.exec(html)[1]);
  const workerSource = ['config.js', 'vendor/libheif-wasm.js', 'heic-worker.js']
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
  assert.equal(
      require('node:zlib')
          .gunzipSync(Buffer.from(encoded, 'base64'))
          .toString(),
      workerSource);
  let loads = 0;
  let fail = true;
  class TestWorker {
    constructor(url) {
      loads++;
      fetch(url)
          .then((response) => response.text())
          .then((code) => {
            assert.equal(code, workerSource);
            fail ? this.onerror() : this.onmessage({data: {ready: true}});
          })
          .catch(() => this.onerror());
    }
    terminate() {}
  }
  const imageEnv = {
    URL,
    Blob,
    Response,
    DecompressionStream,
    atob,
    Worker: TestWorker,
    picQuineHEICSource: encoded,
    picQuineDocument: {dimensions: () => true},
  };
  vm.createContext(imageEnv);
  vm.runInContext(fs.readFileSync('images.js', 'utf8'), imageEnv);
  const images = vm.runInContext('picQuineImages', imageEnv);
  assert.equal(loads, 0);
  await assert.rejects(images.loadDecoder(), /decoder/);
  fail = false;
  const worker = await images.loadDecoder();
  assert.equal(await images.loadDecoder(), worker);
  assert.equal(loads, 2);
  // Reopening captures the new source rather than recursively embedding prior
  // editors.
  env.document = {
    documentElement: {
      cloneNode: () => ({
        outerHTML:
            html.replace(/^<!doctype html>\s*/i, '')
                .replace(
                    /(<script type="application\/json" id="picquine-project">)[\s\S]*?(<\/script>)/,
                    '$1null$2'),
        querySelector: (selector) => selector === '#picquine-project' ?
            {textContent: 'null'} :
            selector === '#picquine-editor-info' ? {textContent: source.info} :
                                                   null,
      }),
    },
  };
  runtime.capture();
  const again = await (await vm.runInContext('picQuineArchive', env)
      .open(await api.encode(data)))
      .blob.text();
  assert.equal(again.length, html.length);
  // Maximum supported document stores 100 originals plus 100 independent edits.
  env.assets.png = async () => new Blob(['PNG'], {type: 'image/png'});
  const full = {
    ...doc,
    layers: Array.from(
        {length: 100},
        (_, index) => ({
          ...layer,
          id: `capacity-${index}`,
          canvas: {width: 4, height: 3},
          pixelsEdited: true,
          original: {
            ...layer.original,
            blob: new File([svg], `${index}.svg`, {type: 'image/svg+xml'}),
          },
        })),
  };
  full.selected = full.layers[0].id;
  const capacity = await io.buildData(full);
  assert.equal(Object.keys(capacity.assets).length, 200);
  assert.equal(
      (await io.readProject(await io.buildProject(full))).layers.length, 100);
  capacity.assets.extra = {...capacity.assets[Object.keys(capacity.assets)[0]]};
  await assert.rejects(api.restore(capacity), /200 asset/);
  env.assets.decode = async (file) => {
    const svg = await file.text();
    return {
      width: +/width="(\d+)"/.exec(svg)[1],
      height: +/height="(\d+)"/.exec(svg)[1],
    };
  };
  const demo = await vm.runInContext('picQuineDemo', env).create();
  const demoData = await io.buildData(demo);
  assert.equal(Object.keys(demoData.assets).length, 4);
  assert(Object.values(demoData.assets)
      .every((file) => file.type === 'image/svg+xml'));
  assert.equal(
      demoData.composition.layers.at(-1).text.runs[0].content,
      'Make room for little changes...');
  console.log(
      'PASS: v3 stable canonical assets, exact sources, fork/unknown preservation, read-only required extensions, JSON duplicate detection, reference integrity, offline HTML/ZIP, WASM loading/retry and 200-asset boundary');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
