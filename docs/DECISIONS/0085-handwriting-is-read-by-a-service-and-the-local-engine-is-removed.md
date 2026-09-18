# ADR-0085 — Handwriting is read by a service, and the local TrOCR engine is removed

- **Status:** Accepted
- **Date:** 2026-09-18
- **Decided by:** the owner, 2026-09-17.
- **Supersedes:** `BUILD-PROMPT.md`:475, *"local handwriting OCR (TrOCR small/base, on-demand
  download, cached, offline)"*, and :806, *"the TrOCR/onnxruntime stack … follows the same
  pinned-hash-on-demand pattern as its models"*; [ADR-0052](0052-a-second-recogniser-arrives-on-demand-and-reads-a-region.md)'s
  local engine, including its 2026-09-17 correction that shipped the ONNX runtime; and the
  handwriting half of §3's recognition row.
- **Keeps:** ADR-0052's shape where it is not about TrOCR — the request names the engine, every
  engine answers a `RecognisedPage`, and a region is the scope handwriting is offered on — and
  [ADR-0057](0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)'s
  declared set of network engines.

## Why

The models are not ours to ship. The TrOCR handwriting models are fine-tuned on the IAM
Handwriting Database, whose terms permit **non-commercial research only**; and the small model
publishes no licence at all. A licence the product cannot meet is not a download-on-demand
problem that a pinned digest solves: the weights would still be fetched, cached and run by a
commercial product on the reader's machine.

## Decision

1. **The local handwriting engine is removed**: `ocrHandwriting.ts`, the model artefact list and
   its downloader, the handwriting cache and its clear control, the ONNX Runtime provisioning and
   its NOTICE entries, the handwriting proof and its CI step, the handwriting settings, and the
   engine's name in the contract's OCR engine set. Excel table detection's local-handwriting option
   goes with it: **five reading engines become four** — Tesseract, and the network engines.
2. **Handwriting means a network engine**: Azure Document Intelligence or Claude, both already
   declared by ADR-0057 and both run in `main`. Nothing new is built to replace the local engine.
3. **Azure's result is deleted after each read.** `ocrAzure.ts` never called *Delete Analyze
   Result*, so a reader's region and its recognition stayed on Microsoft's servers for the
   service's 24-hour retention. It calls it after every read, and a failed deletion is reported.
4. **Claude's handwriting model is chosen by measurement**: Sonnet 5 against Opus 5 on the same
   real handwriting; Sonnet becomes the default if it reads them as accurately ($2/$10 against
   $5/$25 per million tokens). Both results are recorded either way, and the model ids are taken
   from Anthropic's models endpoint, never from memory.
5. **The handwriting dialog carries one line**: add an Azure or an Anthropic key in Settings. No
   link yet — the Help article it will point at is Stage 10's.

## Rejected

- **Keeping the engine behind a notice.** The terms restrict the use, not the attribution.
- **Keeping the engine for "personal" use only.** The application has no personal edition to
  put it in, and a switch nobody can verify is the terms broken with extra steps.
- **Retraining on licensed data.** A training programme is not a Stage 8 or 9 row, and the owner
  chose the services.

## Consequences

- The installer's ONNX Runtime files (13.9 MB of WASM, provisioned 2026-09-17) and the
  `huggingface.co`/`*.hf.co` download hosts leave. **The model cache is the application's own
  data and it removes it**: a reader who downloaded the models holds 63 MB or more under
  `userData` that nothing will read again, so main deletes that one directory at start, once,
  and names what it removed in the shell log.
- `docs/FEATURES.md`'s local handwriting row is closed as withdrawn, naming this decision.
