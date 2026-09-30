/*
 * What MuPDF's platform/wasm/lib/mupdf.c needs from emscripten, supplied natively
 * (docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md).
 *
 * The generated glue includes this in place of "emscripten.h". It declares no
 * EM_ASM: the generator rewrites every call site into mzg_throw or a typed
 * mzg_js call, so a site it missed is a compile error here rather than a call
 * that does something else.
 */
#ifndef MONSTERA_EMSCRIPTEN_H
#define MONSTERA_EMSCRIPTEN_H

#include <setjmp.h>
#include <stdint.h>

#include "mupdf/fitz.h"

#ifdef _MSC_VER
#define MZG_EXPORT __declspec(dllexport)
/* mupdf.c marks wasm_rethrow noinline with GCC's spelling; MSVC has its own and does not need it here. */
#define __attribute__(x)
#else
#define MZG_EXPORT __attribute__((visibility("default")))
#endif

/* mupdf.c's own EXPORT macro expands to this; the generator no longer uses EXPORT. */
#define EMSCRIPTEN_KEEPALIVE MZG_EXPORT

/* The error kinds wasm_rethrow distinguishes; MZG_JS is a JavaScript callback that threw. */
enum { MZG_NONE = 0, MZG_ERROR = 1, MZG_TRYLATER = 2, MZG_ABORT = 3, MZG_JS = 4 };

/* The innermost wrapper's jump target. Each export's wrapper pushes its own and restores the outer one. */
jmp_buf *mzg_enter(jmp_buf *here);
void mzg_leave(jmp_buf *outer);

/* Records the error and jumps to the innermost wrapper. Never returns. */
void mzg_throw(int kind, const char *message);

/*
 * Calls the one JavaScript callback with TARGET and the arguments TYPES names:
 * p a pointer, i an int, l a 64-bit integer, f a float (promoted to double by
 * the varargs). Returns what JavaScript returned. A callback that threw becomes
 * a MuPDF error, so MuPDF's own fz_try stack unwinds it.
 */
double mzg_js(const char *target, const char *types, ...);

/* The glue's context, which is static in mupdf.c. */
fz_context *mzg_context(void);

#endif
