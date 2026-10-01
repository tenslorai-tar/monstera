// @ts-check
/**
 * The Word export's pictures, opened in Microsoft Word
 * ([ADR-0072](../../docs/DECISIONS/0072-office-open-xml-exports-are-written-by-this-build-over-fflate.md) Decision 3:
 * a part is proven by opening it in the application that owns the format; its amendment of 2026-10-01).
 *
 * `proof:wordpictures` reads the package back with a zip reader and a PNG decoder that are not the writer's. What it
 * cannot say is whether Word accepts the DrawingML and puts each picture where the page had it — a malformed anchor
 * is exactly what Word either refuses or silently repairs. So this opens each mode's package in Word through COM,
 * read-only, counts the pictures Word itself sees, has Word save each as PDF, and reads the pictures' boxes out of
 * WORD'S PDF with MuPDF's flat picture read.
 *
 * ## What it reports
 *
 * - per mode: Word's inline and floating shape counts and its page count;
 * - layout: each picture's box in Word's PDF against the page's, and the largest difference in points;
 * - rich: the pictures in Word's PDF, and whether the first one lies between the two paragraphs it sat between;
 * - text, the control: Word's PDF carries no picture.
 *
 * Windows only, and only where Word is installed; it prints what it could not run rather than a pass.
 *
 * Usage: node scripts/research/wordPicturesInWord.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { WORD_PICTURES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { formatError } from '../lib/reportError.mjs';
import { ABOVE, BELOW, PICTURE_BOXES, picturedPage } from '../lib/wordPictureFixture.mjs';

const ROOT = repoRoot();
const MODES = /** @type {const} */ (['text', 'layout', 'rich']);

// Word through COM: each package opened read-only (not converted, not added to recent files), its shapes counted,
// saved as PDF (format 17), closed without saving. The directory arrives in the environment, so nothing is quoted.
//
// EACH PATH IS CAST TO [string] BEFORE IT REACHES WORD. Measured 2026-10-01: `SaveAs2` handed `Join-Path`'s output
// uncast did not return in 180 s (twice) or 90 s (once, the script alone), and wrote no PDF; the same script with only
// that argument cast returned in under 10 s with the PDF written. `Documents.Open` accepted the uncast value. Why Word
// waits is not established here — an invisible dialog is the likely reading and is not observed.
//
// EACH STEP PRINTS ITSELF to stderr as it passes, so a run that hangs names the step it hung in — which is what found
// the cast. QUIT TAKES NO ARGUMENT: PowerShell refuses a plain value for its by-ref parameter, which left every Word
// this started running.
const WORD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$directory = $env:MONSTERA_WORD_DIRECTORY
$word = New-Object -ComObject Word.Application
[Console]::Error.WriteLine('started')
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
try {
  foreach ($mode in 'text', 'layout', 'rich') {
    $document = $word.Documents.Open([string](Join-Path $directory ($mode + '.docx')), $false, $true, $false)
    [Console]::Error.WriteLine($mode + ': opened')
    try {
      $results += [pscustomobject]@{
        mode = $mode
        inline = $document.InlineShapes.Count
        floating = $document.Shapes.Count
        pages = $document.ComputeStatistics(2)
      }
      [Console]::Error.WriteLine($mode + ': counted')
      $document.SaveAs2([string](Join-Path $directory ($mode + '.pdf')), 17)
      [Console]::Error.WriteLine($mode + ': saved as PDF')
    } finally {
      $document.Close(0)
    }
  }
} finally {
  $word.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
ConvertTo-Json -Compress -InputObject $results
`;

/**
 * The pictures MuPDF finds on page 1 of a PDF, top-down, and where the two paragraphs are.
 *
 * @param {any} mupdf @param {Uint8Array} bytes
 */
function picturesIn(mupdf, bytes) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = document.loadPage(0);
  /** @type {number[][]} */
  const boxes = [];
  const flat = page.toStructuredText('preserve-images');
  flat.walk({ onImageBlock: (/** @type {number[]} */ bbox) => boxes.push(bbox) });
  const text = page.toStructuredText('');
  const above = text.search(ABOVE)[0]?.[0];
  const below = text.search(BELOW)[0]?.[0];
  flat.destroy();
  text.destroy();
  document.destroy();
  return { boxes, aboveY: above?.[1] ?? null, belowY: below?.[1] ?? null };
}

if (process.platform !== 'win32') {
  process.stdout.write('NOT RUN: Word is driven through COM, which is Windows only.\n');
} else if (bindNativeEngine(ROOT) === null) {
  process.stdout.write('NOT RUN: the MuPDF shim is not built. Run `npm run provision:mupdf`.\n');
} else {
  refuseStaleBuild(ROOT, WORD_PICTURES, 4);
  /** @type {any} */
  const { composeWordDocument } = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'wordPictures.js')).href);
  /** @type {any} */
  const { mupdfWriter } = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'mupdfWriter.js')).href);
  /** @type {any} */
  const mupdf = await import(pathToFileURL(join(ROOT, 'packages', 'kernel', 'dist', 'mupdfRaw.js')).href);

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-word-'));
  const session = await mupdfWriter.open(await picturedPage());
  try {
    for (const mode of MODES) {
      const parts = [];
      for await (const part of composeWordDocument(session, mode).chunks) parts.push(part);
      writeFileSync(join(scratch, `${mode}.docx`), Buffer.concat(parts));
    }

    const word = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WORD_SCRIPT], {
      env: { ...process.env, MONSTERA_WORD_DIRECTORY: scratch },
      encoding: 'utf8',
      timeout: 180_000,
    });
    if (word.status !== 0) {
      process.stdout.write(`WORD FAILED (exit ${String(word.status)}):\n${word.stderr}\n${word.stdout}\n`);
      process.exitCode = 1;
    } else {
      /** @type {{ mode: string, inline: number, floating: number, pages: number }[]} */
      const counted = [JSON.parse(word.stdout.trim())].flat();
      for (const row of counted) {
        process.stdout.write(`Word opened ${row.mode}: ${String(row.inline)} inline, ${String(row.floating)} floating, ${String(row.pages)} page(s)\n`);
      }

      for (const mode of MODES) {
        const found = picturesIn(mupdf, new Uint8Array(readFileSync(join(scratch, `${mode}.pdf`))));
        process.stdout.write(`\n${mode}: Word's PDF carries ${String(found.boxes.length)} picture(s)\n`);
        for (const box of found.boxes) process.stdout.write(`  at ${box.map((value) => value.toFixed(2)).join(', ')}\n`);
        if (mode === 'layout') {
          let worst = 0;
          for (const expected of PICTURE_BOXES) {
            const nearest = Math.min(
              ...found.boxes.map((box) => Math.max(...box.map((value, index) => Math.abs(value - (expected[index] ?? 0))))),
            );
            worst = Math.max(worst, nearest);
          }
          process.stdout.write(`  largest difference from the page's boxes: ${worst.toFixed(2)} pt\n`);
        }
        if (mode === 'rich') {
          const first = found.boxes[0];
          process.stdout.write(
            `  the paragraphs at y ${String(found.aboveY?.toFixed?.(1) ?? 'not found')} and ${String(found.belowY?.toFixed?.(1) ?? 'not found')}; ` +
              `the first picture spans y ${first === undefined ? '(none)' : `${first[1]?.toFixed(1) ?? ''}–${first[3]?.toFixed(1) ?? ''}`}\n`,
          );
        }
      }
    }
  } catch (error) {
    process.stdout.write(`FAILED: ${formatError(error)}\n`);
    process.exitCode = 1;
  } finally {
    await mupdfWriter.close(session);
    rmSync(scratch, { recursive: true, force: true });
  }
}
