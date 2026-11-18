'use strict';
// Packaged after config.js and the self-contained libheif WASM bundle.
(async () => {
  try {
    const heif = await libheif();
    onmessage = async ({data: {id, buffer}}) => {
      let images = [];
      try {
        images = new heif.HeifDecoder().decode(new Uint8Array(buffer)) || [];
        // The v1 HEIC extension selects only imageIndex 0.
        const image = images[0];
        if (!image) {
          throw Error('No decodable image in this HEIC file.');
        }
        const width = image.get_width();
        const height = image.get_height();
        if (width < 1 || height < 1 ||
            width > picQuineConfig.limits.imageSide ||
            height > picQuineConfig.limits.imageSide ||
            width * height > picQuineConfig.limits.imagePixels) {
          throw Error('Image exceeds the 40 megapixel or 16,384 px limit.');
        }
        const pixels = new Uint8ClampedArray(width * height * 4);
        await new Promise(
            (resolve, reject) => image.display(
                {data: pixels, width, height},
                (result) => result ?
                    resolve() :
                    reject(Error('HEIC pixels could not be decoded.'))));
        // Transfer RGBA ownership before releasing the WASM image handles.
        postMessage(
            {id, width, height, pixels: pixels.buffer}, [pixels.buffer]);
      } catch (error) {
        postMessage({id, error: error.message || String(error)});
      } finally {
        for (const image of images) {
          image.free();
        }
      }
    };
    postMessage({ready: true});
  } catch (error) {
    postMessage({error: error.message || String(error)});
  }
})();
