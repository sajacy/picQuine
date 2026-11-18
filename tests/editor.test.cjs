// Dependency-free checks for document geometry, history isolation and
// compositing.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
// The DOM mock below creates elements on demand; verify actual markup too.
const htmlIds = new Set([
  ...fs.readFileSync('index.html', 'utf8').matchAll(/id="([^"]+)"/g),
].map((m) => m[1]));
for (const [, id] of fs.readFileSync('app.js', 'utf8')
    .matchAll(/\$\(['"]([^'"]+)['"]\)/g)) {
  assert(htmlIds.has(id.slice(1)), `Missing HTML element: ${id}`);
}
const operations = [];
function context() {
  return new Proxy(
      {measureText: () => ({width: 100})},
      {
        get(o, k) {
          return k in o ? o[k] : (...args) => operations.push([k, ...args]);
        },
        set(o, k, v) {
          operations.push([k, v]);
          o[k] = v;
          return true;
        },
      },
  );
}
function element(id = '') {
  return {
    id,
    value: id === 'zoom' ? 'fit' :
        id === 'shapeStrokeWidth' ? '4' :
                                    '',
    style: {},
    dataset: {},
    clientWidth: 1000,
    clientHeight: 800,
    width: 1200,
    height: 800,
    hidden: false,
    classList: {toggle() {}},
    getContext: () => context(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1200,
      height: 800,
    }),
    querySelectorAll: () => [],
    replaceChildren() {},
    append() {},
    setAttribute() {},
    setPointerCapture() {},
    toDataURL: () => 'data:image/png;base64,AA==',
    click() {},
    addEventListener() {},
  };
}
const elements = new Map();
const document = {
  documentElement: {dataset: {}},
  getElementById: (id) => {
    if (!elements.has(id)) {
      elements.set(id, element(id));
    }
    return elements.get(id);
  },
  querySelector: (selector) => document.getElementById(selector.slice(1)),
  querySelectorAll: () => [],
  createElement: () => element(),
};
const sandbox = {
  document,
  window: {addEventListener() {}},
  crypto: require('node:crypto').webcrypto,
  ResizeObserver: class {
    observe() {}
  },
  picQuineRuntime: {capture() {}},
  console,
  setTimeout,
  clearTimeout,
  Blob,
  TextEncoder,
  URL,
};
vm.createContext(sandbox);
for (const file
  of ['config.js',
    'dom.js',
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
    'standalone.js',
    'app.js',
  ]) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
}
function run(s) {
  return vm.runInContext(s, sandbox);
}
assert.equal(run('typeof openEmbeddedProject'), 'function');
run(
    `editor.commit();editor.begin("Test");addLayer(makeCanvas(300,200),'A',20,30);editor.commit();editor.begin("Test");selected().x=100;selected().opacity=.4;`,
);
assert.equal(run('selected().x'), 100);
run('undo()');
assert.equal(run('selected().x'), 20);
assert.equal(run('selected().opacity'), 1);
run('redo()');
assert.equal(run('selected().x'), 100);
assert.equal(run('selected().opacity'), 0.4);
run(
    `editor.commit();editor.begin("Test");const original=selected().canvas;const copy=makeCanvas(300,200);selected().canvas=copy;undo();`,
);
assert.equal(run('selected().canvas===original'), true);
run(`crop={x:30,y:40,w:400,h:250};$('#applyCrop').onclick()`);
assert.equal(run('editor.document.w'), 400);
assert.equal(run('editor.document.h'), 250);
assert.equal(run('selected().x'), 70);
assert.equal(run('selected().y'), -10);
run('undo()');
assert.equal(run('editor.document.w'), 1200);
assert.equal(run('selected().x'), 100);
run(`$('#cropToLayer').checked=true;crop={x:10,y:20,w:80,h:60};$('#applyCrop').onclick()`);
assert.equal(run('editor.document.w'), 1200);
assert.equal(run('selected().canvas.width'), 80);
assert.equal(run('selected().canvas.height'), 60);
assert.equal(run('selected().x'), 10);
assert.equal(run('selected().y'), 20);
run(`undo();$('#cropToLayer').checked=false;$('#layerSizeUnit').value='percent';properties();$('#layerRatio').checked=true;$('#layerWidth').value=50;$('#layerWidth').onchange()`);
assert.equal(run('selected().w'), 150);
assert.equal(run('selected().h'), 100);
run(`$('#layerRatio').checked=false;$('#layerHeight').value=25;$('#layerHeight').onchange()`);
assert.equal(run('selected().w'), 150);
assert.equal(run('selected().h'), 50);
run(`$('#layerWidth').value=-10;$('#layerWidth').onchange()`);
assert.equal(run('selected().w'), 150);
run(`undo();undo();$('#layerSizeUnit').value='pixels';properties()`);
assert.equal(run('selected().w'), 300);
assert.equal(run('selected().h'), 200);
assert.deepEqual(
    JSON.parse(run('JSON.stringify(normalRect({x:100,y:200,w:-50,h:-100}))')),
    {x: 50, y: 100, w: 50, h: 100},
);
operations.length = 0;
run(`selected().visible=false;draw()`);
assert.equal(operations.filter((o) => o[0] === 'drawImage').length, 0);
run(`selected().visible=true;draw()`);
assert.equal(operations.filter((o) => o[0] === 'drawImage').length, 1);
assert(operations.some((o) => o[0] === 'globalAlpha' && o[1] === 0.4));
run(`$('#duplicate').onclick()`);
assert.equal(run('editor.document.layers.length'), 2);
assert.equal(run('selected().x'), 120);
run(`$('#delete').onclick();undo()`);
assert.equal(run('editor.document.layers.length'), 2);
run('reorder(-1)');
assert.equal(
    run('editor.document.layers[0].id===editor.document.selected'),
    true,
);
for (const [w, h, valid] of [
  [1, 1, true],
  [8000, 5000, true],
  [8000, 5001, false],
  [0, 100, false],
  [1.5, 100, false],
  [16385, 1, false],
]) {
  assert.equal(run(`dimensions(${w},${h})`), valid);
}
assert(!/https?:\/\//.test(fs.readFileSync('index.html', 'utf8')));
assert(!/https?:\/\//.test(fs.readFileSync('style.css', 'utf8')));
console.log(
    'PASS: undo/redo, immutable pixel history, crop geometry, alpha/visibility compositing, duplicate/delete/reorder, dimension limits, offline entry point',
);
// Precision controls, rotation transforms, project filenames, percentage sizing
// and themes.
run(`selected().rotation=0;$('#rotate90').onclick()`);
assert.equal(run('angle(selected())'), 90);
run('undo()');
assert.equal(run('angle(selected())'), 0);
run(
    `$('#rotation').onpointerdown();$('#rotation').value='37';$('#rotation').oninput()`,
);
assert.equal(run('angle(selected())'), 37);
run('undo()');
assert.equal(run('angle(selected())'), 0);
const mapped = JSON.parse(
    run(
        `JSON.stringify(layerPoint({x:0,y:0,w:300,h:200,rotation:90,canvas:{width:300,height:200}},{x:250,y:-50}))`,
    ),
);
assert(Math.abs(mapped.x) < 1e-10 && Math.abs(mapped.y) < 1e-10);
run(`$('#docName').value='Precise / Layout';$('#docName').onchange()`);
assert.equal(run('editor.document.name'), 'Precise - Layout');
run('undo()');
run(
    `setTool('rect');$('#regionX').value=40;$('#regionY').value=50;$('#regionW').value=120;$('#regionH').value=80;$('#regionW').oninput();$('#addRectangle').onclick()`,
);
assert.equal(run('selected().x'), 40);
assert.equal(run('selected().y'), 50);
assert.equal(run('selected().w'), 120);
assert.equal(run('selected().h'), 80);
run('undo()');
run(
    `setTool('crop');$('#regionX').value=10;$('#regionY').value=20;$('#regionW').value=200;$('#regionH').value=100;$('#regionW').oninput();$('#applyCrop').onclick()`,
);
assert.equal(run('editor.document.w'), 200);
assert.equal(run('editor.document.h'), 100);
run('undo()');
run(
    `setTool('crop');overlay.onpointerdown({button:0,clientX:10,clientY:20,pointerId:1});overlay.onpointermove({clientX:70,clientY:90});endGesture()`,
);
assert.equal(elements.get('coordinates').textContent, 'X 70  Y 90');
assert.equal(elements.get('regionSize').textContent, 'W 60  H 70');
assert.equal(+elements.get('regionW').value, 60);
run(`setTool('move')`);
assert.deepEqual(
    JSON.parse(
        run(`JSON.stringify(resizeDimensions(1200,800,50,25,'percent'))`)),
    {w: 600, h: 200},
);
assert.equal(document.documentElement.dataset.theme, 'light');
run(`$('#theme').onclick()`);
assert.equal(document.documentElement.dataset.theme, 'dark');
run(`$('#theme').onclick()`);
assert.equal(document.documentElement.dataset.theme, 'light');
console.log(
    'PASS: rotation controls/inverse paint coordinates, precision rectangle/crop, live measurements, percentage sizing, project naming, light/dark toggle',
);
// Shared rectangle/ellipse styles must keep stroke interiors transparent in
// stroke-only mode.
function recordedShape(kind, mode) {
  operations.length = 0;
  run(
      `drawShape(overlayContext,{x:10,y:20,w:100,h:60},{mode:'${
        mode}',strokeWidth:4,fill:'#00ff00',stroke:'#ff0000'},'${kind}')`,
  );
  return operations.map((o) => [...o]);
}
for (const kind of ['rect', 'ellipse']) {
  for (const mode of ['stroke', 'both', 'fill']) {
    const calls = recordedShape(kind, mode);
    assert.equal(
        calls.filter((o) => o[0] === 'fill').length,
        mode === 'stroke' ? 0 : 1,
    );
    assert.equal(
        calls.filter((o) => o[0] === 'stroke').length,
        mode === 'fill' ? 0 : 1,
    );
    if (mode !== 'fill') {
      assert(calls.some((o) => o[0] === 'strokeStyle' && o[1] === '#ff0000'));
      assert(calls.some((o) => o[0] === 'lineWidth' && o[1] === 4));
    }
    if (kind === 'ellipse') {
      assert(
          calls.some((o) => o[0] === 'ellipse' && o[1] === 60 && o[2] === 50),
      );
    }
  }
}
run(
    `setTool('ellipse');$('#regionX').value=25;$('#regionY').value=35;$('#regionW').value=80;$('#regionH').value=50;$('#shapeMode').value='stroke';$('#shapeStrokeWidth').value=4;$('#regionW').oninput();$('#addRectangle').onclick()`,
);
assert.equal(run('selected().name'), 'Ellipse');
assert.equal(run('selected().x'), 25);
assert.equal(run('selected().w'), 80);
assert.equal(elements.get('regionSize').textContent, 'W 80  H 50');
run('undo()');
for (const invalid of ['0', '1.5', '-4', '']) {
  elements.get('shapeStrokeWidth').value = invalid;
  const count = run('editor.document.layers.length');
  run(`$('#addRectangle').onclick()`);
  assert.equal(run('editor.document.layers.length'), count);
}
run(
    `$('#shapeStrokeWidth').value=4;$('#shapeMode').value='fill';$('#shapeMode').onchange()`,
);
assert.equal(elements.get('shapeStroke').disabled, true);
assert.equal(elements.get('shapeFill').disabled, false);
run(
    `setTool('ellipse');overlay.onpointerdown({button:0,clientX:30,clientY:40,pointerId:8});overlay.onpointermove({clientX:10,clientY:20});endGesture()`,
);
assert.equal(run('selected().name'), 'Ellipse');
assert.equal(run('selected().x'), 10);
assert.equal(run('selected().y'), 20);
assert.equal(run('selected().w'), 20);
assert.equal(run('selected().h'), 20);
run('undo();setTool("move")');
console.log(
    'PASS: shape fill/stroke modes and separate colors, inset integer stroke, precision ellipse, reverse ellipse drag, stroke-width validation and disabled unused controls',
);
// Cancelled painting restores the prior pixel buffer and does not create an
// undo entry.
run('setTool("brush")');
const sourceBefore = run('selected().canvas');
const historyBefore = run('editor.past.length');
run(
    'overlay.onpointerdown({button:0,clientX:10,clientY:10,pointerId:90});overlay.onpointercancel()',
);
assert.equal(run('selected().canvas'), sourceBefore);
assert.equal(run('editor.past.length'), historyBefore);
run('setTool("move")');
const noOpCount = run('editor.past.length');
run(
    'overlay.onpointerdown({button:0,clientX:10,clientY:10,pointerId:91});endGesture()',
);
assert.equal(run('editor.past.length'), noOpCount);
// Proof controller integration: read-only UI, immutable state, filter restart
// and cancel.
(async () => {
  document.body = element('body');
  const workers = [];
  sandbox.picQuineResample = {workerSource: () => ''};
  sandbox.ImageData = class {
    constructor(pixels, width, height) {
      this.data = pixels;
      this.width = width;
      this.height = height;
    }
  };
  sandbox.Worker = class {
    constructor() {
      this.terminated = false;
      workers.push(this);
    }
    terminate() {
      this.terminated = true;
    }
    postMessage(data) {
      setTimeout(() => {
        if (!this.terminated) {
          this.onmessage({
            data: {
              id: data.id,
              width: 1,
              height: 1,
              x: 0,
              y: 0,
              pixels: new Uint8ClampedArray([30, 40, 50, 255]),
            },
          });
        }
      }, 0);
    }
  };
  run(
      `for(const l of editor.document.layers)l.canvas.getContext=()=>({getImageData:()=>({data:new Uint8ClampedArray(4)})});`,
  );
  const before = run(
      'JSON.stringify({w:editor.document.w,h:editor.document.h,layers:editor.document.layers.map(({canvas,...l})=>l),history:editor.past.length})',
  );
  await run('enterProof()');
  assert.equal(run('proof.active && proof.ready'), true);
  assert.equal(elements.get('resize').disabled, true);
  assert.equal(elements.get('open').disabled, true);
  assert.equal(elements.get('export').disabled, false);
  assert.equal(elements.get('proofCanvas').hidden, false);
  document.onkeydown({key: 'Delete', target: {matches: () => false}});
  await run('overlay.onpointerdown({button:0})');
  assert.equal(
      run(
          'JSON.stringify({w:editor.document.w,h:editor.document.h,layers:editor.document.layers.map(({canvas,...l})=>l),history:editor.past.length})',
      ),
      before,
  );
  const first = run('renderProof()');
  elements.get('proofFilter').value = 'lanczos';
  const second = run('renderProof()');
  await Promise.all([first, second]);
  assert.equal(run('proof.ready'), true);
  assert(workers.slice(0, -1).every((w) => w.terminated));
  const pending = run('renderProof()');
  run('exitProof()');
  await pending;
  assert.equal(run('proof.active'), false);
  assert.equal(elements.get('proofCanvas').hidden, true);
  assert.equal(elements.get('resize').disabled, false);
  assert(workers.every((w) => w.terminated));
  assert.equal(
      run(
          'JSON.stringify({w:editor.document.w,h:editor.document.h,layers:editor.document.layers.map(({canvas,...l})=>l),history:editor.past.length})',
      ),
      before,
  );
  console.log(
      'PASS: read-only proof controls and keyboard, filter restart, cancellation, worker cleanup, original document/history preserved',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
