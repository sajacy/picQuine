const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const env = {
  Blob,
  TextEncoder,
  TextDecoder,
  CompressionStream,
  DecompressionStream,
};
vm.createContext(env);
for (const file of ['config.js', 'archive.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), env);
}
const zip = vm.runInContext('picQuineArchive', env);
(async () => {
  const html = '<!doctype html><p>Été 🌱</p>'.repeat(100);
  const name = 'Été 🌱.html';
  const saved = await zip.pack(name, new Blob([html]));
  const reopened = await zip.open(saved);
  assert.equal(reopened.name, name);
  assert.equal(await reopened.blob.text(), html);
  assert.equal(zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  fs.writeFileSync(
      '/tmp/picquine-archive-test.zip', Buffer.from(await saved.arrayBuffer()));
  execFileSync('python3', [
    '-c',
    `import zipfile,io
with zipfile.ZipFile('/tmp/picquine-archive-test.zip') as z:
 assert z.namelist()==['Été 🌱.html']
 assert z.testzip() is None
 assert z.read('Été 🌱.html').decode()==${JSON.stringify(html)}
 assert z.getinfo('Été 🌱.html').compress_type==zipfile.ZIP_DEFLATED
for method in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED]:
 with zipfile.ZipFile('/tmp/picquine-python-'+str(method)+'.zip','w',compression=method) as z:
  z.writestr('source.html','<html>external</html>')
with zipfile.ZipFile('/tmp/picquine-old-project.zip','w') as z:
 z.writestr('manifest.json','{}')
 z.writestr('originals/test.svg','<svg/>')
class Stream(io.BytesIO):
 def seekable(self): return False
 def seek(self,*args): raise io.UnsupportedOperation()
stream=Stream()
with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as z:
 z.writestr('stream.html','<html>streamed</html>')
open('/tmp/picquine-descriptor.zip','wb').write(stream.getvalue())
`,
  ]);
  for (const method of [0, 8]) {
    const external = await zip.open(
        new Blob([fs.readFileSync('/tmp/picquine-python-' + method + '.zip')]));
    assert.equal(await external.blob.text(), '<html>external</html>');
  }
  assert.equal(
      await (await zip.open(new Blob([
        fs.readFileSync('/tmp/picquine-descriptor.zip'),
      ]))).blob.text(),
      '<html>streamed</html>');
  await assert.rejects(
      zip.open(new Blob([fs.readFileSync('/tmp/picquine-old-project.zip')])),
      /one HTML/);
  for (const invalid
    of ['../escape.html', '/absolute.html', 'bad\\path.html',
      'manifest.json']) {
    await assert.rejects(zip.pack(invalid, new Blob(['bad'])), /Invalid/);
  }
  const bytes = new Uint8Array(await saved.arrayBuffer());
  const bad = bytes.slice();
  bad[14] ^= 1;
  await assert.rejects(zip.open(new Blob([bad])), /Conflicting/);
  await assert.rejects(
      zip.open(new Blob([bytes.subarray(0, bytes.length - 1)])), /ZIP/);
  const bomb = bytes.slice();
  const directory = new DataView(bomb.buffer);
  let offset = 0;
  while (directory.getUint32(offset, true) !== 0x02014b50) {
    offset++;
  }
  directory.setUint32(offset + 24, 0x7fffffff, true);
  await assert.rejects(zip.open(new Blob([bomb])), /size limit/);
  const mismatch = bytes.slice();
  mismatch[30] ^= 1;
  await assert.rejects(zip.open(new Blob([mismatch])), /Conflicting/);
  console.log(
      'PASS: single-HTML ZIP, native compression, CRC, Python stored/deflated/descriptor interoperability, Unicode, unsafe names, corruption, truncation, expansion limits and old-format rejection');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
