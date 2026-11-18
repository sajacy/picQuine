'use strict';
/**
 * Request a native destination during the user's click, before
 * encoding/compression.
 */
const picQuineFiles = (() => {
  async function choose(name, type, description, extensions) {
    if (!window.showSaveFilePicker) {
      return {download: true};
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{description, accept: {[type]: extensions}}],
      });
      return {handle};
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      }
      toast('File picker unavailable; downloading instead.');
      return {download: true};
    }
  }
  async function write(blob, name, description, extensions, destination) {
    const target =
        destination || (await choose(name, blob.type, description, extensions));
    if (!target) {
      return false;
    }
    if (target.handle) {
      const writable = await target.handle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
      }
      return true;
    }
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = name;
    link.click();
    // Let the browser begin the download before releasing its Blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }
  return {choose, write};
})();
