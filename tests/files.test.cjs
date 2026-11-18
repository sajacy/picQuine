const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const env = {
  Blob,
  URL,
  setTimeout: (fn) => fn(),
  toast() {},
};
vm.createContext(env);
vm.runInContext(fs.readFileSync('files.js', 'utf8'), env);
const picker = vm.runInContext('picQuineFiles', env);
(async () => {
  const calls = [];
  const blob = new Blob(['project'], {type: 'application/zip'});
  let downloads = 0;
  const document = {
    createElement: (tag) => {
      assert.equal(tag, 'a', 'Downloads require an anchor, not a link element');
      return {
        click() {
          downloads++;
        },
      };
    },
  };
  env.document = document;
  env.window = {
    showSaveFilePicker(_) {
      calls.push('choose');
      return Promise.resolve({
        createWritable: async () => ({
          write: async (b) => {
            assert.equal(b, blob);
            calls.push('write');
          },
          close: async () => calls.push('close'),
        }),
      });
    },
  };
  const choice = picker.choose('Project.zip', 'application/zip', 'Project', [
    '.zip',
  ]);
  assert.deepEqual(calls, ['choose']);
  calls.push('encode');
  const destination = await choice;
  await picker.write(blob, 'Project.zip', 'Project', ['.zip'], destination);
  assert.deepEqual(calls, ['choose', 'encode', 'write', 'close']);
  assert.equal(downloads, 0);
  const cancel = picker;
  env.window = {
    showSaveFilePicker: async () => {
      throw Object.assign(Error('cancel'), {name: 'AbortError'});
    },
  };
  assert.equal(
      await cancel.choose('a.zip', 'application/zip', 'Project', ['.zip']),
      null,
  );
  assert.equal(await cancel.write(blob, 'a.zip', 'Project', ['.zip']), false);
  env.window = {};
  const fallback = picker;
  assert.equal(
      await fallback.write(blob, 'Project.zip', 'Project', ['.zip']),
      true,
  );
  assert.equal(downloads, 1);
  let aborted = false;
  const failure = picker;
  await assert.rejects(
      failure.write(blob, 'a.zip', 'Project', ['.zip'], {
        handle: {
          createWritable: async () => ({
            write: async () => {
              throw Error('disk full');
            },
            abort: async () => {
              aborted = true;
            },
          }),
        },
      }),
      /disk full/,
  );
  assert(aborted);
  assert.equal(downloads, 1);
  console.log(
      'PASS: native picker before encoding, cancellation, download fallback, write-error propagation and aborted writes',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
