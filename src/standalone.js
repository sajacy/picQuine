'use strict';
const picQuineStandalone = (() => {
  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      chunks.push(
          String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(''));
  }
  function fromBase64(value) {
    if (typeof value !== 'string' ||
        value.length > Math.ceil(picQuineConfig.limits.assetBytes / 3) * 4 ||
        value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw Error('Invalid Base64 asset.');
    }
    const chunks = [];
    for (let offset = 0; offset < value.length; offset += 65536) {
      const part = value.slice(offset, offset + 65536);
      const raw = atob(part);
      if (btoa(raw) !== part) {
        throw Error('Noncanonical Base64 asset.');
      }
      chunks.push(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
    }
    return new Blob(chunks);
  }
  async function readText(stream, limit = picQuineConfig.limits.htmlBytes) {
    const reader = stream.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > limit) {
          throw Error('Input exceeds the size limit.');
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    // Preserve a BOM as text so bundle hashes cover the exact UTF-8 payload.
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})
        .decode(await new Blob(chunks).arrayBuffer());
  }
  function extract(html) {
    const matches = [
      ...html.matchAll(
          /<script\b(?=[^>]*\bid="picquine-project")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script\s*>/gi),
    ];
    if (matches.length !== 1) {
      throw Error('Open a PicQuine project HTML or single-HTML ZIP file.');
    }
    return picQuineJSON.parse(matches[0][1]);
  }
  async function encode(project, choice) {
    const html = picQuineRuntime.render(project, choice);
    const blob = new Blob([html], {type: 'text/html'});
    if (blob.size > picQuineConfig.limits.htmlBytes) {
      throw Error('Project HTML exceeds the size limit.');
    }
    return picQuineArchive.pack(
        picQuineDocument.fileStem(project.composition.name) + '.html', blob);
  }
  return {
    base64,
    fromBase64,
    readText,
    extract,
    encode,
    readHTML: (blob) => readText(blob.stream()),
    restore: (project) => picQuineProject.restore(project),
  };
})();
