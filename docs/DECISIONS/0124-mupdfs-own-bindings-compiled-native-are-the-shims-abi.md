# ADR-0124 — MuPDF's own bindings, compiled native, are the shim's ABI

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decided by:** the owner's list of 29 September (night), item 2 — *"Native MuPDF … an ADR with the shim's ABI
  design (how the object model the kernel uses crosses the flat-C boundary, and what the shim must add)"* — on a
  decision already in the law: `docs/ARCHITECTURE.md` §3, *"native, both engines, koffi"* (2026-09-08), and
  [ADR-0010](0010-native-mupdf-through-an-ffi-shim.md)'s corrections. The owner's answer of the same night: the shim
  is built on Linux too, so the kernel's engine tests run natively on both CI legs.
- **Amends:** `docs/ARCHITECTURE.md` §3 (the MuPDF adapter's shape), §9.17 (whose `mupdf-host` figure now measures
  the native engine).

## Context

The document pipeline reaches MuPDF through the npm package's WASM build. `npm run proof:enginesurface`, run
2026-09-30: **33** non-test kernel modules import the bare specifier `mupdf` — **11** load it, **22** import types
only — and they call **140** distinct members of MuPDF's object model, 44 of them on `PDFAnnotation`, 24 on
`PDFObject`, 21 on `PDFDocument`. The shim exports **26** C functions and hands back opaque handles, so none of the
140 has a counterpart.

What costs: the WASM build copies the whole file into its heap and is capped at 2 GB, and FEATURES' perf row measured
a 200 MB scan at about 5× its size against a 1.5× target. Right-to-left text waits too: the npm build carries no Noto
fonts for Arabic or Hebrew.

**The fact that decides the shape.** The npm package is not a separate binding. It is built from two files in MuPDF's
own source, both present in the provisioned 1.28.0 tree (`platform/wasm/lib/`): `mupdf.c`, a flat-C layer of **319**
exported `wasm_*` functions over MuPDF's API, and `mupdf.ts`, the object model — every class and member the kernel
calls — written against those exports. The package's version is 1.28.0, the source's is 1.28.0, and both are AGPL v3,
as this repository is. The 140 members are that object model.

## Decision

1. **The shim's ABI is MuPDF's own flat-C binding, compiled native.** `mupdf.c` is compiled into `monstera_mupdf`
   beside the shim's own `mz_*` functions, and its 319 exports are the ABI the object model calls. The rejected
   alternative is below: a hand-written wrapper per member would be a second opinion about how MuPDF's API is
   bound, beside the binding MuPDF ships (B3a).
2. **MuPDF's error unwind ends inside the DLL.** In WASM, `mupdf.c`'s `wasm_rethrow` throws a JavaScript exception
   that unwinds the WebAssembly stack. Native, a `longjmp` through koffi's frames is undefined behaviour — the
   shim README's founding rule. So a generated wrapper stands in front of every export: it `setjmp`s in its own
   frame, calls the implementation, and `wasm_rethrow` becomes a `longjmp` to the innermost wrapper, which returns a
   zero value. The error's kind and MuPDF's own message are read after every call and thrown in JavaScript with the
   WASM build's words. Nothing unwinds past the DLL's boundary.
3. **The shim supplies what emscripten's runtime supplied, typed, rather than emulating it.**
   - **Memory.** Pointers cross as `intptr_t` numbers. Measured 2026-09-30: koffi returns a native address as an
     exact JavaScript number, and a heap block sat at 1.24 × 10¹² — so `mupdf.ts`' `ptr >> 2` into a heap view
     would truncate it. Reads and writes go through exported accessors instead of heap views.
   - **Callbacks into JavaScript.** About 35 `EM_ASM` sites call JavaScript: the custom device (the kernel's
     `flatFields.ts` and `pageFills.ts` implement `fillPath` and `strokePath`), the path and text walkers, streams,
     fonts and logs. Their arguments mix floats and pointers, and the stream callbacks cast a pointer to `int`, which
     WASM allows and a 64-bit build truncates. So each family has a hand-typed native adapter calling one callback
     registered through koffi, and the generator refuses any `EM_ASM` it does not recognise.
   - **The signature table.** The generator writes each export's C signature into the DLL, and `mupdfRaw.ts` binds
     from that table, so the C prototypes are the only statement of the ABI.
4. **The object model is MuPDF's own `mupdf.ts`, carried in `mupdfRaw.ts`.** It is ported by changing memory access
   and nothing else, and it is the one module allowed a file-level lint disable (B7's native-boundary exception). A
   proof pins the upstream file's digest, so a MuPDF upgrade cannot pass without the port being redone and read.
5. **Binding happens where the library's path is known, never in `main`.** The engine hosts are started with the path
   (ADR-0087's rule); tests and instruments bind through the provisioning script's resolver. The kernel's modules
   import `./mupdfRaw.js`, as values where they load an engine and as types where they do not.
6. **Both platforms build it.** The owner's answer: MuPDF and the shim are built on the Linux leg as a shared object,
   cached as the Windows build is, so the kernel's engine tests run against the native engine on both legs.
7. **What moves with it:** §9.17's `mupdf-host` budget is re-measured on the native engine; the four proofs that scan
   `monstera_mupdf.dll` now scan the engine the pipeline loads, which is the same file; `proof:enginesurface` passes
   when no kernel module imports the bare specifier and every export the object model calls is in the DLL; and the
   npm `mupdf` package leaves the shipped tree once nothing imports it.

## Rejected

- **A hand-written shim per member** — about 150 C functions for today's 140 members, each a new opinion on MuPDF's
  API, and every later feature owing more. MuPDF already maintains that layer.
- **Keeping the WASM engine.** The law decided against it on 2026-09-08, and the perf row's 5× is its cost.
- **Compiling `mupdf.c` untouched against a macro-only `emscripten.h`.** A macro cannot type an `EM_ASM` argument
  list that mixes floats and pointers, and cannot undo a pointer cast to `int`.
- **C++ exceptions in place of `setjmp`.** The shim is C by rule, for koffi's sake.
- **A proxy over heap views.** It cannot see the address a `>> 2` has already truncated.

## Consequences

- The binding covers MuPDF's whole API, not the kernel's 140 members, so a later feature calls a member that is
  already bound.
- A MuPDF upgrade becomes a re-port of one file's memory access, which the pinned digest forces.
- The npm package's top-level `await` goes away: binding is explicit and synchronous, and a call before binding
  throws, naming the missing path.
