'use strict';
/**
 * Current and staged editor templates. Downloaded HTML is data until reopened.
 */
const picQuineRuntime = (() => {
  let pristine;
  let info;
  let pending = null;
  const slot =
      /(<script\b(?=[^>]*\bid="picquine-project")(?=[^>]*\btype="application\/json")[^>]*>)[\s\S]*?(<\/script\s*>)/gi;
  function capture() {
    const root = document.documentElement.cloneNode(true);
    if (root.querySelector('script[src]')) {
      throw Error('Run npm run build and open dist/Editor-With-HEIC.html.');
    }
    root.querySelector('#picquine-project').textContent = 'null';
    info = picQuineJSON.parse(
        root.querySelector('#picquine-editor-info').textContent);
    pristine = '<!doctype html>\n' + root.outerHTML;
  }
  function compatible(project, target = info) {
    if (!target?.compatibility.projectVersions.includes(project.version)) {
      return ['project version ' + project.version];
    }
    const missing = [];
    for (const node
      of [project, ...project.composition.layers,
        ...Object.values(project.assets)]) {
      for (const [name, extension] of Object.entries(node.extensions || {})) {
        if (extension.required &&
            !target.compatibility.extensions[name]?.includes(
                extension.version)) {
          missing.push(name + ' v' + extension.version);
        }
      }
    }
    return [...new Set(missing)];
  }
  function render(project, choice = 'current') {
    const target = choice === 'loaded' ? pending : {html: pristine, info};
    if (!target) {
      throw Error('No loaded editor bundle.');
    }
    const missing = compatible(project, target.info);
    if (missing.length) {
      throw Error('Editor lacks required support: ' + missing.join(', '));
    }
    // Project text must never close its non-executable script element.
    const json = JSON.stringify(project)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    return target.html.replace(slot, (_, start, end) => start + json + end);
  }
  // Blob windows opened from file:// lack Web Crypto. SHA-256 fallback keeps
  // subsequent bundle loads verifiable without a network dependency.
  function hash(bytes) {
    const rotate = (word, bits) => word >>> bits | word << (32 - bits);
    const constants = [];
    const state = [];
    for (let candidate = 2; constants.length < 64; candidate++) {
      let prime = true;
      for (let divisor = 2; divisor * divisor <= candidate; divisor++) {
        if (candidate % divisor === 0) {
          prime = false;
          break;
        }
      }
      if (!prime) {
        continue;
      }
      if (state.length < 8) {
        state.push(Math.sqrt(candidate) * 2 ** 32 | 0);
      }
      constants.push(Math.cbrt(candidate) * 2 ** 32 | 0);
    }
    const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    const words = new Int32Array(64);
    view.setUint32(padded.length - 8, Math.floor(bytes.length / 2 ** 29));
    view.setUint32(padded.length - 4, bytes.length * 8);
    for (let offset = 0; offset < padded.length; offset += 64) {
      for (let index = 0; index < 64; index++) {
        if (index < 16) {
          words[index] = view.getInt32(offset + index * 4);
        } else {
          const earlier = words[index - 15];
          const recent = words[index - 2];
          words[index] = words[index - 16] +
              (rotate(earlier, 7) ^ rotate(earlier, 18) ^ earlier >>> 3) +
              words[index - 7] +
              (rotate(recent, 17) ^ rotate(recent, 19) ^ recent >>> 10);
        }
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let index = 0; index < 64; index++) {
        const sum = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) +
            (e & f ^ ~e & g) + constants[index] + words[index];
        const major = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) +
            (a & b ^ a & c ^ b & c);
        h = g;
        g = f;
        f = e;
        e = d + sum | 0;
        d = c;
        c = b;
        b = a;
        a = sum + major | 0;
      }
      [a, b, c, d, e, f, g, h].forEach(
          (word, index) => state[index] = state[index] + word | 0);
    }
    return state.map((word) => (word >>> 0).toString(16).padStart(8, '0'))
        .join('');
  }
  async function stage(url) {
    const address = new URL(url);
    if (!['https:', 'http:'].includes(address.protocol)) {
      throw Error('Enter an HTTP(S) bundle URL.');
    }
    const response = await fetch(address.href, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    if (!response.ok) {
      throw Error('Bundle request failed: HTTP ' + response.status);
    }
    const bundle = picQuineJSON.parse(
        await picQuineStandalone.readText(response.body, 20000000));
    if (bundle.format !== 'picquine-editor-bundle' || bundle.version !== 1 ||
        !bundle.editor ||
        !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(bundle.editor.id) ||
        ![bundle.editor.profile, bundle.editor.version, bundle.editor.build]
            .every((value) => typeof value === 'string' && value.length) ||
        !Array.isArray(bundle.compatibility?.projectVersions) ||
        !bundle.compatibility.projectVersions.length ||
        !bundle.compatibility.projectVersions.every(
            (version) => Number.isInteger(version) && version > 0) ||
        new Set(bundle.compatibility.projectVersions).size !==
            bundle.compatibility.projectVersions.length ||
        !bundle.compatibility.extensions ||
        typeof bundle.compatibility.extensions !== 'object' ||
        Array.isArray(bundle.compatibility.extensions) ||
        bundle.payload?.encoding !== 'gzip+base64' ||
        Object.keys(bundle.payload).sort().join(',') !==
            'base64,encoding,sha256' ||
        !/^[a-f0-9]{64}$/.test(bundle.payload.sha256)) {
      throw Error('Invalid editor bundle.');
    }
    for (const [name, versions] of Object.entries(
        bundle.compatibility.extensions)) {
      if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(name) ||
          !Array.isArray(versions) || !versions.length ||
          new Set(versions).size !== versions.length ||
          !versions.every(
              (version) => Number.isInteger(version) && version > 0)) {
        throw Error('Invalid bundle capabilities.');
      }
    }
    const packed = picQuineStandalone.fromBase64(bundle.payload.base64);
    const html = await picQuineStandalone.readText(
        packed.stream().pipeThrough(new DecompressionStream('gzip')), 20000000);
    const bytes = new TextEncoder().encode(html);
    const digest = crypto.subtle ?
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('') :
        hash(bytes);
    if (digest !== bundle.payload.sha256) {
      throw Error('Bundle SHA-256 mismatch.');
    }
    // Inert parsing avoids running code or fetching template subresources.
    const template = document.createElement('template');
    template.innerHTML = html;
    const parsed = template.content;
    const slots = parsed.querySelectorAll('#picquine-project');
    const identities = parsed.querySelectorAll('#picquine-editor-info');
    if (slots.length !== 1 ||
        slots[0].getAttribute('type') !== 'application/json' ||
        slots[0].textContent.trim() !== 'null' || identities.length !== 1 ||
        identities[0].getAttribute('type') !== 'application/json' ||
        parsed.querySelector('script[src],link[href]:not([href^="data:"])')) {
      throw Error('Bundle must contain a complete blank editor HTML.');
    }
    const identity = picQuineJSON.parse(identities[0].textContent);
    if (!picQuineJSON.equal(identity.editor, bundle.editor) ||
        !picQuineJSON.equal(identity.compatibility, bundle.compatibility)) {
      throw Error('Bundle identity mismatch.');
    }
    const project = await picQuineProject.buildData(editor.document);
    const missing = compatible(project, identity);
    if (missing.length) {
      throw Error(
          'Loaded editor lacks required support: ' + missing.join(', '));
    }
    // Commit only after every check, preserving the old candidate on failure.
    pending = {url: address.href, info: identity, html};
    return pending;
  }
  return {
    capture,
    compatible,
    render,
    stage,
    get info() {
      return info;
    },
    get pending() {
      return pending;
    },
  };
})();
