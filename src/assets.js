'use strict';
/**
 * Asset identity is separate from layer transforms. Caches never own source
 * canvases.
 */
const picQuineAssets = (() => {
  const decoded = new WeakMap();
  const pngs = new WeakMap();
  const thumbs = new WeakMap();
  const revisions = new WeakMap();
  const encodedLRU = new Map();
  const limit = 16 * 1024 * 1024;
  let encodedBytes = 0;
  function decodeOnce(file) {
    const cached = decoded.get(file);
    const live = cached?.weak?.deref();
    if (live) {
      return Promise.resolve(live);
    }
    if (cached?.pending) {
      return cached.pending;
    }
    const pending = Promise.resolve().then(() => picQuineImages.decode(file));
    decoded.set(file, {pending});
    pending.then(
        (canvas) => {
          if (typeof WeakRef !== 'undefined') {
            decoded.set(file, {weak: new WeakRef(canvas)});
          } else {
            decoded.delete(file);
          }
          // The source PNG is already encoded and immutable; do not encode it
          // again.
          if (file.type === 'image/png' && file.size <= limit) {
            const entry = {
              valid: true,
              promise: Promise.resolve(file),
              bytes: file.size,
            };
            while (encodedBytes + entry.bytes > limit) {
              const [old, size] = encodedLRU.entries().next().value;
              old.valid = false;
              old.promise = null;
              encodedBytes -= size;
              encodedLRU.delete(old);
            }
            pngs.set(canvas, entry);
            encodedLRU.set(entry, entry.bytes);
            encodedBytes += entry.bytes;
          }
        },
        () => decoded.delete(file),
    );
    return pending;
  }
  function png(canvas) {
    let entry = pngs.get(canvas);
    if (entry?.valid) {
      if (encodedLRU.has(entry)) {
        encodedLRU.delete(entry);
        encodedLRU.set(entry, entry.bytes);
      }
      return entry.promise;
    }
    entry = {valid: true, bytes: 0, promise: null};
    entry.promise =
        Promise.resolve().then(() => picQuineImages.canvasPNG(canvas));
    pngs.set(canvas, entry);
    entry.promise.then(
        (blob) => {
          if (!entry.valid) {
            return;
          }
          entry.bytes = blob.size;
          if (blob.size > limit) {
            entry.valid = false;
            entry.promise = null;
            return;
          }
          while (encodedBytes + blob.size > limit) {
            const [old, size] = encodedLRU.entries().next().value;
            old.valid = false;
            old.promise = null;
            encodedBytes -= size;
            encodedLRU.delete(old);
          }
          encodedLRU.set(entry, blob.size);
          encodedBytes += blob.size;
        },
        () => {
          entry.valid = false;
        },
    );
    return entry.promise;
  }
  function thumbnail(canvas) {
    if (!thumbs.has(canvas)) {
      const thumb = makeCanvas(76, 64);
      const scale = Math.min(76 / canvas.width, 64 / canvas.height);
      thumb.getContext('2d').drawImage(
          canvas,
          (76 - canvas.width * scale) / 2,
          (64 - canvas.height * scale) / 2,
          canvas.width * scale,
          canvas.height * scale,
      );
      thumbs.set(canvas, thumb);
    }
    return thumbs.get(canvas);
  }
  function invalidate(canvas) {
    const entry = pngs.get(canvas);
    if (entry) {
      entry.valid = false;
      entry.promise = null;
      if (encodedLRU.delete(entry)) {
        encodedBytes -= entry.bytes;
      }
      pngs.delete(canvas);
    }
    thumbs.delete(canvas);
    revisions.set(canvas, (revisions.get(canvas) || 0) + 1);
  }
  return {
    decode: decodeOnce,
    png,
    thumbnail,
    invalidate,
    revision: (canvas) => revisions.get(canvas) || 0,
  };
})();
