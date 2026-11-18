const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const env = {};
vm.createContext(env);
for (const file of ['config.js', 'history.js', 'operations.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env);
}
const makeStore = vm.runInContext('picQuineHistory.create', env);
const makeOperations = vm.runInContext('picQuineOperations.create', env);
const document = () => ({
  w: 10,
  h: 10,
  name: 'Initial',
  selected: null,
  layers: [],
});
const store = makeStore(document());
store.transact('Rename', (doc) => (doc.name = 'Saved'));
store.markSaved();
assert.equal(store.dirty, false);
store.undo();
assert.equal(store.dirty, true);
store.redo();
assert.equal(store.dirty, false);
store.undo();
store.transact('Branch', (doc) => (doc.name = 'New branch'));
assert.equal(store.dirty, true);
assert.equal(store.future.length, 0);
const revision = store.revision;
const count = store.past.length;
store.transact('No change', () => {});
assert.equal(store.revision, revision);
assert.equal(store.past.length, count);
store.begin('Gesture');
store.document.name = 'Draft';
store.document.name = 'Finished';
store.commit();
assert.equal(store.past.length, count + 1);
store.undo();
assert.equal(store.document.name, 'New branch');
assert.throws(
    () => store.transact(
        'Fail',
        (doc) => {
          doc.name = 'Wrong';
          throw Error('cancel');
        }),
    /cancel/,
);
assert.equal(store.document.name, 'New branch');
const ops = makeOperations();
const locked = makeStore(document(), {canEdit: (token) => ops.canEdit(token)});
const token = ops.acquire('import');
assert.equal(ops.acquire('save'), null);
assert.equal(
    locked.transact('Blocked', (doc) => (doc.name = 'bad')),
    false,
);
assert.equal(locked.document.name, 'Initial');
locked.transact('Owned', (doc) => (doc.name = 'Imported'), token);
ops.release({});
assert.equal(ops.state, 'import');
ops.release(token);
assert.equal(ops.state, 'idle');
const proof = ops.acquire('proof');
assert.equal(
    locked.transact('No proof edits', (doc) => (doc.name = 'bad'), proof),
    false,
);
ops.release(proof);
// Count unique retained resources, not duplicate layers or metadata-only
// snapshots.
const initial = document();
const a = {
  width: 10,
  height: 10,
};
initial.layers = [
  {id: 'a', canvas: a},
  {id: 'b', canvas: a},
];
const memory = makeStore(initial, {maxBytes: 800, maxEntries: 100});
for (let i = 0; i < 10; i++) {
  memory.transact('Metadata', (doc) => (doc.name = 'Name ' + i));
}
assert.equal(memory.stats.retainedBytes, 0);
for (let i = 0; i < 6; i++) {
  memory.transact('Pixel copy', (doc) => {
    doc.layers[0].canvas = {width: 10, height: 10};
  });
}
assert(memory.stats.retainedBytes <= 800);
assert(memory.past.length < 16);
assert(memory.document.layers[0].canvas);
assert(memory.undo());
assert(memory.stats.retainedBytes <= 800);
const selectedStore = makeStore({
  ...document(),
  layers: [
    {id: 'a', canvas: a},
    {id: 'b', canvas: a},
  ],
});
selectedStore.transact('Selection', (doc) => (doc.selected = 'b'));
assert.equal(selectedStore.past.length, 0);
console.log(
    'PASS: saved-revision dirty tracking, no-op/gesture transactions, rollback, operation ownership, proof lock, shared-resource memory budget and history eviction',
);

// Export borrows proof ownership without making the composition editable.
const proofOwner = ops.acquire('proof');
const exportOwner = ops.acquire('export');
assert.equal(ops.state, 'export');
assert.equal(ops.canEdit(exportOwner), false);
assert.equal(ops.acquire('export'), null);
ops.release(exportOwner);
assert.equal(ops.state, 'proof');
ops.release(proofOwner);
assert.equal(ops.state, 'idle');
