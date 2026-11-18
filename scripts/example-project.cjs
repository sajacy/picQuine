'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));

const env = {
  Response,
  btoa,
  Blob,
  File,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
  atob,
};
vm.createContext(env);
for (const file
  of ['config.js', 'json.js', 'archive.js', 'geometry.js', 'document.js',
    'standalone.js', 'project.js', 'runtime.js', 'demo.js']) {
  vm.runInContext(fs.readFileSync(path.join('src', file), 'utf8'), env);
}
const html = fs.readFileSync('dist/Editor-With-HEIC.html', 'utf8')
    .replace(/^<!doctype html>\s*/i, '');
env.document = {
  documentElement: {
    cloneNode: () => ({
      outerHTML: html,
      querySelector: (selector) => selector === '#picquine-project' ?
          {textContent: 'null'} :
          selector === '#picquine-editor-info' ? {
            textContent:
                /<script type="application\/json" id="picquine-editor-info">([\s\S]*?)<\/script>/
                    .exec(html)[1],
          } :
                                                 null,
    }),
  },
};
vm.runInContext('picQuineRuntime.capture()', env);
(async () => {
  let id = 0;
  env.uid = () => `sample-${++id}`;
  env.assets = {
    decode: async (file) => {
      const svg = await file.text();
      return {
        width: +/width="(\d+)"/.exec(svg)[1],
        height: +/height="(\d+)"/.exec(svg)[1],
      };
    },
  };
  env.picQuineImages = {imageMime: () => 'image/svg+xml'};
  const project = await vm.runInContext('picQuineDemo', env).create();
  const io = vm.runInContext('picQuineProject', env);
  const saved = await io.buildProject(project);
  fs.writeFileSync(
      'dist/PicQuine-Example.zip', Buffer.from(await saved.arrayBuffer()));
  fs.writeFileSync(
      'dist/PicQuine-Example.html',
      await (await vm.runInContext('picQuineArchive', env).open(saved))
          .blob.text());
  console.log(`Created SVG demo project (${saved.size} compressed bytes)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
