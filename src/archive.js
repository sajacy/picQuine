'use strict';
/**
 * One HTML file in a standard ZIP. Native streams supply raw DEFLATE via gzip.
 */
const picQuineArchive = (() => {
  const utf8 = new TextEncoder();
  const text = new TextDecoder('utf-8', {fatal: true});
  const maxHTML = picQuineConfig.limits.htmlBytes;
  const table = Uint32Array.from({length: 256}, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  const view = (bytes) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function validName(name) {
    return typeof name === 'string' && name.length < 1024 &&
        /\.html$/i.test(name) && !/[\/\\\x00-\x1f]/.test(name);
  }
  async function collect(stream, limit) {
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) {
          break;
        }
        size += value.length;
        if (size > limit) {
          throw Error('Project exceeds the uncompressed size limit.');
        }
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  }
  async function pack(name, blob) {
    if (!validName(name)) {
      throw Error('Invalid project HTML filename.');
    }
    if (blob.size > maxHTML) {
      throw Error('Project exceeds the uncompressed size limit.');
    }
    const raw = new Uint8Array(await blob.arrayBuffer());
    const gzip = await collect(
        blob.stream().pipeThrough(new CompressionStream('gzip')),
        maxHTML + 1000000);
    if (gzip[0] !== 31 || gzip[1] !== 139 || gzip[2] !== 8 || gzip[3] !== 0) {
      throw Error('Unexpected native gzip header.');
    }
    // ZIP needs raw DEFLATE, without the fixed gzip header and trailer.
    const deflated = gzip.subarray(10, -8);
    const method = deflated.length < raw.length ? 8 : 0;
    const payload = method ? deflated : raw;
    const filename = utf8.encode(name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + filename.length);
    const header = view(local);
    // ZIP signatures and fields use little-endian byte order.
    header.setUint32(0, 0x04034b50, /* littleEndian= */ true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x800, true);
    header.setUint16(8, method, true);
    header.setUint16(12, 33, true); // DOS date: 1980-01-01.
    header.setUint32(14, crc, true);
    header.setUint32(18, payload.length, true);
    header.setUint32(22, raw.length, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);
    const central = new Uint8Array(46 + filename.length);
    const directory = view(central);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 0x314, true); // Unix, ZIP 2.0.
    // Version, flags, method, date, CRC, sizes and name length share this
    // layout.
    central.set(local.subarray(4, 28), 6);
    directory.setUint32(38, (0o100644 * 65536) >>> 0, true);
    central.set(filename, 46);
    const end = new Uint8Array(22);
    const trailer = view(end);
    trailer.setUint32(0, 0x06054b50, true);
    trailer.setUint16(8, 1, true);
    trailer.setUint16(10, 1, true);
    trailer.setUint32(12, central.length, true);
    trailer.setUint32(16, local.length + payload.length, true);
    const zip =
        new Blob([local, payload, central, end], {type: 'application/zip'});
    if (zip.size > picQuineConfig.limits.archiveBytes) {
      throw Error('Project archive exceeds 250 MB.');
    }
    return zip;
  }
  async function open(blob) {
    if (blob.size > picQuineConfig.limits.archiveBytes) {
      throw Error('Project archive exceeds 250 MB.');
    }
    const tailStart = Math.max(0, blob.size - 65557);
    const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
    const trailer = view(tail);
    let end = tail.length - 22;
    while (end >= 0 &&
           !(trailer.getUint32(end, true) === 0x06054b50 &&
             end + 22 + trailer.getUint16(end + 20, true) === tail.length)) {
      end--;
    }
    if (end < 0) {
      throw Error('Not a supported ZIP archive.');
    }
    if (trailer.getUint16(end + 4, true) || trailer.getUint16(end + 6, true) ||
        trailer.getUint16(end + 8, true) !== 1 ||
        trailer.getUint16(end + 10, true) !== 1) {
      throw Error(
          'Project ZIP must contain exactly one HTML file. Older formats are not supported.');
    }
    const size = trailer.getUint32(end + 12, true);
    const start = trailer.getUint32(end + 16, true);
    if (size < 46 || size > 46 + 65535 * 3 ||
        start + size !== tailStart + end) {
      throw Error('Invalid ZIP directory.');
    }
    const central =
        new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
    const directory = view(central);
    const flags = directory.getUint16(8, true);
    const method = directory.getUint16(10, true);
    const crc = directory.getUint32(16, true);
    const packed = directory.getUint32(20, true);
    const length = directory.getUint32(24, true);
    const nameLength = directory.getUint16(28, true);
    const extraLength = directory.getUint16(30, true);
    const commentLength = directory.getUint16(32, true);
    if (directory.getUint32(0, true) !== 0x02014b50 || flags & ~0x808 ||
        ![0, 8].includes(method) ||
        46 + nameLength + extraLength + commentLength !== size ||
        directory.getUint16(34, true) || directory.getUint32(42, true)) {
      throw Error('Unsupported ZIP entry.');
    }
    const name = text.decode(central.subarray(46, 46 + nameLength));
    if (!validName(name)) {
      throw Error(
          'Project ZIP must contain exactly one HTML file. Older formats are not supported.');
    }
    if (length > maxHTML || packed > picQuineConfig.limits.archiveBytes) {
      throw Error('Project exceeds the size limit.');
    }
    if (!method && packed !== length) {
      throw Error('Conflicting ZIP entry sizes.');
    }
    if (start < 30) {
      throw Error('Invalid ZIP local header.');
    }
    const local = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
    const header = view(local);
    const localNameLength = header.getUint16(26, true);
    const localExtraLength = header.getUint16(28, true);
    const dataStart = 30 + localNameLength + localExtraLength;
    if (header.getUint32(0, true) !== 0x04034b50 ||
        header.getUint16(6, true) !== flags ||
        header.getUint16(8, true) !== method || dataStart + packed > start ||
        localNameLength !== nameLength) {
      throw Error('Conflicting ZIP local header.');
    }
    const localName = new Uint8Array(
        await blob.slice(30, 30 + localNameLength).arrayBuffer());
    if (text.decode(localName) !== name ||
        (!(flags & 8) &&
         (header.getUint32(14, true) !== crc ||
          header.getUint32(18, true) !== packed ||
          header.getUint32(22, true) !== length))) {
      throw Error('Conflicting ZIP entry sizes.');
    }
    const stored = blob.slice(dataStart, dataStart + packed);
    let raw;
    if (method === 8) {
      const footer = new Uint8Array(8);
      const checksum = view(footer);
      checksum.setUint32(0, crc, true);
      checksum.setUint32(4, length, true);
      const gzip = new Blob(
          [Uint8Array.of(31, 139, 8, 0, 0, 0, 0, 0, 0, 255), stored, footer]);
      raw = await collect(
          gzip.stream().pipeThrough(new DecompressionStream('gzip')), length);
    } else {
      raw = new Uint8Array(await stored.arrayBuffer());
    }
    if (raw.length !== length || crc32(raw) !== crc) {
      throw Error('ZIP checksum or length mismatch.');
    }
    return {name, blob: new Blob([raw], {type: 'text/html'})};
  }
  return {pack, open, crc32};
})();
