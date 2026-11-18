'use strict';
// Real file:// update flow, using a separate CORS-enabled URL and actual
// downloads.
const {chromium} = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'tests/artifacts/browser-upgrade');
fs.mkdirSync(out, {recursive: true});
const htmlBase =
    fs.readFileSync(path.join(root, 'dist/Base-Editor.html'), 'utf8');
const heicBundle = JSON.parse(fs.readFileSync(
    path.join(root, 'dist/editor-with-heic.bundle.json'), 'utf8'));
const badBundle = {
  ...heicBundle,
  payload: {...heicBundle.payload, sha256: '0'.repeat(64)},
};
const requests = [];
const errors = [];
const server = http.createServer((request, response) => {
  requests.push({
    method: request.method,
    url: request.url,
    cookie: request.headers.cookie,
  });
  response.writeHead(
      200,
      {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'});
  response.end(
      JSON.stringify(request.url === '/bad.json' ? badBundle : heicBundle));
});
function source(project) {
  return htmlBase.replace(
      /(<script type="application\/json" id="picquine-project">)[\s\S]*?(<\/script>)/,
      (_, start, end) =>
        start + JSON.stringify(project).replace(/</g, '\\u003c') + end);
}
function extract(zip, name) {
  const directory = path.join(out, name);
  fs.rmSync(directory, {recursive: true, force: true});
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, directory]);
  const names = fs.readdirSync(directory);
  assert.equal(names.length, 1);
  return path.join(directory, names[0]);
}
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/heic.json`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const context = await browser.newContext(
      {acceptDownloads: true, viewport: {width: 1440, height: 1000}});
  await context.addInitScript(() => {
    window.showSaveFilePicker = undefined;
  });
  let downloads = 0;
  async function open(file) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', () => downloads++);
    await page.goto(pathToFileURL(file).href);
    return page;
  }
  async function project(page) {
    return page.evaluate(() => picQuineProject.buildData(editor.document));
  }
  async function load(page, address = url) {
    await page.locator('#loadEditor').click();
    await page.locator('#editorURL').fill(address);
    await page.locator('#modalOK').click();
  }
  async function staged(page) {
    await load(page);
    await page.waitForFunction(
        () => document.querySelector('#modalTitle').textContent ===
                'Editor loaded' &&
            document.querySelector('#modal').open);
    await page.locator('#modal').press('Escape');
    assert.equal(
        await page.locator('#modal').evaluate((element) => element.open),
        false);
  }
  async function save(page, choice, filename) {
    const event = page.waitForEvent('download');
    await page.locator('#saveProject').click();
    const options = await page.locator('#saveEditor option').allTextContents();
    if (await page.evaluate(() => !!picQuineRuntime.pending)) {
      assert(options.includes(url));
    }
    await page.locator('#saveEditor').selectOption(choice);
    await page.locator('#modalOK').click();
    const download = await event;
    const file = path.join(out, filename);
    await download.saveAs(file);
    assert.equal(await download.failure(), null);
    return extract(file, filename.replace('.zip', ''));
  }
  try {
    const seed = await open(path.join(root, 'dist/Base-Editor.html'));
    assert.equal(
        await seed.evaluate(() => typeof globalThis.picQuineHEICSource),
        'undefined');
    await seed.locator('#demo').click();
    await seed.waitForFunction(
        () => document.querySelector('#layerCount').textContent === '4 layers');
    const fork = await project(seed);
    fork.future = {preserve: [1, '<fork>']};
    fork.composition.futureComposition = 'keep';
    fork.composition.layers[0].futureLayer = {keep: true};
    fork.extensions = {
      'io.github.fork.print': {
        version: 1,
        required: false,
        assetRefs: ['preset'],
        data: {preset: 'preset', bleed: 3},
      },
    };
    fork.assets.preset = {
      name: 'preset.json',
      type: 'application/json',
      base64: Buffer.from('{"mode":"print"}').toString('base64'),
      futureAsset: 'keep',
    };
    const initialFile = path.join(out, 'fork-base.html');
    fs.writeFileSync(initialFile, source(fork));
    const base = await open(initialFile);
    await base.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.deepEqual(await project(base), fork);
    await staged(base);
    assert.equal(requests.length, 1);
    assert.equal(downloads, 0, 'Dismissing the prompt must not force a save');
    assert.equal(
        await base.evaluate(() => picQuineRuntime.info.editor.profile),
        'base-editor');
    assert.equal(
        await base.evaluate(() => typeof globalThis.picQuineHEICSource),
        'undefined', 'Downloaded code did not execute');
    const currentHTML = await save(base, 'current', 'current.zip');
    const current = await open(currentHTML);
    await current.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.equal(
        await current.evaluate(() => picQuineRuntime.info.editor.profile),
        'base-editor');
    assert.deepEqual(await project(current), fork);
    const upgradedHTML = await save(base, 'loaded', 'upgraded.zip');
    const upgraded = await open(upgradedHTML);
    await upgraded.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.equal(
        await upgraded.evaluate(() => picQuineRuntime.info.editor.profile),
        'editor-with-heic');
    assert.deepEqual(await project(upgraded), fork);
    assert.equal(
        requests.length, 1, 'Saving and reopening use no additional requests');
    // Bad payload must not replace an already staged, valid URL/template.
    await load(base, url.replace('heic.json', 'bad.json'));
    await base.waitForFunction(
        () => document.querySelector('#toast').textContent.includes(
            'SHA-256 mismatch'));
    assert.equal(await base.evaluate(() => picQuineRuntime.pending.url), url);
    assert.deepEqual(await project(base), fork);
    // Open the staged code directly through a Blob URL, without saving first.
    await load(base);
    await base.waitForFunction(
        () => document.querySelector('#modalTitle').textContent ===
                'Editor loaded' &&
            document.querySelector('#modal').open);
    const popupEvent = base.waitForEvent('popup');
    await base.locator('#modalOK').click();
    const switched = await popupEvent;
    switched.on('pageerror', (error) => errors.push(error.message));
    await switched.waitForFunction(
        () => document.querySelector('#status')?.textContent.startsWith(
            'Project opened.'));
    assert(switched.url().startsWith('blob:'));
    assert.equal(
        await switched.evaluate(() => picQuineRuntime.info.editor.profile),
        'editor-with-heic');
    assert.equal(await switched.evaluate(() => window.opener), null);
    assert.deepEqual(await project(switched), fork);
    assert.equal(
        await switched.evaluate(() => composite(makeCanvas(1, 1)).toDataURL()),
        await base.evaluate(() => composite(makeCanvas(1, 1)).toDataURL()),
        'Rendered pixels survive the switch');
    assert.equal(
        await base.evaluate(() => picQuineRuntime.info.editor.profile),
        'base-editor');
    const switchedHTML = await save(switched, 'current', 'blob-upgrade.zip');
    const savedCode = fs.readFileSync(switchedHTML, 'utf8');
    assert(
        savedCode.includes('picQuineHEICSource'),
        'Saved HTML includes the new decoder code');
    const reopened = await open(switchedHTML);
    await reopened.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.equal(
        await reopened.evaluate(() => picQuineRuntime.info.editor.build),
        heicBundle.editor.build);
    assert.deepEqual(await project(reopened), fork);
    await staged(
        switched); // Opaque Blob origins still verify and load another bundle.
    // Newly installed HEIC capability works offline and keeps every old asset.
    const picker = switched.waitForEvent('filechooser');
    await switched.locator('#importLayer').click();
    await (await picker).setFiles(path.join(root, 'tests/orange.heic'));
    await switched.waitForFunction(
        () => document.querySelector('#layerCount').textContent === '5 layers');
    const withHEIC = await project(switched);
    const heicID = withHEIC.composition.layers.at(-1).content;
    assert.equal(
        withHEIC.assets[heicID].extensions['org.picquine.heic'].required, true);
    assert.deepEqual(
        Buffer.from(withHEIC.assets[heicID].base64, 'base64'),
        fs.readFileSync(path.join(root, 'tests/orange.heic')));
    for (const [id, asset] of Object.entries(fork.assets)) {
      assert.deepEqual(withHEIC.assets[id], asset);
    }
    assert.deepEqual(withHEIC.extensions, fork.extensions);
    // A base editor can upgrade an untouched HEIC-required project without
    // decoding it.
    const requiredFile = path.join(out, 'required-base.html');
    fs.writeFileSync(requiredFile, source(withHEIC));
    const readonly = await open(requiredFile);
    await readonly.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Read-only:'));
    assert.equal(await readonly.evaluate(() => editor.document.readOnly), true);
    assert.deepEqual(await project(readonly), withHEIC);
    await staged(readonly);
    await readonly.locator('#saveProject').click();
    assert.equal(
        await readonly.locator('#saveEditor option[value="current"]')
            .isDisabled(),
        true);
    await readonly.locator('#modal button[value="cancel"]').last().click();
    const recoveredHTML =
        await save(readonly, 'loaded', 'required-upgrade.zip');
    const recovered = await open(recoveredHTML);
    await recovered.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.deepEqual(await project(recovered), withHEIC);
    assert.equal(
        await recovered.evaluate(() => editor.document.readOnly), false);
    assert.equal(requests.length, 5);
    assert(requests.every(
        (request) => request.method === 'GET' && !request.cookie));
    assert.deepEqual(errors, []);
    await recovered.screenshot({path: path.join(out, 'upgraded-heic.png')});
    const report = {
      chrome: browser.version(),
      url,
      requests,
      downloads,
      errors,
      profile:
          await recovered.evaluate(() => picQuineRuntime.info.editor.profile),
      svgSHA256:
          Object.values(fork.assets)
              .filter((asset) => asset.type === 'image/svg+xml')
              .map(
                  (asset) => createHash('sha256')
                      .update(Buffer.from(asset.base64, 'base64'))
                      .digest('hex')),
      checks: [
        'arbitrary CORS URL from file://',
        'one GET per Load',
        'no live code execution',
        'dismissible prompt',
        'current/URL dropdown',
        'fork and asset preservation',
        'bad digest preserves staged bundle',
        'offline HEIC after upgrade',
        'read-only upgrade-only save',
        'Blob window switch and new-code save/reopen',
      ],
    };
    fs.writeFileSync(
        path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
        'PASS: Blob new-window upgrade, exact composition/SVG/fork preservation, new-code save/extract/reopen, subsequent bundle loading and HEIC editing, save choices and read-only recovery');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
