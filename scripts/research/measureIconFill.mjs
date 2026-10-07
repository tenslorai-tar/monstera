// @ts-check
/**
 * How much of a square tile a logo's drawn area fills, read from the alpha channel.
 *
 * An INSTRUMENT, written 2026-10-07 for the owner's icon order (item 7): *measure how much of each tile the art fills at 16,
 * 24, 32, 48, 256 and the Store tiles*. A pixel counts as drawn from alpha {@link DRAWN} up, because the owner's 4096 logo
 * carries a haze of alpha 1 to 23 over 91,606 pixels that is not artwork.
 *
 *   node scripts/research/measureIconFill.mjs <image> [<image> ...]            the image resized to 16, 24, 32, 48, 64, 256
 *   node scripts/research/measureIconFill.mjs --native <image> [<image> ...]   each image as it is, at its own size
 *
 * Its positive control is the first thing it prints with `--control`: a synthetic tile with a known drawn box, which it must
 * measure exactly, so a zero or a full tile elsewhere is the image and not the instrument.
 */
import sharp from 'sharp';

/** The smallest alpha counted as drawn: below it a pixel is anti-aliasing fringe or export haze, not artwork. */
const DRAWN = 24;

/**
 * @param {Buffer} data RGBA
 * @param {number} width
 * @param {number} height
 */
function drawnBox(data, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let drawn = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) >= DRAWN) {
        drawn += 1;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, drawn, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** @param {string} label @param {Buffer} data @param {number} width @param {number} height */
function report(label, data, width, height) {
  const box = drawnBox(data, width, height);
  console.log(
    `  ${label}: drawn ${box.w}x${box.h} of ${width}x${height} = ${((100 * box.w) / width).toFixed(1)}% wide, ` +
      `${((100 * box.h) / height).toFixed(1)}% tall; margins L${box.x0} T${box.y0} R${width - 1 - box.x1} B${height - 1 - box.y1}`,
  );
}

const args = process.argv.slice(2);
if (args.includes('--control')) {
  // A KNOWN BOX: 50 x 20 at (10, 30) in a 100 x 100 tile, alpha 255, with alpha-10 haze everywhere else.
  const data = Buffer.alloc(100 * 100 * 4, 0);
  for (let i = 3; i < data.length; i += 4) data[i] = 10;
  for (let y = 30; y < 50; y += 1) for (let x = 10; x < 60; x += 1) data[(y * 100 + x) * 4 + 3] = 255;
  console.log('control (must read 50x20, 50.0% wide, 20.0% tall, margins L10 T30 R40 B50):');
  report('control', data, 100, 100);
}
const native = args.includes('--native');
for (const path of args.filter((each) => !each.startsWith('--'))) {
  const meta = await sharp(path).metadata();
  console.log(`\n${path}\n  ${meta.width}x${meta.height}, alpha ${String(meta.hasAlpha)}`);
  const sizes = native ? [null] : [16, 24, 32, 48, 64, 256];
  for (const size of sizes) {
    const pipeline = sharp(path).ensureAlpha();
    const sized =
      size === null
        ? pipeline
        : pipeline.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const { data, info } = await sized.raw().toBuffer({ resolveWithObject: true });
    report(size === null ? 'native' : `${String(size).padStart(3)} px`, data, info.width, info.height);
  }
}
