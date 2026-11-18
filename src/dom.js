'use strict';
// Shared browser helpers; modules call these directly rather than passing them
// around.
const $ = (selector) => document.querySelector(selector);
const makeCanvas = (width, height) =>
  Object.assign(document.createElement('canvas'), {width, height});
const uid = () => crypto.randomUUID?.() ||
    Array
        .from(
            crypto.getRandomValues(new Uint8Array(16)),
            (byte) => byte.toString(16).padStart(2, '0'))
        .join('');
