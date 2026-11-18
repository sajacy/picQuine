'use strict';
// Capture the blank editor before UI mutations become part of future saves.
picQuineRuntime.capture();
const canvas = $('#canvas');
const overlay = $('#overlay');
const overlayContext = overlay.getContext('2d');
let tool = 'move';
let crop = null;
let shapeRegion = null;
let gesture = null;
let importMode = 'open';
const operations = picQuineOperations.create(syncOperationUI);
const editor = picQuineHistory.create(
    {w: 1200, h: 800, name: 'Untitled', layers: [], selected: null},
    {
      canEdit: (token) => operations.canEdit(token) &&
          (!editor.document.readOnly || token?.name === 'open-project'),
      onChange: updateHistory,
    },
);
const selected = () => editor.document.layers.find(
    (layer) => layer.id === editor.document.selected);
const {angle, layerCorners, layerPoint, normalRect, resizeDimensions} =
    picQuineGeometry;
const {dimensions} = picQuineDocument;
const {drawShape} = picQuineShapes;
const assets = picQuineAssets;
const proof = picQuineProof;
// Reassignable so file-I/O tests can substitute the save operation.
let writeFile = picQuineFiles.write;
const {enterProof, exitProof, renderProof, proofExport} = proof;
const {buildProject, readProject} = picQuineProject;
function composite(target, background) {
  return picQuineRenderer.composite(target, editor.document, background);
}
function toast(s) {
  $('#toast').textContent = s;
  $('#toast').style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('#toast').style.display = 'none'), 4500);
}
function status(s) {
  $('#status').textContent = s;
}
function snapshot() {
  return editor.snapshot();
}
function mutate(label, mutation, token) {
  if (gesture) {
    editor.commit();
    gesture = null;
  }
  const changed = editor.transact(label, mutation, token);
  if (changed) {
    render();
  }
  return changed;
}
function updateHistory() {
  $('#undo').disabled = operations.state !== 'idle' ||
      !!editor.document.readOnly || !editor.past.length;
  $('#redo').disabled = operations.state !== 'idle' ||
      !!editor.document.readOnly || !editor.future.length;
}
function restoreView() {
  crop = null;
  shapeRegion = null;
  render();
  fit();
}
function undo() {
  if (editor.undo()) {
    restoreView();
  }
}
function redo() {
  if (editor.redo()) {
    restoreView();
  }
}
function newLayer(c, name, x = 0, y = 0) {
  return {
    id: uid(),
    name,
    canvas: c,
    x,
    y,
    w: c.width,
    h: c.height,
    opacity: 1,
    visible: true,
    blend: 'source-over',
    rotation: 0,
  };
}
function addLayer(c, name, x = 0, y = 0) {
  const layer = newLayer(c, name, x, y);
  editor.document.layers.push(layer);
  editor.document.selected = layer.id;
  return layer;
}

const requestDraw = picQuineRenderer.scheduler(
    (callback) => typeof window.requestAnimationFrame === 'function' ?
        window.requestAnimationFrame(callback) :
        callback(),
    (composition) => (composition ? draw() : drawOverlay()),
);
function draw() {
  if (proof.active) {
    return;
  }
  composite(canvas);
  drawOverlay();
}
function drawOverlay() {
  if (proof.active) {
    return;
  }
  picQuineRenderer.prepare(overlay, editor.document.w, editor.document.h);
  const scale =
      $('#stage').getBoundingClientRect().width / editor.document.w || 1;
  overlayContext.lineWidth = 1.2 / scale;
  overlayContext.strokeStyle = '#d8edb1';
  if (crop) {
    const bounds = normalRect(crop);
    overlayContext.fillStyle = '#07120aa0';
    overlayContext.fillRect(0, 0, editor.document.w, editor.document.h);
    overlayContext.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
    overlayContext.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    overlayContext.beginPath();
    for (let i = 1; i < 3; i++) {
      overlayContext.moveTo(bounds.x + (bounds.w * i) / 3, bounds.y);
      overlayContext.lineTo(bounds.x + (bounds.w * i) / 3, bounds.y + bounds.h);
      overlayContext.moveTo(bounds.x, bounds.y + (bounds.h * i) / 3);
      overlayContext.lineTo(bounds.x + bounds.w, bounds.y + (bounds.h * i) / 3);
    }
    overlayContext.stroke();
  } else {
    const layer = selected();
    if (layer && tool === 'move') {
      overlayContext.setLineDash([5 / scale, 4 / scale]);
      const points = layerCorners(layer);
      overlayContext.beginPath();
      overlayContext.moveTo(points[0].x, points[0].y);
      for (const pointer of points.slice(1)) {
        overlayContext.lineTo(pointer.x, pointer.y);
      }
      overlayContext.closePath();
      overlayContext.stroke();
    }
    if (isShapeTool() && shapeRegion) {
      const bounds = normalRect(shapeRegion);
      const style = shapeStyle();
      if (style) {
        overlayContext.globalAlpha = 0.7;
        drawShape(overlayContext, bounds, style, tool);
        overlayContext.globalAlpha = 1;
      }
    }
  }
}
function render() {
  draw();
  $('#welcome').hidden = !!editor.document.layers.length;
  $('#docName').value = editor.document.name;
  document.title = editor.document.name + ' — PicQuine';
  $('#docSize').textContent = `${editor.document.w} × ${editor.document.h} px`;
  $('#layerCount').textContent = `${editor.document.layers.length} layer${
      editor.document.layers.length === 1 ? '' : 's'}`;
  renderLayers();
  properties();
  updateHistory();
}
const layerRows = new Map();
let layerOrder = '';
function renderLayers() {
  const list = $('#layers');
  const layers = [...editor.document.layers].reverse();
  const ids = new Set(layers.map((layer) => layer.id));
  for (const id of layerRows.keys()) {
    if (!ids.has(id)) {
      layerRows.delete(id);
    }
  }
  for (const layer of layers) {
    let item = layerRows.get(layer.id);
    if (!item) {
      const row = document.createElement('div');
      const thumb = makeCanvas(76, 64);
      const title = document.createElement('span');
      const visibility = document.createElement('button');
      thumb.className = 'thumb';
      title.className = 'layer-title';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.append(thumb, title, visibility);
      row.onclick = () => {
        if (!operations.canEdit()) {
          return;
        }
        editor.document.selected = layer.id;
        renderLayers();
        properties();
        drawOverlay();
      };
      row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          row.onclick();
        }
      };
      visibility.onclick = (e) => {
        e.stopPropagation();
        mutate('Toggle visibility', () => {
          const current = editor.document.layers.find((n) => n.id === layer.id);
          if (current) {
            current.visible = !current.visible;
          }
        });
        render();
      };
      item = {row, thumb, title, visibility, source: null, revision: -1};
      layerRows.set(layer.id, item);
    }
    item.row.className =
        'layer' + (layer.id === editor.document.selected ? ' selected' : '');
    item.row.setAttribute('aria-label', 'Select ' + layer.name);
    item.title.textContent = layer.name;
    item.visibility.textContent = layer.visible ? '◉' : '○';
    item.visibility.title = layer.visible ? 'Hide layer' : 'Show layer';
    item.visibility.setAttribute(
        'aria-label',
        item.visibility.title + ' ' + layer.name,
    );
    if (item.source !== layer.canvas ||
        item.revision !== assets.revision(layer.canvas)) {
      const c = picQuineRenderer.prepare(item.thumb, 76, 64);
      c.drawImage(assets.thumbnail(layer.canvas), 0, 0);
      item.source = layer.canvas;
      item.revision = assets.revision(layer.canvas);
    }
  }
  const order = JSON.stringify(layers.map((layer) => layer.id));
  if (order !== layerOrder) {
    list.replaceChildren(...layers.map((layer) => layerRows.get(layer.id).row));
    layerOrder = order;
  }
}
function properties() {
  const layer = selected();
  $('#editLayer').hidden = !layer ||
      !(layer.text || layer.original?.type?.toLowerCase() === 'image/svg+xml');
  $('#properties')
      .querySelectorAll('input,select')
      .forEach((i) => (i.disabled = !layer));
  for (const id of ['duplicate', 'delete', 'raise', 'lower', 'rotate90']) {
    $('#' + id).disabled = !layer;
  }
  if (!layer) {
    return;
  }
  $('#layerName').value = layer.name;
  $('#opacity').value = layer.opacity * 100;
  $('#opacityValue').value = Math.round(layer.opacity * 100) + '%';
  $('#posX').value = Math.round(layer.x);
  $('#posY').value = Math.round(layer.y);
  const percent = $('#layerSizeUnit').value === 'percent';
  $('#layerWidth').min = $('#layerHeight').min = percent ? '0.01' : '1';
  $('#layerWidth').step = $('#layerHeight').step = 'any';
  $('#layerWidth').value =
      percent ? +(layer.w / layer.canvas.width * 100).toFixed(4) : layer.w;
  $('#layerHeight').value =
      percent ? +(layer.h / layer.canvas.height * 100).toFixed(4) : layer.h;
  $('#blend').value = layer.blend;
  $('#rotation').value = angle(layer) || 360;
  $('#rotationValue').value = (angle(layer) || 360) + '°';
  $('#rotate90').disabled = false;
}
function textDialog(text) {
  const first = text?.runs[0];
  return modal(
      text ? 'Edit text' : 'Add text', 'text-fields',
      text ? 'Save' : 'Add text', () => ({
        text: $('#textContent').value,
        size: +$('#textSize').value,
        font: $('#textFont').value,
        color: $('#textColor').value,
      }),
      () => {
        $('#textColor').value = first?.color || $('#color').value;
        if (!text) {
          return;
        }
        $('#textContent').value = text.content;
        const fonts = $('#textFont');
        if (![...fonts.options].some(
            (option) => option.value === first.fontFamily)) {
          const option = document.createElement('option');
          option.value = option.textContent = first.fontFamily;
          fonts.append(option);
        }
        fonts.value = first.fontFamily;
        $('#textSize').value = first.fontSize;
      });
}
function renderText(data) {
  const size = data.size;
  const lines = data.text.split('\n');
  if (!data.text || data.text.length > 2000 || lines.length > 20 ||
      !Number.isFinite(size) || size < 1 || size > 1000) {
    toast('Use 1–1000 px text with at most 20 lines and 2000 characters.');
    return null;
  }
  const family =
      ['system-ui', 'serif', 'sans-serif', 'monospace'].includes(data.font) ?
      data.font :
      JSON.stringify(data.font);
  const font = `${size}px ${family}`;
  const measure = makeCanvas(1, 1).getContext('2d');
  measure.font = font;
  const width = Math.ceil(
      Math.max(...lines.map((line) => measure.measureText(line).width)) + 8);
  const height = Math.ceil(size * 1.4 * lines.length);
  if (!dimensions(width, height)) {
    toast('This text is too large. Use a smaller size or shorter text.');
    return null;
  }
  const pixels = makeCanvas(width, height);
  const context = pixels.getContext('2d');
  context.font = font;
  context.fillStyle = data.color;
  const text = {
    content: data.text,
    runs: lines.map((content, index) => ({
      content,
      fontFamily: data.font,
      fontSize: size,
      color: data.color,
      x: 4,
      y: size + index * size * 1.4,
    })),
  };
  for (const run of text.runs) {
    context.fillText(run.content, run.x, run.y);
  }
  return {pixels, text};
}
async function editLayer() {
  const layer = selected();
  if (!layer || operations.state !== 'idle' || editor.document.readOnly) {
    return;
  }
  editor.commit();
  const token = operations.acquire('edit-layer');
  if (!token) {
    return;
  }
  try {
    let pixels;
    let text;
    let original = layer.original;
    if (layer.text) {
      const data = await textDialog(layer.text);
      if (!data) {
        return;
      }
      const first = layer.text.runs[0];
      if (data.text === layer.text.content && data.font === first.fontFamily &&
          data.size === first.fontSize && data.color === first.color) {
        return;
      }
      const rendered = renderText(data);
      if (!rendered) {
        return;
      }
      ({pixels, text} = rendered);
    } else if (original?.type?.toLowerCase() === 'image/svg+xml') {
      const markup = await original.blob.text();
      const value = await modal(
          'Edit SVG', 'svg-fields', 'Save', () => $('#svgContent').value,
          () => {
            $('#svgContent').value = markup;
          });
      if (value === null || value === markup) {
        return;
      }
      const file = new File([value], original.name, {type: 'image/svg+xml'});
      pixels = await assets.decode(file);
      // New source identity; retain fork-owned file metadata with the new
      // bytes.
      original = {
        blob: file,
        name: file.name,
        type: file.type,
        ...(original.record ? {
          record: {
            ...original.record,
            base64: await picQuineStandalone.base64(file),
          },
        } :
                              {}),
      };
    } else {
      return;
    }
    const total = editor.document.layers.reduce(
        (sum, item) => sum +
            (item === layer ? pixels.width * pixels.height :
                              item.canvas.width * item.canvas.height),
        0);
    if (total > picQuineConfig.limits.projectPixels) {
      throw Error('Project exceeds the pixel memory limit.');
    }
    mutate('Edit layer source', () => {
      // Preserve position and source-relative scale when intrinsic size
      // changes.
      layer.w *= pixels.width / layer.canvas.width;
      layer.h *= pixels.height / layer.canvas.height;
      layer.canvas = pixels;
      layer.original = original;
      layer.pixelsEdited = !!text;
      if (text) {
        layer.text = text;
      }
    }, token);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    operations.release(token);
  }
}
$('#editLayer').onclick = editLayer;

function fit() {
  const viewport = $('#viewport');
  const z = $('#zoom').value;
  const scale = z === 'fit' ?
      Math.min(
          (viewport.clientWidth - 80) / editor.document.w,
          (viewport.clientHeight - 80) / editor.document.h,
          1,
      ) :
      +z;
  $('#stage').style.width = Math.max(1, editor.document.w * scale) + 'px';
  $('#stage').style.height = Math.max(1, editor.document.h * scale) + 'px';
  drawOverlay();
}
new ResizeObserver(fit).observe($('#viewport'));
function setTool(t) {
  tool = t;
  crop = null;
  shapeRegion = null;
  document.querySelectorAll('[data-tool]')
      .forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  const labels = {
    move: ['Move', 'Drag to position the selected layer'],
    crop: ['Crop', 'Drag on the canvas to select your crop'],
    brush: ['Brush', 'Paint on the selected layer'],
    erase: ['Eraser', 'Erase to transparency on the selected layer'],
    text: ['Text', 'Click on the canvas to add text'],
    rect: ['Rectangle', 'Drag or enter exact bounds'],
    ellipse: ['Ellipse', 'Drag or enter exact bounds'],
  };
  $('#toolLabel').textContent = labels[t][0];
  $('#toolHint').textContent = labels[t][1];
  $('#brushLabel').hidden = !['brush', 'erase'].includes(t);
  $('#applyCrop').hidden = $('#cancelCrop').hidden = t !== 'crop';
  $('#cropLayerLabel').hidden = t !== 'crop';
  overlay.style.cursor = t === 'move' ? 'move' : 'crosshair';
  $('#regionControls').hidden = !['crop', 'rect', 'ellipse'].includes(t);
  $('#addRectangle').hidden = !isShapeTool();
  $('#addRectangle').textContent =
      t === 'ellipse' ? 'Add ellipse' : 'Add rectangle';
  $('#shapeControls').hidden = !isShapeTool();
  updateShapeControls();
  $('#regionSize').textContent = '';
  drawOverlay();
}

const point = (e) => {
  const bounds = overlay.getBoundingClientRect();
  return {
    x: ((e.clientX - bounds.left) * editor.document.w) / bounds.width,
    y: ((e.clientY - bounds.top) * editor.document.h) / bounds.height,
  };
};
function clampPoint(pointer) {
  return {
    x: Math.max(0, Math.min(editor.document.w, pointer.x)),
    y: Math.max(0, Math.min(editor.document.h, pointer.y)),
  };
}
function paint(from, to) {
  const layer = selected();
  if (!layer) {
    return;
  }
  assets.invalidate(layer.canvas);
  const context = layer.canvas.getContext('2d');
  context.save();
  context.globalCompositeOperation =
      tool === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = $('#color').value;
  context.fillStyle = $('#color').value;
  context.lineWidth =
      ((+$('#brushSize').value || 24) * layer.canvas.width) / layer.w;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const start = layerPoint(layer, from);
  const end = layerPoint(layer, to);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.arc(end.x, end.y, context.lineWidth / 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
  requestDraw();
}
overlay.onpointerdown = async (e) => {
  if (proof.active || operations.busy || e.button !== 0) {
    return;
  }
  const pointer = point(e);
  updatePointer(pointer);
  if (isShapeTool()) {
    shapeRegion = null;
  }
  if (tool === 'text') {
    const data = await textDialog();
    if (!data || !data.text) {
      return;
    }
    const rendered = renderText(data);
    if (!rendered) {
      return;
    }
    const {pixels, text} = rendered;
    mutate('Edit layer', () => {
      const textLayer = addLayer(pixels, data.text, pointer.x, pointer.y);
      textLayer.text = text;
      setTool('move');
      return;
    });
    return;
  }
  if (['move', 'brush', 'erase'].includes(tool) && !selected()) {
    if (tool === 'erase' || tool === 'move') {
      toast('Select or add a layer first.');
      return;
    }
    if (!editor.begin('Paint')) {
      return;
    }
    addLayer(makeCanvas(editor.document.w, editor.document.h), 'Paint');
  } else if (['move', 'brush', 'erase'].includes(tool) && !editor.begin(tool)) {
    return;
  }
  overlay.setPointerCapture(e.pointerId);
  gesture = {start: pointer, last: pointer, x: selected()?.x, y: selected()?.y};
  if (tool === 'crop') {
    const clamped = clampPoint(pointer);
    crop = {...clamped, w: 0, h: 0};
    gesture.start = clamped;
  }
  if (['brush', 'erase'].includes(tool)) {
    const layer = selected();
    // History shares committed pixels; paint only into a reserved draft copy.
    editor.reservePixelEdit(layer.canvas);
    const copy = makeCanvas(layer.canvas.width, layer.canvas.height);
    copy.getContext('2d').drawImage(layer.canvas, 0, 0);
    layer.canvas = copy;
    layer.pixelsEdited = true;
    paint(pointer, pointer);
  }
};
overlay.onpointermove = (e) => {
  const pointer = point(e);
  updatePointer(pointer);
  if (!gesture) {
    return;
  }
  if (tool === 'move') {
    const layer = selected();
    layer.x = Math.round(gesture.x + pointer.x - gesture.start.x);
    layer.y = Math.round(gesture.y + pointer.y - gesture.start.y);
    requestDraw();
    properties();
  }
  if (tool === 'crop') {
    const clamped = clampPoint(pointer);
    crop = {
      ...gesture.start,
      w: clamped.x - gesture.start.x,
      h: clamped.y - gesture.start.y,
    };
    syncRegion(crop);
    requestDraw(/* composition= */ false);
  }
  if (['brush', 'erase'].includes(tool)) {
    paint(gesture.last, pointer);
  }
  if (isShapeTool()) {
    shapeRegion = {
      ...gesture.start,
      w: pointer.x - gesture.start.x,
      h: pointer.y - gesture.start.y,
    };
    syncRegion(shapeRegion);
    requestDraw(/* composition= */ false);
  }
  gesture.last = pointer;
};
function endGesture() {
  if (!gesture) {
    return;
  }
  if (isShapeTool() && shapeRegion) {
    commitShape();
  }
  gesture = null;
  editor.commit();
  render();
}
function updatePointer(pointer) {
  $('#coordinates').textContent =
      `X ${Math.round(pointer.x)}  Y ${Math.round(pointer.y)}`;
}
function syncRegion(region) {
  const bounds = normalRect(region);
  for (const [id, key] of [
    ['regionX', 'x'],
    ['regionY', 'y'],
    ['regionW', 'w'],
    ['regionH', 'h'],
  ]) {
    $('#' + id).value = Math.round(bounds[key]);
  }
  $('#regionSize').textContent =
      `W ${Math.round(bounds.w)}  H ${Math.round(bounds.h)}`;
}
function precisionRegion() {
  const bounds = {
    x: +$('#regionX').value,
    y: +$('#regionY').value,
    w: +$('#regionW').value,
    h: +$('#regionH').value,
  };
  if (!Object.values(bounds).every(Number.isFinite) ||
      !Object.values(bounds).every(Number.isInteger) ||
      !dimensions(bounds.w, bounds.h) || Math.abs(bounds.x) > 100000 ||
      Math.abs(bounds.y) > 100000) {
    return null;
  }
  return bounds;
}
function isShapeTool() {
  return tool === 'rect' || tool === 'ellipse';
}
function shapeStyle() {
  const width = +$('#shapeStrokeWidth').value;
  const mode = $('#shapeMode').value || 'both';
  if (!['stroke', 'both', 'fill'].includes(mode) ||
      (mode !== 'fill' &&
       (!Number.isInteger(width) || width < 1 || width > 4096))) {
    return null;
  }
  return {
    mode,
    strokeWidth: width,
    fill: $('#shapeFill').value || '#287c65',
    stroke: $('#shapeStroke').value || '#ff0000',
  };
}
function updateShapeControls() {
  const mode = $('#shapeMode').value || 'both';
  $('#shapeFill').disabled = mode === 'stroke';
  $('#shapeStroke').disabled = $('#shapeStrokeWidth').disabled =
      mode === 'fill';
}

function commitShape() {
  if (proof.active || operations.busy || !isShapeTool()) {
    return;
  }
  const bounds = shapeRegion ? normalRect(shapeRegion) : precisionRegion();
  const style = shapeStyle();
  if (!bounds || !dimensions(Math.round(bounds.w), Math.round(bounds.h))) {
    return toast('Enter valid integer shape dimensions.');
  }
  if (!style) {
    return toast('Stroke width must be an integer from 1 to 4096 pixels.');
  }
  mutate('commitShape', () => {
    const c = makeCanvas(Math.round(bounds.w), Math.round(bounds.h));
    drawShape(
        c.getContext('2d'),
        {x: 0, y: 0, w: c.width, h: c.height},
        style,
        tool,
    );
    addLayer(
        c,
        tool === 'ellipse' ? 'Ellipse' : 'Rectangle',
        Math.round(bounds.x),
        Math.round(bounds.y),
    );
    shapeRegion = null;
    drawOverlay();
  });
}
for (const id
  of ['shapeMode', 'shapeFill', 'shapeStroke', 'shapeStrokeWidth']) {
  $('#' + id).oninput = () => {
    updateShapeControls();
    drawOverlay();
  };
}
$('#shapeMode').onchange = $('#shapeMode').oninput;
for (const id of ['regionX', 'regionY', 'regionW', 'regionH']) {
  $('#' + id).oninput = () => {
    const bounds = precisionRegion();
    if (!bounds) {
      $('#regionSize').textContent = 'Invalid dimensions';
      return;
    }
    if (tool === 'crop') {
      crop = bounds;
    } else if (isShapeTool()) {
      shapeRegion = bounds;
    }
    syncRegion(bounds);
    drawOverlay();
  };
}
$('#addRectangle').onclick = commitShape;
overlay.onpointerleave = () => {
  $('#coordinates').textContent = 'X —  Y —';
};
$('#stage').onpointerleave = overlay.onpointerleave;
$('#stage').onpointermove = (e) => updatePointer(point(e));
overlay.onpointerup = endGesture;
overlay.onpointercancel = () => {
  editor.cancel();
  gesture = null;
  shapeRegion = null;
  crop = null;
  render();
};

function modal(
    title,
    templateId,
    ok = 'Apply',
    read = () => true,
    initialize = () => {},
) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalBody')
        .replaceChildren($('#' + templateId).content.cloneNode(true));
    initialize();
    $('#modalOK').textContent = ok;
    $('#modal').onclose = () =>
      resolve($('#modal').returnValue === 'ok' ? read() : null);
    // Escape must not reuse the previous dialog's accepted return value.
    $('#modal').returnValue = 'cancel';
    $('#modal').showModal();
  });
}
async function newDocument() {
  const d = await modal(
      'A fresh canvas', 'new-fields', 'Create', () => ({
        w: +$('#newW').value,
        h: +$('#newH').value,
      }));
  if (!d) {
    return;
  }
  if (!dimensions(d.w, d.h)) {
    return toast('Use dimensions up to 16,384 px and 40 megapixels.');
  }
  mutate('newDocument', () => {
    editor.document = {
      w: d.w,
      h: d.h,
      name: 'Untitled',
      layers: [],
      selected: null,
    };

    fit();
  });
}

async function resize() {
  const ow = editor.document.w;
  const oh = editor.document.h;
  let unit = 'pixels';
  const pending = modal(
      'Resize canvas',
      'resize-fields',
      'Resize',
      () => resizeDimensions(
          ow, oh, +$('#resizeW').value, +$('#resizeH').value, unit),
      () => {
        $('#resizeW').value = ow;
        $('#resizeH').value = oh;
      },
  );
  $('#resizeW').oninput = () => {
    if ($('#ratio').checked) {
      $('#resizeH').value = unit === 'percent' ?
          $('#resizeW').value :
          Math.max(1, Math.round((+$('#resizeW').value * oh) / ow));
    }
  };
  $('#resizeH').oninput = () => {
    if ($('#ratio').checked) {
      $('#resizeW').value = unit === 'percent' ?
          $('#resizeH').value :
          Math.max(1, Math.round((+$('#resizeH').value * ow) / oh));
    }
  };
  $('#ratio').onchange = () => {
    if ($('#ratio').checked) {
      $('#resizeW').oninput();
    }
  };
  $('#resizeUnit').onchange = () => {
    const d = resizeDimensions(
        ow,
        oh,
        +$('#resizeW').value,
        +$('#resizeH').value,
        unit,
    );
    unit = $('#resizeUnit').value;
    $('#resizeW').value =
        unit === 'percent' ? Math.round((d.w / ow) * 10000) / 100 : d.w;
    $('#resizeH').value =
        unit === 'percent' ? Math.round((d.h / oh) * 10000) / 100 : d.h;
  };
  const d = await pending;
  if (!d) {
    return;
  }
  if (!dimensions(d.w, d.h)) {
    return toast('Use dimensions up to 16,384 px and 40 megapixels.');
  }
  mutate('resize', () => {
    const sx = d.w / ow;
    const sy = d.h / oh;
    for (const layer of editor.document.layers) {
      const cx = (layer.x + layer.w / 2) * sx;
      const cy = (layer.y + layer.h / 2) * sy;
      layer.w *= sx;
      layer.h *= sy;
      layer.x = cx - layer.w / 2;
      layer.y = cy - layer.h / 2;
    }
    editor.document.w = d.w;
    editor.document.h = d.h;

    fit();
    status('Canvas resized.');
  });
}
$('#applyCrop').onclick = () => {
  if (!crop) {
    crop = precisionRegion();
  }
  if (!crop) {
    return toast('Drag a crop area or enter its dimensions.');
  }
  const bounds = normalRect(crop);
  const x = Math.round(bounds.x);
  const y = Math.round(bounds.y);
  const w = Math.min(editor.document.w - x, Math.round(bounds.w));
  const h = Math.min(editor.document.h - y, Math.round(bounds.h));
  if (x < 0 || y < 0 || bounds.x + bounds.w > editor.document.w ||
      bounds.y + bounds.h > editor.document.h || w < 1 || h < 1) {
    return toast('Crop must be inside the canvas.');
  }
  mutate('Edit layer', () => {
    if ($('#cropToLayer').checked) {
      const pixels = makeCanvas(w, h);
      const c = pixels.getContext('2d');
      c.translate(-x, -y);
      for (const layer of editor.document.layers) {
        if (!layer.visible) {
          continue;
        }
        c.globalAlpha = layer.opacity;
        c.globalCompositeOperation = layer.blend;
        picQuineRenderer.drawLayer(c, layer);
      }
      addLayer(pixels, 'Crop', x, y);
      setTool('move');
      status('Cropped composition added as a new layer.');
      return;
    }
    for (const layer of editor.document.layers) {
      layer.x -= x;
      layer.y -= y;
    }
    editor.document.w = w;
    editor.document.h = h;
    setTool('move');

    fit();
    status('Canvas cropped. Layer pixels outside the canvas are retained.');
  });
};
$('#cancelCrop').onclick = () => setTool('move');

async function importFiles(files, mode) {
  if (proof.active) {
    toast('Exit preview to import images.');
    return;
  }
  if (operations.busy || gesture) {
    return;
  }
  editor.commit();
  const token = operations.acquire('import');
  if (!token) {
    return;
  }
  try {
    let first = true;
    for (const file of files) {
      status('Opening ' + file.name + '…');
      try {
        const mime = picQuineImages.imageMime(file.name);
        const type = mime === 'application/octet-stream' ? file.type : mime;
        if (!picQuineConfig.imageTypes.includes(type)) {
          throw Error('Unsupported image format.');
        }
        const c = await assets.decode(file);
        mutate(
            'importFiles',
            () => {
              if (first && mode === 'open') {
                editor.document = {
                  w: c.width,
                  h: c.height,
                  name: picQuineDocument.fileStem(
                      file.name.replace(/\.[^.]+$/, '')),
                  layers: [],
                  selected: null,
                };
              }
              const layer = addLayer(c, file.name);
              layer.original = {
                blob: file,
                name: file.name,
                type,
              };
              layer.pixelsEdited = false;
              first = false;
            },
            token,
        );
      } catch (e) {
        toast(file.name + ': ' + (e.message || String(e)));
      }
    }
    fit();
    status('Images opened');
  } finally {
    operations.release(token);
  }
}
function pick(mode) {
  if (operations.busy) {
    return;
  }
  importMode = mode;
  $('#fileInput').value = '';
  $('#fileInput').click();
}
$('#fileInput').onchange = (e) => importFiles([...e.target.files], importMode);
$('#viewport').ondragover = (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
};
$('#viewport').ondrop = (e) => {
  e.preventDefault();
  importFiles(
      [...e.dataTransfer.files],
      editor.document.layers.length ? 'layer' : 'open',
  );
};
async function exportImage() {
  if (operations.busy || (proof.active && !proof.ready)) {
    return;
  }
  const pending = modal(
      'Export image', 'export-fields', 'Export',
      () => ({
        type: $('#exportFormat').value,
        quality: +$('#exportQuality').value / 100,
        bg: $('#exportBg').value,
        filter: $('#exportResampling').value,
      }));
  $('#exportResampling').value =
      proof.active ? $('#proofFilter').value : 'none';
  $('#exportFormat').onchange = () => {
    $('#qualityLabel').hidden = $('#exportFormat').value === 'image/png';
    $('#bgLabel').hidden = $('#exportFormat').value !== 'image/jpeg';
  };
  const d = await pending;
  if (!d) {
    return;
  }
  editor.commit();
  const exportToken = operations.acquire('export');
  if (!exportToken) {
    return;
  }
  try {
    const ext = d.type.split('/')[1].replace('jpeg', 'jpg');
    const name = picQuineDocument.fileStem(editor.document.name) + '.' + ext;
    const destination = await picQuineFiles.choose(
        name,
        d.type,
        ext.toUpperCase() + ' image',
        ['.' + ext],
    );
    if (!destination) {
      return;
    }
    const background = d.type === 'image/jpeg' ? d.bg : null;
    let c;
    if (d.filter === 'none') {
      c = composite(makeCanvas(1, 1), background);
    } else if (proof.active && d.filter === $('#proofFilter').value) {
      c = proofExport(background);
    } else {
      const filtered = await proof.renderLayers(makeCanvas(1, 1), d.filter);
      c = proofExport(background, filtered);
      filtered.width = filtered.height = 1;
    }
    const blob =
        await new Promise((resolve) => c.toBlob(resolve, d.type, d.quality));
    if (!blob) {
      throw Error('Could not encode this image.');
    }
    if (await writeFile(
        blob,
        name,
        ext.toUpperCase() + ' image',
        ['.' + ext],
        destination,
    )) {
      status('Image exported.');
    }
  } catch (e) {
    toast(e.message);
  } finally {
    if (exportToken) {
      operations.release(exportToken);
    }
  }
}
// Source edits replace specs and pixels together; history retains the old pair.

function syncOperationUI() {
  const locked = operations.state !== 'idle' || !!editor.document.readOnly;
  const io = operations.busy;
  document.querySelectorAll('.tools, aside, .contextbar, #welcome')
      .forEach((el) => (el.inert = locked));
  document.querySelectorAll('.documentbar').forEach((el) => (el.inert = io));
  for (const id
    of ['new',
      'open',
      'projectOpen',
      'saveProject',
      'resize',
      'docName',
    ]) {
    $('#' + id).disabled = locked;
  }
  $('#projectOpen').disabled = operations.state !== 'idle';
  $('#loadEditor').disabled = operations.state !== 'idle';
  $('#saveProject').disabled = operations.state !== 'idle' ||
      (!!editor.document.readOnly && !picQuineRuntime.pending);
  $('#preview').disabled = io || !!editor.document.readOnly;
  $('#proofFilter').disabled = io;
  $('#export').disabled =
      !!editor.document.readOnly || io || (proof.active && !proof.ready);
  updateHistory();
}
async function saveProject() {
  if (operations.busy || proof.active || gesture) {
    return;
  }
  editor.commit();
  const token = operations.acquire('save');
  if (!token) {
    return;
  }
  let choice;
  try {
    choice = await modal(
        'Save Project', 'save-fields', 'Save', () => $('#saveEditor').value,
        () => {
          const select = $('#saveEditor');
          select.options[0].textContent =
              'Current editor: ' + picQuineRuntime.info.editor.profile + ' ' +
              picQuineRuntime.info.editor.version;
          select.options[0].disabled = !!editor.document.readOnly;
          if (picQuineRuntime.pending) {
            const option = document.createElement('option');
            option.value = 'loaded';
            option.textContent = picQuineRuntime.pending.url;
            select.append(option);
            select.value = 'loaded';
          }
        });
    if (!choice) {
      return;
    }
  } finally {
    if (!choice) {
      operations.release(token);
    }
  }
  const savingRevision = editor.revision;
  status('Choose save destination…');
  try {
    const destination = await picQuineFiles.choose(
        picQuineDocument.fileStem(editor.document.name) + '.zip',
        'application/zip',
        'PicQuine project ZIP',
        ['.zip'],
    );
    if (!destination) {
      status('Save cancelled.');
      return;
    }
    status('Compressing project locally…');
    const archive = await buildProject(snapshot(), choice);
    if (await writeFile(
        archive,
        picQuineDocument.fileStem(editor.document.name) + '.zip',
        'PicQuine project ZIP',
        ['.zip'],
        destination,
    )) {
      editor.markSaved(savingRevision);
      status(
          'Project saved. Extract the ZIP and open the HTML to continue editing.');
    }
  } catch (e) {
    toast(e.message || String(e));
    status('Project save failed.');
  } finally {
    operations.release(token);
  }
}

$('#projectInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file || operations.busy || proof.active) {
    return;
  }
  editor.commit();
  const token = operations.acquire('open-project');
  if (!token) {
    return;
  }
  status('Opening project locally…');
  try {
    const next = await readProject(file);
    mutate(
        'Open project',
        () => {
          editor.document = next;
        },
        token,
    );
    render();
    fit();
    editor.markSaved();
    syncOperationUI();
    status(
        next.readOnly ? 'Read-only: missing ' + next.missing.join(', ') :
                        'Layered project restored.');
  } catch (e) {
    toast(e.message || String(e));
    status('Project could not be opened. Current document preserved.');
  } finally {
    operations.release(token);
    e.target.value = '';
  }
};
for (const [id, key] of [
  ['layerName', 'name'],
  ['posX', 'x'],
  ['posY', 'y'],
  ['blend', 'blend'],
]) {
  $('#' + id).onchange = () => {
    const layer = selected();
    if (!layer) {
      return;
    }
    const v = ['x', 'y', 'w', 'h'].includes(key) ? +$('#' + id).value :
                                                   $('#' + id).value;
    if (typeof v === 'number' &&
        (!Number.isFinite(v) || Math.abs(v) > 100000 ||
         (['w', 'h'].includes(key) && v < 1))) {
      properties();
      return;
    }
    mutate('Edit layer', () => {
      layer[key] = v;
    });
  };
}
$('#layerSizeUnit').onchange = properties;
for (const [id, key, other] of [
  ['layerWidth', 'w', 'h'], ['layerHeight', 'h', 'w']]) {
  $('#' + id).onchange = () => {
    const layer = selected();
    if (!layer) {
      return;
    }
    let value = +$('#' + id).value;
    if ($('#layerSizeUnit').value === 'percent') {
      value *= (key === 'w' ? layer.canvas.width : layer.canvas.height) / 100;
    }
    const paired = $('#layerRatio').checked ?
        layer[other] * value / layer[key] :
        layer[other];
    if (![value, paired].every(
        (v) => Number.isFinite(v) && v >= 1 && v <= 100000)) {
      properties();
      return;
    }
    mutate('Resize layer', () => {
      layer[key] = value;
      layer[other] = paired;
    });
  };
}
$('#opacity').onpointerdown = () => {
  if (selected()) {
    editor.begin('Adjust layer');
  }
};
$('#opacity').onkeydown = (e) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown']
      .includes(
          e.key,
      ) &&
      selected()) {
    editor.begin('Opacity');
  }
};
$('#opacity').oninput = () => {
  const layer = selected();
  if (layer && editor.begin('Opacity')) {
    layer.opacity = +$('#opacity').value / 100;
    $('#opacityValue').value = $('#opacity').value + '%';
    requestDraw();
  }
};
$('#rotate90').onclick = () => {
  const layer = selected();
  if (!layer) {
    return;
  }
  mutate('Edit layer', () => {
    layer.rotation = (angle(layer) + 90) % 360;
  });
};
$('#rotation').onpointerdown = () => {
  if (selected()) {
    editor.begin('Rotate layer');
  }
};
$('#rotation').onkeydown = (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
      .includes(
          e.key,
      ) &&
      selected()) {
    editor.begin('Rotate layer');
  }
};
$('#rotation').oninput = () => {
  const layer = selected();
  if (!layer || !editor.begin('Rotate layer')) {
    return;
  }
  layer.rotation =
      Math.max(1, Math.min(360, Math.round(+$('#rotation').value))) % 360;
  $('#rotationValue').value = (angle(layer) || 360) + '°';
  requestDraw();
};
$('#docName').onchange = () => {
  const name = picQuineDocument.fileStem($('#docName').value);
  if (name !== editor.document.name) {
    mutate('Edit layer', () => {
      editor.document.name = name;
    });
  }
  $('#docName').value = name;
};
$('#docName').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.target.blur();
  }
};
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  $('#theme').setAttribute('aria-pressed', String(theme === 'dark'));
  $('#theme').title =
      'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode';
}
$('#theme').onclick = () => {
  const theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try {
    localStorage.setItem('picquine-theme', theme);
  } catch {
    // File and Blob origins may deny storage; the current theme still works.
  }
};
try {
  applyTheme(
      localStorage.getItem('picquine-theme') === 'dark' ? 'dark' : 'light');
} catch {
  applyTheme('light');
}
$('#addLayer').onclick = () => {
  mutate('Edit layer', () => {
    addLayer(
        makeCanvas(editor.document.w, editor.document.h),
        'Transparent layer',
    );
  });
};
$('#duplicate').onclick = () => {
  const layer = selected();
  if (!layer) {
    return;
  }
  mutate('Edit layer', () => {
    // Duplicate metadata now; pixel sources stay shared until a paint edit.
    const n = {
      ...layer,
      id: uid(),
      name: layer.name + ' copy',
      x: layer.x + 20,
      y: layer.y + 20,
    };
    editor.document.layers.splice(
        editor.document.layers.indexOf(layer) + 1, 0, n);
    editor.document.selected = n.id;
  });
};
$('#delete').onclick = () => {
  const layer = selected();
  if (!layer) {
    return;
  }
  if (picQuineProject.protects(layer, editor.document.project)) {
    return toast(
        'This layer owns unsupported extension data; use an editor that supports it to delete it.');
  }
  mutate('Edit layer', () => {
    editor.document.layers = editor.document.layers.filter((n) => n !== layer);
    editor.document.selected = editor.document.layers.at(-1)?.id || null;
  });
};
function reorder(delta) {
  const layer = selected();
  const i = editor.document.layers.indexOf(layer);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= editor.document.layers.length) {
    return;
  }
  mutate('reorder', () => {
    [editor.document.layers[i], editor.document.layers[j]] = [
      editor.document.layers[j],
      editor.document.layers[i],
    ];
  });
}
$('#raise').onclick = () => reorder(1);
$('#lower').onclick = () => reorder(-1);
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#new').onclick = newDocument;
$('#open').onclick = $('#welcomeOpen').onclick = () => pick('open');
$('#importLayer').onclick = () => pick('layer');
$('#resize').onclick = resize;
$('#export').onclick = exportImage;
$('#saveProject').onclick = saveProject;
$('#loadEditor').onclick = async () => {
  if (operations.state !== 'idle' || gesture) {
    return;
  }
  const url = await modal(
      'Load editor URL', 'editor-fields', 'Load', () => $('#editorURL').value);
  if (!url) {
    return;
  }
  const token = operations.acquire('load-editor');
  if (!token) {
    return;
  }
  let preview;
  try {
    await picQuineRuntime.stage(url);
    // Embed the snapshot before prompting; opening needs no async work.
    preview = URL.createObjectURL(new Blob(
        [picQuineRuntime.render(
            await picQuineProject.buildData(editor.document), 'loaded')],
        {type: 'text/html;charset=utf-8'}));
    status('Editor loaded: ' + picQuineRuntime.pending.url);
  } catch (error) {
    toast(error.message || String(error));
    return;
  } finally {
    operations.release(token);
  }
  const opened = await modal(
      'Editor loaded', 'upgrade-fields', 'Open in New Window', () => {
        // Keep the popup inside the confirmation's user-activation window.
        const next = window.open(preview, '_blank');
        if (!next) {
          toast('Allow popups to open the loaded editor.');
          return false;
        }
        next.opener = null;
        next.addEventListener(
            'load', () => URL.revokeObjectURL(preview), {once: true});
        return true;
      });
  if (!opened) {
    URL.revokeObjectURL(preview);
  }
};
$('#projectOpen').onclick = () => $('#projectInput').click();
$('#fit').onclick = () => {
  $('#zoom').value = 'fit';
  fit();
};
$('#zoom').onchange = fit;
document.querySelectorAll('[data-tool]')
    .forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
$('#help').onclick = () =>
  modal('Welcome to PicQuine', 'help-fields', 'Got it');
$('#demo').onclick = async () => {
  if (operations.busy || proof.active || gesture) {
    return;
  }
  editor.commit();
  const token = operations.acquire('import');
  if (!token) {
    return;
  }
  status('Loading SVG sample…');
  try {
    const next = await picQuineDemo.create();
    mutate('Open SVG sample', () => {
      editor.document = next;
    }, token);
    setTool('move');
    fit();
    status('SVG sample loaded');
  } catch (error) {
    toast(error.message || String(error));
    status('Sample could not be loaded.');
  } finally {
    operations.release(token);
  }
};
document.onkeydown = (e) => {
  if (operations.busy) {
    return;
  }
  if (proof.active) {
    if (e.key === 'Escape' && !$('#modal').open) {
      e.preventDefault();
      exitProof();
    }
    return;
  }
  if (e.target.matches('input,textarea,select') || $('#modal').open) {
    return;
  }
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (cmd && ['o', 's'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    e.key.toLowerCase() === 'o' ? pick('open') : saveProject();
    return;
  }
  if (cmd) {
    return;
  }
  const map = {
    v: 'move',
    c: 'crop',
    b: 'brush',
    e: 'erase',
    t: 'text',
    r: 'rect',
    u: 'ellipse',
  };
  if (map[e.key.toLowerCase()]) {
    setTool(map[e.key.toLowerCase()]);
  }
  if (e.key === 'Escape') {
    setTool('move');
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    $('#delete').click();
    e.preventDefault();
  }
  if (e.key.startsWith('Arrow') && selected()) {
    e.preventDefault();
    mutate('Edit layer', () => {
      const layer = selected();
      const n = e.shiftKey ? 10 : 1;
      layer.x += e.key === 'ArrowRight' ? n : e.key === 'ArrowLeft' ? -n : 0;
      layer.y += e.key === 'ArrowDown' ? n : e.key === 'ArrowUp' ? -n : 0;
    });
  }
};
// Proof mode uses explicitly filtered, full document-resolution layer rasters.

function setProofUI(active) {
  document.body.classList.toggle('proof-mode', active);
  if (active) {
    for (const id
      of ['regionControls',
        'shapeControls',
        'applyCrop',
        'cancelCrop',
        'brushLabel',
      ]) {
      $('#' + id).hidden = true;
    }
  }
  $('#proofControls').hidden = !active;
  $('#proofCanvas').hidden = !active;
  if (active) {
    // Shrinking releases editing buffers while the proof owns the pixels.
    for (const c of [canvas, overlay]) {
      if (c.width !== 1) {
        c.width = 1;
      }
      if (c.height !== 1) {
        c.height = 1;
      }
    }
  }
  $('#preview').textContent = active ? 'Exit preview' : 'Preview';
  $('#preview').setAttribute('aria-pressed', String(active));
  syncOperationUI();
}

$('#preview').onclick = () => (proof.active ? exitProof() : enterProof());
$('#proofFilter').onchange = () => {
  if (proof.active) {
    renderProof();
  }
};
window.addEventListener('beforeunload', (e) => {
  if (editor.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
render();
fit();

for (const id of ['opacity', 'rotation']) {
  for (const event of ['onchange', 'onpointerup', 'onkeyup']) {
    $('#' + id)[event] = () => editor.commit();
  }
  $('#' + id).onpointercancel = () => {
    editor.cancel();
    render();
  };
}

async function openEmbeddedProject() {
  const element = $('#picquine-project');
  const json = element?.textContent?.trim();
  if (!json || json === 'null') {
    return;
  }
  const token = operations.acquire('open-project');
  if (!token) {
    return;
  }
  status('Opening embedded composition…');
  try {
    const project = picQuineJSON.parse(json);
    element.textContent = 'null';
    const next = await picQuineStandalone.restore(project);
    mutate('Open embedded project', () => {
      editor.document = next;
    }, token);
    editor.markSaved();
    fit();
    syncOperationUI();
    status(
        next.readOnly ?
            'Read-only: missing ' + next.missing.join(', ') :
            'Project opened. Save project downloads an updated ZIP containing one HTML file.');
  } catch (error) {
    toast(error.message || String(error));
    status('Embedded project could not be opened.');
  } finally {
    operations.release(token);
  }
}
openEmbeddedProject();
