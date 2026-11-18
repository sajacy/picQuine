'use strict';
/** Shared document, archive and history limits; no browser dependencies. */
const picQuineConfig = Object.freeze({
  limits: Object.freeze({
    imageSide: 16384,
    imagePixels: 40000000,
    projectPixels: 120000000,
    layers: 100,
    archiveBytes: 250000000,
    assetBytes: 300000000,
    htmlBytes: 420000000,
    compositionBytes: 1000000,
    assetFiles: 200,
    historyBytes: 256 * 1024 * 1024,
    historyEntries: 100,
  }),
  blendModes: Object.freeze([
    'source-over',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
  ]),
  imageTypes: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/svg+xml',
    'image/bmp',
    'image/x-ms-bmp',
    'image/heic',
    'image/heif',
  ]),
});
