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

void mzg_throw(int kind, const char *message)
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

double mzg_js(const char *target, const char *types, ...)
{
	double argv[16];
	double result = 0;
	int argc = (int)strlen(types);
	va_list ap;
	int i;

	if (argc > (int)(sizeof argv / sizeof argv[0]))
		fz_throw(mzg_context(), FZ_ERROR_GENERIC, "monstera_mupdf: %s passes more arguments than the bridge holds", target);
	if (mzg_callback == NULL)
		fz_throw(mzg_context(), FZ_ERROR_GENERIC, "monstera_mupdf: %s was called before a JavaScript callback was registered", target);

	va_start(ap, types);
	for (i = 0; i < argc; ++i) {
		switch (types[i]) {
		case 'p': argv[i] = (double)(intptr_t)va_arg(ap, void *); break;
		case 'l': argv[i] = (double)va_arg(ap, int64_t); break;
		case 'i': argv[i] = (double)va_arg(ap, int); break;
		case 'f': argv[i] = va_arg(ap, double); break;
		default: va_end(ap); fz_throw(mzg_context(), FZ_ERROR_GENERIC, "monstera_mupdf: bad type letter for %s", target);
		}
	}
	va_end(ap);

	/* A JavaScript throw is carried as a MuPDF error, so MuPDF's own fz_try stack unwinds it; the object
	 * model keeps the thrown value and rethrows it when the export returns MZG_JS. */
	if (mzg_callback(target, argc, argv, &result) != 0)
		fz_throw(mzg_context(), FZ_ERROR_GENERIC, "monstera_mupdf: the JavaScript callback for %s threw", target);
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
