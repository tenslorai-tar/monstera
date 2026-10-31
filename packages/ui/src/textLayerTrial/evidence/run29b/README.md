# Text-layer trial, cloud run 29b: raw results as measured

**Measured 2026-10-31**, on Linux in a cloud container, in **Chromium 151.0.7922.34** (Playwright 1.62.1's headless
shell, revision 1234), driven with Playwright's mouse and keyboard. Untouched output of
`packages/testing/src/textLayerTrial.measure.ts`; evidence, not baselines.

Three layers, as `kind`: `span` is the shipped `TextLayer.tsx` (the control); `A` and `B` are `../../TrialTextLayer.tsx`
with `drawn` `span` and `svg`, both taking the engine's letter positions and the two rules (the layer paints the
selection from the range; a letter's side is decided from the engine's positions). All runs set `TRIAL_SIZED=1`.

## The command

```
npx esbuild packages/ui/src/textLayerTrial/harness.tsx --bundle --format=iife --jsx=automatic --define:process.env.NODE_ENV='"production"' --outfile=<scratch>/harness.js
TRIAL_KINDS=span,A,B TRIAL_SIZED=1 [TRIAL_PRESS=drag] TRIAL_OUT=<scratch>/<file> TRIAL_HARNESS=<scratch>/harness.js npx playwright test --config scripts/research/textLayerTrial.config.mjs -g "<filter>"
```

## The files

| file | `TRIAL_PRESS` | filter | what it holds |
|---|---|---|---|
| `clicks.jsonl` | unset | `letters and presses\|presses at\|press sides\|flip points` | presses as CLICKS: A reads exactly as today, because a click leaves the browser's caret (`holdAnchorAtPress` anchors on the first drag event) and so never reaches a press rule; B's three faces read alike because the face override still named run 29's class. Kept as the reading that showed the instrument could not see the rule |
| `drag-presses-invalid.jsonl` | drag | the same | **INVALID, kept as measured.** Each press landed inside the previous drag's selection, which starts the browser's drag of selected text and moves no anchor: every layer read about 128 of 142 presses wrong and a 12.81 pt flip. Fixed by clearing the selection before each press |
| `all.jsonl` | drag | `letters and presses\|presses at\|press sides\|flip points\|gestures\|drags\|one resolver\|painted highlight\|arriving\|painting cost` | every measurement, the fixed instrument; the nine `highlight-*.png` (sans-serif, 400 %, light, dark and high contrast) |
| `moving-ends.jsonl` | unset | `moving ends` | a drag from line 0's first letter ending 70% into each of its letters, one move and twenty: wrong ends, and the rule's corrections of the browser's focus |
| `arriving-x3.jsonl` | unset | `arriving` (run three times) | scrolling the 300-page dense document with pages arriving as the application mounts them (`SETTLE_MS`), a fling and a reading scroll: frames over 16.7 ms and 33 ms, the worst frame, each arrival's render-and-layout time |

The flip figures are the bisection's resolution at their floor: nine halvings over three letter widths, about 0.03 pt.
Frame times come from animation frames in headless Chromium, which paces them at 60 Hz with no real compositor, so a
frame count separates a 30 ms task from a 3 ms one and little finer; the arrival times are the harness's own clock.

## Angled text (ADR-0273), measured the same day

A page from pdf-lib with one upright line and one at 30 degrees (Times, 11 pt), read through MuPDF's structured-text
walk (`beginLine` and `onChar`, the npm `mupdf` package):

```
{"direction":[1,0],"letters":18,"first":["U",72,92],"second":["p",79.94,92],"last":["e",152.65,92]}
{"direction":[0.866,-0.5],"letters":17,"first":["A",72,292],"second":["n",78.88,288.03],"last":["e",140.26,252.59]}
```

The angled line's letters advance along its direction in both x and y, so a line's letters are its direction plus each
letter's advance along it.
