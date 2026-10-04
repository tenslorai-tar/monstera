/*
 * The native runtime under MuPDF's own binding
 * (docs/DECISIONS/0124-mupdfs-own-bindings-compiled-native-are-the-shims-abi.md).
 *
 * In WASM, emscripten supplied three things mupdf.c relies on: a way to throw
 * past the C stack, a heap the JavaScript side reads directly, and calls into
 * JavaScript. This file supplies each natively:
 *
 *  - the unwind: mzg_throw longjmps to the innermost generated wrapper, which
 *    is always a frame of this DLL, so nothing unwinds through koffi's frames;
 *  - memory: pointers cross as intptr_t numbers, and the object model reads and
 *    writes through mzg_read and mzg_write rather than through a heap view;
 *  - JavaScript: one callback, registered once, reached through mzg_js.
 *
 * One thread: the host runs every call on its main thread, as the WASM build
 * did, so the error state and the jump chain are plain statics.
 */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "monstera_emscripten.h"

typedef int (*mzg_js_callback)(const char *target, int argc, const double *argv, double *result);

static jmp_buf *mzg_top;
static int mzg_kind = MZG_NONE;
static char mzg_message[1024];
static mzg_js_callback mzg_callback;

jmp_buf *mzg_enter(jmp_buf *here)
{
	jmp_buf *outer = mzg_top;
	mzg_top = here;
	return outer;
}

void mzg_leave(jmp_buf *outer)
{
	mzg_top = outer;
}

FZ_NORETURN void mzg_throw(int kind, const char *message)
{
	mzg_kind = kind;
	snprintf(mzg_message, sizeof mzg_message, "%s", message != NULL ? message : "");
	if (mzg_top == NULL) {
		/* No wrapper is on the stack, which only a call from outside an export can produce. */
		fprintf(stderr, "monstera_mupdf: an error with no export to return it to: %s\n", mzg_message);
		abort();
	}
	longjmp(*mzg_top, 1);
}

MZG_EXPORT int mzg_error_kind(void)
{
	return mzg_kind;
}

MZG_EXPORT const char *mzg_error_message(void)
{
	return mzg_message;
}

MZG_EXPORT void mzg_error_clear(void)
{
	mzg_kind = MZG_NONE;
	mzg_message[0] = 0;
}

MZG_EXPORT void mzg_set_js(mzg_js_callback callback)
{
	mzg_callback = callback;
}

/*
 * A failure inside mzg_js unwinds as MuPDF's own throw() decides (source/fitz/error.c): through MuPDF when an fz_try
 * is on its error stack, so MuPDF's cleanup runs, and straight to the export's wrapper when none is. fz_throw with no
 * fz_try ends the process ("aborting process from uncaught error!"), and an export can call back with none on the
 * stack: wasm_walk_text calls JavaScript from its own loop, and a walker that threw took the engine host with it.
 * The predicate is the one throw() reads, from the public fz_context, so the two cannot disagree about it (B3a).
 */
FZ_NORETURN static void mzg_js_fail(const char *target, const char *what)
{
	fz_context *ctx = mzg_context();
	char message[sizeof mzg_message];

	if (ctx != NULL && ctx->error.top > ctx->error.stack_base)
		fz_throw(ctx, FZ_ERROR_GENERIC, "monstera_mupdf: %s %s", target, what);
	snprintf(message, sizeof message, "monstera_mupdf: %s %s", target, what);
	mzg_throw(MZG_ERROR, message);
}

double mzg_js(const char *target, const char *types, ...)
{
	double argv[16];
	double result = 0;
	int argc = (int)strlen(types);
	va_list ap;
	int i;

	if (argc > (int)(sizeof argv / sizeof argv[0]))
		mzg_js_fail(target, "passes more arguments than the bridge holds");
	if (mzg_callback == NULL)
		mzg_js_fail(target, "was called before a JavaScript callback was registered");

	va_start(ap, types);
	for (i = 0; i < argc; ++i) {
		switch (types[i]) {
		case 'p': argv[i] = (double)(intptr_t)va_arg(ap, void *); break;
		case 'l': argv[i] = (double)va_arg(ap, int64_t); break;
		case 'i': argv[i] = (double)va_arg(ap, int); break;
		case 'f': argv[i] = va_arg(ap, double); break;
		default: va_end(ap); mzg_js_fail(target, "carries a bad type letter");
		}
	}
	va_end(ap);

	/* A JavaScript throw is carried as an error, through MuPDF's fz_try stack where there is one (mzg_js_fail); the
	 * object model keeps the thrown value and rethrows it when the export returns. */
	if (mzg_callback(target, argc, argv, &result) != 0)
		mzg_js_fail(target, "called back into JavaScript, which threw");
	return result;
}

MZG_EXPORT void mzg_read(intptr_t from, void *to, size_t n)
{
	memcpy(to, (const void *)from, n);
}

MZG_EXPORT void mzg_write(intptr_t to, const void *from, size_t n)
{
	memcpy((void *)to, from, n);
}

/* An address handed back typed as a pointer, so the caller can make a view over the memory at it. */
MZG_EXPORT void *mzg_pointer(intptr_t address)
{
	return (void *)address;
}

MZG_EXPORT size_t mzg_strlen(intptr_t s)
{
	return strlen((const char *)s);
}
