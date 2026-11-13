import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raw pixels and their shape, as `sharp`'s `raw()` answers them. */
export interface DecodedImage {
  readonly data: Buffer;
  readonly info: { readonly width: number; readonly height: number; readonly channels: number };
}

/** The variable `proof:hostruntime` names its own plain Node binary in, for the decode below. */
export const PLAIN_NODE_VARIABLE = 'MONSTERA_PLAIN_NODE';

const DECODER = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'scripts', 'lib', 'decodeImage.mjs');

/**
 * Decodes an image with `sharp` — libvips, a reader that is not the MuPDF or libwebp that wrote it — WHERE SHARP RUNS.
 *
 * Under the engine hosts' runtime (`proof:hostruntime` runs this suite in Electron's Node mode) sharp is never loaded:
 * it declares Electron on Linux possibly incompatible, and a worker died inside its decode there on main's CI at
 * 2bd1e19e. The bytes go to a plain Node process instead, the one the proof names in `MONSTERA_PLAIN_NODE`, so the
 * kernel code under test still runs in Electron and only the independent reader leaves it. That is done under Electron
 * on every platform rather than on Linux alone, so the Windows run takes this path too and it is not a branch only one
 * CI leg executes.
 */
export async function decodeForTests(bytes: Uint8Array, options: { ensureAlpha?: boolean } = {}): Promise<DecodedImage> {
  if (process.versions['electron'] === undefined) {
    const { default: sharp } = await import('sharp');
    const image = options.ensureAlpha === true ? sharp(bytes).ensureAlpha() : sharp(bytes);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    return { data, info: { width: info.width, height: info.height, channels: info.channels } };
  }
  const node = process.env[PLAIN_NODE_VARIABLE];
  if (node === undefined || node === '') {
    throw new Error(`under Electron the decode runs in plain Node, and ${PLAIN_NODE_VARIABLE} names none`);
  }
  const run = spawnSync(node, [DECODER, ...(options.ensureAlpha === true ? ['--ensure-alpha'] : [])], {
    input: bytes,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  if (run.status !== 0) {
    throw new Error(`the plain Node decode exited ${String(run.status)} (signal ${String(run.signal)}): ${run.stderr}`, {
      cause: run.error,
    });
  }
  const answer = JSON.parse(run.stdout) as { width: number; height: number; channels: number; data: string };
  return {
    data: Buffer.from(answer.data, 'base64'),
    info: { width: answer.width, height: answer.height, channels: answer.channels },
  };
}
