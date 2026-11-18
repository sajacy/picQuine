'use strict';
// Developer-only real Chrome check. Requires playwright-core; never shipped to
// users.
const {chromium} = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'tests/artifacts/browser-roundtrip');
const startURL = process.env.PICQUINE_TEST_URL ||
    'http://127.0.0.1:5173/dist/Editor-With-HEIC.html';
const executablePath = process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const digest = (value) => createHash('sha256').update(value).digest('hex');
fs.mkdirSync(artifacts, {recursive: true});
(async () => {
  const browser = await chromium.launch({executablePath, headless: true});
  const context = await browser.newContext(
      {acceptDownloads: true, viewport: {width: 1440, height: 1000}});
  // Exercise the actual download fallback rather than an OS-specific Save As
  // dialog.
  await context.addInitScript(() => {
    window.showSaveFilePicker = undefined;
  });
  const errors = [];
  const requests = [];
  const browserNotes = [];
  async function open(url) {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }
      const url = message.location().url;
      if (url.endsWith('/favicon.ico')) {
        browserNotes.push({url, message: message.text()});
      } else {
        errors.push(message.text());
      }
    });
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(url);
    return page;
  }
  async function snapshot(page) {
    const project =
        await page.evaluate(() => picQuineProject.buildData(editor.document));
    const pixels = await page.evaluate(
        () => document.querySelector('#canvas').toDataURL('image/png'));
    return {project, canvasSHA256: digest(pixels)};
  }
  async function save(page, name) {
    const pending = page.waitForEvent('download', {timeout: 30000});
    await page.locator('#saveProject').click();
    await page.locator('#modalOK').click();
    const download = await pending;
    assert(download.suggestedFilename().endsWith('.zip'));
    const destination = path.join(artifacts, name);
    await download.saveAs(destination);
    assert.equal(await download.failure(), null);
    await page.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project saved.'));
    return destination;
  }
  function extract(zip, directory) {
    const target = path.join(artifacts, directory);
    fs.rmSync(target, {recursive: true, force: true});
    // Validate the standard ZIP independently, then extract it with the host
    // OS.
    const entry =
        execFileSync(
            'python3',
            [
              '-c',
              'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; names=z.namelist(); assert len(names)==1 and names[0].endswith(\'.html\'); print(names[0])',
              zip,
            ],
            {encoding: 'utf8'})
            .trim();
    execFileSync('/usr/bin/ditto', ['-x', '-k', zip, target]);
    return path.join(target, entry);
  }
  function embedded(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(!/<script\b[^>]*\bsrc=|<link\b[^>]*\bhref=/i.test(html));
    const match =
        /<script type="application\/json" id="picquine-project">([\s\S]*?)<\/script>/
            .exec(html);
    assert(match, 'The saved HTML contains its project JSON');
    return JSON.parse(match[1]);
  }
  try {
    const source = await open(startURL);
    await source.locator('#demo').click();
    await source.waitForFunction(
        () => document.querySelector('#status').textContent ===
            'SVG sample loaded');
    const demoSnapshot = await snapshot(source);
    await source.locator('#docName').fill('SVG round trip');
    await source.locator('#docName').press('Tab');
    await source.locator('#posX').fill('410');
    await source.locator('#posX').press('Tab');
    await source.locator('#layerSizeUnit').selectOption('percent');
    await source.locator('#layerRatio').check();
    await source.locator('#layerWidth').fill('95');
    await source.locator('#layerWidth').press('Tab');
    await source.locator('#blend').selectOption('multiply');
    const expected = await snapshot(source);
    assert.equal(Object.keys(expected.project.assets).length, 4);
    assert(Object.values(expected.project.assets)
        .every((file) => file.type === 'image/svg+xml'));
    const quote = expected.project.composition.layers.at(-1);
    assert.equal(quote.text.runs[0].content, 'Make room for little changes...');
    assert.equal(quote.text.runs[0].fontFamily, 'Georgia');
    assert.equal(
        quote.text.runs[0].fontSize,
        demoSnapshot.project.composition.layers.at(-1).text.runs[0].fontSize);
    assert.equal(quote.x, 410);
    assert.equal(
        quote.w, demoSnapshot.project.composition.layers.at(-1).w * 0.95);
    assert.equal(quote.blend, 'multiply');
    await source.screenshot({path: path.join(artifacts, '01-source.png')});
    const firstZIP = await save(source, 'first-save.zip');
    const firstHTML = extract(firstZIP, 'First extract # É');
    assert.deepEqual(embedded(firstHTML), expected.project);
    console.log(
        'PASS: Chrome loaded SVG demo, applied transforms and downloaded a one-HTML ZIP');
    const smoke = await open(new URL('../tests/browser.html', startURL).href);
    await smoke.waitForFunction(
        () => /FAIL:|proof rotation/.test(
            document.querySelector('#results').textContent));
    const smokeResults = await smoke.locator('#results').textContent();
    assert(!smokeResults.includes('FAIL:'), smokeResults);
    console.log(smokeResults);
    await smoke.close();
    // No localhost or remote resources may be used once the extracted page is
    // opened.
    await context.route(/^https?:\/\//, (route) => route.abort());
    const local = await open(pathToFileURL(firstHTML).href);
    await local.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    const reopened = await snapshot(local);
    assert.deepEqual(reopened, expected);
    assert.equal(await local.evaluate(() => editor.dirty), false);
    await local.screenshot({path: path.join(artifacts, '02-local-html.png')});
    const secondZIP = await save(local, 'second-save.zip');
    const secondHTML = extract(secondZIP, 'Second extract # É');
    assert.deepEqual(embedded(secondHTML), expected.project);
    const final = await open(pathToFileURL(secondHTML).href);
    await final.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.deepEqual(await snapshot(final), expected);
    await final.screenshot({path: path.join(artifacts, '03-second-save.png')});
    const chooser = final.waitForEvent('filechooser');
    await final.locator('#importLayer').click();
    await (await chooser).setFiles(path.join(root, 'tests/orange.heic'));
    await final.waitForFunction(
        () => document.querySelector('#layerCount').textContent === '5 layers');
    const decoded = await final.evaluate(() => {
      const layer = selected();
      return {
        width: layer.canvas.width,
        height: layer.canvas.height,
        pixels:
            [...layer.canvas.getContext('2d').getImageData(0, 0, 1, 1).data],
      };
    });
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 16);
    assert(
        decoded.pixels[0] > 240 && decoded.pixels[1] > 110 &&
        decoded.pixels[1] < 145 && decoded.pixels[2] < 15 &&
        decoded.pixels[3] === 255);
    const withHEIC = await snapshot(final);
    const heicFile = Object.values(withHEIC.project.assets)
        .find((file) => file.type === 'image/heic');
    assert(heicFile, 'The original HEIC remains HEIC, not PNG');
    assert.deepEqual(
        Buffer.from(heicFile.base64, 'base64'),
        fs.readFileSync(path.join(root, 'tests/orange.heic')));
    const heicZIP = await save(final, 'heic-save.zip');
    const heicHTML = extract(heicZIP, 'HEIC extract # É');
    const heicPage = await open(pathToFileURL(heicHTML).href);
    await heicPage.waitForFunction(
        () => document.querySelector('#status').textContent.startsWith(
            'Project opened.'));
    assert.deepEqual(await snapshot(heicPage), withHEIC);
    await heicPage.screenshot(
        {path: path.join(artifacts, '04-heic-reopened.png')});
    console.log(
        'PASS: offline WASM HEIC import, original-byte preservation and ZIP/file:// reopen with identical pixels');
    assert.equal(
        fs.statSync(firstHTML).size, fs.statSync(secondHTML).size,
        'Repeated saving does not grow the HTML');
    assert.deepEqual(errors, []);
    const sourceHashes =
        Object.entries(expected.project.assets)
            .map(
                ([id, file]) =>
                  ({id, sha256: digest(Buffer.from(file.base64, 'base64'))}));
    const report = {
      browser: browser.version(),
      mode:
          'headless system Chrome; native save picker disabled; download fallback',
      initialURL: startURL,
      localURLs:
          [pathToFileURL(firstHTML).href, pathToFileURL(secondHTML).href],
      layers: sourceHashes,
      composition: expected.project.composition,
      canvasSHA256: expected.canvasSHA256,
      firstHTMLBytes: fs.statSync(firstHTML).size,
      secondHTMLBytes: fs.statSync(secondHTML).size,
      heic: {
        decoded,
        sourceSHA256: digest(Buffer.from(heicFile.base64, 'base64')),
        canvasSHA256: withHEIC.canvasSHA256,
      },
      smokeResults,
      errors,
      browserNotes,
      requests,
    };
    fs.writeFileSync(
        path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
        'PASS: extracted file:// HTML opened offline, saved again, extracted and reopened');
    console.log(
        'PASS: all four original SVGs, full composition JSON and rendered pixels match exactly; no application browser errors');
    console.log('Evidence:', artifacts);
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
