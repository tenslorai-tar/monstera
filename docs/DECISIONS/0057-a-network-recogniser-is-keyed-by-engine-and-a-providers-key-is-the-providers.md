# 0057 — A network recogniser is keyed by engine, and a provider's key is the provider's

Accepted 2026-09-13.

## Context

The owner added a D6 row on 2026-09-12, after Stage 6 closed: **Claude, as a fourth
recogniser beside Azure Document Intelligence.** It is Azure's class — it runs in
`main` because invariant 25 gives the engine host no network, it calls a service
over HTTPS, its key is a secret, and it must answer a `RecognisedPage`. The owner
named the design question: *a second network engine is the trigger to decide
whether one network-recogniser shape, parameterised by provider, is owed; if the
seam must bend, that is B4, in its own commit.*

It is owed, and read from the code rather than argued. *Which engines run in main*
is written today as literals in three places, each correct for one network engine:

- `commandDeclarations.ts`' pre-read is a two-way ternary —
  `command.engine === 'azure' ? … : handwriting`. **A fourth engine added to the
  contract's list alone would be silently recognised as handwriting.** That is
  the latent defect this decision exists to close, not a tidiness point.
- `composition.ts` branches on `request.engine === 'azure'`.
- `RecognitionRequest` has an arm whose discriminant is the literal `'azure'`.

Adding Claude by writing `|| 'claude'` at each is the second opinion B3a names,
three times over.

ADR-0052's addition (2026-09-12) settled *where* a recogniser runs — per engine,
by what its input must reach — and *how its raster arrives*: the host rasterises
the region and the frame travels with it. It did not consider a second network
engine, and its Decision 8 says Azure is not an `AiProvider`. **Claude is one**:
`BUILD-PROMPT.md` E5 lists Anthropic in the `AiProvider` registry that Stage 9
builds.

## Sources read, 2026-09-13

- Anthropic, *Coordinates and bounding boxes*
  (`platform.claude.com/docs/en/build-with-claude/vision-coordinates`): coordinates
  are pixels, origin top-left, *in the image Claude sees after resizing*; padding
  is on the bottom and right only; `"transformations": {"oversized_image":
  "error"}` turns a server-side resize into a 400; outputs are *approximate* and
  should be spot-checked; a PDF sent as a document is rasterised server-side at
  dimensions the caller does not control, so its coordinates *can't be reliably
  mapped back onto the page*; normalised 0–1000 coordinates *do not work well*.
- Anthropic, *Vision*: an image costs `⌈width/28⌉ × ⌈height/28⌉` visual tokens;
  the high-resolution tier (Claude 4.7 and later) allows a 2576 px long edge and
  4784 tokens.
- Anthropic, *Structured outputs*: `output_config.format` with
  `type: "json_schema"`, no beta header; numeric and array-length constraints and
  any `additionalProperties` but `false` are not supported.
- Anthropic, *Handling stop reasons*: `end_turn`, `max_tokens`, `stop_sequence`,
  `tool_use`, `pause_turn`, `refusal`, `model_context_window_exceeded`; a
  `refusal` is *a normal HTTP 200 response, not an error*.
- Anthropic, *Errors*: 400, 401, 402, 403, 404, 409, 413, 429, 500, 504, 529, each
  body `{ type: "error", error: { type, message }, request_id }`.
- Anthropic, *Models overview* and *Pricing*: `claude-opus-5` supports vision and
  structured outputs, at $5 / $25 per million input / output tokens.

## Decisions

### 1 — The network engines are declared once, in the contract

`NETWORK_OCR_ENGINES`, a subset of `OCR_ENGINES`, is the only list of engines
that execute in `main`. Every question with an engine in it reads that list — the
pre-read, the composition root, the request type, and the tool gate — and the
pre-read's branch becomes **exhaustive over the engine type**, so an engine with
no arm is a compile error rather than a handwriting recognition.

### 2 — Main holds one recogniser per network engine, in a record keyed by engine

`{ credentials(settings, secrets) → C | null, recognise(credentials, raster) →
RecognisedPage }`, in a `Record` over the network-engine type. The composition
root's branch becomes one lookup, and an engine added to the contract without an
entry does not compile. `RecognitionRequest`'s cloud arm is keyed on the network
type rather than on `'azure'`.

### 3 — Every network recogniser takes the host's raster and its frame

ADR-0052 §7's route, unchanged: `engine/snapshotRegion` rasterises, the frame
travels, and the answer returns through `pageTransform`. No provider brings a
frame of its own.

### 4 — Claude reads a raster it will not resize, and answers a shape the kernel checks

- **The raster is sized to fit the model's tier before it is sent, and the image
  block carries `oversized_image: "error"`.** A resize the build did not do then
  cannot happen silently, so the pixel coordinates Claude returns are the
  raster's own and the one frame conversion applies. Rescaling after a
  server-side resize was rejected: a model on a different tier would shift every
  coordinate with no error.
- **The answer is constrained by `output_config.format`, and validated again in
  the kernel.** The schema cannot bound a number or an array's length, so a box
  outside the raster, or of the wrong arity, is refused as an unreadable answer
  rather than drawn.
- **Any `stop_reason` but `end_turn` is refused, by name.** `max_tokens` means the
  JSON was cut off; `refusal` arrives as a 200. Neither is an empty page.

### 5 — The Anthropic key is the provider's, and Stage 9 takes it

One secret id, `ai.anthropic-key`, in a new `ai` settings category — Part F's AI
group — declared in `SECRET_SETTING_IDS`. **It is not a recogniser key.** Stage 9's
provider registry uses this id for Anthropic rather than minting a second one, and
both Stage 9 rows say so. The Azure pair stays in Editing; reaching them does not
need the move.

### 6 — The model is a sourced constant until Stage 9's model setting exists

`claude-opus-5`, read from the models overview on 2026-09-13: vision, the
high-resolution tier, structured outputs, and the lower of the two prices that
offer that tier among current models. Part F's *AI: provider · model* setting is
Stage 9's; when it lands, the recogniser reads it and this constant is deleted.
That expiry is written into the D6 row.

### 7 — The row is not done until a live run, and cost is not a string it ships

ADR-0052 Decision 9's rule, applied again: a harness in `scripts/probes/`, the
drawn-word control, box placement asserted. **No per-page cost figure appears in
the interface.** Measured 2026-09-13, Azure's Read price is $1.50 per 1,000 pages
for the first million (Microsoft's retail prices API, Central US, USD, effective
2022-03-01) — so *a cent or two per page* is wrong for Azure by about ten times —
and Claude's per-page cost turns on output tokens nobody has measured.

## Rejected

**`|| 'claude'` at each call site.** Three literals that agree today, and a
ternary that routes the next engine to handwriting.

**Recognition through Stage 9's `AiProvider.vision` now.** The registry is Stage 9's
work, and building it inside a D6 row is building a stage early. The recogniser
makes one narrow call; the registry adopts the key and the call when it arrives.

**Sending the PDF to Claude.** Anthropic's own documentation says the coordinates
cannot be mapped back onto the page, and it would send the whole document where
the reader asked about a region.

**Normalised coordinates.** Anthropic's documentation says they work poorly.

## What this does not decide

- **How accurate Claude's boxes are.** *Approximate* is Anthropic's word; the
  number is the live run's to produce.
- **Moving the Azure pair into the `ai` category.**
