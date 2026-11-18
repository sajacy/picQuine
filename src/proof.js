'use strict';
const picQuineProof = (() => {
  const proofCanvas = $('#proofCanvas');
  const {angle, layerCorners} = picQuineGeometry;
  let active = false;
  let ready = false;
  let epoch = 0;
  let task = null;
  let rejectPending = null;
  let token = null;
  function proofExport(background, source = proofCanvas) {
    const output = makeCanvas(editor.document.w, editor.document.h);
    const outputContext = output.getContext('2d');
    if (background) {
      outputContext.fillStyle = background;
      outputContext.fillRect(0, 0, output.width, output.height);
    }
    outputContext.drawImage(source, 0, 0);
    return output;
  }
  function cancel() {
    // Invalidate replies already queued by a terminated worker.
    epoch++;
    if (rejectPending) {
      rejectPending(Error('Proof cancelled.'));
      rejectPending = null;
    }
    if (task) {
      task.terminate();
      task = null;
    }
  }
  async function enterProof() {
    if (operations.busy || gesture || $('#modal').open) {
      return;
    }
    if (!editor.document.layers.length) {
      toast('Add an image or layer before previewing.');
      return;
    }
    if (!active) {
      editor.commit();
      token = operations.acquire('proof');
      if (!token) {
        return;
      }
      active = true;
      crop = shapeRegion = null;
      setProofUI(true);
    }
    await renderProof();
  }
  function exitProof() {
    cancel();
    active = false;
    ready = false;
    operations.release(token);
    token = null;
    $('#proofProgress').hidden = true;
    proofCanvas.width = proofCanvas.height = 1;
    setProofUI(false);
    setTool(tool);
    render();
    fit();
    status('Editing');
  }
  async function renderProof() {
    if (!active) {
      return;
    }
    cancel();
    const generation = epoch;
    ready = false;
    setProofUI(true);
    $('#proofProgress').hidden = false;
    $('#proofProgress').textContent = 'Rendering proof…';
    $('#toolLabel').textContent = 'Read-only proof';
    const method = $('#proofFilter').value || 'bicubic';
    const label = method === 'bicubic' ? 'Bicubic' : 'Lanczos 3';
    $('#toolHint').textContent = label + ' · Full resolution · Escape to edit';
    try {
      await renderLayers(proofCanvas, method);
      if (generation !== epoch) {
        return;
      }
      ready = true;
      $('#proofProgress').hidden = true;
      $('#export').disabled = false;
      status(
          `${label} proof · ${editor.document.w} × ${editor.document.h} px · ` +
          'Read-only. Export uses this resampled proof. ' +
          'Use 100% zoom to inspect pixels.');
    } catch (e) {
      if (generation !== epoch) {
        return;
      }
      exitProof();
      toast('Preview failed: ' + (e.message || String(e)));
    }
  }
  // Preview and export share the same full-resolution worker path.
  async function renderLayers(target, method) {
    const generation = epoch;
    const context = picQuineRenderer.prepare(
        target,
        editor.document.w,
        editor.document.h,
    );
    try {
      const url = URL.createObjectURL(
          new Blob([picQuineResample.workerSource()], {
            type: 'application/javascript',
          }),
      );
      try {
        task = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const worker = task;
      const layers = editor.document.layers.filter((layer) => layer.visible);
      let n = 0;
      for (const layer of layers) {
        if (generation !== epoch) {
          throw Error('Proof cancelled.');
        }
        $('#proofProgress').textContent =
            `Rendering ${method} · layer ${++n} of ${layers.length}`;
        status($('#proofProgress').textContent);
        const corners = layerCorners(layer);
        if (layer.opacity === 0 || corners.every((p) => p.x <= 0) ||
            corners.every((p) => p.y <= 0) ||
            corners.every((p) => p.x >= editor.document.w) ||
            corners.every((p) => p.y >= editor.document.h)) {
          continue;
        }
        const source = layer.canvas.getContext('2d').getImageData(
            0, 0, layer.canvas.width, layer.canvas.height);
        const result = await new Promise((resolve, reject) => {
          rejectPending = reject;
          worker.onmessage = ({data}) => {
            rejectPending = null;
            if (data.error) {
              reject(Error(data.error));
            } else {
              resolve(data);
            }
          };
          worker.onerror = () => {
            rejectPending = null;
            reject(
                Error('The local proof worker could not render this image.'),
            );
          };
          worker.postMessage(
              {
                id: n,
                pixels: source.data.buffer,
                sw: layer.canvas.width,
                sh: layer.canvas.height,
                x: layer.x,
                y: layer.y,
                w: layer.w,
                h: layer.h,
                cw: editor.document.w,
                ch: editor.document.h,
                rotation: angle(layer),
                method,
              },
              // Transfer this readback buffer, never the layer's canvas.
              [source.data.buffer],
          );
        });
        if (generation !== epoch) {
          throw Error('Proof cancelled.');
        }
        if (!result.width || !result.height) {
          continue;
        }
        const tile = makeCanvas(result.width, result.height);
        tile.getContext('2d').putImageData(
            new ImageData(result.pixels, result.width, result.height),
            0,
            0,
        );
        context.globalAlpha = layer.opacity;
        context.globalCompositeOperation = layer.blend;
        context.drawImage(tile, result.x, result.y);
        tile.width = tile.height = 1;
      }
      if (generation !== epoch) {
        throw Error('Proof cancelled.');
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      return target;
    } finally {
      if (generation === epoch && task) {
        task.terminate();
        task = null;
      }
    }
  }
  return {
    get active() {
      return active;
    },
    get ready() {
      return ready;
    },
    proofExport,
    renderLayers,
    enterProof,
    exitProof,
    renderProof,
  };
})();
