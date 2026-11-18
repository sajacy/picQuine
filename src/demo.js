'use strict';
/** The sample uses the same original-SVG import path as user artwork. */
const picQuineDemo = {
  async create() {
    const quote = 'Make room for little changes...';
    const caption =
        'P  I  C  Q  U  I  N  E  /pɪk.\'waɪn/    S T U D Y   N O . 0 1';
    const definitions = [
      {
        name: 'Warm paper',
        w: 1200,
        h: 800,
        x: 0,
        y: 0,
        markup: '<rect width="1200" height="800" fill="#e8e7d7"/>',
      },
      {
        name: 'Sage / circle',
        w: 480,
        h: 480,
        x: 570,
        y: 85,
        markup: '<circle cx="240" cy="240" r="235" fill="#b4bf91"/>',
      },
      {
        name: 'Forest / arch',
        w: 340,
        h: 510,
        x: 135,
        y: 200,
        markup:
            '<path d="M0 170 A170 170 0 0 1 340 170 V510 H0 Z" fill="#354637"/>',
      },
      {
        name: quote,
        w: 580,
        h: 150,
        x: 500,
        y: 610,
        markup: `<text x="0" y="65" font-family="Georgia,serif" font-size="32pt" fill="#293f30">${
          quote}</text><text x="3" y="115" font-family="sans-serif" font-size="13" fill="#293f30">${
          caption}</text>`,
        // Text metadata uses source pixels; SVG keeps its original font units.
        text: {
          content: quote + '\n' + caption,
          runs: [
            {
              content: quote,
              fontFamily: 'Georgia',
              fontSize: 36,
              color: '#293f30',
              x: 0,
              y: 65,
            },
            {
              content: caption,
              fontFamily: 'sans-serif',
              fontSize: 14,
              color: '#293f30',
              x: 3,
              y: 115,
            },
          ],
        },
      },
    ];
    const layers = [];
    for (const [i, item] of definitions.entries()) {
      const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${item.w}" height="${
            item.h}" viewBox="0 0 ${item.w} ${item.h}">${item.markup}</svg>`;
      const file =
          new File([svg], `sample-${i + 1}.svg`, {type: 'image/svg+xml'});
      layers.push({
        id: uid(),
        name: item.name,
        canvas: await assets.decode(file),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        opacity: 1,
        visible: true,
        blend: 'source-over',
        rotation: 0,
        original: {blob: file, name: file.name, type: file.type},
        pixelsEdited: false,
        ...(item.text ? {text: item.text} : {}),
      });
    }
    return {
      w: 1200,
      h: 800,
      name: 'Quiet forms',
      layers,
      selected: layers.at(-1).id,
    };
  },
};
