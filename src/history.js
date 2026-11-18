'use strict';
/**
 * Document transactions. Source canvases and blobs are immutable between
 * edits.
 */
const picQuineHistory = (() => {
  function clone(document) {
    return {
      ...document,
      layers: document.layers.map((layer) => ({...layer})),
    };
  }
  function create(
      initial,
      {
        canEdit = () => true,
        onChange = () => {},
        maxBytes = picQuineConfig.limits.historyBytes,
        maxEntries = picQuineConfig.limits.historyEntries,
      } = {},
  ) {
    let document = initial;
    let revision = 0;
    let sequence = 0;
    let savedRevision = 0;
    let pending = null;
    const past = [];
    const future = [];
    function snapshot() {
      return {document: clone(document), revision};
    }
    function resources(doc, set) {
      for (const layer of doc.layers) {
        if (layer.canvas) {
          set.set(layer.canvas, layer.canvas.width * layer.canvas.height * 4);
        }
        if (layer.original?.blob) {
          set.set(layer.original.blob, layer.original.blob.size);
        }
      }
    }
    function retainedBytes() {
      const live = new Map();
      const retained = new Map();
      // History pays only for resources not already owned by the live document.
      resources(document, live);
      for (const entry of [...past, ...future]) {
        resources(entry.document, retained);
      }
      let bytes = 0;
      for (const [resource, size] of retained) {
        if (!live.has(resource)) {
          bytes += size;
        }
      }
      return bytes;
    }
    function trim(reserve = 0) {
      while (past.length + future.length > maxEntries ||
             retainedBytes() + reserve > maxBytes) {
        if (past.length) {
          past.shift();
        } else if (future.length) {
          future.shift();
        } else {
          break;
        }
      }
    }
    function changed(before, after) {
      if (before.w !== after.w || before.h !== after.h ||
          before.name !== after.name ||
          before.layers.length !== after.layers.length) {
        return true;
      }
      return before.layers.some((layer, i) => {
        const other = after.layers[i];
        return (
          Object.keys(layer).some((key) => layer[key] !== other[key]) ||
            Object.keys(other).some((key) => layer[key] !== other[key]));
      });
    }
    function commit() {
      if (!pending) {
        return false;
      }
      const entry = pending;
      pending = null;
      if (!changed(entry.document, document)) {
        onChange();
        return false;
      }
      past.push(entry);
      future.length = 0;
      revision = ++sequence;
      trim();
      onChange();
      return true;
    }
    function begin(label = 'Edit', token) {
      if (!canEdit(token)) {
        return false;
      }
      if (!pending) {
        pending = {...snapshot(), label};
      }
      return true;
    }
    function cancel() {
      if (!pending) {
        return;
      }
      document = pending.document;
      revision = pending.revision;
      pending = null;
      onChange();
    }
    function transact(label, mutation, token) {
      if (!canEdit(token)) {
        return false;
      }
      commit();
      begin(label, token);
      try {
        mutation(document);
        return commit();
      } catch (error) {
        cancel();
        throw error;
      }
    }
    function undo() {
      if (!canEdit()) {
        return false;
      }
      commit();
      if (!past.length) {
        return false;
      }
      future.push(snapshot());
      const previous = past.pop();
      document = previous.document;
      revision = previous.revision;
      trim();
      onChange();
      return true;
    }
    function redo() {
      if (!canEdit()) {
        return false;
      }
      commit();
      if (!future.length) {
        return false;
      }
      past.push(snapshot());
      const next = future.pop();
      document = next.document;
      revision = next.revision;
      trim();
      onChange();
      return true;
    }
    return {
      get document() {
        return document;
      },
      set document(next) {
        if (!pending) {
          throw Error('Replace documents inside a transaction.');
        }
        document = next;
      },
      get past() {
        return past;
      },
      get future() {
        return future;
      },
      get revision() {
        return revision;
      },
      get dirty() {
        return (
          revision !== savedRevision ||
            (!!pending && changed(pending.document, document)));
      },
      get active() {
        return !!pending;
      },
      get stats() {
        return {
          retainedBytes: retainedBytes(),
          maxBytes,
          entries: past.length + future.length,
        };
      },
      snapshot: () => clone(document),
      begin,
      commit,
      cancel,
      transact,
      undo,
      redo,
      markSaved(at = revision) {
        savedRevision = at;
        onChange();
      },
      reservePixelEdit(canvas) {
        trim(canvas.width * canvas.height * 4);
      },
    };
  }
  return {create, clone};
})();
