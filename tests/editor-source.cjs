// Minimal DOM snapshot for VM tests of the actual built editor's self-copying
// source.
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(
    path.join(__dirname, '../dist/Editor-With-HEIC.html'), 'utf8');
const heicSource =
    JSON.parse(/globalThis\.picQuineHEICSource=("[^"]+");/.exec(html)[1]);
const info =
    /<script type="application\/json" id="picquine-editor-info">([\s\S]*?)<\/script>/
        .exec(html)[1];
const root = () => ({
  outerHTML: html.replace(/^<!doctype html>\s*/i, ''),
  querySelector: (selector) => selector === '#picquine-project' ?
      {textContent: 'null'} :
      selector === '#picquine-editor-info' ? {textContent: info} :
                                             null,
});
module.exports = {
  root,
  heicSource,
  info,
};
