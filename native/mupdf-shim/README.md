# `monstera_mupdf` — the native MuPDF seam

A flat C ABI over MuPDF, bound with koffi. This is the seam
[ADR-0010](../../docs/DECISIONS/0010-native-mupdf-through-an-ffi-shim.md)
mandates; it is not a helper or an optimisation.

## Why a shim exists at all

MuPDF's error handling is `fz_try`/`fz_catch`, which is `setjmp`/`longjmp`. A
`longjmp` that unwinds through frames koffi created is **undefined behaviour** —
koffi keeps its own stack bookkeeping and MuPDF would jump straight past it.

So every `fz_try`/`fz_catch` pair lives **entirely inside one exported
function**, and what crosses the ABI is an `int` and a message. Nothing throws
across the boundary. This is the same property that makes PDFium's flat API bind
cleanly today.

Two further rules the source keeps:

- **No C++**, so there is no name mangling for koffi to work around.
- **Opaque handles.** The caller never sees a `fitz` struct, so the ABI does not
  change when MuPDF's internals do.

## Building

```bash
npm run provision:mupdf
```

That is the whole recipe. It fetches the source tarball against a pinned
SHA-256, builds MuPDF's static libraries, compiles and links this shim, and
verifies the DLL exports every `MZ_EXPORT` symbol the source declares. Roughly
ten minutes cold, seconds when only the shim changed (`--skip-mupdf`).

`npm run proof:shim` checks that the export verification can actually fail, by
pointing it at a DLL missing a declared symbol — the state a build that silently
did not run leaves behind.

MuPDF is **not** vendored. The source lands in `.tools/mupdf/<version>/`, with
every other provisioned artefact, and `.gitignore` covers it. It previously
defaulted to `native/src/`, which `.gitignore` does **not** cover: following the
recipe left roughly 15,000 untracked third-party files in `git status`.

Static, not shared, on purpose: MuPDF's headers carry no `dllexport`
annotations, so exporting `fz_*` from a DLL would mean patching thousands of
declarations. The shim owns the export surface instead.

### Three mechanisms that will otherwise waste an afternoon

**`vcvars64.bat` cannot be used programmatically, and the reason usually given
is wrong.** This file previously recorded that `%ProgramFiles(x86)%` "cannot
survive a parent shell that can't represent a variable name containing
parentheses — so it arrives unset". That is false, and measured to be false:
the variable reads correctly from Node, and from a `cmd` launched by bash.

What actually breaks is cmd's own block parser. Expanded inside a parenthesised
block, `%ProgramFiles(x86)%` is terminated at the `)` inside its own name:

```
if 1==1 ( echo [%ProgramFiles(x86)%] )    →  ] was unexpected at this time.
```

so vcvars' `vswhere` lookup collapses, the path degrades to
`\Microsoft Visual Studio\...`, and it reports `\Microsoft was unexpected at
this time` — an error naming neither the variable nor the cause. It fails
identically with `cmd` as the parent, so **the shell plays no part and changing
shells does not help.** `scripts/lib/msvc.mjs` records the four measurements and
resolves the toolchain through `vswhere` directly; MSBuild needs no vcvars at
all.

**The install layout is not fixed.** A machine may carry `BuildTools` under
`Program Files (x86)` or `Community`/`Professional`/`Enterprise` under
`Program Files`. A hardcoded path is a single-machine build dressed as a recipe,
so `vswhere` is asked, and asked specifically for an install carrying the C++
toolset — otherwise a .NET-only install matches.

**MuPDF's solution pins Platform Toolset `v142` (VS2019).** With VS2022, every
project fails with `MSB8020` unless `/p:PlatformToolset=v143` is passed.

One more, smaller: the source tarball contains four symlinks, in freeglut's demo
programs and zxing-cpp's Python and Rust bindings. Windows cannot create a
symlink without elevation or Developer Mode, so bsdtar writes every other file,
fails on those four, and exits 1 — leaving a tree that looks extracted while the
command reports failure. They are excluded, from a list read out of the archive
rather than hardcoded, so a version bump cannot quietly reintroduce it. That
they are not build inputs is not taken on trust: the link step resolves every
symbol or provisioning fails.

## Surface

Lifecycle (`mz_init`, `mz_drop`, `mz_open`, `mz_close`, `mz_last_error`),
queries (`mz_page_count`, `mz_object_count`, `mz_page_bounds`,
`mz_page_geometry`), rotation with the exact prior-state semantics the engine
spike proved (`mz_page_rotation`, `mz_set_page_rotation`,
`mz_clear_page_rotation`), save (`mz_save`, with an incremental flag), render
(`mz_render_page`, `mz_free_pixmap`), and instrumentation (`mz_alloc_stats`,
`mz_store_size`, `mz_open_page_count`, `mz_purge_objects`, `mz_shrink_store`).

`mz_page_geometry` reads page size and rotation from the dictionary **without**
loading the page. That distinction is not cosmetic: a full page load costs
370 MB on a 141-page fixture where geometry costs 10 MB, and scroll layout needs
only geometry.

The instrumentation entries exist because RSS cannot distinguish "MuPDF retains
this" from "the C runtime is sitting on it" from "we leak it".
`mz_alloc_stats` counts live bytes inside MuPDF through a `fz_alloc_context`
hook, which is how the memory question in ADR-0010 was settled. They are not
debug leftovers — keep them.

## Not yet done

- Windows only. Other platforms need MuPDF built through its Makefile.
- The surface covers the operations measured so far, not the whole C3 matrix.
- `koffi` is a root devDependency because the only consumer today is the
  measurement script. It moves to `packages/kernel` when the kernel's FFI
  adapter exists, which is where ADR-0010 puts it.

Provisioning is done: `scripts/provision/mupdf.mjs` fetches source against a
pinned SHA-256, builds, links and verifies the export surface, and runs in CI on
`windows-latest`. The earlier `scripts/provision/mutool.mjs` was withdrawn
because it fetched a command-line tool rather than the library this needs.
