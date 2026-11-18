const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function canvas() {
  const c = {
    width: 4,
    height: 3,
    getContext: () => new Proxy(
        {},
        {
          get: (_, key) =>
              key === 'measureText' ? () => ({width: 100}) : () => {},
        },
    ),
    toBlob: (fn) => fn(new Blob(['edited PNG bytes'], {type: 'image/png'})),
  };
  return c;
}
const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      ...canvas(),
      value: id === 'zoom' ? 'fit' : '',
      style: {},
      clientWidth: 1000,
      clientHeight: 800,
      querySelectorAll: () => [],
      replaceChildren() {},
      append() {},
      setAttribute() {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1200,
        height: 800,
      }),
      setPointerCapture() {},
    });
  }
  return elements.get(id);
}
const env = {
  console,
  Response,
  atob,
  btoa,
  Blob,
  File,
  URL,
  fetch,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  crypto: require('node:crypto').webcrypto,
  ResizeObserver: class {
    observe() {}
  },
  window: {addEventListener() {}},
  document: {
    documentElement:
        {dataset: {}, cloneNode: require('./editor-source.cjs').root},
    getElementById: el,
    querySelector: (selector) => el(selector.slice(1)),
    querySelectorAll: () => [],
    createElement: () => ({
      ...canvas(),
      setAttribute() {},
      append() {},
      classList: {toggle() {}},
    }),
  },
  setTimeout,
  clearTimeout,
};
vm.createContext(env);
for (const file
  of ['config.js',
    'json.js',
    'dom.js',
    'archive.js',
    'geometry.js',
    'document.js',
    'images.js',
    'shapes.js',
    'renderer.js',
    'project.js',
    'history.js',
    'operations.js',
    'assets.js',
    'files.js',
    'proof.js',
    'runtime.js',
    'standalone.js',
    'app.js',
  ]) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env);
}
const run = (s) => vm.runInContext(s, env);
async function savedProject(blob) {
  const archive = await vm.runInContext('picQuineArchive', env).open(blob);
  const data =
      await run('picQuineStandalone.extract')(await archive.blob.text());
  const files = new Map(
      Object.entries(data.assets)
          .map(([
            id,
            file,
          ]) => [id, new Blob([Buffer.from(file.base64, 'base64')])]));
  return {composition: data.composition, files, project: data};
}
(async () => {
  const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="red"/></svg>';
  const source = new File([svg], 'Vector.svg', {type: 'image/svg+xml'});
  env.source = source;
  // Decode is stubbed here: ZIP tests validate bytes; browser SVG rendering
  // remains independent.
  run('picQuineImages.decode=async()=>makeCanvas(4,3)');
  await run('importFiles([source],\'open\')');
  assert.equal(run('selected().original.blob===source'), true);
  assert.equal(run('selected().pixelsEdited'), false);
  run(
      'selected().x=1.25;selected().rotation=37;selected().opacity=.65;selected().blend=\'multiply\';$(\'#duplicate\').onclick();editor.document.selected=editor.document.layers[0].id',
  );
  const selection = run('editor.document.selected');
  const archive = await run('buildProject(snapshot())');
  const {composition, files} = await savedProject(archive);
  assert.equal((await savedProject(archive)).project.version, 3);
  assert.equal(files.size, 1);
  assert.equal(composition.layers[0].content, composition.layers[0].original);
  assert.equal(
      composition.layers[1].content,
      composition.layers[0].content,
  );
  assert.equal(await files.get(composition.layers[0].original).text(), svg);
  assert([...files.values()].every((file) => file.type !== 'image/png'));
  env.saved = archive;
  const reopened = await run('readProject(saved)');
  assert.equal(reopened.selected, selection);
  assert.equal(reopened.layers[0].rotation, 37);
  assert.equal(reopened.layers[0].x, 1.25);
  assert.equal(reopened.layers[0].opacity, 0.65);
  assert.equal(reopened.layers[0].blend, 'multiply');
  assert.equal(await reopened.layers[0].original.blob.text(), svg);
  assert.equal(reopened.layers[0].pixelsEdited, false);
  // A real brush gesture marks only its layer as edited, retaining its
  // immutable original.
  run('setTool(\'brush\')');
  await run(
      'overlay.onpointerdown({button:0,clientX:2,clientY:2,pointerId:1})',
  );
  run('endGesture()');
  assert.equal(run('selected().pixelsEdited'), true);
  const {composition: editedComposition, files: edited} =
      await savedProject(await run('buildProject(snapshot())'));
  assert.notEqual(
      editedComposition.layers[0].content,
      editedComposition.layers[0].original);
  assert.equal(
      await edited.get(editedComposition.layers[0].content).text(),
      'edited PNG bytes');
  assert.equal(
      await edited.get(editedComposition.layers[0].original).text(), svg);
  assert.equal(
      editedComposition.layers[1].content, composition.layers[1].content);
  run('undo()');
  assert.equal(run('selected().pixelsEdited'), false);
  assert.equal(run('selected().original.blob===source'), true);
  run(
      'writeFile=async(blob,name,description,extensions)=>{globalThis.savedArguments={type:blob.type,name,extensions};return true}',
  );
  run('modal=async()=>"current"');
  await run('saveProject()');
  assert.equal(env.savedArguments.type, 'application/zip');
  assert(env.savedArguments.name.endsWith('.zip'));
  assert.equal(env.savedArguments.extensions[0], '.zip');
  // Text tool commits chosen font, size and color, then preserves the source
  // through ZIP round-trips.
  run(
      'modal=async()=>({text:\'Hello 🌱 & <world>\',font:\'Courier New\',size:48,color:\'#123abc\'});setTool(\'text\')',
  );
  await run(
      'overlay.onpointerdown({button:0,clientX:10,clientY:20,pointerId:2})',
  );
  assert.equal(run('selected().text.content'), 'Hello 🌱 & <world>');
  assert.equal(run('selected().text.runs[0].fontFamily'), 'Courier New');
  assert.equal(run('selected().text.runs[0].fontSize'), 48);
  assert.equal(run('selected().text.runs[0].color'), '#123abc');
  run('selected().name=\'Renamed layer\'');
  const textZip = await run('buildProject(snapshot())');
  env.textZip = textZip;
  const textProject = await run('readProject(textZip)');
  const textLayer = textProject.layers.at(-1);
  assert.equal(textLayer.text.content, 'Hello 🌱 & <world>');
  assert.equal(textLayer.name, 'Renamed layer');
  assert.equal(textLayer.text.runs[0].fontFamily, 'Courier New');
  run('$(\'#duplicate\').onclick();setTool(\'erase\')');
  await run(
      'overlay.onpointerdown({button:0,clientX:12,clientY:22,pointerId:3})',
  );
  run('endGesture()');
  assert.equal(run('selected().text.content'), 'Hello 🌱 & <world>');
  run('modal=async()=>null;setTool("text")');
  const count = run('editor.document.layers.length');
  await run(
      'overlay.onpointerdown({button:0,clientX:10,clientY:20,pointerId:4})',
  );
  assert.equal(run('editor.document.layers.length'), count);
  env.notZip = new Blob(['{"version":1}']);
  await assert.rejects(run('readProject(notZip)'), /ZIP/);
  // While an import awaits decoding, every unrelated document command stays
  // locked.
  env.delayedFile = new File(['new source'], 'Pending.png', {
    type: 'image/png',
  });
  run('picQuineImages.decode=()=>new Promise(resolve=>{globalThis.finishDecode=resolve})');
  const pendingImport = run('importFiles([delayedFile],\'layer\')');
  const beforeImport = run('JSON.stringify(snapshot())');
  run(
      '$(\'#duplicate\').onclick();$(\'#rotate90\').onclick();$(\'#delete\').onclick();undo()',
  );
  assert.equal(run('JSON.stringify(snapshot())'), beforeImport);
  assert.equal(run('operations.state'), 'import');
  await Promise.resolve();
  await Promise.resolve();
  run('finishDecode(makeCanvas(4,3))');
  await pendingImport;
  assert.equal(run('operations.state'), 'idle');
  assert.equal(run('selected().name'), 'Pending.png');
  // Shared originals re-open to the same decoded source buffer.
  assert.equal(reopened.layers[0].canvas, reopened.layers[1].canvas);
  const invalid = JSON.parse(JSON.stringify(editedComposition));
  invalid.layers[0].content = 'missing.svg';
  const bad = await vm.runInContext('picQuineArchive', env)
      .pack('invalid.html', new Blob([JSON.stringify(invalid)]));
  env.bad = bad;
  const name = run('editor.document.name');
  await assert.rejects(run('readProject(bad)'), /HTML/);
  assert.equal(run('editor.document.name'), name);
  // Directly opened single HTML initializes from the embedded project element.
  const supportedMime = run('picQuineImages.imageMime');
  assert.equal(supportedMime('photo.AVIF'), 'image/avif');
  assert.equal(supportedMime('photo.webp'), 'image/webp');
  const beforeUnsupported = run('editor.document.layers.length');
  env.unsupported = new File(['GIF89a'], 'animation.gif', {type: 'image/gif'});
  await run('importFiles([unsupported],\'layer\')');
  assert.equal(run('editor.document.layers.length'), beforeUnsupported);
  const startupData = await run('picQuineProject.buildData(snapshot())');
  env.startupData = startupData;
  run('$(\'#picquine-project\').textContent=JSON.stringify(startupData);picQuineImages.decode=async()=>makeCanvas(4,3)');
  await run('openEmbeddedProject()');
  assert.equal(run('editor.document.name'), startupData.composition.name);
  assert.equal(run('editor.dirty'), false);
  assert.equal(run('$(\'#picquine-project\').textContent'), 'null');
  console.log(
      'PASS: original SVG preservation without stored raster, source deduplication, single-HTML ZIP/HTML reopen and embedded startup, selection/transforms, brush edit PNG with original retained, undo, invalid project rejection, text typography/source round-trip, cancel text creation, missing asset rejection',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
