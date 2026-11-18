'use strict';
/**
 * Immutable asset records and retained raw metadata keep unfamiliar fork data
 * intact.
 */
const picQuineProject = (() => {
  const {validID, validateProject, layerSettings, validateTextSource} =
      picQuineDocument;
  const originals = new WeakMap();
  const rasters = new WeakMap();
  function extensions(node) {
    const map = node.extensions;
    if (map === undefined) {
      return [];
    }
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      throw Error('Invalid extensions.');
    }
    return Object.entries(map).flatMap(([name, extension]) => {
      if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(name) || !extension ||
          !Number.isInteger(extension.version) || extension.version < 1 ||
          typeof extension.required !== 'boolean' ||
          !Array.isArray(extension.assetRefs) ||
          !extension.assetRefs.every(validID) ||
          new Set(extension.assetRefs).size !== extension.assetRefs.length ||
          !extension.data || typeof extension.data !== 'object' ||
          Array.isArray(extension.data)) {
        throw Error('Invalid extension: ' + name);
      }
      if (name === 'org.picquine.heic' && extension.version === 1 &&
          (extension.data.imageIndex !== 0 || extension.assetRefs.length)) {
        throw Error('Invalid HEIC extension.');
      }
      return extension.assetRefs;
    });
  }
  function reachable(project) {
    const queue = extensions(project);
    for (const layer of project.composition.layers) {
      queue.push(
          layer.content, ...(layer.original ? [layer.original] : []),
          ...extensions(layer));
    }
    // Follow extension references too, including cyclic fork-owned assets.
    const visited = new Set();
    while (queue.length) {
      const id = queue.pop();
      if (!validID(id) || !Object.hasOwn(project.assets, id)) {
        throw Error('Missing project asset: ' + id);
      }
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      queue.push(...extensions(project.assets[id]));
    }
    return visited;
  }
  function validate(project) {
    if (!project || project.format !== 'picquine-project' ||
        project.version !== 3 || !project.assets ||
        typeof project.assets !== 'object' || Array.isArray(project.assets)) {
      throw Error('Invalid PicQuine project v3.');
    }
    validateProject(project.composition);
    if ([project, ...project.composition.layers].some(
        (node) => node.extensions?.['org.picquine.heic']?.version === 1)) {
      throw Error('HEIC v1 extensions belong on assets.');
    }
    if (project.composition.layers.some(
        (layer) => layer.text?.extensions !== undefined ||
                layer.text?.runs.some((run) => run.extensions !== undefined))) {
      throw Error('Unsupported extension scope.');
    }
    if (project.composition.extensions !== undefined) {
      throw Error('Extensions belong at project, layer or asset scope.');
    }
    if (new Blob([JSON.stringify(project.composition)]).size >
        picQuineConfig.limits.compositionBytes) {
      throw Error('Composition metadata exceeds 1 MB.');
    }
    const entries = Object.entries(project.assets);
    if (entries.length > picQuineConfig.limits.assetFiles) {
      throw Error('Project exceeds the 200 asset file limit.');
    }
    let bytes = 0;
    for (const [id, file] of entries) {
      if (!validID(id) || !file || typeof file.name !== 'string' ||
          !file.name || typeof file.type !== 'string' ||
          !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(file.type) ||
          typeof file.base64 !== 'string') {
        throw Error('Invalid asset record.');
      }
      bytes += Math.floor(file.base64.length * 3 / 4) -
          (file.base64.endsWith('==') ? 2 :
               file.base64.endsWith('=') ? 1 :
                                           0);
      if (bytes > picQuineConfig.limits.assetBytes) {
        throw Error('Project exceeds the asset size limit.');
      }
      extensions(file);
      if (/^image\/hei[cf]$/i.test(file.type)) {
        const heic = file.extensions?.['org.picquine.heic'];
        if (!heic ||
            project.composition.layers.some((layer) => layer.content === id) &&
                !heic.required) {
          throw Error('HEIC content requires its extension.');
        }
      }
    }
    for (const layer of project.composition.layers) {
      if (!validID(layer.content) ||
          !(layer.original === null || validID(layer.original))) {
        throw Error('Invalid asset reference.');
      }
    }
    if (reachable(project).size !== entries.length) {
      throw Error('Unreferenced project asset.');
    }
    return project;
  }
  async function buildData(document) {
    // Unknown required data must survive upgrade-only saves untouched.
    if (document.readOnly) {
      return document.project;
    }
    validateProject(document);
    if (document.layers.reduce(
        (sum, layer) => sum + layer.canvas.width * layer.canvas.height, 0) >
        picQuineConfig.limits.projectPixels) {
      throw Error('Project exceeds the pixel memory limit.');
    }
    const result = {
      ...document.project,
      format: 'picquine-project',
      version: 3,
      composition: {
        ...document.project?.composition,
        name: document.name,
        w: document.w,
        h: document.h,
        selected: document.selected,
        layers: [],
      },
      assets: {...document.project?.assets},
    };
    async function originalAsset(original) {
      let record = originals.get(original.blob);
      if (!record) {
        record = {
          id: original.id || uid(),
          file: original.record || {
            name: original.name,
            type: original.type || picQuineImages.imageMime(original.name),
            base64: await picQuineStandalone.base64(original.blob),
          },
        };
        originals.set(original.blob, record);
      }
      result.assets[record.id] = record.file;
      return record.id;
    }
    for (const layer of document.layers) {
      const original =
          layer.original ? await originalAsset(layer.original) : null;
      let content = original;
      if (!original || layer.pixelsEdited) {
        let record = rasters.get(layer.canvas);
        if (!record) {
          record = {
            id: uid(),
            file: {
              name: layer.name + '.png',
              type: 'image/png',
              base64: await picQuineStandalone.base64(
                  await assets.png(layer.canvas)),
            },
          };
          rasters.set(layer.canvas, record);
        }
        content = record.id;
        result.assets[content] = record.file;
      }
      result.composition.layers.push({
        ...layer.record,
        id: layer.id,
        name: layer.name,
        content,
        original,
        x: layer.x,
        y: layer.y,
        w: layer.w,
        h: layer.h,
        rotation: picQuineGeometry.angle(layer),
        opacity: layer.opacity,
        visible: layer.visible,
        blend: layer.blend,
        ...(layer.text ? {
          text: {
            ...layer.record?.text,
            ...validateTextSource(layer.text),
            runs: layer.text.runs.map(
                (run, index) => ({...layer.record?.text?.runs[index], ...run})),
          },
        } :
                         {}),
      });
    }
    const used = reachable(result);
    for (const id of Object.keys(result.assets)) {
      if (!used.has(id)) {
        delete result.assets[id];
        continue;
      }
      const file = result.assets[id];
      if (/^image\/hei[cf]$/i.test(file.type) &&
          (!file.extensions?.['org.picquine.heic'] ||
           file.extensions['org.picquine.heic'].version === 1)) {
        result.assets[id] = {
          ...file,
          extensions: {
            ...file.extensions,
            'org.picquine.heic': {
              ...file.extensions?.['org.picquine.heic'],
              version: 1,
              required: result.composition.layers.some(
                  (layer) => layer.content === id),
              assetRefs: [],
              data: {
                ...file.extensions?.['org.picquine.heic']?.data,
                imageIndex: 0,
              },
            },
          },
        };
      }
    }
    return validate(result);
  }
  async function restore(project) {
    validate(project);
    const files = new Map();
    for (const [id, record] of Object.entries(project.assets)) {
      const blob = new File(
          [picQuineStandalone.fromBase64(record.base64)], record.name,
          {type: record.type});
      const original = {id, record, blob, name: record.name, type: record.type};
      files.set(id, original);
      originals.set(blob, {id, file: record});
    }
    const missing = picQuineRuntime.compatible(project);
    const readOnly = missing.length > 0;
    const layers = [];
    let pixels = 0;
    for (const record of project.composition.layers) {
      const content = files.get(record.content);
      const original = record.original ? files.get(record.original) : null;
      if (!readOnly &&
          !picQuineConfig.imageTypes.includes(content.type.toLowerCase())) {
        throw Error('Unsupported content type: ' + content.type);
      }
      // Placeholders retain metadata without decoding unsupported content.
      const canvas =
          readOnly ? makeCanvas(1, 1) : await assets.decode(content.blob);
      if ((pixels += canvas.width * canvas.height) >
          picQuineConfig.limits.projectPixels) {
        throw Error('Project exceeds the pixel memory limit.');
      }
      // Reuse saved PNG bytes until a later edit changes this canvas.
      rasters.set(
          canvas, {id: record.content, file: project.assets[record.content]});
      layers.push({
        ...layerSettings(record),
        record,
        canvas,
        original,
        pixelsEdited: record.content !== record.original,
      });
    }
    return {...project.composition, project, layers, readOnly, missing};
  }
  async function readProject(file) {
    const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (signature[0] === 80 && signature[1] === 75) {
      file = (await picQuineArchive.open(file)).blob;
    }
    return restore(
        picQuineStandalone.extract(await picQuineStandalone.readHTML(file)));
  }
  const buildProject = async (document, choice = 'current') =>
    picQuineStandalone.encode(await buildData(document), choice);
  function protects(layer, project) {
    return [
      layer.record,
      layer.original?.record,
      project?.assets?.[layer.record?.content],
    ]
        .some(
            (node) => Object.entries(node?.extensions || {})
                .some(
                    ([name, extension]) =>
                      !picQuineRuntime.info.compatibility
                          .extensions[name]
                          ?.includes(extension.version)));
  }
  return {
    validate,
    reachable,
    buildData,
    buildProject,
    restore,
    readProject,
    protects,
  };
})();
