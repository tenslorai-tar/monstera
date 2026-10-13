# ADR-0234 — Every conversion is named work, shown from its chosen input until its result

- **Status:** Accepted
- **Date:** 2026-10-13
- **Amends:** [ADR-0202](0202-a-whole-page-may-be-read-by-a-service-when-the-person-chose-these-pages-for-an-export.md)
  Decision 5 (the Excel export's own progress and cancel channels). A correction is dated under it.
- **Decided by:** the owner's O9: *"When it is running, users are not notified that it is running … a notification on the
  screen that says converting markdown to pdf."* Build one shared notice every conversion registers with, shown from the
  moment the input is chosen until the result appears, with progress where it is known and Cancel where the work can
  stop; a conversion that does not register fails a check.

## Where it stood

The notice existed: `TaskNotice.tsx`, fed by `track` (`runningTask.ts`), in the toast strip. What fed it was the problem.

| route | conversions on it | when the notice showed |
|---|---|---|
| `work.progress` / `work.cancel`, a name the renderer mints (`withWorkProgress`) | CSV import only | from the call, so while main's file picker was open too |
| `document.exportProgress` / `document.cancelExport`, keyed by `DocId` (ADR-0202 D5) | Excel export read by a service | from the call |
| `track` around a renderer-side loop | OCR, Straighten, Enhance, word count | from the loop's start, which is after any choice |
| nothing | Markdown, Office, images, camera, web address, Insert from Markdown, Insert images, every other export | never |

Two routes answered the same question, *how far has this work in main got, and stop it*, which is B3a's shape: two
opinions about one authority. And nothing made a new conversion take either.

## Decision

1. **One route for work in main: `work.progress` and `work.cancel`.** `document.exportProgress` and
   `document.cancelExport` are removed; the Excel export reports and stops under the work's name like every other
   conversion.
2. **Every conversion channel takes the work's name, REQUIRED.** `CONVERSION_CHANNELS` in the contract lists them: every
   `document.newFrom*`, every `document.export*`, `document.openFromUrl`, `document.appendMarkdown` and
   `document.insertImage`. A required parameter means a renderer call without a name does not compile, and a main method
   that takes the name and never begins it is an unused parameter, which lint refuses.
3. **Main begins the work when the input is chosen**, after the picker answers and before anything is read or
   converted, and ends it when the call answers. Before that its name answers `idle`, so a picker that is open shows no
   notice and a picker dismissed never showed one.
4. **The renderer shows the notice when main first says `running`**, not when the call starts (`withWorkProgress`), and
   hides it when the call answers. It asks every 200 ms until then and every second after, the measured interval.
5. **Progress where it is known, Cancel where the work can stop.** `running` carries `stoppable`. Work cut into parts
   (CSV in parts, the Excel service read) steps a count and is stoppable at its next part; a single conversion shows
   its label with no count and no Cancel, because a Cancel that could not stop it would be the display-only defect with
   a button on it.
6. **The check.** `conversionChannels.test.ts` in the contract asserts that every listed channel refuses params without
   `work`, and that every channel whose name says it converts (`newFrom`, `export`, `FromUrl`, `appendMarkdown`,
   `insertImage`) is listed, so a conversion added tomorrow under one of those names fails until it registers.
   Renderer-side loops (OCR, Straighten, Enhance) keep `track`, which feeds the same notice.

## Rejected alternatives

- **Show the notice from the call, renderer-side only.** No channel change. Rejected: the picker is main's, so the
  notice would sit over the open dialog and show for a conversion the person then cancelled, which is not *from the
  moment the input is chosen*.
- **Keep `document.exportProgress` beside `work.progress`.** Rejected under B3a: a third conversion would have to pick
  one, and the two disagree about the key (`DocId` against a name), so two Excel exports of different documents and an
  Excel export beside a CSV import are answered by different rules.
- **An optional `work`.** It is what `document.newFromCsv` had. Rejected: optional is exactly how every other conversion
  came to have none.

## Limits, stated

- A conversion named outside the pattern in Decision 6 is not caught by the name check; the required parameter then
  catches it only once someone lists it. The pattern covers every conversion that exists on 2026-10-13.
- Lint proves the name is used, not that it is begun after the picker. The order is held by each method's own code and
  by the root cases that drive one picker each.

## Consequences

- Sixteen channels gain `work`; the renderer's conversion commands run through `withWorkProgress`.
- The Excel export's read steps and stops through `WorkInProgress`; ADR-0202 D5's two channels are gone.
- `TaskNotice` hides Cancel for work that cannot stop.
