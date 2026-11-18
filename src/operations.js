'use strict';
/** Single owner for asynchronous I/O and read-only proof mode. */
const picQuineOperations = {
  create(onChange = () => {}) {
    let owner = null;
    return {
      get state() {
        return owner?.name || 'idle';
      },
      get busy() {
        return !!owner && owner.name !== 'proof';
      },
      canEdit(token) {
        return !owner ||
            (token === owner && owner.name !== 'proof' && !owner.previous);
      },
      acquire(name) {
        // Export temporarily owns a completed proof without exiting preview.
        if (owner && !(owner.name === 'proof' && name === 'export')) {
          return null;
        }
        owner = Object.freeze({name, previous: owner});
        onChange();
        return owner;
      },
      release(token) {
        if (owner && owner === token) {
          owner = owner.previous;
          onChange();
        }
      },
    };
  },
};
