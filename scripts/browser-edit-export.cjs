'use strict';
// Real editing, filtered exports, and persistence through the built HTML.
const {chromium} = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tests/artifacts/edit-export');
fs.mkdirSync(output, {recursive: true});
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext({acceptDownloads: true});
  await context.addInitScript(() => {
    window.showSaveFilePicker = undefined;
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  async function project() {
    return page.evaluate(() => picQuineProject.buildData(editor.document));
  }
  async function download(action, name) {
    const pending = page.waitForEvent('download');
    await action();
    const file = path.join(output, name);
    await (await pending).saveAs(file);
    return file;
  }
  async function exportImage(filter) {
    await page.locator('#export').click();
    assert.deepEqual(
        await page.locator('#exportResampling option').allTextContents(),
        ['None', 'Bicubic (graphics)', 'Lanczos (photos)']);
    await page.locator('#exportResampling').selectOption(filter);
    const file =
        await download(() => page.locator('#modalOK').click(), filter + '.png');
    await page.waitForFunction(
        () => document.querySelector('#status').textContent ===
            'Image exported.');
    return fs.readFileSync(file);
  }
  try {
    await page.goto(
        pathToFileURL(path.join(root, 'dist/Editor-With-HEIC.html')).href);
    await page.locator('#demo').click();
    await page.waitForFunction(
        () =>
          editor.document.layers.length === 4 && operations.state === 'idle');
    const initial = await project();
    // The demo's text also has an original SVG: edits must keep that
    // provenance.
    await page.locator('#editLayer').click();
    assert.equal(
        await page.locator('#textContent').inputValue(),
        initial.composition.layers[3].text.content);
    await page.locator('#textContent').fill('Edited text\nSecond line');
    await page.locator('#textFont').selectOption('Courier New');
    await page.locator('#textSize').fill('35');
    await page.locator('#textColor').fill('#123abc');
    await page.locator('#modalOK').click();
    await page.waitForFunction(() => operations.state === 'idle');
    const edited = await project();
    const text = edited.composition.layers[3];
    assert.equal(text.text.content, 'Edited text\nSecond line');
    assert.equal(text.text.runs.length, 2);
    assert(text.text.runs.every(
        (run) => run.fontFamily === 'Courier New' && run.fontSize === 35 &&
            run.color === '#123abc'));
    assert.equal(edited.assets[text.content].type, 'image/png');
    assert.deepEqual(
        edited.assets[text.original],
        initial.assets[initial.composition.layers[3].original]);
    await page.locator('#undo').click();
    assert.deepEqual(await project(), initial);
    await page.locator('#redo').click();
    assert.deepEqual(await project(), edited);
    await page.locator('#editLayer').click();
    await page.locator('#modal').press('Escape');
    assert.deepEqual(await project(), edited);
    // SVG input is edited as markup and saved exactly, not substituted with
    // PNG.
    await page.evaluate(() => {
      editor.document.selected = editor.document.layers[1].id;
      properties();
    });
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#ff0000"/><path d="M0 0 L240 240" stroke="white" stroke-width="3"/></svg>';
    await page.locator('#editLayer').click();
    assert((await page.locator('#svgContent').inputValue()).includes('<svg'));
    await page.locator('#svgContent').fill(svg);
    await page.locator('#modalOK').click();
    await page.waitForFunction(() => operations.state === 'idle');
    const changed = await project();
    const vector = changed.composition.layers[1];
    assert.equal(changed.assets[vector.content].type, 'image/svg+xml');
    assert.equal(
        Buffer.from(changed.assets[vector.content].base64, 'base64').toString(),
        svg);
    assert.equal(vector.content, vector.original);
    assert.equal(vector.w, 240);
    const pixels = await page.evaluate(
        () => selected()
            .canvas.getContext('2d')
            .getImageData(120, 120, 1, 1)
            .data[0]);
    assert.equal(pixels, 255);
    await page.locator('#editLayer').click();
    await page.locator('#svgContent').fill('<not-an-svg>');
    await page.locator('#modalOK').click();
    await page.waitForFunction(() => operations.state === 'idle');
    assert.deepEqual(await project(), changed);
    // Scaling a sharp source makes the explicit filters distinguishable.
    await page.locator('#layerWidth').fill('137');
    await page.locator('#layerWidth').press('Tab');
    await page.locator('#layerHeight').fill('131');
    await page.locator('#layerHeight').press('Tab');
    const none = await exportImage('none');
    const cubic = await exportImage('bicubic');
    const lanczos = await exportImage('lanczos');
    assert(!none.equals(cubic));
    assert(!cubic.equals(lanczos));
    // A preview export with the same filter must exactly match edit-mode
    // export.
    await page.locator('#preview').click();
    await page.waitForFunction(() => proof.ready);
    assert(cubic.equals(await exportImage('bicubic')));
    assert(lanczos.equals(await exportImage('lanczos')));
    assert.equal(
        await page.evaluate(() => proof.active && operations.state === 'proof'),
        true);
    await page.locator('#preview').click();
    const beforeSave = await project();
    await page.locator('#saveProject').click();
    const zip =
        await download(() => page.locator('#modalOK').click(), 'edited.zip');
    const directory = path.join(output, 'extracted');
    fs.rmSync(directory, {recursive: true, force: true});
    execFileSync('/usr/bin/ditto', ['-x', '-k', zip, directory]);
    await page.goto(
        pathToFileURL(path.join(directory, fs.readdirSync(directory)[0])).href);
    await page.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.deepEqual(await project(), beforeSave);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: editable text/SVG specs, exact markup and original provenance, undo/cancel/invalid rollback, three export filters, preview parity, ZIP reopen');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
