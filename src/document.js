'use strict';
const picQuineDocument = (() => {
  // One filename stem for the ZIP, its HTML entry, and flattened exports.
  function fileStem(value) {
    let name = String(value ?? '')
        .trim()
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-')
        .replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(
        name.split('.')[0].trimEnd())) {
      name = '_' + name;
    }
    const encoder = new TextEncoder();
    let stem = '';
    let bytes = 0;
    for (const char of name) {
      bytes += encoder.encode(char).length;
      if (bytes > 240 || stem.length + char.length > 200) {
        break;
      }
      stem += char;
    }
    return stem.replace(/[. ]+$/g, '') || 'Untitled';
  }
  const validID = (id) =>
    typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);

  function dimensions(w, h) {
    return (
      Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 &&
        w <= picQuineConfig.limits.imageSide &&
        h <= picQuineConfig.limits.imageSide &&
        w * h <= picQuineConfig.limits.imagePixels);
  }
  function makeTextSource(content, fontFamily, fontSize, color, x, y) {
    return {content, runs: [{content, fontFamily, fontSize, color, x, y}]};
  }
  function validateTextSource(text) {
    if (!text || typeof text.content !== 'string' ||
        text.content.length > 2000 || !Array.isArray(text.runs) ||
        text.runs.length < 1 || text.runs.length > 20) {
      throw Error('Invalid original text metadata.');
    }
    const runs = text.runs.map((r) => {
      if (!r || typeof r.content !== 'string' || r.content.length > 2000 ||
          typeof r.fontFamily !== 'string' || r.fontFamily.length > 100 ||
          !Number.isFinite(r.fontSize) || r.fontSize < 1 || r.fontSize > 1000 ||
          !/^#[0-9a-f]{6}$/i.test(r.color) || !Number.isFinite(r.x) ||
          !Number.isFinite(r.y) || Math.abs(r.x) > 100000 ||
          Math.abs(r.y) > 100000) {
        throw Error('Invalid original text styling.');
      }
      return {
        content: r.content,
        fontFamily: r.fontFamily,
        fontSize: r.fontSize,
        color: r.color,
        x: r.x,
        y: r.y,
      };
    });
    return {content: text.content, runs};
  }
  function validateProject(d) {
    if (!d || typeof d.name !== 'string' || d.name.length > 200 ||
        !dimensions(d.w, d.h) || !Array.isArray(d.layers) ||
        d.layers.length > picQuineConfig.limits.layers) {
      throw Error('Invalid PicQuine project.');
    }
    const ids = new Set();
    for (const l of d.layers) {
      if (!l ||
          !['x', 'y', 'w', 'h', 'opacity'].every(
              (k) => Number.isFinite(l[k])) ||
          l.w <= 0 || l.h <= 0 || l.w > 100000 || l.h > 100000 ||
          Math.abs(l.x) > 1e7 || Math.abs(l.y) > 1e7 || !validID(l.id) ||
          typeof l.name !== 'string' || typeof l.visible !== 'boolean' ||
          l.opacity < 0 || l.opacity > 1 ||
          !picQuineConfig.blendModes.includes(l.blend) || ids.has(l.id)) {
        throw Error('Invalid layer data.');
      }
      if (!Number.isInteger(l.rotation) || l.rotation < 0 || l.rotation > 359) {
        throw Error('Invalid layer rotation.');
      }
      if (l.text) {
        validateTextSource(l.text);
      }
      ids.add(l.id);
    }
    if (d.selected !== null && !ids.has(d.selected)) {
      throw Error('Invalid selected layer.');
    }
  }
  function layerSettings(l) {
    const blends = picQuineConfig.blendModes;
    return {
      id: l.id,
      name: l.name,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      opacity: Math.min(1, Math.max(0, l.opacity)),
      visible: !!l.visible,
      blend: blends.includes(l.blend) ? l.blend : 'source-over',
      rotation: (l.rotation || 0) % 360,
      ...(l.text ? {text: validateTextSource(l.text)} : {}),
    };
  }
  return {
    fileStem,
    validID,
    dimensions,
    makeTextSource,
    validateTextSource,
    validateProject,
    layerSettings,
  };
})();
