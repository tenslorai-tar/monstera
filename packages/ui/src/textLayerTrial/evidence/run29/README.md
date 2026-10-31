# Text-layer trial, cloud run 29: raw results as measured

**Measured 2026-10-30**, on Linux in a cloud container, in **Chromium 151.0.7922.34** (Playwright 1.62.1's headless
shell, revision 1234, installed by `npx playwright install chromium`), driven with Playwright's mouse and keyboard.
These files are the measurement as it came out of the instrument and are not edited. They are evidence, not baselines.

The page is run 18's agreement page (`packages/testing/fixtures/text-markup/agreement-lines.json`: Times, standard 14,
not embedded, 11 pt), its letters placed by Times' metrics. `span` is the shipped `TextLayer.tsx`; `svg` is
`../../SvgTextLayer.tsx`, the same file with each line an SVG `<text>` carrying a position per letter. Run 29's
instrument was `svgTrial.measure.ts`; it is kept as `packages/testing/src/textLayerTrial.measure.ts`, with only its paths
moved and the lint findings its new home raised fixed (string spreads written as UTF-16 index ranges, which is what they
were; three optional chains). Run 29b extends that file.

## The command

```
npx esbuild <trial>/harness.tsx --bundle --format=iife --jsx=automatic --define:process.env.NODE_ENV='"production"' --outfile=<scratch>/harness.js
TRIAL_OUT=<scratch>/<file> TRIAL_HARNESS=<scratch>/harness.js [TRIAL_SIZED=1] npx playwright test --config <scratch>/trial.config.mjs [-g <filter>]
```

The config was `../../../../../../scripts/research/textLayerTrial.config.mjs` with an absolute `testDir`.

## The files

| file | filter | `TRIAL_SIZED` | what it holds |
|---|---|---|---|
| `out.jsonl` | none (the first two groups) | unset | each letter's laid-out left against the page's, and a press 30% into every letter, three faces; presses at 90, 180, 270 degrees and 50 % and 400 % |
| `out2.jsonl` | `gestures` | unset | drag ends, double and triple click, Shift+Arrow, copy across a line end, the caret API, a click's wobble, blank space, beside a line, the line element's box against the engine's, the accessibility tree |
| `out3.jsonl` | `press sides\|screen reader` | unset | a press 70% into every letter, and each glyph cell's width against the page letter's; the accessibility tree by the SVG's `role` |
| `out4.jsonl` | `svg` | 1 | the SVG rows of all of the above with the letters at the glyph size (11 pt) rather than the box's height |
| `out5.jsonl` | `flip points\|visible highlight` | 1 | where a press flips from before a letter to after it, by bisection with clicks, against the page letter's middle; `highlight-today.png` and `highlight-svg.png` (sans-serif, 400 %) |
| `out6.jsonl` | `cost of 300` (run twice) | 1 | 300 dense pages (45 lines of 95 letters) mounted at once: elements, JS heap, mount time, a wheel scroll's frame times |
| `out7.jsonl` | `cost of 300` (run twice) | 1 | the same, with the mount split into render and layout |
| `out8.jsonl` | `route` | 1 | route (a)'s raw facts with plain per-letter spans and none of the application's rules: flip points, cost; `highlight-per-letter.png` |

The scroll in `out6.jsonl` ran with every page already laid out, and headless Chromium paces frames at 60 Hz, so it
cannot see a page arriving during a scroll. Run 29b measures that.
