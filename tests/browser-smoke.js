'use strict';
(async () => {
  const frame = document.createElement('iframe');
  frame.src = '../dist/Editor-With-HEIC.html';
  frame.hidden = true;
  const loaded = new Promise((resolve, reject) => {
    frame.onload = resolve;
    frame.onerror = reject;
  });
  document.body.append(frame);
  await loaded;
  const {
    picQuineShapes,
    picQuineProject,
    picQuineArchive,
    picQuineStandalone,
    picQuineRenderer,
    picQuineResample,
    assets,
  } =
      frame.contentWindow.eval(
          '({picQuineShapes,picQuineProject,picQuineArchive,picQuineStandalone,picQuineRenderer,picQuineResample,assets})');
  const lines = [];
  const output = document.getElementById('results');
  const assert = (condition, message) => {
    if (!condition) {
      throw Error(message);
    }
  };
  const makeCanvas = (width, height) =>
    Object.assign(document.createElement('canvas'), {width, height});
  const pixel = (c, x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data;
  for (const kind of ['rect', 'ellipse']) {
    const c = makeCanvas(40, 30);
    picQuineShapes.drawShape(
        c.getContext('2d'),
        {x: 0, y: 0, w: 40, h: 30},
        {mode: 'stroke', strokeWidth: 4, stroke: '#ff0000', fill: '#00ff00'},
        kind,
    );
    assert(
        pixel(c, 20, 15)[3] === 0,
        kind + ' stroke-only center must be transparent',
    );
    assert(
        pixel(c, 20, 1)[0] > 240 && pixel(c, 20, 1)[3] > 200,
        kind + ' stroke must be red',
    );
  }
  lines.push(
      'PASS: real rectangle/ellipse stroke colors and transparent interiors',
  );
  const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="#ff0000"/></svg>';
  const file = new File([svg], 'source.svg', {type: 'image/svg+xml'});
  const source = await assets.decode(file);
  assert(source.width === 16 && source.height === 12, 'SVG dimensions');
  assert(pixel(source, 8, 6)[0] === 255, 'SVG raster display');
  const project = picQuineProject;
  const layer = {
    id: 'source',
    name: 'SVG',
    canvas: source,
    x: 2,
    y: 3,
    w: 16,
    h: 12,
    opacity: 1,
    visible: true,
    blend: 'source-over',
    rotation: 90,
    original: {blob: file, name: file.name, type: file.type},
    pixelsEdited: false,
  };
  const archive = await project.buildProject({
    w: 40,
    h: 30,
    name: 'Smoke',
    selected: layer.id,
    layers: [layer],
  });
  const zip = await picQuineArchive.open(archive);
  const data = picQuineStandalone.extract(await zip.blob.text());
  const reopened = await project.readProject(archive);
  assert(
      atob(data.assets[data.composition.layers[0].original].base64) === svg,
      'Original SVG bytes',
  );
  assert(reopened.layers[0].rotation === 90, 'Rotation round trip');
  lines.push(
      'PASS: native single-HTML ZIP/SVG project round trip and original source preservation',
  );
  const composed = picQuineRenderer.composite(makeCanvas(1, 1), reopened);
  assert(pixel(composed, 10, 10)[3] > 0, 'Rotated composite');
  const url = URL.createObjectURL(
      new Blob([picQuineResample.workerSource()], {
        type: 'application/javascript',
      }),
  );
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  try {
    const pixels = source.getContext('2d').getImageData(0, 0, 16, 12).data;
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({data}) =>
          data.error ? reject(Error(data.error)) : resolve(data);
      worker.onerror = reject;
      worker.postMessage(
          {
            pixels: pixels.buffer,
            sw: 16,
            sh: 12,
            x: 2,
            y: 3,
            w: 16,
            h: 12,
            cw: 40,
            ch: 30,
            rotation: 90,
            method: 'lanczos',
          },
          [pixels.buffer],
      );
    });
    assert(
        result.width === 12 && result.height === 16,
        'Worker quarter-turn dimensions',
    );
    assert(
        result.pixels.some((v, i) => i % 4 === 3 && v === 255),
        'Worker alpha',
    );
  } finally {
    worker.terminate();
  }
  lines.push('PASS: real offline Blob worker and proof rotation');
  output.textContent = lines.join('\n');
})().catch((error) => {
  document.getElementById('results').textContent +=
      '\nFAIL: ' + (error.stack || error);
  console.error(error);
});
