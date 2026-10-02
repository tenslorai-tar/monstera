// @ts-check
/**
 * Which icon a Windows executable carries, read from its resource directory, and whether it is a given `.ico`.
 *
 * ## The question is about the artefact, not the step
 *
 * The packager sets `Monstera.exe`'s icon with rcedit. *rcedit exited 0* and *the executable carries the brand's icon*
 * are different facts — rcedit replaces the FIRST icon group it enumerates, so an executable carrying two groups would
 * keep showing the other one wherever Windows reads a different group, and a step pointed at the wrong file succeeds
 * quietly. So the answer is read back from the bytes.
 *
 * ## The format
 *
 * Data directory 2 is the resource tree: three levels — type, name, language — of `IMAGE_RESOURCE_DIRECTORY`, 16 bytes
 * followed by 8-byte entries, named entries first and then numeric ones in ascending order. An entry whose offset has
 * its high bit set points at a subdirectory, and one without points at a data entry whose first field is an RVA. Offsets
 * inside the tree are relative to its root; the data entry's RVA is not.
 *
 * An icon is two resource types: `RT_GROUP_ICON` (14) holds a `GRPICONDIR` — six bytes, then 14-byte entries whose
 * last field is the ID of an `RT_ICON` (3) — and each `RT_ICON` holds one image's bytes exactly as the `.ico` file held
 * them. An `.ico` is a six-byte `ICONDIR`, 16-byte entries ending in the image's size and file offset, then the images.
 * So *carries this `.ico`* is *the first group's images are the file's images, byte for byte, in order*.
 */

import { peLayout } from './peImage.mjs';

const RT_ICON = 3;
const RT_GROUP_ICON = 14;
const SUBDIRECTORY = 0x80000000;

/**
 * @typedef {{ id: number | string, offset: number }} ResourceEntry
 *   `offset` is the entry's own field, relative to the resource root
 */

/**
 * The entries of one resource directory, in the file's order.
 *
 * @param {Buffer} bytes
 * @param {number} root the file offset of the resource tree
 * @param {number} at the file offset of this directory
 * @returns {ResourceEntry[]}
 */
function entries(bytes, root, at) {
  const count = bytes.readUInt16LE(at + 12) + bytes.readUInt16LE(at + 14);
  /** @type {ResourceEntry[]} */
  const found = [];
  for (let index = 0; index < count; index += 1) {
    const entryAt = at + 16 + index * 8;
    const name = bytes.readUInt32LE(entryAt);
    let id;
    if ((name & SUBDIRECTORY) === 0) id = name & 0xffff;
    else {
      const stringAt = root + (name & ~SUBDIRECTORY);
      id = bytes.toString('utf16le', stringAt + 2, stringAt + 2 + bytes.readUInt16LE(stringAt) * 2);
    }
    found.push({ id, offset: bytes.readUInt32LE(entryAt + 4) });
  }
  return found;
}

/**
 * Every icon group in an executable, in the order Windows enumerates them, each with its images' bytes.
 *
 * Throws on a structure it cannot follow — a group naming an `RT_ICON` the file does not hold, a data entry where a
 * directory belongs. An empty list is a real answer only for a file with no icon resources at all, and
 * {@link applicationIcon} refuses it for the callers that need one.
 *
 * @param {Buffer} bytes the whole executable
 * @returns {{ id: number | string, images: Buffer[] }[]}
 */
export function iconGroups(bytes) {
  const layout = peLayout(bytes);
  const { rva } = layout.directory(2);
  if (rva === 0) return [];
  const root = layout.fileOffset(rva);

  /** The first language's data under a type and name entry. @param {ResourceEntry} named */
  const dataOf = (named) => {
    if ((named.offset & SUBDIRECTORY) === 0) throw new Error(`resource ${String(named.id)} has data where its language directory belongs`);
    const [language] = entries(bytes, root, root + (named.offset & ~SUBDIRECTORY));
    if (language === undefined || (language.offset & SUBDIRECTORY) !== 0) {
      throw new Error(`resource ${String(named.id)} has no language entry carrying data`);
    }
    const dataEntry = root + language.offset;
    const at = layout.fileOffset(bytes.readUInt32LE(dataEntry));
    return bytes.subarray(at, at + bytes.readUInt32LE(dataEntry + 4));
  };
  /** The names under one type. @param {number} type */
  const namesOf = (type) => {
    const entry = entries(bytes, root, root).find((candidate) => candidate.id === type);
    if (entry === undefined) return [];
    if ((entry.offset & SUBDIRECTORY) === 0) throw new Error(`resource type ${String(type)} has data where its names belong`);
    return entries(bytes, root, root + (entry.offset & ~SUBDIRECTORY));
  };

  const icons = new Map(namesOf(RT_ICON).map((named) => [named.id, named]));
  return namesOf(RT_GROUP_ICON).map((group) => {
    const directory = dataOf(group);
    const count = directory.readUInt16LE(4);
    /** @type {Buffer[]} */
    const images = [];
    for (let index = 0; index < count; index += 1) {
      const iconId = directory.readUInt16LE(6 + index * 14 + 12);
      const icon = icons.get(iconId);
      if (icon === undefined) throw new Error(`icon group ${String(group.id)} names RT_ICON ${String(iconId)}, which the file does not hold`);
      images.push(dataOf(icon));
    }
    return { id: group.id, images };
  });
}

/**
 * The executable's own icon: the first group, which is the one rcedit replaces and the one Windows shows for the file.
 *
 * Throws when there is none, because every caller asks *is it this icon* and a reader that found nothing would answer
 * *no* — which is the answer the control wants, produced by the reader rather than the file.
 *
 * @param {Buffer} bytes the whole executable
 * @returns {{ id: number | string, images: Buffer[] }}
 */
export function applicationIcon(bytes) {
  const [first] = iconGroups(bytes);
  if (first === undefined || first.images.length === 0) {
    throw new Error('the executable carries no icon group with images, so which icon it shows cannot be read from it');
  }
  return first;
}

/**
 * The images of an `.ico` file, in its own order.
 *
 * @param {Buffer} bytes the whole `.ico`
 * @returns {Buffer[]}
 */
export function icoImages(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) {
    throw new Error('not an .ico file: its directory header is not reserved 0, type 1');
  }
  const count = bytes.readUInt16LE(4);
  if (count === 0) throw new Error('the .ico holds no images');
  /** @type {Buffer[]} */
  const images = [];
  for (let index = 0; index < count; index += 1) {
    const entryAt = 6 + index * 16;
    const size = bytes.readUInt32LE(entryAt + 8);
    const offset = bytes.readUInt32LE(entryAt + 12);
    if (offset + size > bytes.length) throw new Error(`.ico image ${String(index)} runs past the end of the file`);
    images.push(bytes.subarray(offset, offset + size));
  }
  return images;
}

/**
 * Whether an executable's own icon is this `.ico`, image for image.
 *
 * @param {Buffer} executable
 * @param {Buffer} ico
 * @returns {boolean}
 */
export function carriesIcon(executable, ico) {
  const shown = applicationIcon(executable).images;
  const wanted = icoImages(ico);
  return shown.length === wanted.length && shown.every((image, index) => image.equals(wanted[index] ?? Buffer.alloc(0)));
}
