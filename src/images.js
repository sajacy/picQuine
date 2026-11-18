'use strict';
const picQuineImages = (() => {
  let decoder;
  let sequence = 0;
  const requests = new Map();
  const {dimensions} = picQuineDocument;
  function loadDecoder() {
    if (decoder) {
      return decoder;
    }
    // Share startup across imports; a failed worker clears the cached promise.
    decoder = (async () => {
      if (typeof globalThis.picQuineHEICSource !== 'string') {
        throw Error('The embedded HEIC decoder is missing.');
      }
      const raw = atob(globalThis.picQuineHEICSource);
      const chunks = [];
      for (let offset = 0; offset < raw.length; offset += 65536) {
        chunks.push(Uint8Array.from(
            raw.slice(offset, offset + 65536),
            (char) => char.charCodeAt(0)));
      }
      const stream = new Blob(chunks).stream().pipeThrough(
          new DecompressionStream('gzip'));
      const url = URL.createObjectURL(new Blob(
          [await new Response(stream).blob()],
          {type: 'application/javascript'}));
      let worker;
      try {
        worker = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      return new Promise((resolve, reject) => {
        const fail = (error) => {
          worker.terminate();
          decoder = null;
          for (const request of requests.values()) {
            request.reject(error);
          }
          requests.clear();
          reject(error);
        };
        worker.onmessage = ({data}) => {
          if (data.ready) {
            return resolve(worker);
          }
          if (data.id === undefined) {
            return fail(
                Error(data.error || 'HEIC decoder could not start.'));
          }
          const request = requests.get(data.id);
          if (!request) {
            return;
          }
          requests.delete(data.id);
          if (data.error) {
            request.reject(Error(data.error));
          } else {
            request.resolve(data);
          }
        };
        worker.onerror = () =>
          fail(Error('The local HEIC decoder failed.'));
      });
    })().catch((error) => {
      decoder = null;
      throw error;
    });
    return decoder;
  }
  async function decodeHEIC(file) {
    const worker = await loadDecoder();
    const buffer = await file.arrayBuffer();
    const id = ++sequence;
    const result = await new Promise((resolve, reject) => {
      requests.set(id, {resolve, reject});
      try {
        worker.postMessage({id, buffer}, [buffer]);
      } catch (error) {
        requests.delete(id);
        reject(error);
      }
    });
    const pixels = makeCanvas(result.width, result.height);
    pixels.getContext('2d').putImageData(
        new ImageData(
            new Uint8ClampedArray(result.pixels), result.width, result.height),
        0, 0);
    return pixels;
  }
  async function imageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(Error('This file could not be decoded.'));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function decode(file) {
    let blob = file;
    if (/\.hei[cf]$/i.test(file.name) || /heic|heif/.test(file.type)) {
      status('Decoding HEIC locally…');
      return decodeHEIC(file);
    }
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
      const doc = new DOMParser().parseFromString(
          await file.text(),
          'image/svg+xml',
      );
      if (doc.querySelector('parsererror') ||
          doc.documentElement.localName !== 'svg') {
        throw Error('Invalid SVG file.');
      }
      doc.querySelectorAll(
          'script,foreignObject,style,animate,animateTransform,set',
      )
          .forEach((n) => n.remove());
      for (const n of [doc.documentElement, ...doc.querySelectorAll('*')]) {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name) || /url\s*\(/i.test(a.value) ||
              (/(?:href|src)$/i.test(a.name) && !a.value.startsWith('#'))) {
            n.removeAttribute(a.name);
          }
        }
      }
      const root = doc.documentElement;
      const v =
          root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      if (!root.getAttribute('width')) {
        root.setAttribute('width', v?.[2] || 1200);
      }
      if (!root.getAttribute('height')) {
        root.setAttribute('height', v?.[3] || 800);
      }
      blob = new Blob([new XMLSerializer().serializeToString(doc)], {
        type: 'image/svg+xml',
      });
    }
    const image = await imageFromBlob(blob);
    if (!dimensions(image.naturalWidth, image.naturalHeight)) {
      throw Error('Image exceeds the 40 megapixel or 16,384 px limit.');
    }
    const pixels = makeCanvas(image.naturalWidth, image.naturalHeight);
    pixels.getContext('2d').drawImage(image, 0, 0);
    return pixels;
  }
  function imageMime(name) {
    const ext = name.split('.').pop().toLowerCase();
    return (
      {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        svg: 'image/svg+xml',
        heic: 'image/heic',
        heif: 'image/heif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        avif: 'image/avif',
      }[ext] ||
        'application/octet-stream');
  }
  function canvasPNG(pixels) {
    return new Promise(
        (resolve, reject) => pixels.toBlob(
            (blob) => blob ? resolve(blob) :
                             reject(Error('Could not encode layer PNG.')),
            'image/png',
        ),
    );
  }
  return {loadDecoder, decode, imageMime, canvasPNG};
})();
