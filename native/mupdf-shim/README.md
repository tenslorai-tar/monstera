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

MuPDF is **not** vendored. The build fetches the source tarball
(`mupdf-1.28.0-source.tar.gz`, SHA-256
`21c7f064903154f1c3a7458bee81f130fc36f9b5147ea13328f9980e02d2dea2`, published by
GitHub as the release asset's own digest), builds the static libraries with
MuPDF's own MSVC solution, then compiles and links this shim against them.

Static, not shared, on purpose: MuPDF's headers carry no `dllexport`
annotations, so exporting `fz_*` from a DLL would mean patching thousands of
declarations. The shim owns the export surface instead.

### Two mechanisms that will otherwise waste an afternoon

**Do not use `vcvars64.bat` or `VsDevCmd.bat` from a non-`cmd` parent.** They
resolve `vswhere.exe` through `%ProgramFiles(x86)%`, and that variable's *name*
contains parentheses, which a bash or PowerShell parent process cannot represent
— so it arrives unset, the path collapses to `\Microsoft Visual Studio\...`, and
cmd reports `\Microsoft was unexpected at this time`, an error naming neither
the variable nor the cause. Invoke `MSBuild.exe` directly instead; it resolves
the toolchain from the project.

**The solution pins Platform Toolset `v142` (VS2019).** With VS2022 installed,
pass `/p:PlatformToolset=v143` or every project fails with `MSB8020`.

```
MSBuild.exe <mupdf-src>\platform\win32\mupdf.sln ^
  /t:libmupdf /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143

MSBuild.exe native\mupdf-shim\monstera_mupdf.vcxproj ^
  /p:Configuration=Release /p:Platform=x64
```

Roughly ten minutes for the first, seconds for the second. Output is a 40.1 MB
`monstera_mupdf.dll`.

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

- No provisioning script. `scripts/provision/mutool.mjs` was withdrawn because
  it fetched the wrong artifact; a replacement must fetch source, build, and
  hash-verify, and run in CI.
- Windows only. Other platforms need MuPDF built through its Makefile.
- The surface covers the operations measured so far, not the whole C3 matrix.
