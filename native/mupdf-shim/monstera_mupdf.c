/*
 * monstera_mupdf — a flat C ABI over MuPDF, for koffi.
 *
 * WHY A SHIM AT ALL, rather than binding fz_* directly:
 *
 * MuPDF's error handling is fz_try/fz_catch, which is setjmp/longjmp. A longjmp
 * that unwinds through frames koffi created is undefined behaviour — koffi has
 * its own stack bookkeeping, and MuPDF would jump straight past it. So every
 * fz_try/fz_catch pair lives ENTIRELY inside one exported function here, and
 * what crosses the boundary is an int error code and a message. Nothing throws
 * across the ABI.
 *
 * This is the same reason PDFium binds cleanly today: its public API is already
 * a flat C surface that returns codes.
 *
 * Two further rules this file keeps:
 *   - No C++, so there is no name mangling for koffi to work around.
 *   - Handles are opaque pointers. The caller never sees a fitz struct, so the
 *     ABI does not change when MuPDF's internals do.
 *
 * THE fz_var RULE, since fz_try is setjmp:
 *
 *   A local that is assigned INSIDE fz_try and read from fz_always or fz_catch
 *   must be declared with fz_var(). On longjmp the C standard leaves such a
 *   local indeterminate unless it is volatile or its address has been taken,
 *   and this project builds with /O2, which is exactly when the compiler keeps
 *   it in a register instead.
 *
 *   A local read only AFTER the whole block does not need it, because the throw
 *   path returns from fz_catch without reading it. That distinction is why the
 *   rule is stated rather than applied blanket: three locals here qualify and
 *   the rest genuinely do not, and a reader who cannot tell the two apart will
 *   either add noise or omit the one that matters.
 *
 *   The failure is quiet. On MSVC x64 the usual outcome is that the pointer
 *   reverts to its pre-try value — NULL — so the drop in fz_always becomes a
 *   no-op and the object leaks, with its whole materialised graph. Nothing
 *   crashes and nothing is reported. Error paths are not hypothetical: every
 *   fz_catch in this file exists because MuPDF throws on damaged documents,
 *   which is the input this application is built to open.
 *
 * The surface is deliberately only the operation matrix already enumerated:
 * lifecycle, the queries the view model needs, the first command with its exact
 * inverse, save, and render. It is a proof that the shape works, not the
 * finished seam.
 */

#include <malloc.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "mupdf/fitz.h"
#include "mupdf/pdf.h"

/* glibc's name for the size of an allocated block (ADR-0124: the shim builds on Linux too). The counter reads it the
 * same way on the way in and on the way out, so the totals balance whichever the platform reports. */
#ifndef _WIN32
#define _msize malloc_usable_size
#endif

/*
 * ---------------------------------------------------------------------------
 * Allocator instrumentation
 *
 * RSS cannot answer "does MuPDF still hold this memory". On Windows it is the
 * working set, which counts mapped and shared pages the OS reclaims freely, and
 * it does not fall when a C allocator frees to its own freelist. So the only way
 * to tell "the engine retains it" from "the CRT is sitting on it" is to count
 * live bytes INSIDE MuPDF, which fz_new_context allows through fz_alloc_context.
 *
 * Sizes come from _msize rather than from a header we prepend, so the counting
 * cannot itself change allocation sizes or alignment and skew what it measures.
 * ---------------------------------------------------------------------------
 */

/*
 * Accounting is PER CONTEXT, carried in fz_alloc_context.user.
 *
 * It used to be three file-scope statics with a NULL user pointer, which made
 * two states representable that must not be. mz_init reset them before creating
 * a context, so opening a second context zeroed the first one's totals; and
 * every context added into the same counters, so closing one clamped the shared
 * byte total to 0 while another still held memory, and the block counter
 * decremented past zero and wrapped to 2^64. ADR-0010's "0 live blocks and 0
 * live bytes after the context is dropped" is a number this instrument
 * produced.
 *
 * Hanging the counters off `user` removes both by shape rather than by care: an
 * allocation can only be counted against the context whose allocator performed
 * it, and there is no shared total left to reset.
 */
/*
 * MONOTONIC totals. Nothing here ever decreases.
 *
 * Live bytes is a DERIVED quantity — allocated minus freed — rather than a
 * counter that goes up and down. That single change removes three problems at
 * once instead of trading them off:
 *
 *   - It cannot underflow, because subtraction never happens. The previous
 *     design decremented a live counter and clamped at zero on underflow, which
 *     made the error state indistinguishable from the success value: 0 live
 *     bytes reads as "everything was freed", which is exactly the conclusion the
 *     instrument existed to support. A fault confirmed the hypothesis.
 *   - The GLOBAL pair outlives every context, so the leak question survives the
 *     drop. Per-context accounting alone cannot answer it — the accounting lives
 *     inside the thing being destroyed — and ADR-0010's "0 live blocks after the
 *     context is dropped" was produced by counters that were reset on the next
 *     mz_init rather than by a measurement that outlasted anything.
 *   - The per-context pair still isolates one document from another, which is
 *     what the file-scope statics could not do.
 *
 * `imbalance` is the only error signal left, and it is a real one: freeing more
 * than was allocated through this allocator means the counters have stopped
 * describing reality, and it is detectable precisely because both terms are
 * monotonic.
 */
typedef struct {
    size_t bytes_allocated;
    size_t bytes_freed;
    size_t blocks_allocated;
    size_t blocks_freed;
    size_t peak_live_bytes;
    int imbalance;
} mz_accounting;

/*
 * Process-wide, and DELIBERATELY never reset — not in mz_init, not anywhere.
 * Resetting is what made the old counters lie across two contexts. Monotonic
 * totals need no reset to stay correct, so the reset can simply be absent
 * rather than carefully placed.
 */
static mz_accounting g_process = { 0, 0, 0, 0, 0, 0 };

static size_t mz_live_bytes(const mz_accounting *a)
{
    return (a->bytes_allocated >= a->bytes_freed) ? a->bytes_allocated - a->bytes_freed : 0;
}

static size_t mz_live_blocks(const mz_accounting *a)
{
    return (a->blocks_allocated >= a->blocks_freed) ? a->blocks_allocated - a->blocks_freed : 0;
}

static void mz_account_alloc(mz_accounting *a, size_t n)
{
    size_t live;
    a->bytes_allocated += n;
    a->blocks_allocated++;
    live = mz_live_bytes(a);
    if (live > a->peak_live_bytes)
        a->peak_live_bytes = live;

    g_process.bytes_allocated += n;
    g_process.blocks_allocated++;
    live = mz_live_bytes(&g_process);
    if (live > g_process.peak_live_bytes)
        g_process.peak_live_bytes = live;
}

static void mz_account_release(mz_accounting *a, size_t n)
{
    a->bytes_freed += n;
    a->blocks_freed++;
    if (a->bytes_freed > a->bytes_allocated || a->blocks_freed > a->blocks_allocated)
        a->imbalance = 1;

    g_process.bytes_freed += n;
    g_process.blocks_freed++;
    /* Both terms, matching the per-context check above. Testing only bytes here
     * left the process-wide counter able to report a healthy total while its
     * block count had already gone inconsistent — the same signal, trusted in
     * one place and not the other. */
    if (g_process.bytes_freed > g_process.bytes_allocated ||
        g_process.blocks_freed > g_process.blocks_allocated)
        g_process.imbalance = 1;
}

static void *mz_alloc_malloc(void *user, size_t size)
{
    mz_accounting *a = (mz_accounting *)user;
    void *p = malloc(size);
    if (p != NULL)
        mz_account_alloc(a, _msize(p));
    return p;
}

static void *mz_alloc_realloc(void *user, void *old, size_t size)
{
    mz_accounting *a = (mz_accounting *)user;
    size_t before = (old != NULL) ? _msize(old) : 0;
    void *p;

    p = realloc(old, size);
    if (p == NULL) {
        /* realloc failed: `old` is still live and still counted. Nothing to do.
         * (size == 0 with a NULL return is a free on some CRTs, but MSVC's
         * realloc(ptr, 0) frees and returns NULL, so account for it.) */
        if (size == 0 && old != NULL)
            mz_account_release(a, before);
        return NULL;
    }

    /* A realloc is one release and one allocation, even when the block moved in
     * place. Counting it that way keeps allocated and freed monotonic and their
     * difference exact; the alternative — adjusting a live counter by a delta —
     * is the shape that could underflow. */
    if (old != NULL)
        mz_account_release(a, before);
    mz_account_alloc(a, _msize(p));
    return p;
}

static void mz_alloc_free(void *user, void *p)
{
    mz_accounting *a = (mz_accounting *)user;
    if (p == NULL)
        return;
    mz_account_release(a, _msize(p));
    free(p);
}

/* The one document handler this application registers. MuPDF declares it the
 * same way in source/fitz/document-all.c; it is a linkable global rather than
 * public API, so an upstream rename fails the link instead of silently
 * registering nothing. See mz_init for why the bulk registration is not used. */
extern fz_document_handler pdf_document_handler;

#ifdef _WIN32
#define MZ_EXPORT __declspec(dllexport)
#else
#define MZ_EXPORT __attribute__((visibility("default")))
#endif

#define MZ_OK 0
#define MZ_ERR 1

struct mz_ctx {
    fz_context *fz;
    /* Owned here so the allocator's `user` pointer can reach it. Must outlive
     * fz_drop_context, which frees through the same allocator. */
    mz_accounting acct;
    fz_alloc_context alloc;
    /* Pixmaps handed to the caller and not yet returned. Part of the quiescence
     * test in mz_store_footprint: a live pixmap keeps store items referenced,
     * so the store cannot be fully evicted while one is outstanding. */
    size_t live_pixmaps;
    char error[512];
};

struct mz_doc {
    fz_document *doc;
    pdf_document *pdf;
};

typedef struct mz_ctx mz_ctx;
typedef struct mz_doc mz_doc;

/* Records the message from the most recent fz_catch. Called only from inside a
 * catch block, where fz_caught_message is valid. */
static void mz_record(mz_ctx *c)
{
    const char *msg = fz_caught_message(c->fz);
    if (msg == NULL)
        msg = "unknown MuPDF error";
    strncpy(c->error, msg, sizeof(c->error) - 1);
    c->error[sizeof(c->error) - 1] = '\0';
}

/*
 * Records a message for a failure that did NOT come from MuPDF.
 *
 * Every MZ_ERR must leave a message behind. Returning MZ_ERR without one leaves
 * whatever the previous failure wrote still sitting in c->error, so
 * mz_last_error hands the caller a confident, detailed, and completely unrelated
 * sentence — which is worse than an empty string, because it will be believed
 * and it will be pasted into a bug report.
 */
static void mz_fail(mz_ctx *c, const char *msg)
{
    if (c == NULL)
        return;
    strncpy(c->error, msg, sizeof(c->error) - 1);
    c->error[sizeof(c->error) - 1] = '\0';
}

MZ_EXPORT int mz_init(mz_ctx **out)
{
    mz_ctx *c = (mz_ctx *)calloc(1, sizeof(mz_ctx));
    if (c == NULL)
        return MZ_ERR;

    /* calloc already zeroed acct and live_pixmaps. Nothing global is reset,
     * because nothing is global: see mz_accounting. */
    c->alloc.user = &c->acct;
    c->alloc.malloc = mz_alloc_malloc;
    c->alloc.realloc = mz_alloc_realloc;
    c->alloc.free = mz_alloc_free;

    /* No fz_try here: fz_new_context returns NULL on failure rather than
     * throwing, because there is no context to throw through yet. */
    c->fz = fz_new_context(&c->alloc, NULL, FZ_STORE_DEFAULT);
    if (c->fz == NULL) {
        free(c);
        return MZ_ERR;
    }

    /* Register PDF and nothing else.
     *
     * fz_register_document_handlers() registers FOURTEEN parsers, and
     * fz_open_document picks between them by scoring the stream's CONTENT as
     * well as the filename. The "not a PDF" refusal in mz_open comes from
     * pdf_specifics AFTER fz_open_document returns, so a file that scored as
     * EPUB had already been opened and parsed by the EPUB handler before it was
     * refused. That is a foreign parser on the untrusted-document path, reached
     * without anything asking for it.
     *
     * The build also passes -DFZ_ENABLE_<FORMAT>=0 for every format not
     * permitted (scripts/lib/documentHandlers.mjs). This call is the half that
     * covers what those flags cannot: gz_document_handler has no flag at all,
     * and a MuPDF release that adds a handler adds it to the bulk function
     * rather than to a list anybody here reviews. Naming what we want is the
     * only form that stays correct across an upgrade.
     *
     * pdf_document_handler is a linkable global, declared this way in MuPDF's
     * own source/fitz/document-all.c. It is not in a public header, so an
     * upstream rename breaks the LINK — loudly, which is the acceptable
     * failure mode for this. */
    fz_try(c->fz)
        fz_register_document_handler(c->fz, &pdf_document_handler);
    fz_catch(c->fz) {
        mz_record(c);
        fz_drop_context(c->fz);
        free(c);
        return MZ_ERR;
    }

    *out = c;
    return MZ_OK;
}

MZ_EXPORT void mz_drop(mz_ctx *c)
{
    if (c == NULL)
        return;
    fz_drop_context(c->fz);
    free(c);
}

MZ_EXPORT const char *mz_last_error(mz_ctx *c)
{
    return (c == NULL) ? "no context" : c->error;
}

/*
 * Live bytes and blocks currently held inside THIS context, independent of the
 * OS.
 *
 * Takes a context. The previous signature took none, which was not an oversight
 * in the parameter list but the shape of the defect: a function with no context
 * argument structurally cannot answer a per-context question, so it answered a
 * process-wide one and was read as though it were per-context.
 *
 * `invalid` is sticky, and now means only one thing: more was freed than was
 * allocated. It can no longer be set by an underflow, because there is no
 * subtraction to underflow.
 */
MZ_EXPORT int mz_alloc_stats(mz_ctx *c, double *live, double *peak, double *blocks, int *invalid)
{
    if (c == NULL)
        return MZ_ERR;
    /* double, not size_t: koffi marshals it cleanly and these never approach
     * the range where a double loses integer precision. */
    *live = (double)mz_live_bytes(&c->acct);
    *peak = (double)c->acct.peak_live_bytes;
    *blocks = (double)mz_live_blocks(&c->acct);
    *invalid = c->acct.imbalance;
    return MZ_OK;
}

/*
 * Process-wide totals, which OUTLIVE every context.
 *
 * This is the leak check, and it takes no context on purpose — the opposite of
 * mz_alloc_stats, whose contextless signature was the defect. A leak is a
 * property of the process after everything has been destroyed, so it cannot be
 * asked of a live object: per-context accounting is freed along with the context
 * it describes.
 *
 * ADR-0010 recorded "0 live blocks and 0 live bytes after the context is
 * dropped". That was produced by counters mz_init reset on the next call, so it
 * measured a reset rather than a release. Answering it honestly needs totals
 * that no reset touches and no subtraction can corrupt, which is what these are.
 *
 * The leak test is `allocated == freed` after every context is dropped. Both
 * terms only ever rise, so the equality is meaningful even if a context leaked
 * and was never dropped at all.
 */
MZ_EXPORT void mz_process_alloc_stats(double *allocated, double *freed, double *blocks_allocated,
                                      double *blocks_freed, double *peak, int *imbalance)
{
    *allocated = (double)g_process.bytes_allocated;
    *freed = (double)g_process.bytes_freed;
    *blocks_allocated = (double)g_process.blocks_allocated;
    *blocks_freed = (double)g_process.blocks_freed;
    *peak = (double)g_process.peak_live_bytes;
    *imbalance = g_process.imbalance;
}

/*
 * Bytes held by the RESOURCE STORE — decoded images, fonts, display lists — as
 * opposed to parsed PDF objects in the xref.
 *
 * *** DESTRUCTIVE. This empties the cache in order to weigh it. ***
 *
 * Correct in a proof, a defect as a live metric: called during rendering it
 * throws away work the next page would have reused, so a "memory pressure"
 * dashboard wired to this would cause the slowness it was added to diagnose.
 * There is no non-destructive route, and that is an external constraint rather
 * than a choice:
 *
 *   MuPDF exposes no accessor for the store's current size. `struct fz_store`
 *   does carry `size_t size`, but it is defined in source/fitz/store.c (v1.28.0
 *   line 42) and appears in NO header, public or internal — context.h only
 *   forward-declares the type. The entire public surface is fz_empty_store,
 *   fz_shrink_store, fz_debug_store and fz_log_dump_store.
 *
 * The previous implementation scraped fz_debug_store's output for "size=", and
 * could never have been truthful. fz_debug_store prints one
 * "[refs=%d][size=%d]" line PER ITEM (store.c:745 and :769) before its summary
 * line "STORE\tmax=%zu, size=%zu, actual size=%zu" (store.c:783), so a search
 * from the start of the buffer binds to the first cached item and reaches the
 * summary only when the store is empty. It read correctly throughout ADR-0010
 * for exactly that reason: every checkpoint there had an empty store. With
 * three pages rendered it reported 98,065 bytes while emptying the store
 * released 75,296,838.
 *
 * Measuring the delta across fz_empty_store also answers a better question than
 * the accounted number could. MuPDF's own debug line prints `size` and
 * `actual size` separately because an item's declared itemsize is not what it
 * cost to allocate; the delta is bytes genuinely returned to the allocator.
 *
 * *** FLOOR, NOT TOTAL, WHEN NOT QUIESCENT ***
 *
 * Store items are refcounted and fz_empty_store evicts only those the store
 * alone holds. Anything still in use survives and its bytes are not in the
 * delta — the same shape as pdf_clear_xref skipping entries with refs above
 * one. `quiescent_out` reports whether anything was held at the moment of
 * measurement: it is 1 only when the document has no open pages and no pixmap
 * is outstanding. When it is 0 the caller must report the figure as a lower
 * bound, not a total.
 *
 * `d` may be NULL, in which case only the pixmap half of quiescence is checked.
 */
MZ_EXPORT int mz_store_footprint(mz_ctx *c, mz_doc *d, double *freed_out, int *quiescent_out)
{
    size_t before, after;
    int live_pages = 0;
    fz_page *p;

    if (c == NULL)
        return MZ_ERR;

    if (d != NULL && d->doc != NULL) {
        for (p = d->doc->open; p != NULL; p = p->next)
            if (p->doc != NULL)
                live_pages++;
    }
    *quiescent_out = (live_pages == 0 && c->live_pixmaps == 0) ? 1 : 0;

    before = mz_live_bytes(&c->acct);
    fz_try(c->fz)
        fz_empty_store(c->fz);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    after = mz_live_bytes(&c->acct);

    *freed_out = (before >= after) ? (double)(before - after) : 0.0;
    return MZ_OK;
}

/*
 * The raw text of fz_debug_store, copied out for a human to read.
 *
 * Deliberately NOT parsed, and no decision is taken from it. It exists so the
 * footprint measurement above can be validated once by eye against MuPDF's own
 * summary at a checkpoint where the store is genuinely full — three instruments
 * in this investigation produced confidently wrong numbers, and a fourth that
 * nothing was ever checked against would be the fifth.
 *
 * Returns the byte length written. If the buffer is too small the text is
 * truncated and `needed_out` reports the full length.
 */
MZ_EXPORT int mz_store_debug(mz_ctx *c, char *out_buf, int buf_len, double *needed_out)
{
    fz_buffer *buf = NULL;
    fz_output *out = NULL;
    unsigned char *data = NULL;
    size_t len = 0;

    if (c == NULL || out_buf == NULL || buf_len <= 0)
        return MZ_ERR;

    /* Both are assigned inside the try and read from fz_always (out) and
     * fz_catch (buf). `data` and `len` are read only after the whole block, so
     * the throw path never touches them — see the fz_var rule in the header. */
    fz_var(buf);
    fz_var(out);

    fz_try(c->fz) {
        buf = fz_new_buffer(c->fz, 4096);
        out = fz_new_output_with_buffer(c->fz, buf);
        fz_debug_store(c->fz, out);
        fz_close_output(c->fz, out);
        len = fz_buffer_storage(c->fz, buf, &data);
    }
    fz_always(c->fz) {
        fz_drop_output(c->fz, out);
    }
    fz_catch(c->fz) {
        fz_drop_buffer(c->fz, buf);
        mz_record(c);
        return MZ_ERR;
    }

    *needed_out = (double)len;
    {
        /* fz_buffer_storage does not NUL-terminate, so every copy is bounded by
         * the length it returned rather than by a terminator. */
        size_t room = (size_t)buf_len - 1;
        size_t take = (len < room) ? len : room;
        if (data != NULL && take > 0)
            memcpy(out_buf, data, take);
        out_buf[take] = '\0';
    }

    fz_drop_buffer(c->fz, buf);
    return MZ_OK;
}

/*
 * Shrinks the store to `percent` of its current size.
 *
 * Two things this used to get wrong, both of which reported success:
 *
 *   - the argument was cast straight to unsigned. fz_shrink_store takes an
 *     unsigned percent, so -1 arrived as 4294967295, which is above 100 and
 *     therefore a no-op — a caller asking for something impossible was told it
 *     had happened. The cast is now guarded by a range check, and the range is
 *     rejected rather than clamped: clamping invents an intention the caller
 *     did not express.
 *   - fz_shrink_store's return value was discarded. It returns non-zero when
 *     the store reached the target and zero when it could not, which is the
 *     entire question being asked.
 */
MZ_EXPORT int mz_shrink_store(mz_ctx *c, int percent, int *reached)
{
    int ok = 0;

    if (c == NULL || reached == NULL)
        return MZ_ERR;

    if (percent < 0 || percent > 100) {
        mz_fail(c, "shrink percent must be between 0 and 100");
        return MZ_ERR;
    }

    fz_try(c->fz)
        ok = fz_shrink_store(c->fz, (unsigned int)percent);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *reached = ok;
    return MZ_OK;
}

/*
 * Page geometry WITHOUT loading the page.
 *
 * fz_load_page materialises resources, annotations and content streams. Scroll
 * layout (invariant L21) needs only the displayed size, which is a handful of
 * dictionary reads. If this is cheap, then a full page walk measures a workload
 * the viewer never performs.
 *
 * WHAT THIS USED TO GET WRONG, and why it is now MuPDF's own call:
 *
 * It hand-rolled the reads. MediaBox went through pdf_dict_get_inheritable;
 * three lines later /Rotate went through pdf_dict_get_int, which sees only the
 * leaf page's own key. /Rotate is an inheritable page attribute, so every page
 * that inherits rotation from an ancestor Pages node reported 0. /CropBox was
 * not read at all, so a page displayed at its crop reported its media size.
 *
 * Against this repository's own nested fixture, pages 3-5 inherit /Rotate 90:
 * the shim reported 600x800 rot=0 while fz_bound_page returned 800x600. Since
 * L21 makes this the viewer's scroll-layout source, every scroll offset below
 * page 3 would have been wrong — and wrong in a way no flat fixture can show.
 *
 * pdf_page_obj_transform_box already does all of it: inheritance on both boxes,
 * CropBox intersected with MediaBox, the degenerate-box fallbacks, and rotation
 * snapped to a quadrant. It returns the box in PDF space plus the transform into
 * fitz space, and pdf_bound_page — which is what fz_bound_page reaches for a PDF
 * — is literally fz_transform_rect of those two. Applying the transform here is
 * therefore not an approximation of the expensive path; it is the same
 * arithmetic on the same two values, which is what lets the proof assert the two
 * agree exactly rather than approximately.
 *
 * `rotate` is the EFFECTIVE, inherited value as the document stores it, and is
 * deliberately NOT snapped: width and height already have MuPDF's snapping
 * applied, so a caller must not rotate again. mz_page_rotation answers a
 * different question — the page's OWN key, verbatim, with present/absent — and
 * that one exists for the exact inverse of a rotate command, where normalising
 * would destroy the round trip.
 */
MZ_EXPORT int mz_page_geometry(mz_ctx *c, mz_doc *d, int number,
                               float *width, float *height, int *rotate)
{
    float w = 0, h = 0;
    int r = 0;

    if (c == NULL || d == NULL || width == NULL || height == NULL || rotate == NULL)
        return MZ_ERR;

    fz_try(c->fz) {
        pdf_obj *page = pdf_lookup_page_obj(c->fz, d->pdf, number);
        fz_rect box;
        fz_matrix ctm;
        fz_rect bounds;

        pdf_page_obj_transform_box(c->fz, page, &box, &ctm, FZ_CROP_BOX);
        bounds = fz_transform_rect(box, ctm);

        w = bounds.x1 - bounds.x0;
        h = bounds.y1 - bounds.y0;
        r = pdf_dict_get_inheritable_int(c->fz, page, PDF_NAME(Rotate));
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *width = w;
    *height = h;
    *rotate = r;
    return MZ_OK;
}

MZ_EXPORT int mz_open(mz_ctx *c, const char *path, mz_doc **out)
{
    mz_doc *d;

    if (c == NULL || path == NULL || out == NULL)
        return MZ_ERR;

    d = (mz_doc *)calloc(1, sizeof(mz_doc));
    if (d == NULL) {
        /* Not a MuPDF failure, so mz_record has nothing to read. Without a
         * message of its own this returned MZ_ERR leaving the PREVIOUS error
         * still in the buffer, and mz_last_error then handed back a confident,
         * detailed sentence about a different failure entirely. */
        mz_fail(c, "out of memory allocating the document handle");
        return MZ_ERR;
    }

    fz_try(c->fz) {
        d->doc = fz_open_document(c->fz, path);
        d->pdf = pdf_specifics(c->fz, d->doc);
    }
    fz_catch(c->fz) {
        mz_record(c);
        free(d);
        return MZ_ERR;
    }

    if (d->pdf == NULL) {
        mz_fail(c, "not a PDF");
        fz_drop_document(c->fz, d->doc);
        free(d);
        return MZ_ERR;
    }

    *out = d;
    return MZ_OK;
}

/*
 * One password attempt on a document mz_open opened, answering MuPDF's own access bits in *access: 0 when the password
 * does not open the document, otherwise 1 (no encryption), 2 (user), 4 (owner) or 6 (both). The empty string is an
 * attempt like any other, and is what a caller holding no password passes.
 *
 * Called once, straight after mz_open and before any page is read. A failed attempt clears the key a good one set
 * (ADR-0055), and a page read with no key is read undecrypted and in silence: measured 2026-10-05 on an AES-256
 * document, mz_keep_inline_images found no inline image and wrote nothing, and mz_rewrite_images wrote a copy with no
 * page in it.
 */
MZ_EXPORT int mz_authenticate(mz_ctx *c, mz_doc *d, const char *password, int *access)
{
    if (c == NULL || d == NULL || password == NULL || access == NULL) {
        mz_fail(c, "mz_authenticate was called with a missing argument");
        return MZ_ERR;
    }

    fz_try(c->fz)
        *access = pdf_authenticate_password(c->fz, d->pdf, password);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * No fz_try, deliberately, and this is the one place in the file where its
 * ABSENCE is the load-bearing decision.
 *
 * This used to wrap fz_drop_document in fz_try/fz_catch while mz_open's error
 * path called the identical function bare. Both cannot be right. MuPDF settles
 * it: fitz/context.h says "Do not call anything in the fz_always() section that
 * can throw", and MuPDF calls fz_drop_* from fz_always throughout its own
 * source — including this file's own mz_page_bounds. The drop family therefore
 * does not throw, the catch was dead code, and the bare call was correct.
 *
 * Removing it also removes what the catch did: it freed `d` and returned
 * MZ_ERR, so a caller told the close had failed was holding a dangling handle
 * with no safe move — retry it and the second free is a double free.
 */
MZ_EXPORT int mz_close(mz_ctx *c, mz_doc *d)
{
    if (c == NULL || d == NULL)
        return MZ_OK;
    fz_drop_document(c->fz, d->doc);
    free(d);
    return MZ_OK;
}

MZ_EXPORT int mz_page_count(mz_ctx *c, mz_doc *d, int *out)
{
    int n = 0;
    fz_try(c->fz)
        n = pdf_count_pages(c->fz, d->pdf);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    *out = n;
    return MZ_OK;
}

MZ_EXPORT int mz_object_count(mz_ctx *c, mz_doc *d, int *out)
{
    int n = 0;
    fz_try(c->fz)
        n = pdf_xref_len(c->fz, d->pdf);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    *out = n;
    return MZ_OK;
}

MZ_EXPORT int mz_page_bounds(mz_ctx *c, mz_doc *d, int number,
                             float *x0, float *y0, float *x1, float *y1)
{
    fz_rect r = fz_empty_rect;
    fz_page *page = NULL;

    /* Assigned inside the try and read from fz_always, which runs on the throw
     * path too. See the fz_var rule in the file header. Upstream's writer.c
     * carries fz_var(page) on this identical shape. */
    fz_var(page);

    fz_try(c->fz) {
        page = fz_load_page(c->fz, d->doc, number);
        r = fz_bound_page(c->fz, page);
    }
    fz_always(c->fz)
        fz_drop_page(c->fz, page);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *x0 = r.x0; *y0 = r.y0; *x1 = r.x1; *y1 = r.y1;
    return MZ_OK;
}

/*
 * Rotation, with the exact semantics the engine spike proved:
 *
 *   `present` distinguishes "this page declares /Rotate" from "it inherits one".
 *   The inverse of rotating an inheriting page is to DELETE the key, never to
 *   write back the value that was showing — both render identically, and only
 *   the delete restores the same document.
 *
 *   `value` is returned verbatim, not normalised into a quadrant, because MuPDF
 *   stores /Rotate 45 and /Rotate 450 as given and real documents carry them.
 *   Normalising on the way in is the caller's job; restoring must be exact.
 */
MZ_EXPORT int mz_page_rotation(mz_ctx *c, mz_doc *d, int number,
                               int *present, int *value)
{
    int own_present = 0;
    int own_value = 0;

    fz_try(c->fz) {
        pdf_obj *page = pdf_lookup_page_obj(c->fz, d->pdf, number);
        pdf_obj *rotate = pdf_dict_get(c->fz, page, PDF_NAME(Rotate));
        if (pdf_is_number(c->fz, rotate)) {
            own_present = 1;
            own_value = pdf_to_int(c->fz, rotate);
        }
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *present = own_present;
    *value = own_value;
    return MZ_OK;
}

MZ_EXPORT int mz_set_page_rotation(mz_ctx *c, mz_doc *d, int number, int value)
{
    fz_try(c->fz) {
        pdf_obj *page = pdf_lookup_page_obj(c->fz, d->pdf, number);
        pdf_dict_put_int(c->fz, page, PDF_NAME(Rotate), value);
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

MZ_EXPORT int mz_clear_page_rotation(mz_ctx *c, mz_doc *d, int number)
{
    fz_try(c->fz) {
        pdf_obj *page = pdf_lookup_page_obj(c->fz, d->pdf, number);
        pdf_dict_del(c->fz, page, PDF_NAME(Rotate));
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * Holds a page open, so the caller can measure what holding actually costs.
 * mz_page_bounds loads and drops in one call; this pair does not.
 */
/*
 * Length of the document's open-page list, split into live and dead entries.
 *
 * fz_load_chapter_page inserts every page it loads onto fz_document.open and
 * returns a cached page on a hit, and fz_drop_page marks an entry dead
 * (page->doc = NULL) rather than unlinking it — the struct is reaped on a later
 * load. So this list is the obvious candidate for memory that survives dropping
 * a page, and counting it directly is the difference between knowing and
 * guessing.
 */
MZ_EXPORT int mz_open_page_count(mz_ctx *c, mz_doc *d, int *live, int *dead)
{
    int alive = 0, gone = 0;
    fz_page *p;
    (void)c;

    for (p = d->doc->open; p != NULL; p = p->next) {
        if (p->doc == NULL)
            gone++;
        else
            alive++;
    }

    *live = alive;
    *dead = gone;
    return MZ_OK;
}

MZ_EXPORT int mz_page_hold(mz_ctx *c, mz_doc *d, int number, void **page_out)
{
    fz_page *page = NULL;
    fz_try(c->fz)
        page = fz_load_page(c->fz, d->doc, number);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    *page_out = page;
    return MZ_OK;
}

MZ_EXPORT void mz_page_release(mz_ctx *c, void *page)
{
    if (c == NULL || page == NULL)
        return;
    fz_drop_page(c->fz, (fz_page *)page);
}

/*
 * Evicts cached PDF objects.
 *
 * MuPDF caches every object it parses in the xref table (pdf_xref_entry.obj)
 * and keeps it for the document's lifetime. That is where a heavily annotated
 * document's memory goes — NOT the resource store, whose FZ_STORE_DEFAULT cap
 * of 256 MB the measured 487 MB already exceeds, and which holds decoded images
 * and fonts rather than parsed dictionaries.
 *
 * pdf_clear_xref drops any cached object whose refcount is 1, meaning nothing
 * else holds it, and skips any whose stream buffer has been modified, so it
 * cannot discard unsaved work. Objects reload from the file on next access.
 *
 * fz_empty_store is called too, because the two caches are separate and a
 * viewer that has scrolled through a document has filled both.
 */
/*
 * One entry of the census below, classified exactly as pdf_clear_xref does.
 *
 * pdf_clear_xref drops an object when `obj != NULL && stm_buf == NULL &&
 * pdf_obj_refs(obj) == 1`. This mirrors that test — and unlike the comment that
 * used to make the same claim, the mirroring is now CHECKED rather than
 * asserted: mz_purge_objects reports the census before and after, so
 * `cached_after == cached_before - droppable` is an equation a proof can hold it
 * to. A classification that stops matching upstream stops balancing.
 */
static void mz_census_entry(fz_context *ctx, pdf_xref_entry *entry, int number,
                            pdf_document *doc, void *arg)
{
    int *census = (int *)arg; /* [0] cached, [1] droppable, [2] pinned */
    (void)number;
    (void)doc;

    if (entry == NULL || entry->obj == NULL)
        return;

    census[0]++;
    if (entry->stm_buf != NULL)
        census[2]++;
    else if (pdf_obj_refs(ctx, entry->obj) == 1)
        census[1]++;
    else
        census[2]++;
}

MZ_EXPORT int mz_purge_objects(mz_ctx *c, mz_doc *d,
                               int *cached_before, int *droppable, int *pinned,
                               int *cached_after)
{
    int census[3] = { 0, 0, 0 };
    int after[3] = { 0, 0, 0 };

    if (c == NULL || d == NULL || cached_before == NULL || droppable == NULL ||
        pinned == NULL || cached_after == NULL)
        return MZ_ERR;

    /* Counted so that "purging reclaimed nothing" can be told apart from
     * "purging was never going to reclaim anything because everything is still
     * referenced". The two have opposite consequences: one is our bug, the other
     * is a genuine upstream constraint.
     *
     * THE WALK, and why it is pdf_xref_entry_map rather than a loop over
     * pdf_xref_len. The previous version was wrong in three ways, all confirmed
     * against the 1.28.0 source rather than argued from naming:
     *
     *   - POPULATION. pdf_clear_xref walks every entry of every subsection of
     *     every xref section. The loop walked 0..pdf_xref_len taking ONE resolved
     *     entry per object number, and started at doc->xref_base rather than
     *     section 0. On a document with incremental updates — the shape ADR-0010
     *     §4 makes routine — object N has an entry in more than one section, and
     *     the count saw at most one of them. So the comment claiming it mirrored
     *     pdf_clear_xref's test was false on exactly the documents that matter.
     *   - MUTATION. pdf_get_xref_entry_no_null resolves through
     *     pdf_get_xref_entry, which passes solidify_if_needed=1 and can call
     *     ensure_solid_xref. A counting function was therefore able to rewrite
     *     the xref's in-memory shape — and MuPDF's own comment there notes that
     *     doing so renders fingerprinting for snapshotting invalid.
     *   - A DEAD BRANCH. That accessor throws rather than returning NULL, as its
     *     name says, so `e == NULL` was unreachable and the `continue` meant for
     *     a missing entry could never run; a missing entry aborted the whole
     *     purge into MZ_ERR instead.
     *
     * pdf_xref_entry_map hands the entry pointer straight to a callback, so
     * there is no accessor to solidify anything and nothing to throw on a sparse
     * table. Its population differs from pdf_clear_xref's in two stated ways: it
     * also visits the local xref while one is active (never, here — that
     * requires an in-progress local-xref operation), and it skips entries whose
     * `type` is zero, which pdf_clear_xref would visit but which carry no cached
     * object to drop. Both are named rather than glossed, because the last
     * comment in this position claimed an identity it did not have. */
    fz_try(c->fz) {
        pdf_xref_entry_map(c->fz, d->pdf, mz_census_entry, census);

        /* The full documented purge surface, not just part of it.
         *
         * An earlier version called only pdf_clear_xref and fz_empty_store and
         * concluded "purging does not reclaim". That was measuring an
         * incomplete purge: pdf_drop_document_imp additionally drops the glyph
         * cache — whose own comment notes it "can contain pdf_obj pointers" —
         * and this document's store items, and neither is reached by the two
         * calls above.
         *
         * pdf_drop_resource_tables is deliberately NOT called: it appears only
         * in document teardown, so using it mid-life is unproven. */
        pdf_clear_xref(c->fz, d->pdf);
        fz_purge_glyph_cache(c->fz);
        pdf_purge_locals_from_store(c->fz, d->pdf);
        pdf_empty_store(c->fz, d->pdf);
        fz_empty_store(c->fz);

        /* The same census again. This is what makes the classification above a
         * measurement rather than a claim: if `droppable` really is what
         * pdf_clear_xref will drop, then cached_after is cached_before minus it,
         * and any drift between this file and upstream shows up as an equation
         * that stops balancing. */
        pdf_xref_entry_map(c->fz, d->pdf, mz_census_entry, after);
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *cached_before = census[0];
    *droppable = census[1];
    *pinned = census[2];
    *cached_after = after[0];
    return MZ_OK;
}

MZ_EXPORT int mz_save(mz_ctx *c, mz_doc *d, const char *path, int incremental)
{
    pdf_write_options opts = pdf_default_write_options;
    opts.do_incremental = incremental ? 1 : 0;

    fz_try(c->fz)
        pdf_save_document(c->fz, d->pdf, path, &opts);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * Rewrites the document's images through MuPDF's own rewriter, `pdf_rewrite_images`, the
 * routine `mutool clean` drives. What this build decides is only the inputs:
 *
 * - an image stored LOSSY (a DCT or JPX stream) is re-encoded as JPEG at `jpeg_quality`;
 * - an image stored LOSSLESS stays lossless — flate — because a JPEG of a screenshot or a
 *   drawing is a visible defect the person did not ask for by choosing a JPEG quality;
 * - a colour or grey image drawn above `threshold_dpi` is subsampled to `target_dpi` (0 and 0
 *   leave resolution alone), and a bitonal image is left as it is;
 * - `recompress_when` is SMALLER, so an image whose new stream would be larger is kept.
 *
 * The quality travels as the string the options struct holds, which the rewriter reads with
 * fz_atoi; it is formatted here rather than taken from the caller as a string, so the ABI
 * carries an int and cannot carry an option string MuPDF would parse.
 */
MZ_EXPORT int mz_rewrite_images(mz_ctx *c, mz_doc *d, int jpeg_quality, int threshold_dpi, int target_dpi)
{
    pdf_image_rewriter_options opts;
    char quality[8];

    if (jpeg_quality < 1 || jpeg_quality > 100) {
        mz_fail(c, "jpeg quality must be between 1 and 100");
        return MZ_ERR;
    }
    if (threshold_dpi < 0 || target_dpi < 0 || (threshold_dpi > 0 && target_dpi >= threshold_dpi)) {
        mz_fail(c, "subsampling needs a target below its threshold, or both 0");
        return MZ_ERR;
    }

    memset(&opts, 0, sizeof opts);
    fz_snprintf(quality, sizeof quality, "%d", jpeg_quality);

    opts.color_lossy_image_subsample_method = FZ_SUBSAMPLE_AVERAGE;
    opts.color_lossless_image_subsample_method = FZ_SUBSAMPLE_AVERAGE;
    opts.color_lossy_image_subsample_threshold = threshold_dpi;
    opts.color_lossy_image_subsample_to = target_dpi;
    opts.color_lossless_image_subsample_threshold = threshold_dpi;
    opts.color_lossless_image_subsample_to = target_dpi;
    opts.color_lossy_image_recompress_method = FZ_RECOMPRESS_JPEG;
    opts.color_lossy_image_recompress_quality = quality;
    opts.color_lossless_image_recompress_method = FZ_RECOMPRESS_LOSSLESS;

    opts.gray_lossy_image_subsample_method = FZ_SUBSAMPLE_AVERAGE;
    opts.gray_lossless_image_subsample_method = FZ_SUBSAMPLE_AVERAGE;
    opts.gray_lossy_image_subsample_threshold = threshold_dpi;
    opts.gray_lossy_image_subsample_to = target_dpi;
    opts.gray_lossless_image_subsample_threshold = threshold_dpi;
    opts.gray_lossless_image_subsample_to = target_dpi;
    opts.gray_lossy_image_recompress_method = FZ_RECOMPRESS_JPEG;
    opts.gray_lossy_image_recompress_quality = quality;
    opts.gray_lossless_image_recompress_method = FZ_RECOMPRESS_LOSSLESS;

    opts.bitonal_image_recompress_method = FZ_RECOMPRESS_NEVER;
    opts.recompress_when = FZ_RECOMPRESS_WHEN_SMALLER;

    fz_try(c->fz)
        pdf_rewrite_images(c->fz, d->pdf, &opts);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * Saves a full rewrite with the unreferenced objects collected and streams compressed, so the
 * image streams `mz_rewrite_images` replaced are not carried into the file beside their
 * replacements. Garbage level 3 is `mutool clean -ggg`'s: collect, renumber, merge duplicates.
 *
 * OBJECT STREAMS ON, because the default writes every object in the open: measured 2026-09-19, a
 * plain re-save with no image touched grew a corpus document by 12% — its original packed its
 * objects into compressed object streams, and the default write unpacked them.
 */
MZ_EXPORT int mz_save_compacted(mz_ctx *c, mz_doc *d, const char *path)
{
    pdf_write_options opts = pdf_default_write_options;
    opts.do_use_objstms = 1;
    opts.do_garbage = 3;
    opts.do_compress = 1;
    opts.do_compress_images = 1;
    opts.do_compress_fonts = 1;

    fz_try(c->fz)
        pdf_save_document(c->fz, d->pdf, path, &opts);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/* ========================================================================== */
/*
 * INLINE IMAGES MADE XOBJECTS, before PDFium regenerates a page (ADR-0126).
 *
 * PDFium's content generator returns early for an image that IsInline(), so a page it regenerates is saved
 * without its BI ... EI pictures. This rewrites each inline image in a content stream into an image XObject and
 * "/Name Do" at the SAME place, copying every other byte of the stream unchanged, so the picture's clip, colour
 * and drawing order are the stream's own and cannot be lost.
 *
 * The inline image is read exactly as MuPDF's interpreter reads it (parse_inline_image in pdf-interpret.c): the
 * dictionary up to ID, one whitespace byte (two for CR LF), pdf_load_inline_image, then the first "EI" followed by
 * whitespace or a delimiter. pdf_add_image writes the image with its compressed data, mask and decode as they were.
 *
 * AN INLINE IMAGE THAT CANNOT BE READ IS LEFT, AND COUNTED: after a failed read the lexer's position in the stream is
 * unknown, so the rest of that stream is copied as it was and the caller is told how many were left.
 */

typedef struct {
    int converted;
    int left;
    int *visited;
    int visited_len;
    int visited_cap;
} mz_keep_tally;

/* Whether a form (by object number) was already rewritten, recording it if not: a form drawn twice, or drawing
 * itself, is visited once. */
static int mz_keep_seen(fz_context *ctx, mz_keep_tally *t, int num)
{
    int i;
    if (num <= 0)
        return 0;
    for (i = 0; i < t->visited_len; ++i)
        if (t->visited[i] == num)
            return 1;
    if (t->visited_len == t->visited_cap) {
        int cap = t->visited_cap == 0 ? 16 : t->visited_cap * 2;
        t->visited = fz_realloc_array(ctx, t->visited, cap, int);
        t->visited_cap = cap;
    }
    t->visited[t->visited_len++] = num;
    return 0;
}

/*
 * Rewrites one content stream. `resources` is what its names resolve in (a page's may be inherited, a form's may be
 * absent); `owner` is where a Resources dictionary is made when there is none and an image has to be named.
 */
static void mz_keep_stream(fz_context *ctx, pdf_document *doc, pdf_obj *stream, pdf_obj *owner, pdf_obj *resources,
                           pdf_resource_stack *parent, mz_keep_tally *t)
{
    fz_buffer *content = NULL;
    fz_buffer *out = NULL;
    fz_stream *stm = NULL;
    fz_image *img = NULL;
    pdf_obj *dict = NULL;
    pdf_lexbuf lb;
    pdf_resource_stack rs;
    size_t copied = 0;
    int counter = 0;
    int changed = 0;
    int broken = 0;
    unsigned char *data = NULL;
    size_t len = 0;

    rs.next = parent;
    rs.resources = resources;
    pdf_lexbuf_init(ctx, &lb, PDF_LEXBUF_SMALL);

    fz_var(content);
    fz_var(out);
    fz_var(stm);
    fz_var(img);
    fz_var(dict);
    fz_var(copied);
    fz_var(counter);
    fz_var(changed);
    fz_var(broken);
    fz_var(resources);

    fz_try(ctx)
    {
        content = pdf_load_stream(ctx, stream);
        len = fz_buffer_storage(ctx, content, &data);
        stm = fz_open_buffer(ctx, content);
        out = fz_new_buffer(ctx, len + 64);

        while (!broken)
        {
            pdf_token tok = pdf_lex(ctx, stm, &lb);
            size_t start;
            size_t end = 0;

            if (tok == PDF_TOK_EOF)
                break;
            if (tok != PDF_TOK_KEYWORD || strcmp(lb.scratch, "BI") != 0)
                continue;
            start = (size_t)fz_tell(ctx, stm) - 2;

            fz_try(ctx)
            {
                int ch;
                int found = 0;
                dict = pdf_parse_dict(ctx, doc, stm, &lb);
                ch = fz_read_byte(ctx, stm);
                if (ch == '\r' && fz_peek_byte(ctx, stm) == '\n')
                    fz_read_byte(ctx, stm);
                img = pdf_load_inline_image(ctx, doc, &rs, dict, stm);
                ch = fz_read_byte(ctx, stm);
                do
                {
                    while (ch != 'E' && ch != EOF)
                        ch = fz_read_byte(ctx, stm);
                    if (ch == 'E')
                    {
                        ch = fz_read_byte(ctx, stm);
                        if (ch == 'I')
                        {
                            ch = fz_peek_byte(ctx, stm);
                            if (ch == ' ' || ch <= 32 || ch == '<' || ch == '/')
                            {
                                found = 1;
                                break;
                            }
                        }
                    }
                } while (ch != EOF);
                if (!found)
                    fz_throw(ctx, FZ_ERROR_SYNTAX, "no EI after an inline image");
                end = (size_t)fz_tell(ctx, stm);
            }
            fz_always(ctx)
            {
                pdf_drop_obj(ctx, dict);
                dict = NULL;
            }
            fz_catch(ctx)
            {
                fz_drop_image(ctx, img);
                img = NULL;
                t->left += 1;
                broken = 1;
            }
            if (broken)
                break;

            {
                char name[32];
                pdf_obj *xobjects;
                if (resources == NULL)
                    resources = pdf_dict_put_dict(ctx, owner, PDF_NAME(Resources), 2);
                xobjects = pdf_dict_get(ctx, resources, PDF_NAME(XObject));
                if (!pdf_is_dict(ctx, xobjects))
                    xobjects = pdf_dict_put_dict(ctx, resources, PDF_NAME(XObject), 4);
                do
                    fz_snprintf(name, sizeof name, "MzInline%d", ++counter);
                while (pdf_dict_gets(ctx, xobjects, name) != NULL);
                pdf_dict_puts_drop(ctx, xobjects, name, pdf_add_image(ctx, doc, img));
                fz_drop_image(ctx, img);
                img = NULL;
                fz_append_data(ctx, out, data + copied, start - copied);
                fz_append_printf(ctx, out, " /%s Do ", name);
                copied = end;
                changed = 1;
                t->converted += 1;
            }
        }

        if (changed)
        {
            fz_append_data(ctx, out, data + copied, len - copied);
            pdf_update_stream(ctx, doc, stream, out, 0);
        }
    }
    fz_always(ctx)
    {
        fz_drop_stream(ctx, stm);
        fz_drop_buffer(ctx, out);
        fz_drop_buffer(ctx, content);
        fz_drop_image(ctx, img);
        pdf_drop_obj(ctx, dict);
        pdf_lexbuf_fin(ctx, &lb);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/*
 * The Form XObjects a resource dictionary names, each rewritten once and then its own forms. Collected before any
 * is rewritten, because rewriting a form with no Resources of its own adds entries to a dictionary, and a form that
 * shares its parent's dictionary would change the one being walked.
 */
static void mz_keep_forms(fz_context *ctx, pdf_document *doc, pdf_obj *resources, pdf_resource_stack *parent,
                          mz_keep_tally *t)
{
    pdf_obj *xobjects = pdf_dict_get(ctx, resources, PDF_NAME(XObject));
    int n = pdf_dict_len(ctx, xobjects);
    pdf_obj **forms = NULL;
    int count = 0;
    int i;

    if (n <= 0)
        return;

    fz_var(forms);
    fz_try(ctx)
    {
        pdf_resource_stack rs;
        forms = fz_malloc_array(ctx, n, pdf_obj *);
        for (i = 0; i < n; ++i)
        {
            pdf_obj *xobj = pdf_dict_get_val(ctx, xobjects, i);
            if (!pdf_is_stream(ctx, xobj) || !pdf_name_eq(ctx, pdf_dict_get(ctx, xobj, PDF_NAME(Subtype)), PDF_NAME(Form)))
                continue;
            if (mz_keep_seen(ctx, t, pdf_to_num(ctx, xobj)))
                continue;
            forms[count++] = xobj;
        }
        rs.next = parent;
        rs.resources = resources;
        for (i = 0; i < count; ++i)
        {
            pdf_obj *own = pdf_dict_get(ctx, forms[i], PDF_NAME(Resources));
            mz_keep_stream(ctx, doc, forms[i], forms[i], own, &rs, t);
            own = pdf_dict_get(ctx, forms[i], PDF_NAME(Resources));
            if (own != NULL)
                mz_keep_forms(ctx, doc, own, &rs, t);
        }
    }
    fz_always(ctx)
        fz_free(ctx, forms);
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/*
 * Rewrites the inline images of one page — its content streams, and every Form XObject its resources name — and
 * answers how many were converted and how many could not be read and were left.
 */
MZ_EXPORT int mz_keep_inline_images(mz_ctx *c, mz_doc *d, int number, int *converted, int *left)
{
    mz_keep_tally t;
    pdf_page *page = NULL;

    if (c == NULL || d == NULL || converted == NULL || left == NULL) {
        mz_fail(c, "mz_keep_inline_images was called with a missing argument");
        return MZ_ERR;
    }
    memset(&t, 0, sizeof t);

    fz_var(page);
    fz_try(c->fz)
    {
        pdf_obj *resources;
        pdf_obj *contents;
        page = pdf_load_page(c->fz, d->pdf, number);
        resources = pdf_page_resources(c->fz, page);
        contents = pdf_page_contents(c->fz, page);
        if (pdf_is_array(c->fz, contents))
        {
            int i;
            int n = pdf_array_len(c->fz, contents);
            for (i = 0; i < n; ++i)
            {
                pdf_obj *stream = pdf_array_get(c->fz, contents, i);
                if (pdf_is_stream(c->fz, stream))
                    mz_keep_stream(c->fz, d->pdf, stream, page->obj, resources, NULL, &t);
                resources = pdf_page_resources(c->fz, page);
            }
        }
        else if (pdf_is_stream(c->fz, contents))
            mz_keep_stream(c->fz, d->pdf, contents, page->obj, resources, NULL, &t);
        resources = pdf_page_resources(c->fz, page);
        if (resources != NULL)
            mz_keep_forms(c->fz, d->pdf, resources, NULL, &t);
    }
    fz_always(c->fz)
    {
        fz_drop_page(c->fz, (fz_page *)page);
        fz_free(c->fz, t.visited);
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    *converted = t.converted;
    *left = t.left;
    return MZ_OK;
}

/*
 * Saves what mz_keep_inline_images changed: incrementally where MuPDF says the document can be — the original bytes
 * with the changed objects appended, which is fast whatever the document's size — and whole where it cannot, which
 * is a repaired file. MuPDF's own predicate decides, so a failed incremental save is never retried another way.
 */
MZ_EXPORT int mz_save_kept(mz_ctx *c, mz_doc *d, const char *path)
{
    pdf_write_options opts = pdf_default_write_options;

    fz_try(c->fz)
    {
        opts.do_incremental = pdf_can_be_saved_incrementally(c->fz, d->pdf);
        pdf_save_document(c->fz, d->pdf, path, &opts);
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * Renders one page to an RGB pixmap and hands back the samples.
 *
 * The buffer is owned by MuPDF until mz_free_pixmap is called; the caller must
 * copy out. Returning a pointer into MuPDF's allocation rather than copying
 * here keeps one copy out of the path — the same discipline the WASM binding
 * needs and does not enforce.
 */
MZ_EXPORT int mz_render_page(mz_ctx *c, mz_doc *d, int number, float dpi,
                             unsigned char **samples, int *width, int *height,
                             int *stride, void **pixmap_out)
{
    /* volatile: assigned inside the try and read after it. fz_try is setjmp, and
     * longjmp leaves a non-volatile local indeterminate — the /O2 this project
     * builds with is exactly when the compiler keeps it in a register. */
    fz_pixmap * volatile pix = NULL;
    fz_matrix ctm = fz_scale(dpi / 72.0f, dpi / 72.0f);

    fz_try(c->fz)
        pix = fz_new_pixmap_from_page_number(c->fz, d->doc, number, ctm,
                                             fz_device_rgb(c->fz), 0);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *samples = pix->samples;
    *width = pix->w;
    *height = pix->h;
    *stride = pix->stride;
    *pixmap_out = pix;
    /* Counted for the quiescence test in mz_store_footprint: a live pixmap holds
     * store items referenced, so the store cannot be fully evicted while one is
     * outstanding, and the measured delta would silently be a floor. */
    c->live_pixmaps++;
    return MZ_OK;
}

MZ_EXPORT void mz_free_pixmap(mz_ctx *c, void *pixmap)
{
    if (c == NULL || pixmap == NULL)
        return;
    fz_drop_pixmap(c->fz, (fz_pixmap *)pixmap);
    if (c->live_pixmaps > 0)
        c->live_pixmaps--;
    else
        /* Freeing a pixmap that was never handed out means the quiescence test
         * is reading a count that no longer tracks reality, so mark the whole
         * accounting untrustworthy rather than clamping to a plausible zero. */
        c->acct.imbalance = 1;
}

/*
 * mz_stext_json WAS HERE AND WAS REMOVED ON 2026-09-02, and the reason is a
 * rule rather than a tidy-up, so it is recorded instead of silently deleted.
 *
 * It exported one page's structured text as MuPDF's own JSON and took an int
 * FLAG WORD. The npm `mupdf` package — the same engine, 1.28.0, checked — reaches
 * the same serialiser through `toStructuredText(options).asJSON()` and takes an
 * option STRING. So the flag word here and the string there were two encodings
 * of one decision, declared as two independent literals in `textStructure.ts`
 * with nothing deriving one from the other and nothing comparing them. This
 * export had no product caller at all, so any drift would have run toward the
 * side nothing exercises.
 *
 * ADR-0034's K.0 bans a second set of stext options anywhere; two encodings of
 * one set is that shape one step short. Deleting the export makes the second
 * encoding unrepresentable rather than discouraged (B5).
 *
 * IF A SHIM PATH IS EVER NEEDED, it comes back taking the option string and
 * calling fz_parse_stext_options, so `textStructure.ts` still holds the only
 * set. The notes below are kept because they are what the next author of that
 * function would otherwise have to rediscover.
 *
 * WHY MuPDF'S SERIALISER AND NOT A SHAPE OF OURS. `fz_print_stext_page_as_json`
 * is the authority's own answer to "what did the structuring produce"; a struct
 * walked here would be a second opinion about a format MuPDF owns, and it would
 * silently stop describing the tree the day MuPDF adds a block type (B3a). The
 * cost is a parse on the far side, which is a spike's price and not a seam's.
 *
 * `flags` is passed to fz_stext_options unchanged, so the caller chooses among
 * MuPDF's own segmentation options — FZ_STEXT_SEGMENT (4096),
 * FZ_STEXT_PARAGRAPH_BREAK (8192), FZ_STEXT_TABLE_HUNT (16384) — rather than
 * this file deciding which of them a text substrate wants. That decision is
 * E2's and it is not taken in C.
 *
 * THE BUFFER CONTRACT IS mz_store_debug'S, deliberately: the caller sizes, this
 * writes what fits, and `needed_out` reports the full length so a short buffer
 * is a measurable state rather than silent truncation. A NUL is written because
 * the payload is UTF-8 JSON, and fz_buffer_storage does not terminate.
 *
 * SCALE 1.0f, so coordinates arrive in the page's own units. Scaling here would
 * bake a rendering decision into an extraction path, which is the coordinate
 * confusion invariant L3 exists to prevent.
 *
 * AMENDED 2026-10-31 (ADR-0280's fifth correction): the product asks for this
 * serialiser's JSON at PAGE_TEXT_SCALE (100, `textStructure.ts`), because at 1
 * it writes every box, size and origin as a whole point cut toward zero. That
 * is a precision, not a rendering decision: the values stay in the page's
 * display space, and the one reader divides the scaled fields back, so no
 * consumer ever sees a scaled number. A shim path that returns would take the
 * same constant rather than 1.0f.
 */

/* ========================================================================== */
/*
 * THE TEXT LAYER'S LETTERS (ADR-0280 and its fourth correction).
 *
 * Writes `packages/kernel/src/textLetters.ts`' format for the structured-text page the JSON was written from, taken by
 * its pointer so one page read builds one structured text: per text line, in MuPDF's own depth-first order
 * (fz_stext_page_block_iterator_begin_dfs / _next_dfs / _eod_dfs, which step into struct blocks and keep their place
 * through parent pointers, so there is no recursion here and no depth to cap), a 12-byte header and a signed 16-bit
 * advance per character. It reproduces `writeLetters` exactly — the same rounding (Math.round is floor(x + 0.5)), the
 * same end for a clipped line, the same check value over each character's low 16 bits — and the TypeScript case that
 * compares the two on one page is what holds it to that.
 *
 * BOUNDED BY ITS CALLER. `capacity`, `max_lines` and `max_chars` are textLetters.ts' own figures, passed in rather than
 * restated here. Every write is checked against `capacity` before it is made; a page that does not fit answers
 * MZ_LETTERS_FULL with nothing written past the buffer. `*walked` is every text line the iterator gave, kept or not,
 * which `main` compares with the JSON's line count for the page.
 *
 * It does none of main's checking: main reads this as from a hostile host (invariant 25).
 */
fz_context *mzg_context(void);

#define MZ_LETTERS_FULL 2
#define MZ_LETTERS_HEADER 12

typedef struct
{
    unsigned char *out;
    size_t capacity;
    size_t used;
    int full;
} mz_letters_out;

static double mz_round(double v)
{
    return floor(v + 0.5);
}

static int mz_letters_fits(mz_letters_out *w, size_t n)
{
    if (w->full || w->capacity - w->used < n)
    {
        w->full = 1;
        return 0;
    }
    return 1;
}

static void mz_letters_put16(unsigned char *at, int value)
{
    at[0] = (unsigned char)(value & 0xff);
    at[1] = (unsigned char)((value >> 8) & 0xff);
}

static void mz_letters_line(mz_letters_out *w, fz_stext_line *line, int max_chars)
{
    fz_stext_char *ch;
    fz_stext_char *first = line->first_char;
    fz_stext_char *after = NULL;
    double dx = line->dir.x, dy = line->dir.y;
    double fx, fy, ex, ey, previous;
    int n = 0, k, carried = 1, size = 0;
    unsigned int hash = 0x811c9dc5u;
    unsigned char *header;

    for (ch = first; ch != NULL && n < max_chars; ch = ch->next)
    {
        unsigned int c = (unsigned int)ch->c & 0xffffu;
        hash ^= c & 0xffu;
        hash *= 0x01000193u;
        hash ^= c >> 8;
        hash *= 0x01000193u;
        n++;
    }
    after = ch;

    /* WHERE THE KEPT LETTERS END: the first dropped letter's origin, or the last letter's far edge. */
    if (after != NULL)
    {
        ex = after->origin.x;
        ey = after->origin.y;
    }
    else if (line->last_char != NULL)
    {
        ex = (line->last_char->quad.ur.x + line->last_char->quad.lr.x) / 2.0;
        ey = (line->last_char->quad.ur.y + line->last_char->quad.lr.y) / 2.0;
    }
    else
    {
        ex = 0;
        ey = 0;
    }
    fx = first != NULL ? first->origin.x : ex;
    fy = first != NULL ? first->origin.y : ey;
    if (first != NULL)
    {
        double s = mz_round(first->size * 100.0);
        size = s < 0 ? 0 : s > 65535 ? 65535 : (int)s;
    }

    /* A LINE THAT CANNOT BE CARRIED carries no advances; main places it as today. */
    previous = 0;
    for (k = 0, ch = first; k < n; k++, ch = ch->next)
    {
        double next_x = k + 1 < n ? ch->next->origin.x : ex;
        double next_y = k + 1 < n ? ch->next->origin.y : ey;
        double place = mz_round(((next_x - fx) * dx + (next_y - fy) * dy) * 100.0);
        double place_here = k == 0 ? 0 : previous;
        if (k == 0)
            place_here = mz_round(((ch->origin.x - fx) * dx + (ch->origin.y - fy) * dy) * 100.0);
        if (place - place_here > 32767 || place - place_here < -32767)
            carried = 0;
        previous = place;
    }
    if (!carried)
        n = 0;

    if (!mz_letters_fits(w, MZ_LETTERS_HEADER + 2 * (size_t)n))
        return;
    header = w->out + w->used;
    mz_letters_put16(header, (int)mz_round(dx * 16384.0));
    mz_letters_put16(header + 2, (int)mz_round(dy * 16384.0));
    mz_letters_put16(header + 4, size);
    header[6] = (unsigned char)(hash & 0xff);
    header[7] = (unsigned char)((hash >> 8) & 0xff);
    header[8] = (unsigned char)((hash >> 16) & 0xff);
    header[9] = (unsigned char)((hash >> 24) & 0xff);
    mz_letters_put16(header + 10, n);
    w->used += MZ_LETTERS_HEADER;

    previous = 0;
    for (k = 0, ch = first; k < n; k++, ch = ch->next)
    {
        double next_x = k + 1 < n ? ch->next->origin.x : ex;
        double next_y = k + 1 < n ? ch->next->origin.y : ey;
        double here = k == 0 ? mz_round(((ch->origin.x - fx) * dx + (ch->origin.y - fy) * dy) * 100.0) : previous;
        double place = mz_round(((next_x - fx) * dx + (next_y - fy) * dy) * 100.0);
        mz_letters_put16(w->out + w->used, (int)(place - here));
        w->used += 2;
        previous = place;
    }
}

MZ_EXPORT int mz_text_letters(fz_stext_page *page, unsigned char *out, int capacity, int max_lines, int max_chars, int *written, int *walked)
{
    fz_context *ctx = mzg_context();
    fz_stext_page_block_iterator pos;
    mz_letters_out w;
    int lines = 0;

    *written = 0;
    *walked = 0;
    if (ctx == NULL || page == NULL || out == NULL || capacity < 0 || max_lines < 0 || max_chars < 0)
        return MZ_ERR;
    w.out = out;
    w.capacity = (size_t)capacity;
    w.used = 0;
    w.full = 0;

    fz_try(ctx)
    {
        for (pos = fz_stext_page_block_iterator_begin_dfs(page); !fz_stext_page_block_iterator_eod_dfs(pos); pos = fz_stext_page_block_iterator_next_dfs(pos))
        {
            fz_stext_line *line;
            if (pos.block->type != FZ_STEXT_BLOCK_TEXT)
                continue;
            for (line = pos.block->u.t.first_line; line != NULL; line = line->next)
            {
                if (lines < max_lines && !w.full)
                    mz_letters_line(&w, line, max_chars);
                lines++;
            }
        }
    }
    fz_catch(ctx)
    {
        return MZ_ERR;
    }
    *walked = lines;
    if (w.full)
        return MZ_LETTERS_FULL;
    *written = (int)w.used;
    return MZ_OK;
}

/*
 * ============================================================================
 * CUTTING DRAWINGS AT A REDACTION MARK'S EDGE (ADR-0286)
 * ============================================================================
 *
 * MuPDF's burn-in keeps or drops a whole subpath, judged by fz_bound_path's box,
 * which over-reaches: with "remove if covered" a drawn signature under a mark
 * stayed in the file, and with "remove if touched" a background and a line 8
 * points clear of the mark went too. This pass runs before the burn-in and
 * leaves nothing drawn inside a mark and everything outside as it was.
 *
 * HOW. The page's content goes through pdf_filter_page_contents with the filter
 * list [MuPDF's sanitize filter, this one]. The sanitize filter instances every
 * form the page draws and runs the same list over it, with the form's placement
 * and /Matrix in the transform this filter is given, so forms are cut in their
 * own instance and in page space. This filter holds each path until it is
 * painted. A path whose ink meets no mark is passed on unchanged. A path whose
 * ink meets one is replaced:
 *
 *   - its ink, as directed edges: a fill's own flattened contours, a stroke's
 *     outline from MuPDF's own stroker (fz_flatten_stroke_path into a capturing
 *     rasteriser, the one internal interface this uses, from draw-imp.h, whose
 *     declarations scripts/provision/drawImpPin.proof.mjs pins);
 *   - each edge a->b closed into the quadrilateral (a, b, (X, b.y), (X, a.y)),
 *     X right of all the ink, which keeps the scanline winding number of every
 *     point, so the quadrilaterals together fill exactly the ink under either
 *     fill rule (mz_fan_cut says why not a triangle to one point);
 *   - each quadrilateral clipped (Sutherland-Hodgman) to the convex pieces of
 *     the area outside each mark: outside edge i and inside edges 0..i-1 of the
 *     mark's convex quadrilateral, for i = 0..3. Disjoint, and together the
 *     whole plane less the mark.
 *
 *   A fill keeps its operator and rule. A stroke's cut outline is filled with
 *   the stroke's own paint where the fill and stroke alpha and overprint agree,
 *   which draws the stroker's own pixels; otherwise it becomes a clip, painted
 *   by one synthetic wide stroke lying away from every mark, which keeps the
 *   stroke's alpha and overprint. A stroke under 1 point wide (on the page) is cut on its
 *   centre line instead and stays a stroke, its dash phase carried along: an
 *   outline would not keep the minimum width a viewer gives a thin stroke. A
 *   clip path is cut when its boundary enters a mark, and an unpainted path (n)
 *   that enters one is dropped: it paints nothing.
 *
 * Nothing of the original geometry inside a mark is written. A mark is its
 * /QuadPoints where it has them (a text mark, slanted on turned text), read in
 * user space as MuPDF's own culler reads them, else its /Rect.
 */
#include "../source/fitz/draw-imp.h"

/* A stroke narrower than this on the page is cut on its centre line. */
#define MZ_CUT_HAIRLINE 1.0f
/* Flattening tolerance on the page, in points. */
#define MZ_CUT_FLATNESS 0.01f
/* A clipped piece smaller than this (square points) is nothing. */
#define MZ_CUT_AREA_EPS 1e-9
#define MZ_CUT_ERR_DEPTH 64

typedef struct
{
    fz_point v[4]; /* convex, counter-clockwise in user space */
    fz_rect box;
} mz_mark;

typedef struct
{
    mz_mark *marks;
    int count;
    int cut;  /* paths replaced */
    int clip_cut; /* of which clip paths, at the page's own level */
} mz_cut_options;

typedef struct
{
    fz_point *v;
    int n, cap;
} mz_poly;

typedef struct
{
    mz_poly *p;
    int n, cap;
} mz_polys;

typedef struct
{
    float x0, y0, x1, y1;
} mz_edge;

typedef struct
{
    mz_edge *e;
    int n, cap;
} mz_edges;

static void mz_poly_push(fz_context *ctx, mz_poly *p, fz_point pt)
{
    if (p->n == p->cap)
    {
        int cap = p->cap ? p->cap * 2 : 8;
        p->v = fz_realloc_array(ctx, p->v, cap, fz_point);
        p->cap = cap;
    }
    p->v[p->n++] = pt;
}

static void mz_poly_free(fz_context *ctx, mz_poly *p)
{
    fz_free(ctx, p->v);
    p->v = NULL;
    p->n = p->cap = 0;
}

/* Takes ownership of `p`'s points. */
static void mz_polys_push(fz_context *ctx, mz_polys *ps, mz_poly *p)
{
    if (ps->n == ps->cap)
    {
        int cap = ps->cap ? ps->cap * 2 : 16;
        ps->p = fz_realloc_array(ctx, ps->p, cap, mz_poly);
        ps->cap = cap;
    }
    ps->p[ps->n++] = *p;
    p->v = NULL;
    p->n = p->cap = 0;
}

static void mz_polys_free(fz_context *ctx, mz_polys *ps)
{
    int i;
    for (i = 0; i < ps->n; i++)
        fz_free(ctx, ps->p[i].v);
    fz_free(ctx, ps->p);
    ps->p = NULL;
    ps->n = ps->cap = 0;
}

static void mz_edges_push(fz_context *ctx, mz_edges *es, float x0, float y0, float x1, float y1)
{
    if (x0 == x1 && y0 == y1)
        return;
    if (es->n == es->cap)
    {
        int cap = es->cap ? es->cap * 2 : 64;
        es->e = fz_realloc_array(ctx, es->e, cap, mz_edge);
        es->cap = cap;
    }
    es->e[es->n].x0 = x0;
    es->e[es->n].y0 = y0;
    es->e[es->n].x1 = x1;
    es->e[es->n].y1 = y1;
    es->n++;
}

/* ---- the capturing rasteriser: MuPDF's stroker and filler write the ink's edges here ---- */

typedef struct
{
    fz_rasterizer super;
    mz_edges *out;
} mz_capture;

static void mz_capture_insert(fz_context *ctx, fz_rasterizer *r, float x0, float y0, float x1, float y1, int rev)
{
    /* THE PLAIN RASTERISER IGNORES `rev` (fz_insert_gel): the direction of x0,y0 -> x1,y1 is the winding. */
    (void)rev;
    mz_edges_push(ctx, ((mz_capture *)r)->out, x0, y0, x1, y1);
}

static void mz_capture_rect(fz_context *ctx, fz_rasterizer *r, float x0, float y0, float x1, float y1)
{
    /* THE CYCLE fz_insert_gel_rect's two vertical edges belong to: up the right side, down the left. */
    mz_edges *out = ((mz_capture *)r)->out;
    mz_edges_push(ctx, out, x0, y0, x1, y0);
    mz_edges_push(ctx, out, x1, y0, x1, y1);
    mz_edges_push(ctx, out, x1, y1, x0, y1);
    mz_edges_push(ctx, out, x0, y1, x0, y0);
}

static int mz_capture_reset(fz_context *ctx, fz_rasterizer *r)
{
    (void)ctx;
    (void)r;
    return 0; /* one pass */
}

static void mz_capture_nothing(fz_context *ctx, fz_rasterizer *r)
{
    (void)ctx;
    (void)r;
}

static void mz_capture_drop(fz_context *ctx, fz_rasterizer *r)
{
    fz_free(ctx, r);
}

static int mz_capture_is_rect(fz_context *ctx, fz_rasterizer *r)
{
    (void)ctx;
    (void)r;
    return 0;
}

static const fz_rasterizer_fns mz_capture_fns = {
    mz_capture_drop,
    mz_capture_reset,
    mz_capture_nothing, /* postindex */
    mz_capture_insert,
    mz_capture_rect,
    mz_capture_nothing, /* gap */
    NULL,               /* convert: never asked to make pixels */
    mz_capture_is_rect,
    0,
};

static fz_rasterizer *mz_new_capture(fz_context *ctx, mz_edges *out)
{
    mz_capture *c = fz_new_rasterizer_of_size(ctx, sizeof(mz_capture), &mz_capture_fns);
    c->out = out;
    /* NO ANTI-ALIASING SCALE: the edges are wanted in the coordinates they were computed in. */
    c->super.aa.hscale = 1;
    c->super.aa.vscale = 1;
    c->super.aa.scale = 1;
    c->super.aa.bits = 0;
    c->super.aa.text_bits = 0;
    c->super.aa.min_line_width = 0;
    return &c->super;
}

/* ---- geometry ---- */

static double mz_cross(fz_point a, fz_point b, fz_point p)
{
    return ((double)b.x - a.x) * ((double)p.y - a.y) - ((double)b.y - a.y) * ((double)p.x - a.x);
}

static double mz_poly_area(const mz_poly *p)
{
    double s = 0;
    int i;
    for (i = 0; i < p->n; i++)
    {
        fz_point a = p->v[i], b = p->v[(i + 1) % p->n];
        s += (double)a.x * b.y - (double)b.x * a.y;
    }
    return s / 2;
}

static fz_rect mz_poly_box(const mz_poly *p)
{
    fz_rect r = fz_empty_rect;
    int i;
    for (i = 0; i < p->n; i++)
        r = fz_include_point_in_rect(r, p->v[i]);
    return r;
}

static int mz_boxes_meet(fz_rect a, fz_rect b)
{
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/*
 * One Sutherland-Hodgman step: the part of `in` on the kept side of the line a->b, into `out` (emptied first).
 * keep_left: the side where mz_cross(a, b, p) >= 0, which is a counter-clockwise polygon's inside.
 */
static void mz_clip_half(fz_context *ctx, const mz_poly *in, mz_poly *out, fz_point a, fz_point b, int keep_left)
{
    int i;
    out->n = 0;
    for (i = 0; i < in->n; i++)
    {
        fz_point s = in->v[i], e = in->v[(i + 1) % in->n];
        double ds = mz_cross(a, b, s), de = mz_cross(a, b, e);
        int s_in, e_in;
        if (!keep_left)
        {
            ds = -ds;
            de = -de;
        }
        s_in = ds >= 0;
        e_in = de >= 0;
        if (s_in)
            mz_poly_push(ctx, out, s);
        if (s_in != e_in)
        {
            double t = ds / (ds - de);
            fz_point m;
            m.x = (float)(s.x + (e.x - s.x) * t);
            m.y = (float)(s.y + (e.y - s.y) * t);
            mz_poly_push(ctx, out, m);
        }
    }
}

/* `list` with every mark's inside taken out of each polygon; `list` is replaced. */
static void mz_cut_polys(fz_context *ctx, mz_polys *list, const mz_cut_options *marks)
{
    int k;
    mz_poly a = { 0 }, b = { 0 };

    fz_var(a);
    fz_var(b);

    fz_try(ctx)
    {
        for (k = 0; k < marks->count; k++)
        {
            const mz_mark *m = &marks->marks[k];
            mz_polys next = { 0 };
            int i;

            fz_try(ctx)
            {
                for (i = 0; i < list->n; i++)
                {
                    mz_poly *p = &list->p[i];
                    int side;
                    if (!mz_boxes_meet(mz_poly_box(p), m->box))
                    {
                        mz_polys_push(ctx, &next, p);
                        continue;
                    }
                    for (side = 0; side < 4; side++)
                    {
                        int j;
                        mz_clip_half(ctx, p, &a, m->v[side], m->v[(side + 1) % 4], 0);
                        for (j = 0; j < side && a.n >= 3; j++)
                        {
                            mz_poly swap;
                            mz_clip_half(ctx, &a, &b, m->v[j], m->v[(j + 1) % 4], 1);
                            swap = a;
                            a = b;
                            b = swap;
                        }
                        if (a.n >= 3 && fabs(mz_poly_area(&a)) > MZ_CUT_AREA_EPS)
                        {
                            mz_poly copy = { 0 };
                            int q;
                            for (q = 0; q < a.n; q++)
                                mz_poly_push(ctx, &copy, a.v[q]);
                            mz_polys_push(ctx, &next, &copy);
                        }
                    }
                }
            }
            fz_catch(ctx)
            {
                mz_polys_free(ctx, &next);
                fz_rethrow(ctx);
            }
            mz_polys_free(ctx, list);
            *list = next;
        }
    }
    fz_always(ctx)
    {
        mz_poly_free(ctx, &a);
        mz_poly_free(ctx, &b);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/* The part of the segment p0->p1 inside a convex counter-clockwise mark, as parameters t0 < t1; 0 where none. */
static int mz_segment_in_mark(const mz_mark *m, fz_point p0, fz_point p1, double *t0, double *t1)
{
    double lo = 0, hi = 1;
    int i;
    for (i = 0; i < 4; i++)
    {
        double d0 = mz_cross(m->v[i], m->v[(i + 1) % 4], p0);
        double d1 = mz_cross(m->v[i], m->v[(i + 1) % 4], p1);
        if (d0 <= 0 && d1 <= 0)
            return 0;
        if (d0 < 0 || d1 < 0)
        {
            double t = d0 / (d0 - d1);
            if (d0 < 0)
                lo = fmax(lo, t);
            else
                hi = fmin(hi, t);
        }
    }
    if (hi - lo <= 1e-9)
        return 0;
    *t0 = lo;
    *t1 = hi;
    return 1;
}

/* The winding number of the edge set around `p`, by a ray to the right. */
static int mz_winding(const mz_edges *es, fz_point p)
{
    int w = 0, i;
    for (i = 0; i < es->n; i++)
    {
        const mz_edge *e = &es->e[i];
        if ((e->y0 <= p.y) != (e->y1 <= p.y))
        {
            double x = e->x0 + (p.y - e->y0) * (double)(e->x1 - e->x0) / (e->y1 - e->y0);
            if (x > p.x)
                w += e->y1 > e->y0 ? 1 : -1;
        }
    }
    return w;
}

/*
 * Whether the ink an edge set fills meets any mark: an edge crosses into one, or a mark's centre lies inside the ink.
 * `boundary_only` asks only the first, which is what a clip path's data is about.
 */
static int mz_ink_meets_marks(const mz_edges *es, const mz_cut_options *marks, int evenodd, int boundary_only)
{
    int k, i;
    fz_rect box = fz_empty_rect;
    for (i = 0; i < es->n; i++)
    {
        box = fz_include_point_in_rect(box, fz_make_point(es->e[i].x0, es->e[i].y0));
        box = fz_include_point_in_rect(box, fz_make_point(es->e[i].x1, es->e[i].y1));
    }
    for (k = 0; k < marks->count; k++)
    {
        const mz_mark *m = &marks->marks[k];
        fz_point c;
        int w;
        if (!mz_boxes_meet(box, m->box))
            continue;
        for (i = 0; i < es->n; i++)
        {
            double t0, t1;
            if (mz_segment_in_mark(m, fz_make_point(es->e[i].x0, es->e[i].y0), fz_make_point(es->e[i].x1, es->e[i].y1), &t0, &t1))
                return 1;
        }
        if (boundary_only)
            continue;
        c.x = (m->v[0].x + m->v[1].x + m->v[2].x + m->v[3].x) / 4;
        c.y = (m->v[0].y + m->v[1].y + m->v[2].y + m->v[3].y) / 4;
        w = mz_winding(es, c);
        if (evenodd ? (w & 1) : (w != 0))
            return 1;
    }
    return 0;
}

/*
 * The ink of an edge set as closed polygons, cut by the marks.
 *
 * EACH EDGE a->b BECOMES THE QUADRILATERAL (a, b, (X, b.y), (X, a.y)), X right of all the ink. Its winding number at a
 * point is that edge's crossing of the point's rightward ray, so the quadrilaterals together have the scanline winding
 * MuPDF's rasteriser fills by, whether or not the edges close up: MuPDF's stroker does not close them (it sends a dash's
 * two cap edges twice, measured 2026-11-05, and the rasteriser ignores the horizontal edges that would balance them).
 * The edges added are level, which a scanline rasteriser takes as nothing, or upright on x = X, where they cancel exactly,
 * so no sliver is drawn: closing each edge to one point instead left 7% of ink in the gaps between dashes. A level edge
 * itself is left out, having no crossing.
 *
 * A RUN OF EDGES IS ONE POLYGON. Consecutive edges that join end to start and go the same way up or down the page have
 * quadrilaterals whose y ranges touch and never overlap, so together they are exactly the polygon (p0, ..., pk,
 * (X, pk.y), (X, p0.y)): a point's rightward ray crosses one edge of the run, the same crossing. Written one by one a
 * curve flattened at MZ_CUT_FLATNESS cost four points an edge, and a page of 4,000 drawings grew from 151,983 to 222,086
 * bytes under one mark (measured 2026-11-06, the owner's 132,274 to 402,373 the same shape); as runs it is one point an
 * edge and three a run.
 */
static void mz_fan_polys(fz_context *ctx, const mz_edges *es, float far, mz_polys *out);

static void mz_fan_cut(fz_context *ctx, const mz_edges *es, const mz_cut_options *marks, mz_polys *out)
{
    float far = -1e30f;
    int i;
    for (i = 0; i < es->n; i++)
        far = fmaxf(far, fmaxf(es->e[i].x0, es->e[i].x1));
    mz_fan_polys(ctx, es, far + 1, out);
    mz_cut_polys(ctx, out, marks);
}

/* The quadrilaterals of an edge set to x = `far`, a run of joined edges as one polygon (see mz_fan_cut), not yet cut. */
typedef struct
{
    float x, y;
    int edge;
} mz_end_key;

static int mz_end_key_cmp(const void *a, const void *b)
{
    const mz_end_key *p = a, *q = b;
    if (p->x != q->x)
        return p->x < q->x ? -1 : 1;
    if (p->y != q->y)
        return p->y < q->y ? -1 : 1;
    return p->edge - q->edge;
}

/* An unused edge in `keys` (sorted) at (x, y) going the way `down` says, or -1. */
static int mz_find_end(const mz_end_key *keys, int n, const mz_edges *es, const unsigned char *used, float x, float y, int down)
{
    int lo = 0, hi = n;
    while (lo < hi)
    {
        int mid = (lo + hi) / 2;
        if (keys[mid].x < x || (keys[mid].x == x && keys[mid].y < y))
            lo = mid + 1;
        else
            hi = mid;
    }
    for (; lo < n && keys[lo].x == x && keys[lo].y == y; lo++)
    {
        const mz_edge *e = &es->e[keys[lo].edge];
        if (!used[keys[lo].edge] && (e->y1 > e->y0) == down)
            return keys[lo].edge;
    }
    return -1;
}

/*
 * The quadrilaterals of an edge set to x = `far`, a run of joined edges as one polygon (see mz_fan_cut), not yet cut.
 *
 * THE RUNS ARE FOUND BY THEIR ENDS, not by the order the edges came in: MuPDF's stroker sends a stroke's two sides
 * interleaved, so no two edges in a row joined and every edge was its own quadrilateral (measured 2026-11-07: a 3-point
 * circle under a mark, 180,999 bytes). Joining an edge to the unused one that starts where it ends, going the same way
 * up or down, is the same set of edges and the same winding.
 */
static void mz_fan_polys(fz_context *ctx, const mz_edges *es, float far, mz_polys *out)
{
    mz_end_key *starts = NULL, *ends = NULL;
    unsigned char *used = NULL;
    int *chain = NULL;
    int i;

    if (es->n == 0)
        return;
    fz_var(starts);
    fz_var(ends);
    fz_var(used);
    fz_var(chain);
    fz_try(ctx)
    {
        starts = fz_malloc_array(ctx, es->n, mz_end_key);
        ends = fz_malloc_array(ctx, es->n, mz_end_key);
        used = fz_calloc(ctx, es->n, 1);
        chain = fz_malloc_array(ctx, 2 * es->n + 1, int);
        for (i = 0; i < es->n; i++)
        {
            starts[i].x = es->e[i].x0;
            starts[i].y = es->e[i].y0;
            starts[i].edge = i;
            ends[i].x = es->e[i].x1;
            ends[i].y = es->e[i].y1;
            ends[i].edge = i;
        }
        qsort(starts, es->n, sizeof *starts, mz_end_key_cmp);
        qsort(ends, es->n, sizeof *ends, mz_end_key_cmp);
        for (i = 0; i < es->n; i++)
        {
            mz_poly t = { 0 };
            int head, tail, down, k, q;
            const mz_edge *e = &es->e[i];
            if (used[i] || e->y0 == e->y1)
                continue;
            down = e->y1 > e->y0;
            /* THE CHAIN, held in the middle of `chain` so it can grow either way. */
            head = tail = es->n;
            chain[head] = i;
            used[i] = 1;
            for (;;)
            {
                const mz_edge *f = &es->e[chain[head]];
                k = mz_find_end(ends, es->n, es, used, f->x0, f->y0, down);
                if (k < 0)
                    break;
                used[k] = 1;
                chain[--head] = k;
            }
            for (;;)
            {
                const mz_edge *f = &es->e[chain[tail]];
                k = mz_find_end(starts, es->n, es, used, f->x1, f->y1, down);
                if (k < 0)
                    break;
                used[k] = 1;
                chain[++tail] = k;
            }
            mz_poly_push(ctx, &t, fz_make_point(es->e[chain[head]].x0, es->e[chain[head]].y0));
            for (q = head; q <= tail; q++)
                mz_poly_push(ctx, &t, fz_make_point(es->e[chain[q]].x1, es->e[chain[q]].y1));
            mz_poly_push(ctx, &t, fz_make_point(far, es->e[chain[tail]].y1));
            mz_poly_push(ctx, &t, fz_make_point(far, es->e[chain[head]].y0));
            mz_polys_push(ctx, out, &t);
        }
    }
    fz_always(ctx)
    {
        fz_free(ctx, starts);
        fz_free(ctx, ends);
        fz_free(ctx, used);
        fz_free(ctx, chain);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/* ---- the filter ---- */

/*
 * THE STROKE'S PAINT, as the operators that set it: what a cut stroke is filled with, so its outline rasterises as the
 * stroke did. Names and numbers only, which is all the output processor writes (pdf-op-buffer.c), and a name the stroke
 * used is in the resources the sanitize filter keeps.
 */
enum { MZ_PAINT_GRAY, MZ_PAINT_RGB, MZ_PAINT_CMYK, MZ_PAINT_SPACE, MZ_PAINT_PATTERN, MZ_PAINT_SHADE };

typedef struct
{
    int kind;
    char space[64];
    char pattern[64];
    int n;
    float color[FZ_MAX_COLORS];
} mz_paint;

typedef struct
{
    fz_matrix ctm;
    float linewidth, miterlimit, phase;
    int cap, join;
    pdf_obj *dash;
    mz_paint stroke_paint;
    float fill_alpha, stroke_alpha;
    int fill_overprint, stroke_overprint;
    int blend_normal; /* the blend mode is Normal (or Compatible): a second coat of an opaque paint changes nothing */
} mz_cut_gstate;

typedef struct
{
    pdf_processor super;
    pdf_document *doc;
    mz_cut_options *options;
    fz_matrix base; /* this stream's space to the page's user space */
    int top_level;  /* the page's own stream, not a form instance */
    mz_cut_gstate *gs;
    int gs_n, gs_cap;
    fz_path *path;
    int clip; /* 0 none, 1 W, 2 W* */
} mz_cut_processor;

static mz_cut_gstate *mz_gs(mz_cut_processor *p)
{
    return &p->gs[p->gs_n - 1];
}

static fz_matrix mz_total(mz_cut_processor *p)
{
    return fz_concat(mz_gs(p)->ctm, p->base);
}

static void mz_cut_q(fz_context *ctx, pdf_processor *proc)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    if (p->gs_n == p->gs_cap)
    {
        int cap = p->gs_cap * 2;
        p->gs = fz_realloc_array(ctx, p->gs, cap, mz_cut_gstate);
        p->gs_cap = cap;
    }
    p->gs[p->gs_n] = p->gs[p->gs_n - 1];
    pdf_keep_obj(ctx, p->gs[p->gs_n].dash);
    p->gs_n++;
    if (proc->chain->op_q)
        proc->chain->op_q(ctx, proc->chain);
}

static void mz_cut_Q(fz_context *ctx, pdf_processor *proc)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    if (p->gs_n > 1)
    {
        pdf_drop_obj(ctx, mz_gs(p)->dash);
        p->gs_n--;
    }
    if (proc->chain->op_Q)
        proc->chain->op_Q(ctx, proc->chain);
}

static void mz_cut_cm(fz_context *ctx, pdf_processor *proc, float a, float b, float c, float d, float e, float f)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    mz_gs(p)->ctm = fz_concat(fz_make_matrix(a, b, c, d, e, f), mz_gs(p)->ctm);
    if (proc->chain->op_cm)
        proc->chain->op_cm(ctx, proc->chain, a, b, c, d, e, f);
}

static void mz_cut_w(fz_context *ctx, pdf_processor *proc, float v)
{
    mz_gs((mz_cut_processor *)proc)->linewidth = v;
    if (proc->chain->op_w)
        proc->chain->op_w(ctx, proc->chain, v);
}

static void mz_cut_J(fz_context *ctx, pdf_processor *proc, int v)
{
    mz_gs((mz_cut_processor *)proc)->cap = v;
    if (proc->chain->op_J)
        proc->chain->op_J(ctx, proc->chain, v);
}

static void mz_cut_j(fz_context *ctx, pdf_processor *proc, int v)
{
    mz_gs((mz_cut_processor *)proc)->join = v;
    if (proc->chain->op_j)
        proc->chain->op_j(ctx, proc->chain, v);
}

static void mz_cut_M(fz_context *ctx, pdf_processor *proc, float v)
{
    mz_gs((mz_cut_processor *)proc)->miterlimit = v;
    if (proc->chain->op_M)
        proc->chain->op_M(ctx, proc->chain, v);
}

static void mz_cut_d(fz_context *ctx, pdf_processor *proc, pdf_obj *array, float phase)
{
    mz_cut_gstate *g = mz_gs((mz_cut_processor *)proc);
    pdf_drop_obj(ctx, g->dash);
    g->dash = pdf_keep_obj(ctx, array);
    g->phase = phase;
    if (proc->chain->op_d)
        proc->chain->op_d(ctx, proc->chain, array, phase);
}

static void mz_paint_name(char *dst, const char *name)
{
    size_t n = name ? strlen(name) : 0;
    if (n > 63)
        n = 63;
    if (n)
        memcpy(dst, name, n);
    dst[n] = 0;
}

static void mz_paint_numbers(mz_paint *paint, int n, const float *color)
{
    int i;
    if (n > FZ_MAX_COLORS)
        n = FZ_MAX_COLORS;
    paint->n = n < 0 ? 0 : n;
    for (i = 0; i < paint->n; i++)
        paint->color[i] = color[i];
}

static void mz_cut_CS(fz_context *ctx, pdf_processor *proc, const char *name, fz_colorspace *cs)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_SPACE;
    mz_paint_name(paint->space, name);
    paint->n = 0;
    if (proc->chain->op_CS)
        proc->chain->op_CS(ctx, proc->chain, name, cs);
}

static void mz_cut_SC_color(fz_context *ctx, pdf_processor *proc, int n, float *color)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    if (paint->kind == MZ_PAINT_PATTERN || paint->kind == MZ_PAINT_SHADE)
        paint->kind = MZ_PAINT_SPACE;
    mz_paint_numbers(paint, n, color);
    if (proc->chain->op_SC_color)
        proc->chain->op_SC_color(ctx, proc->chain, n, color);
}

static void mz_cut_SC_pattern(fz_context *ctx, pdf_processor *proc, const char *name, pdf_pattern *pat, int n, float *color)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_PATTERN;
    mz_paint_name(paint->pattern, name);
    mz_paint_numbers(paint, n, color);
    if (proc->chain->op_SC_pattern)
        proc->chain->op_SC_pattern(ctx, proc->chain, name, pat, n, color);
}

static void mz_cut_SC_shade(fz_context *ctx, pdf_processor *proc, const char *name, fz_shade *shade)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_SHADE;
    mz_paint_name(paint->pattern, name);
    paint->n = 0;
    if (proc->chain->op_SC_shade)
        proc->chain->op_SC_shade(ctx, proc->chain, name, shade);
}

static void mz_cut_G(fz_context *ctx, pdf_processor *proc, float g)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_GRAY;
    paint->n = 1;
    paint->color[0] = g;
    if (proc->chain->op_G)
        proc->chain->op_G(ctx, proc->chain, g);
}

static void mz_cut_RG(fz_context *ctx, pdf_processor *proc, float r, float g, float b)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_RGB;
    paint->n = 3;
    paint->color[0] = r;
    paint->color[1] = g;
    paint->color[2] = b;
    if (proc->chain->op_RG)
        proc->chain->op_RG(ctx, proc->chain, r, g, b);
}

static void mz_cut_K(fz_context *ctx, pdf_processor *proc, float c, float m, float y, float k)
{
    mz_paint *paint = &mz_gs((mz_cut_processor *)proc)->stroke_paint;
    paint->kind = MZ_PAINT_CMYK;
    paint->n = 4;
    paint->color[0] = c;
    paint->color[1] = m;
    paint->color[2] = y;
    paint->color[3] = k;
    if (proc->chain->op_K)
        proc->chain->op_K(ctx, proc->chain, c, m, y, k);
}

static void mz_cut_gs_BM(fz_context *ctx, pdf_processor *proc, const char *blendmode)
{
    mz_gs((mz_cut_processor *)proc)->blend_normal =
        blendmode == NULL || !strcmp(blendmode, "Normal") || !strcmp(blendmode, "Compatible");
    if (proc->chain->op_gs_BM)
        proc->chain->op_gs_BM(ctx, proc->chain, blendmode);
}

static void mz_cut_gs_ca(fz_context *ctx, pdf_processor *proc, float alpha)
{
    mz_gs((mz_cut_processor *)proc)->fill_alpha = alpha;
    if (proc->chain->op_gs_ca)
        proc->chain->op_gs_ca(ctx, proc->chain, alpha);
}

static void mz_cut_gs_CA(fz_context *ctx, pdf_processor *proc, float alpha)
{
    mz_gs((mz_cut_processor *)proc)->stroke_alpha = alpha;
    if (proc->chain->op_gs_CA)
        proc->chain->op_gs_CA(ctx, proc->chain, alpha);
}

static void mz_cut_gs_op(fz_context *ctx, pdf_processor *proc, int b)
{
    mz_gs((mz_cut_processor *)proc)->fill_overprint = b;
    if (proc->chain->op_gs_op)
        proc->chain->op_gs_op(ctx, proc->chain, b);
}

static void mz_cut_gs_OP(fz_context *ctx, pdf_processor *proc, int b)
{
    mz_cut_gstate *g = mz_gs((mz_cut_processor *)proc);
    /* `OP` alone sets both, as ISO 32000 says of an ExtGState with no `op`; an `op` after it then sets the fill's. */
    g->stroke_overprint = b;
    g->fill_overprint = b;
    if (proc->chain->op_gs_OP)
        proc->chain->op_gs_OP(ctx, proc->chain, b);
}

/* The stroke's paint, set as the fill's. */
static void mz_emit_fill_paint(fz_context *ctx, pdf_processor *chain, const mz_paint *paint)
{
    float none[1] = { 0 };
    switch (paint->kind)
    {
    case MZ_PAINT_GRAY:
        chain->op_g(ctx, chain, paint->n > 0 ? paint->color[0] : 0);
        break;
    case MZ_PAINT_RGB:
        chain->op_rg(ctx, chain, paint->color[0], paint->color[1], paint->color[2]);
        break;
    case MZ_PAINT_CMYK:
        chain->op_k(ctx, chain, paint->color[0], paint->color[1], paint->color[2], paint->color[3]);
        break;
    case MZ_PAINT_SPACE:
        chain->op_cs(ctx, chain, paint->space, NULL);
        if (paint->n > 0)
            chain->op_sc_color(ctx, chain, paint->n, (float *)paint->color);
        break;
    case MZ_PAINT_PATTERN:
        chain->op_cs(ctx, chain, paint->space, NULL);
        chain->op_sc_pattern(ctx, chain, paint->pattern, NULL, paint->n, paint->n > 0 ? (float *)paint->color : none);
        break;
    case MZ_PAINT_SHADE:
        chain->op_cs(ctx, chain, paint->space, NULL);
        chain->op_sc_shade(ctx, chain, paint->pattern, NULL);
        break;
    default:
        break;
    }
}

static void mz_cut_m(fz_context *ctx, pdf_processor *proc, float x, float y)
{
    fz_moveto(ctx, ((mz_cut_processor *)proc)->path, x, y);
}

static void mz_cut_l(fz_context *ctx, pdf_processor *proc, float x, float y)
{
    fz_lineto(ctx, ((mz_cut_processor *)proc)->path, x, y);
}

static void mz_cut_c(fz_context *ctx, pdf_processor *proc, float x1, float y1, float x2, float y2, float x3, float y3)
{
    fz_curveto(ctx, ((mz_cut_processor *)proc)->path, x1, y1, x2, y2, x3, y3);
}

static void mz_cut_v(fz_context *ctx, pdf_processor *proc, float x2, float y2, float x3, float y3)
{
    fz_curvetov(ctx, ((mz_cut_processor *)proc)->path, x2, y2, x3, y3);
}

static void mz_cut_y(fz_context *ctx, pdf_processor *proc, float x1, float y1, float x3, float y3)
{
    fz_curvetoy(ctx, ((mz_cut_processor *)proc)->path, x1, y1, x3, y3);
}

static void mz_cut_h(fz_context *ctx, pdf_processor *proc)
{
    fz_closepath(ctx, ((mz_cut_processor *)proc)->path);
}

static void mz_cut_re(fz_context *ctx, pdf_processor *proc, float x, float y, float w, float h)
{
    fz_rectto(ctx, ((mz_cut_processor *)proc)->path, x, y, x + w, y + h);
}

static void mz_cut_W(fz_context *ctx, pdf_processor *proc)
{
    (void)ctx;
    ((mz_cut_processor *)proc)->clip = 1;
}

static void mz_cut_Wstar(fz_context *ctx, pdf_processor *proc)
{
    (void)ctx;
    ((mz_cut_processor *)proc)->clip = 2;
}

/* ---- replaying the original path, unchanged ---- */

static void mz_replay_moveto(fz_context *ctx, void *arg, float x, float y)
{
    pdf_processor *c = arg;
    if (c->op_m)
        c->op_m(ctx, c, x, y);
}

static void mz_replay_lineto(fz_context *ctx, void *arg, float x, float y)
{
    pdf_processor *c = arg;
    if (c->op_l)
        c->op_l(ctx, c, x, y);
}

static void mz_replay_curveto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2, float x3, float y3)
{
    pdf_processor *c = arg;
    if (c->op_c)
        c->op_c(ctx, c, x1, y1, x2, y2, x3, y3);
}

static void mz_replay_closepath(fz_context *ctx, void *arg)
{
    pdf_processor *c = arg;
    if (c->op_h)
        c->op_h(ctx, c);
}

static void mz_replay_curvetov(fz_context *ctx, void *arg, float x2, float y2, float x3, float y3)
{
    pdf_processor *c = arg;
    if (c->op_v)
        c->op_v(ctx, c, x2, y2, x3, y3);
}

static void mz_replay_curvetoy(fz_context *ctx, void *arg, float x1, float y1, float x3, float y3)
{
    pdf_processor *c = arg;
    if (c->op_y)
        c->op_y(ctx, c, x1, y1, x3, y3);
}

static void mz_replay_rectto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2)
{
    pdf_processor *c = arg;
    if (c->op_re)
        c->op_re(ctx, c, x1, y1, x2 - x1, y2 - y1);
}

static const fz_path_walker mz_replay_walker = {
    mz_replay_moveto, mz_replay_lineto, mz_replay_curveto, mz_replay_closepath,
    NULL, mz_replay_curvetov, mz_replay_curvetoy, mz_replay_rectto,
};

/* ---- the centre line of a thin stroke, flattened, in page space ---- */

typedef struct
{
    fz_context *ctx;
    fz_matrix ctm;
    mz_polys *lines; /* each a polyline; closed ones repeat their first point */
    mz_poly cur;
    fz_point start, last;
    int open;
} mz_flat;

static void mz_flat_end(mz_flat *f)
{
    if (f->open && f->cur.n >= 2)
        mz_polys_push(f->ctx, f->lines, &f->cur);
    else
        mz_poly_free(f->ctx, &f->cur);
    f->open = 0;
}

static void mz_flat_point(mz_flat *f, float x, float y)
{
    fz_point p = fz_transform_point(fz_make_point(x, y), f->ctm);
    mz_poly_push(f->ctx, &f->cur, p);
    f->last = fz_make_point(x, y);
}

static void mz_flat_moveto(fz_context *ctx, void *arg, float x, float y)
{
    mz_flat *f = arg;
    (void)ctx;
    mz_flat_end(f);
    f->open = 1;
    f->start = fz_make_point(x, y);
    mz_flat_point(f, x, y);
}

static void mz_flat_lineto(fz_context *ctx, void *arg, float x, float y)
{
    (void)ctx;
    mz_flat_point(arg, x, y);
}

static void mz_flat_curveto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2, float x3, float y3)
{
    mz_flat *f = arg;
    fz_point a = f->last;
    fz_point p0 = fz_transform_point(a, f->ctm), p3 = fz_transform_point(fz_make_point(x3, y3), f->ctm);
    fz_point p1 = fz_transform_point(fz_make_point(x1, y1), f->ctm), p2 = fz_transform_point(fz_make_point(x2, y2), f->ctm);
    double reach = hypot(p1.x - p0.x, p1.y - p0.y) + hypot(p2.x - p1.x, p2.y - p1.y) + hypot(p3.x - p2.x, p3.y - p2.y);
    int n = (int)ceil(sqrt(reach / MZ_CUT_FLATNESS)), i;
    (void)ctx;
    if (n < 1)
        n = 1;
    if (n > 256)
        n = 256;
    for (i = 1; i <= n; i++)
    {
        double t = (double)i / n, u = 1 - t;
        double x = u * u * u * a.x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        double y = u * u * u * a.y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        mz_flat_point(f, (float)x, (float)y);
    }
}

static void mz_flat_closepath(fz_context *ctx, void *arg)
{
    mz_flat *f = arg;
    (void)ctx;
    mz_flat_point(f, f->start.x, f->start.y);
}

static void mz_flat_curvetov(fz_context *ctx, void *arg, float x2, float y2, float x3, float y3)
{
    mz_flat *f = arg;
    mz_flat_curveto(ctx, arg, f->last.x, f->last.y, x2, y2, x3, y3);
}

static void mz_flat_curvetoy(fz_context *ctx, void *arg, float x1, float y1, float x3, float y3)
{
    mz_flat_curveto(ctx, arg, x1, y1, x3, y3, x3, y3);
}

static void mz_flat_rectto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2)
{
    mz_flat_moveto(ctx, arg, x1, y1);
    mz_flat_lineto(ctx, arg, x2, y1);
    mz_flat_lineto(ctx, arg, x2, y2);
    mz_flat_lineto(ctx, arg, x1, y2);
    mz_flat_closepath(ctx, arg);
}

static const fz_path_walker mz_flat_walker = {
    mz_flat_moveto, mz_flat_lineto, mz_flat_curveto, mz_flat_closepath,
    NULL, mz_flat_curvetov, mz_flat_curvetoy, mz_flat_rectto,
};

/* A point outside every mark: left of the leftmost and below the lowest. */
static fz_point mz_outside_point(const mz_cut_options *marks)
{
    fz_point q = fz_make_point(0, 0);
    int k;
    for (k = 0; k < marks->count; k++)
    {
        if (k == 0 || marks->marks[k].box.x0 < q.x)
            q.x = marks->marks[k].box.x0;
        if (k == 0 || marks->marks[k].box.y0 < q.y)
            q.y = marks->marks[k].box.y0;
    }
    q.x -= 10;
    q.y -= 10;
    return q;
}

/* ---- writing ---- */

static void mz_emit_polys(fz_context *ctx, pdf_processor *chain, const mz_polys *ps, fz_matrix to_stream)
{
    int i, j;
    for (i = 0; i < ps->n; i++)
    {
        const mz_poly *p = &ps->p[i];
        for (j = 0; j < p->n; j++)
        {
            fz_point q = fz_transform_point(p->v[j], to_stream);
            if (j == 0)
                chain->op_m(ctx, chain, q.x, q.y);
            else
                chain->op_l(ctx, chain, q.x, q.y);
        }
        chain->op_h(ctx, chain);
    }
}

/* The least a unit vector in this matrix's space is scaled by. */
static double mz_least_expansion(fz_matrix m)
{
    double a = m.a, b = m.b, c = m.c, d = m.d;
    double s = a * a + b * b + c * c + d * d;
    double det = fabs(a * d - b * c);
    double disc = sqrt(fmax(0, s * s - 4 * det * det));
    return sqrt(fmax(0, (s - disc) / 2));
}

static int mz_segment_meets_marks(const mz_cut_options *marks, fz_point a, fz_point b)
{
    int k;
    for (k = 0; k < marks->count; k++)
    {
        double t0, t1;
        if (mz_segment_in_mark(&marks->marks[k], a, b, &t0, &t1))
            return 1;
    }
    return 0;
}

/*
 * Paints `ps` (page space) with the stroke's own paint: they become the clip, and one synthetic stroke, wide enough
 * to cover their box and lying along a line that meets no mark, paints inside it.
 */
static void mz_emit_stroke_paint(fz_context *ctx, mz_cut_processor *p, const mz_polys *ps, fz_matrix to_stream)
{
    pdf_processor *chain = p->super.chain;
    fz_rect box = fz_empty_rect;
    fz_point a, b;
    double reach, width;
    int i, tries;
    pdf_obj *none = NULL;

    for (i = 0; i < ps->n; i++)
        box = fz_union_rect(box, mz_poly_box(&ps->p[i]));
    if (fz_is_empty_rect(box))
        return;

    /*
     * FILLED WITH THE STROKE'S OWN PAINT where a fill paints as the stroke does: the quadrilaterals' added edges cancel, so
     * the rasteriser sees the stroker's own edges and draws the same pixels. Measured 2026-11-05: painted through a clip
     * instead, a stroke's edge pixels differed by up to 81 of 255 from the original's.
     */
    {
        mz_cut_gstate *g = mz_gs(p);
        if (g->fill_alpha == g->stroke_alpha && g->fill_overprint == g->stroke_overprint)
        {
            chain->op_q(ctx, chain);
            mz_emit_fill_paint(ctx, chain, &g->stroke_paint);
            mz_emit_polys(ctx, chain, ps, to_stream);
            chain->op_f(ctx, chain);
            chain->op_Q(ctx, chain);
            return;
        }
    }
    /* OTHERWISE THROUGH A CLIP, which keeps the stroke's own alpha and overprint. */
    reach = (box.y1 - box.y0) + 2;
    /* A LEVEL LINE BELOW THE BOX, moved further down until it meets no mark: synthetic, outside every mark. */
    for (tries = 0;; tries++)
    {
        double off = 1 + tries * (reach + 1);
        a = fz_make_point(box.x0 - (float)(reach + off) - 1, (float)(box.y0 - off));
        b = fz_make_point(box.x1 + (float)(reach + off) + 1, (float)(box.y0 - off));
        if (!mz_segment_meets_marks(p->options, a, b) || tries > MZ_CUT_ERR_DEPTH)
        {
            width = 2 * (off + (box.y1 - box.y0) + 1);
            break;
        }
    }

    fz_var(none);
    fz_try(ctx)
    {
        double least = mz_least_expansion(to_stream);
        fz_point sa = fz_transform_point(a, to_stream), sb = fz_transform_point(b, to_stream);
        /* WIDTH IN THE STREAM'S SPACE: the page's width over the inverse's least scale is never thinner on the page. */
        double stream_width = least > 1e-12 ? width / least : width;
        none = pdf_new_array(ctx, p->doc, 0);
        chain->op_q(ctx, chain);
        mz_emit_polys(ctx, chain, ps, to_stream);
        chain->op_W(ctx, chain);
        chain->op_n(ctx, chain);
        chain->op_d(ctx, chain, none, 0);
        chain->op_J(ctx, chain, 0);
        chain->op_w(ctx, chain, (float)stream_width);
        chain->op_m(ctx, chain, sa.x, sa.y);
        chain->op_l(ctx, chain, sb.x, sb.y);
        chain->op_S(ctx, chain);
        chain->op_Q(ctx, chain);
    }
    fz_always(ctx)
        pdf_drop_obj(ctx, none);
    fz_catch(ctx)
        fz_rethrow(ctx);
}

static fz_stroke_state *mz_stroke_state(fz_context *ctx, mz_cut_gstate *g)
{
    int n = g->dash ? pdf_array_len(ctx, g->dash) : 0, i;
    fz_stroke_state *s = fz_new_stroke_state_with_dash_len(ctx, n);
    s->linewidth = g->linewidth;
    s->miterlimit = g->miterlimit;
    s->start_cap = s->end_cap = s->dash_cap = (fz_linecap)g->cap;
    s->linejoin = (fz_linejoin)g->join;
    s->dash_phase = g->phase;
    s->dash_len = n;
    for (i = 0; i < n; i++)
        s->dash_list[i] = pdf_array_get_real(ctx, g->dash, i);
    return s;
}

/* The ink a fill of the current path paints, as edges in page space. */
static void mz_fill_edges(fz_context *ctx, mz_cut_processor *p, fz_matrix total, mz_edges *out)
{
    fz_rasterizer *r = mz_new_capture(ctx, out);
    fz_try(ctx)
        fz_flatten_fill_path(ctx, r, p->path, total, MZ_CUT_FLATNESS, fz_infinite_irect, NULL);
    fz_always(ctx)
        fz_drop_rasterizer(ctx, r);
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/* The ink a stroke of the current path paints, through MuPDF's own stroker, as edges in page space. */
static void mz_stroke_edges(fz_context *ctx, mz_cut_processor *p, fz_matrix total, mz_edges *out)
{
    fz_stroke_state *s = mz_stroke_state(ctx, mz_gs(p));
    fz_rasterizer *r = NULL;
    fz_var(r);
    fz_try(ctx)
    {
        r = mz_new_capture(ctx, out);
        fz_flatten_stroke_path(ctx, r, p->path, s, total, MZ_CUT_FLATNESS, s->linewidth, fz_infinite_irect, NULL);
    }
    fz_always(ctx)
    {
        if (r)
            fz_drop_rasterizer(ctx, r);
        fz_drop_stroke_state(ctx, s);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

static void mz_replay(fz_context *ctx, mz_cut_processor *p)
{
    fz_walk_path(ctx, p->path, &mz_replay_walker, p->super.chain);
}

/*
 * ---------------------------------------------------------------------------
 * ONLY WHAT MEETS A MARK IS REWRITTEN (ADR-0286's amendment of 2026-11-07)
 *
 * The cut used to rewrite the whole of every path whose ink met a mark, flattened at MZ_CUT_FLATNESS: a filled circle
 * of 177 bytes came back as 11,006, and every pixel along its edge, however far from the mark, was drawn from the
 * flattening rather than from the curve (measured 2026-11-07, `redactionOutside.test.ts`). Here the path is read as
 * written, subpath by subpath and segment by segment, and a curve is split, by its own control points, until each piece
 * either keeps its control box clear of every mark's box or is smaller than MZ_CUT_NEAR. A clear piece is written as the
 * curve it is, in the stream's own numbers; only the small pieces against a mark are flattened and cut. A curve lies
 * within its control points' hull, so a kept piece cannot reach into a mark.
 * ---------------------------------------------------------------------------
 */

/* A curve piece no larger than this on the page, against a mark, is flattened and cut rather than split again. */
#define MZ_CUT_NEAR 0.5f
#define MZ_CUT_SPLIT_DEPTH 24

typedef struct
{
    int cubic;     /* 0: a line from s[0] to s[3]; 1: the cubic s[0], s[1], s[2], s[3] */
    fz_point s[4]; /* the stream's space: what is written */
    fz_point p[4]; /* the page's space: what is measured */
} mz_seg;

typedef struct
{
    mz_seg *v;
    int n, cap;
    int closed;
} mz_sub;

typedef struct
{
    fz_context *ctx;
    fz_matrix total;
    mz_sub *v;
    int n, cap;
    fz_point start, last; /* the stream's space */
} mz_segs;

static void mz_segs_free(fz_context *ctx, mz_segs *g)
{
    int i;
    for (i = 0; i < g->n; i++)
        fz_free(ctx, g->v[i].v);
    fz_free(ctx, g->v);
    g->v = NULL;
    g->n = g->cap = 0;
}

static void mz_segs_new_sub(mz_segs *g)
{
    if (g->n == g->cap)
    {
        int cap = g->cap ? g->cap * 2 : 8;
        g->v = fz_realloc_array(g->ctx, g->v, cap, mz_sub);
        g->cap = cap;
    }
    memset(&g->v[g->n], 0, sizeof g->v[g->n]);
    g->n++;
}

static void mz_segs_push(mz_segs *g, int cubic, fz_point a, fz_point b, fz_point c, fz_point d)
{
    mz_sub *s;
    mz_seg *e;
    int i;
    /* A SEGMENT AFTER A CLOSE, with no move, starts a new subpath at the closed one's start, as the format has it. */
    if (g->n == 0 || g->v[g->n - 1].closed)
        mz_segs_new_sub(g);
    s = &g->v[g->n - 1];
    if (s->n == s->cap)
    {
        int cap = s->cap ? s->cap * 2 : 8;
        s->v = fz_realloc_array(g->ctx, s->v, cap, mz_seg);
        s->cap = cap;
    }
    e = &s->v[s->n++];
    e->cubic = cubic;
    e->s[0] = a;
    e->s[1] = b;
    e->s[2] = c;
    e->s[3] = d;
    for (i = 0; i < 4; i++)
        e->p[i] = fz_transform_point(e->s[i], g->total);
    g->last = d;
}

static void mz_segs_moveto(fz_context *ctx, void *arg, float x, float y)
{
    mz_segs *g = arg;
    (void)ctx;
    mz_segs_new_sub(g);
    g->start = g->last = fz_make_point(x, y);
}

static void mz_segs_lineto(fz_context *ctx, void *arg, float x, float y)
{
    mz_segs *g = arg;
    fz_point a = g->last, d = fz_make_point(x, y);
    (void)ctx;
    mz_segs_push(g, 0, a, a, d, d);
}

static void mz_segs_curveto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2, float x3, float y3)
{
    mz_segs *g = arg;
    (void)ctx;
    mz_segs_push(g, 1, g->last, fz_make_point(x1, y1), fz_make_point(x2, y2), fz_make_point(x3, y3));
}

static void mz_segs_curvetov(fz_context *ctx, void *arg, float x2, float y2, float x3, float y3)
{
    mz_segs *g = arg;
    mz_segs_curveto(ctx, arg, g->last.x, g->last.y, x2, y2, x3, y3);
}

static void mz_segs_curvetoy(fz_context *ctx, void *arg, float x1, float y1, float x3, float y3)
{
    mz_segs_curveto(ctx, arg, x1, y1, x3, y3, x3, y3);
}

static void mz_segs_closepath(fz_context *ctx, void *arg)
{
    mz_segs *g = arg;
    (void)ctx;
    if (g->n == 0)
        return;
    /* THE CLOSING SIDE AS A SEGMENT, so a fill and a stroke both see the edge the format draws there. */
    if (g->last.x != g->start.x || g->last.y != g->start.y)
        mz_segs_push(g, 0, g->last, g->last, g->start, g->start);
    g->v[g->n - 1].closed = 1;
    g->last = g->start;
}

static void mz_segs_rectto(fz_context *ctx, void *arg, float x1, float y1, float x2, float y2)
{
    mz_segs_moveto(ctx, arg, x1, y1);
    mz_segs_lineto(ctx, arg, x2, y1);
    mz_segs_lineto(ctx, arg, x2, y2);
    mz_segs_lineto(ctx, arg, x1, y2);
    mz_segs_closepath(ctx, arg);
}

static const fz_path_walker mz_segs_walker = {
    mz_segs_moveto, mz_segs_lineto, mz_segs_curveto, mz_segs_closepath,
    NULL, mz_segs_curvetov, mz_segs_curvetoy, mz_segs_rectto,
};

static void mz_read_segs(fz_context *ctx, const fz_path *path, fz_matrix total, mz_segs *out)
{
    memset(out, 0, sizeof *out);
    out->ctx = ctx;
    out->total = total;
    fz_walk_path(ctx, path, &mz_segs_walker, out);
}

static fz_rect mz_seg_box(const mz_seg *e)
{
    fz_rect r = fz_empty_rect;
    int i;
    for (i = 0; i < 4; i++)
        r = fz_include_point_in_rect(r, e->p[i]);
    return r;
}

static int mz_box_meets_marks(const mz_cut_options *marks, fz_rect box)
{
    int k;
    for (k = 0; k < marks->count; k++)
        if (mz_boxes_meet(box, marks->marks[k].box))
            return 1;
    return 0;
}

/* Whether a segment's quadrilateral to the right (mz_fan_cut) can reach a mark: a mark beside it, to its right. */
static int mz_box_shadows_marks(const mz_cut_options *marks, fz_rect box)
{
    int k;
    for (k = 0; k < marks->count; k++)
    {
        const fz_rect m = marks->marks[k].box;
        if (box.y0 < m.y1 && m.y0 < box.y1 && box.x0 < m.x1)
            return 1;
    }
    return 0;
}

static void mz_split_seg(const mz_seg *e, fz_matrix total, mz_seg *a, mz_seg *b)
{
    /* DE CASTELJAU AT ONE HALF, in the stream's space, so each half is exactly part of the curve as written. */
    fz_point p01 = fz_make_point((e->s[0].x + e->s[1].x) / 2, (e->s[0].y + e->s[1].y) / 2);
    fz_point p12 = fz_make_point((e->s[1].x + e->s[2].x) / 2, (e->s[1].y + e->s[2].y) / 2);
    fz_point p23 = fz_make_point((e->s[2].x + e->s[3].x) / 2, (e->s[2].y + e->s[3].y) / 2);
    fz_point q0 = fz_make_point((p01.x + p12.x) / 2, (p01.y + p12.y) / 2);
    fz_point q1 = fz_make_point((p12.x + p23.x) / 2, (p12.y + p23.y) / 2);
    fz_point m = fz_make_point((q0.x + q1.x) / 2, (q0.y + q1.y) / 2);
    int i;
    a->cubic = b->cubic = 1;
    a->s[0] = e->s[0];
    a->s[1] = p01;
    a->s[2] = q0;
    a->s[3] = m;
    b->s[0] = m;
    b->s[1] = q1;
    b->s[2] = p23;
    b->s[3] = e->s[3];
    for (i = 0; i < 4; i++)
    {
        a->p[i] = fz_transform_point(a->s[i], total);
        b->p[i] = fz_transform_point(b->s[i], total);
    }
}

typedef struct
{
    mz_seg seg;
    int near; /* against a mark: flattened and cut */
} mz_piece;

typedef struct
{
    mz_piece *v;
    int n, cap;
} mz_pieces;

static void mz_pieces_push(fz_context *ctx, mz_pieces *ps, const mz_seg *e, int near)
{
    if (ps->n == ps->cap)
    {
        int cap = ps->cap ? ps->cap * 2 : 16;
        ps->v = fz_realloc_array(ctx, ps->v, cap, mz_piece);
        ps->cap = cap;
    }
    ps->v[ps->n].seg = *e;
    ps->v[ps->n].near = near;
    ps->n++;
}

/* A segment as pieces: kept whole where its control box is clear of every mark's box, split where it is not. */
static void mz_pieces_of(fz_context *ctx, const mz_cut_options *marks, fz_matrix total, const mz_seg *e, int depth, mz_pieces *out)
{
    fz_rect box = mz_seg_box(e);
    mz_seg a, b;
    if (!mz_box_meets_marks(marks, box))
    {
        mz_pieces_push(ctx, out, e, 0);
        return;
    }
    if (!e->cubic || depth >= MZ_CUT_SPLIT_DEPTH || fmaxf(box.x1 - box.x0, box.y1 - box.y0) <= MZ_CUT_NEAR)
    {
        mz_pieces_push(ctx, out, e, 1);
        return;
    }
    mz_split_seg(e, total, &a, &b);
    mz_pieces_of(ctx, marks, total, &a, depth + 1, out);
    mz_pieces_of(ctx, marks, total, &b, depth + 1, out);
}

static double mz_point_line_distance(fz_point p, fz_point a, fz_point b)
{
    double dx = (double)b.x - a.x, dy = (double)b.y - a.y;
    double len = hypot(dx, dy);
    if (len < 1e-12)
        return hypot((double)p.x - a.x, (double)p.y - a.y);
    return fabs(dx * ((double)a.y - p.y) - dy * ((double)a.x - p.x)) / len;
}

/* A near piece on the page as a polyline after its first point, flat within MZ_CUT_FLATNESS, into `out`. */
static void mz_flatten_piece(fz_context *ctx, const mz_seg *e, fz_matrix total, int depth, mz_poly *out)
{
    mz_seg a, b;
    if (!e->cubic || depth >= MZ_CUT_SPLIT_DEPTH ||
        (mz_point_line_distance(e->p[1], e->p[0], e->p[3]) <= MZ_CUT_FLATNESS &&
            mz_point_line_distance(e->p[2], e->p[0], e->p[3]) <= MZ_CUT_FLATNESS))
    {
        mz_poly_push(ctx, out, e->p[3]);
        return;
    }
    mz_split_seg(e, total, &a, &b);
    mz_flatten_piece(ctx, &a, total, depth + 1, out);
    mz_flatten_piece(ctx, &b, total, depth + 1, out);
}

static void mz_emit_seg(fz_context *ctx, pdf_processor *chain, const mz_seg *e)
{
    if (e->cubic)
        chain->op_c(ctx, chain, e->s[1].x, e->s[1].y, e->s[2].x, e->s[2].y, e->s[3].x, e->s[3].y);
    else
        chain->op_l(ctx, chain, e->s[3].x, e->s[3].y);
}

static void mz_emit_sub(fz_context *ctx, pdf_processor *chain, const mz_sub *s)
{
    int i;
    if (s->n == 0)
        return;
    chain->op_m(ctx, chain, s->v[0].s[0].x, s->v[0].s[0].y);
    for (i = 0; i < s->n; i++)
        mz_emit_seg(ctx, chain, &s->v[i]);
    if (s->closed)
        chain->op_h(ctx, chain);
}

/* ---- a fill (or a clip): the subpaths that cannot reach a mark as written, the rest by their quadrilaterals ---- */

/*
 * THE WINDING IS A SUM OF QUADRILATERALS (mz_fan_cut): a closed subpath's winding everywhere is the sum, over its
 * segments, of the loop (segment, (X, end.y), (X, start.y)), and that holds for a curve as for a line. So a run of
 * clear pieces is one loop with its curves as written. Where a mark lies to the run's right, inside its height, the loop
 * is split at x = c between the run and the mark: (run, (c, end.y), (c, start.y)), which no mark meets, and the
 * rectangle from c to X, which is cut by the marks exactly as a polygon is. Near pieces are flattened and their edges'
 * quadrilaterals cut as before. A subpath none of whose quadrilaterals can reach a mark contributes nothing inside one,
 * and is written as it was.
 *
 * Answers how many loops were written, so a clip cut to nothing can be told from one that is not.
 */
static int mz_emit_fill_cut(fz_context *ctx, mz_cut_processor *p, const mz_segs *g, fz_matrix to_stream)
{
    pdf_processor *chain = p->super.chain;
    const mz_cut_options *marks = p->options;
    mz_polys polys = { 0 };
    mz_edges edges = { 0 };
    mz_pieces pieces = { 0 };
    float far = -1e30f;
    int written = 0, i, j, k;

    fz_var(polys);
    fz_var(edges);
    fz_var(pieces);
    fz_try(ctx)
    {
        for (i = 0; i < g->n; i++)
            for (j = 0; j < g->v[i].n; j++)
                for (k = 0; k < 4; k++)
                    far = fmaxf(far, g->v[i].v[j].p[k].x);
        /*
         * FROM THE PATH ALONE, as mz_fan_cut's: the split below is an identity whatever c is, so X need not pass the marks,
         * and an X past a mark would leave each quadrilateral a sliver beyond it that its partner cancels but that still
         * counts as written (a clip wholly under a mark read as not empty, measured 2026-11-07).
         */
        far += 1;

        for (i = 0; i < g->n; i++)
        {
            const mz_sub *s = &g->v[i];
            mz_seg closing;
            int reaches = 0, total_n;
            if (s->n == 0)
                continue;
            /* A FILL CLOSES EVERY SUBPATH; the closing side is part of what the quadrilaterals sum. */
            total_n = s->n;
            if (!s->closed && (s->v[s->n - 1].s[3].x != s->v[0].s[0].x || s->v[s->n - 1].s[3].y != s->v[0].s[0].y))
            {
                fz_point a = s->v[s->n - 1].s[3], d = s->v[0].s[0];
                closing.cubic = 0;
                closing.s[0] = closing.s[1] = a;
                closing.s[2] = closing.s[3] = d;
                for (k = 0; k < 4; k++)
                    closing.p[k] = fz_transform_point(closing.s[k], g->total);
                total_n++;
            }
            for (j = 0; j < total_n && !reaches; j++)
                reaches = mz_box_shadows_marks(marks, mz_seg_box(j < s->n ? &s->v[j] : &closing));
            if (!reaches)
            {
                mz_emit_sub(ctx, chain, s);
                if (!s->closed)
                    chain->op_h(ctx, chain);
                written++;
                continue;
            }

            pieces.n = 0;
            for (j = 0; j < total_n; j++)
                mz_pieces_of(ctx, marks, g->total, j < s->n ? &s->v[j] : &closing, 0, &pieces);

            /* RUNS OF CLEAR PIECES whose box together stays clear; near pieces become edges. */
            j = 0;
            while (j < pieces.n)
            {
                if (pieces.v[j].near)
                {
                    mz_poly line = { 0 };
                    int q;
                    fz_var(line);
                    fz_try(ctx)
                    {
                        mz_flatten_piece(ctx, &pieces.v[j].seg, g->total, 0, &line);
                        {
                            fz_point from = pieces.v[j].seg.p[0];
                            for (q = 0; q < line.n; q++)
                            {
                                mz_edges_push(ctx, &edges, from.x, from.y, line.v[q].x, line.v[q].y);
                                from = line.v[q];
                            }
                        }
                    }
                    fz_always(ctx)
                        mz_poly_free(ctx, &line);
                    fz_catch(ctx)
                        fz_rethrow(ctx);
                    j++;
                    continue;
                }
                {
                    int first = j, last = j, m;
                    fz_rect box = mz_seg_box(&pieces.v[j].seg);
                    fz_point a, b;
                    float c = far, right = 1e30f;
                    while (last + 1 < pieces.n && !pieces.v[last + 1].near)
                    {
                        fz_rect grown = fz_union_rect(box, mz_seg_box(&pieces.v[last + 1].seg));
                        if (mz_box_meets_marks(marks, grown))
                            break;
                        box = grown;
                        last++;
                    }
                    a = pieces.v[first].seg.p[0];
                    b = pieces.v[last].seg.p[3];
                    /* THE NEAREST MARK TO THE RUN'S RIGHT within its height: the split goes halfway to it. */
                    for (k = 0; k < marks->count; k++)
                    {
                        const fz_rect mb = marks->marks[k].box;
                        if (box.y0 < mb.y1 && mb.y0 < box.y1 && mb.x0 >= box.x1)
                            right = fminf(right, mb.x0);
                    }
                    if (right < 1e29f)
                        c = box.x1 + (right - box.x1) / 2;
                    /*
                     * A LOOP OF NO AREA IS NOT WRITTEN: it adds nothing to the winding, and a side lying on a mark's edge
                     * would otherwise make a clip the marks cut to nothing read as one that is not, keeping what it clipped.
                     * The area counts the control points, so a curve that bulges has some.
                     */
                    {
                        mz_poly hull = { 0 };
                        double area;
                        mz_poly_push(ctx, &hull, a);
                        for (m = first; m <= last; m++)
                        {
                            const mz_seg *e = &pieces.v[m].seg;
                            if (e->cubic)
                            {
                                mz_poly_push(ctx, &hull, e->p[1]);
                                mz_poly_push(ctx, &hull, e->p[2]);
                            }
                            mz_poly_push(ctx, &hull, e->p[3]);
                        }
                        mz_poly_push(ctx, &hull, fz_make_point(c, b.y));
                        mz_poly_push(ctx, &hull, fz_make_point(c, a.y));
                        area = mz_poly_area(&hull);
                        mz_poly_free(ctx, &hull);
                        if (fabs(area) <= MZ_CUT_AREA_EPS)
                        {
                            j = last + 1;
                            continue;
                        }
                    }
                    chain->op_m(ctx, chain, pieces.v[first].seg.s[0].x, pieces.v[first].seg.s[0].y);
                    for (m = first; m <= last; m++)
                        mz_emit_seg(ctx, chain, &pieces.v[m].seg);
                    {
                        fz_point qb = fz_transform_point(fz_make_point(c, b.y), to_stream);
                        fz_point qa = fz_transform_point(fz_make_point(c, a.y), to_stream);
                        chain->op_l(ctx, chain, qb.x, qb.y);
                        chain->op_l(ctx, chain, qa.x, qa.y);
                        chain->op_h(ctx, chain);
                    }
                    written++;
                    /* THE OTHER HALF, whichever side of X the split fell: a mark far to the right puts c past X. */
                    if (c != far)
                    {
                        mz_poly r = { 0 };
                        mz_poly_push(ctx, &r, fz_make_point(c, b.y));
                        mz_poly_push(ctx, &r, fz_make_point(far, b.y));
                        mz_poly_push(ctx, &r, fz_make_point(far, a.y));
                        mz_poly_push(ctx, &r, fz_make_point(c, a.y));
                        mz_polys_push(ctx, &polys, &r);
                    }
                    j = last + 1;
                }
            }
        }

        mz_fan_polys(ctx, &edges, far, &polys);
        mz_cut_polys(ctx, &polys, marks);
        mz_emit_polys(ctx, chain, &polys, to_stream);
        written += polys.n;
    }
    fz_always(ctx)
    {
        mz_polys_free(ctx, &polys);
        fz_free(ctx, edges.e);
        fz_free(ctx, pieces.v);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
    return written;
}

/* ---- a thin stroke: its centre line cut where it enters a mark, the rest as written ---- */

typedef struct
{
    mz_seg *v;
    int n, cap;
    double along; /* the length along the subpath where the run starts, on the page */
    int from_start; /* the run begins at the subpath's start point */
    int to_end;     /* the run ends at the subpath's end point */
} mz_run;

typedef struct
{
    mz_run *v;
    int n, cap;
} mz_runs;

static void mz_runs_free(fz_context *ctx, mz_runs *rs)
{
    int i;
    for (i = 0; i < rs->n; i++)
        fz_free(ctx, rs->v[i].v);
    fz_free(ctx, rs->v);
    rs->v = NULL;
    rs->n = rs->cap = 0;
}

static mz_run *mz_runs_open(fz_context *ctx, mz_runs *rs, double along, int from_start)
{
    mz_run *r;
    if (rs->n == rs->cap)
    {
        int cap = rs->cap ? rs->cap * 2 : 8;
        rs->v = fz_realloc_array(ctx, rs->v, cap, mz_run);
        rs->cap = cap;
    }
    r = &rs->v[rs->n++];
    memset(r, 0, sizeof *r);
    r->along = along;
    r->from_start = from_start;
    return r;
}

static void mz_run_push(fz_context *ctx, mz_run *r, const mz_seg *e)
{
    if (r->n == r->cap)
    {
        int cap = r->cap ? r->cap * 2 : 8;
        r->v = fz_realloc_array(ctx, r->v, cap, mz_seg);
        r->cap = cap;
    }
    r->v[r->n++] = *e;
}

static double mz_seg_length(fz_context *ctx, const mz_seg *e, fz_matrix total)
{
    mz_poly line = { 0 };
    double len = 0;
    fz_point from = e->p[0];
    int q;
    if (!e->cubic)
        return hypot((double)e->p[3].x - e->p[0].x, (double)e->p[3].y - e->p[0].y);
    fz_var(line);
    fz_try(ctx)
    {
        mz_flatten_piece(ctx, e, total, 0, &line);
        for (q = 0; q < line.n; q++)
        {
            len += hypot((double)line.v[q].x - from.x, (double)line.v[q].y - from.y);
            from = line.v[q];
        }
    }
    fz_always(ctx)
        mz_poly_free(ctx, &line);
    fz_catch(ctx)
        fz_rethrow(ctx);
    return len;
}

/* The line a->b on the page, its parts outside every mark appended to the runs, a gap closing the open one. */
static void mz_thin_line(fz_context *ctx, const mz_cut_options *marks, fz_point a, fz_point b, fz_matrix to_stream,
    fz_matrix total, mz_runs *rs, mz_run **open, double *along, int *gaps, int at_start)
{
    double lo[64], hi[64], t = 0, len = hypot((double)b.x - a.x, (double)b.y - a.y);
    int n = 0, s, k;
    for (k = 0; k < marks->count && n < 64; k++)
    {
        double t0, t1;
        if (mz_segment_in_mark(&marks->marks[k], a, b, &t0, &t1))
        {
            lo[n] = t0;
            hi[n] = t1;
            n++;
        }
    }
    for (s = 1; s < n; s++)
    {
        double l = lo[s], h = hi[s];
        int r = s - 1;
        while (r >= 0 && lo[r] > l)
        {
            lo[r + 1] = lo[r];
            hi[r + 1] = hi[r];
            r--;
        }
        lo[r + 1] = l;
        hi[r + 1] = h;
    }
    for (s = 0; s <= n; s++)
    {
        double end = s < n ? lo[s] : 1;
        if (end > t)
        {
            mz_seg e;
            fz_point from = fz_make_point((float)(a.x + (b.x - a.x) * t), (float)(a.y + (b.y - a.y) * t));
            fz_point to = fz_make_point((float)(a.x + (b.x - a.x) * end), (float)(a.y + (b.y - a.y) * end));
            int i;
            if (*open == NULL)
                *open = mz_runs_open(ctx, rs, *along + len * t, at_start && t == 0);
            e.cubic = 0;
            e.s[0] = e.s[1] = fz_transform_point(from, to_stream);
            e.s[2] = e.s[3] = fz_transform_point(to, to_stream);
            for (i = 0; i < 4; i++)
                e.p[i] = fz_transform_point(e.s[i], total);
            mz_run_push(ctx, *open, &e);
        }
        if (s < n)
        {
            if (hi[s] > lo[s])
            {
                *open = NULL;
                (*gaps)++;
            }
            if (hi[s] > t)
                t = hi[s];
        }
    }
    *along += len;
}

static void mz_emit_run(fz_context *ctx, pdf_processor *chain, const mz_run *r, int from)
{
    int i;
    for (i = from; i < r->n; i++)
        mz_emit_seg(ctx, chain, &r->v[i]);
}

/*
 * A THIN STROKE, CUT ON ITS CENTRE LINE: a subpath that meets no mark as written; a segment whose control box is clear as
 * written; a curve against a mark split, and only its small pieces against the mark flattened and cut. What is drawn
 * between two gaps is one run, so the joins inside it are the stroker's own. A CLOSED SUBPATH CUT OPEN keeps the join at
 * its start point: the run that ends there and the run that starts there are written as one, the first after the last.
 * Writing them apart left that corner to two butt ends (measured 2026-11-07: a 0.5-point square crossing a mark lost 4
 * pixels of its corner at 8x, 3 points outside the mark). A dashed subpath keeps its runs apart, each at its own phase,
 * since the pattern does not run on past a subpath's end.
 */
static void mz_emit_thin_cut(fz_context *ctx, mz_cut_processor *p, const mz_segs *g, fz_matrix to_stream)
{
    pdf_processor *chain = p->super.chain;
    const mz_cut_options *marks = p->options;
    mz_cut_gstate *gs = mz_gs(p);
    int dashed = gs->dash && pdf_array_len(ctx, gs->dash) > 0;
    mz_runs runs = { 0 };
    mz_pieces pieces = { 0 };
    int i, j, r;

    fz_var(runs);
    fz_var(pieces);
    fz_try(ctx)
    {
        for (i = 0; i < g->n; i++)
        {
            const mz_sub *s = &g->v[i];
            mz_run *open = NULL;
            double along = 0;
            int gaps = 0, touches = 0;
            if (s->n == 0)
                continue;
            for (j = 0; j < s->n && !touches; j++)
                touches = mz_box_meets_marks(marks, mz_seg_box(&s->v[j]));
            if (!touches)
            {
                if (!dashed)
                    mz_emit_sub(ctx, chain, s);
                else
                {
                    /* KEPT AS IT WAS, its own subpath under the original dash, which starts each subpath at the phase. */
                    chain->op_q(ctx, chain);
                    mz_emit_sub(ctx, chain, s);
                    chain->op_S(ctx, chain);
                    chain->op_Q(ctx, chain);
                }
                continue;
            }
            runs.n = 0;
            for (j = 0; j < s->n; j++)
            {
                int q;
                pieces.n = 0;
                mz_pieces_of(ctx, marks, g->total, &s->v[j], 0, &pieces);
                for (q = 0; q < pieces.n; q++)
                {
                    const mz_seg *e = &pieces.v[q].seg;
                    if (!pieces.v[q].near)
                    {
                        if (open == NULL)
                            open = mz_runs_open(ctx, &runs, along, j == 0 && q == 0);
                        mz_run_push(ctx, open, e);
                        if (dashed)
                            along += mz_seg_length(ctx, e, g->total);
                        continue;
                    }
                    {
                        mz_poly line = { 0 };
                        fz_point from = e->p[0];
                        int w;
                        fz_var(line);
                        fz_try(ctx)
                        {
                            mz_flatten_piece(ctx, e, g->total, 0, &line);
                            for (w = 0; w < line.n; w++)
                            {
                                /* THE SUBPATH'S VERY FIRST POINT: a run opened there starts at the subpath's start. */
                                mz_thin_line(ctx, marks, from, line.v[w], to_stream, g->total, &runs, &open, &along, &gaps,
                                    j == 0 && q == 0 && w == 0);
                                from = line.v[w];
                            }
                        }
                        fz_always(ctx)
                            mz_poly_free(ctx, &line);
                        fz_catch(ctx)
                            fz_rethrow(ctx);
                    }
                }
            }
            if (open != NULL)
                open->to_end = 1;
            if (gaps == 0)
            {
                /* NOTHING WAS CUT AFTER ALL: the subpath as written, its close included. */
                if (!dashed)
                    mz_emit_sub(ctx, chain, s);
                else
                {
                    chain->op_q(ctx, chain);
                    mz_emit_sub(ctx, chain, s);
                    chain->op_S(ctx, chain);
                    chain->op_Q(ctx, chain);
                }
                continue;
            }
            {
                /* THE JOIN AT A CLOSED SUBPATH'S START: the last run, then the first after it, as one. */
                int wrap = !dashed && s->closed && runs.n >= 2 && runs.v[0].from_start && runs.v[runs.n - 1].to_end;
                for (r = wrap ? 1 : 0; r < runs.n; r++)
                {
                    const mz_run *run = &runs.v[r];
                    if (run->n == 0)
                        continue;
                    if (dashed)
                    {
                        chain->op_q(ctx, chain);
                        chain->op_d(ctx, chain, gs->dash, (float)(gs->phase + run->along / fmax(1e-12, mz_least_expansion(g->total))));
                    }
                    chain->op_m(ctx, chain, run->v[0].s[0].x, run->v[0].s[0].y);
                    mz_emit_run(ctx, chain, run, 0);
                    if (wrap && r == runs.n - 1)
                        mz_emit_run(ctx, chain, &runs.v[0], 0);
                    if (dashed)
                    {
                        chain->op_S(ctx, chain);
                        chain->op_Q(ctx, chain);
                    }
                }
            }
        }
        if (!dashed)
            chain->op_S(ctx, chain);
    }
    fz_always(ctx)
    {
        mz_runs_free(ctx, &runs);
        fz_free(ctx, pieces.v);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

/* ---- a wide stroke: the subpaths whose ink shares no pixel with a cut one stroked as written, the rest outlined ---- */

/*
 * A STROKE'S SUBPATHS ARE PAINTED AS ONE (one S): where two of them cover a pixel, the rasteriser takes their coverage
 * together. Split into a stroke and a fill, that pixel is painted twice, and an antialiased edge comes out darker
 * (measured 2026-11-07: a 3-point circle stroked in part and outlined in part darkened 300 pixels along the overlap, by
 * up to 64 levels at 4x). So a subpath is kept as written only where its ink box, grown by a point, meets no cut
 * subpath's ink box, and only where a second coat changes nothing: opaque, no overprint, the Normal blend. A dashed
 * stroke keeps its pattern, which the format restarts at each subpath. Elsewhere the whole path is outlined, as before.
 * Answers whether it did the work, so the caller can fall back.
 */
static int mz_emit_wide_cut(fz_context *ctx, mz_cut_processor *p, const mz_segs *g, fz_matrix total, fz_matrix to_stream)
{
    pdf_processor *chain = p->super.chain;
    mz_cut_gstate *gs = mz_gs(p);
    fz_stroke_state *state = NULL;
    fz_path *one = NULL;
    fz_rasterizer *r = NULL;
    mz_edges edges = { 0 };
    mz_polys cut = { 0 };
    unsigned char *meets = NULL;
    fz_rect *ink = NULL;
    fz_rect cut_ink = fz_empty_rect;
    int kept = 0, i, j, done = 0;

    if (gs->stroke_alpha != 1 || gs->stroke_overprint || !gs->blend_normal || g->n < 2)
        return 0;

    fz_var(state);
    fz_var(one);
    fz_var(r);
    fz_var(edges);
    fz_var(cut);
    fz_var(meets);
    fz_var(ink);
    fz_try(ctx)
    {
        state = mz_stroke_state(ctx, gs);
        meets = fz_calloc(ctx, g->n, 1);
        ink = fz_malloc_array(ctx, g->n, fz_rect);
        for (i = 0; i < g->n; i++)
        {
            const mz_sub *s = &g->v[i];
            int q;
            ink[i] = fz_empty_rect;
            if (s->n == 0)
                continue;
            fz_drop_path(ctx, one);
            one = NULL;
            one = fz_new_path(ctx);
            fz_moveto(ctx, one, s->v[0].s[0].x, s->v[0].s[0].y);
            for (j = 0; j < s->n; j++)
            {
                const mz_seg *e = &s->v[j];
                if (e->cubic)
                    fz_curveto(ctx, one, e->s[1].x, e->s[1].y, e->s[2].x, e->s[2].y, e->s[3].x, e->s[3].y);
                else
                    fz_lineto(ctx, one, e->s[3].x, e->s[3].y);
            }
            if (s->closed)
                fz_closepath(ctx, one);
            edges.n = 0;
            r = mz_new_capture(ctx, &edges);
            fz_flatten_stroke_path(ctx, r, one, state, total, MZ_CUT_FLATNESS, state->linewidth, fz_infinite_irect, NULL);
            fz_drop_rasterizer(ctx, r);
            r = NULL;
            for (q = 0; q < edges.n; q++)
            {
                ink[i] = fz_include_point_in_rect(ink[i], fz_make_point(edges.e[q].x0, edges.e[q].y0));
                ink[i] = fz_include_point_in_rect(ink[i], fz_make_point(edges.e[q].x1, edges.e[q].y1));
            }
            if (mz_ink_meets_marks(&edges, p->options, 0, 0))
            {
                meets[i] = 1;
                cut_ink = fz_union_rect(cut_ink, ink[i]);
                mz_fan_cut(ctx, &edges, p->options, &cut);
            }
            else
                kept++;
        }
        /* NO SHARED PIXEL between what is stroked and what is outlined, or the overlap is painted twice. */
        if (kept > 0 && !fz_is_empty_rect(cut_ink))
        {
            done = 1;
            for (i = 0; i < g->n && done; i++)
                if (!meets[i] && !fz_is_empty_rect(ink[i]) && mz_boxes_meet(fz_expand_rect(ink[i], 1), fz_expand_rect(cut_ink, 1)))
                    done = 0;
        }
        if (done)
        {
            for (i = 0; i < g->n; i++)
                if (!meets[i])
                    mz_emit_sub(ctx, chain, &g->v[i]);
            chain->op_S(ctx, chain);
            mz_emit_stroke_paint(ctx, p, &cut, to_stream);
        }
    }
    fz_always(ctx)
    {
        if (r)
            fz_drop_rasterizer(ctx, r);
        fz_drop_path(ctx, one);
        fz_drop_stroke_state(ctx, state);
        fz_free(ctx, edges.e);
        mz_polys_free(ctx, &cut);
        fz_free(ctx, meets);
        fz_free(ctx, ink);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
    return done;
}

typedef void (mz_paint_fn)(fz_context *ctx, pdf_processor *proc);

/*
 * The paint operator: `fill` 0 none, 1 non-zero, 2 even-odd; `stroke` 0 or 1; `close` closes the path first (s, b, b*).
 * `original` is the operator to pass on when nothing is cut.
 */
static void mz_cut_paint(fz_context *ctx, pdf_processor *proc, int fill, int stroke, int close, mz_paint_fn *original)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    pdf_processor *chain = proc->chain;
    fz_matrix total = mz_total(p);
    fz_matrix to_stream = fz_invert_matrix(total);
    mz_edges fill_e = { 0 }, stroke_e = { 0 };
    mz_polys fill_p = { 0 }, stroke_p = { 0 }, clip_p = { 0 };
    int fill_cut = 0, stroke_cut = 0, clip_cut = 0, thin = 0;
    int clip = p->clip;
    fz_rect reach;
    int k, near = 0;
    mz_segs segs = { 0 };

    fz_var(fill_e);
    fz_var(stroke_e);
    fz_var(fill_p);
    fz_var(stroke_p);
    fz_var(clip_p);
    fz_var(segs);

    p->clip = 0;
    fz_try(ctx)
    {
        if (close)
            fz_closepath(ctx, p->path);

        /* THE CHEAP QUESTION FIRST: MuPDF's own over-reaching box. Nothing near a mark is passed on untouched. */
        {
            fz_stroke_state *s = stroke ? mz_stroke_state(ctx, mz_gs(p)) : NULL;
            fz_try(ctx)
                reach = fz_bound_path(ctx, p->path, s, total);
            fz_always(ctx)
                fz_drop_stroke_state(ctx, s);
            fz_catch(ctx)
                fz_rethrow(ctx);
        }
        for (k = 0; k < p->options->count; k++)
            if (mz_boxes_meet(reach, p->options->marks[k].box))
                near = 1;

        if (near && fz_matrix_expansion(total) > 1e-9)
        {
            if (fill || clip)
                mz_fill_edges(ctx, p, total, &fill_e);
            if (fill && mz_ink_meets_marks(&fill_e, p->options, fill == 2, 0))
                fill_cut = 1;
            if (clip && mz_ink_meets_marks(&fill_e, p->options, clip == 2, 1))
                clip_cut = 1;
            if (stroke)
            {
                thin = mz_gs(p)->linewidth * fz_matrix_expansion(total) < MZ_CUT_HAIRLINE;
                if (thin)
                {
                    /* THE CENTRE LINE is the thin stroke's data: cut where it enters a mark. */
                    mz_polys lines = { 0 };
                    mz_flat f = { 0 };
                    int i, j;
                    fz_try(ctx)
                    {
                        f.ctx = ctx;
                        f.ctm = total;
                        f.lines = &lines;
                        fz_walk_path(ctx, p->path, &mz_flat_walker, &f);
                        mz_flat_end(&f);
                        for (i = 0; i < lines.n && !stroke_cut; i++)
                            for (j = 0; j + 1 < lines.p[i].n && !stroke_cut; j++)
                                if (mz_segment_meets_marks(p->options, lines.p[i].v[j], lines.p[i].v[j + 1]))
                                    stroke_cut = 1;
                    }
                    fz_always(ctx)
                    {
                        mz_poly_free(ctx, &f.cur);
                        mz_polys_free(ctx, &lines);
                    }
                    fz_catch(ctx)
                        fz_rethrow(ctx);
                }
                else
                {
                    mz_stroke_edges(ctx, p, total, &stroke_e);
                    if (mz_ink_meets_marks(&stroke_e, p->options, 0, 0))
                        stroke_cut = 1;
                }
            }
        }

        if (!fill_cut && !stroke_cut && !clip_cut)
        {
            /* UNCHANGED: the path as it came, its clip, its operator. */
            mz_replay(ctx, p);
            if (clip == 1)
                chain->op_W(ctx, chain);
            else if (clip == 2)
                chain->op_Wstar(ctx, chain);
            if (original)
                original(ctx, chain);
        }
        else
        {
            p->options->cut++;
            /* THE PATH AS WRITTEN, segment by segment, which each cut below rewrites only where it meets a mark. */
            mz_read_segs(ctx, p->path, total, &segs);
            /* THE FILL, then THE STROKE, then THE CLIP: the order a fill-and-stroke paints in, and a clip applies after. */
            if (fill)
            {
                if (fill_cut)
                    mz_emit_fill_cut(ctx, p, &segs, to_stream);
                else
                    mz_replay(ctx, p);
                if (fill == 2)
                    chain->op_fstar(ctx, chain);
                else
                    chain->op_f(ctx, chain);
            }
            if (stroke)
            {
                if (!stroke_cut)
                {
                    mz_replay(ctx, p);
                    chain->op_S(ctx, chain);
                }
                else if (thin)
                    mz_emit_thin_cut(ctx, p, &segs, to_stream);
                else if (!mz_emit_wide_cut(ctx, p, &segs, total, to_stream))
                {
                    mz_fan_cut(ctx, &stroke_e, p->options, &stroke_p);
                    mz_emit_stroke_paint(ctx, p, &stroke_p, to_stream);
                }
            }
            if (clip)
            {
                if (clip_cut)
                {
                    if (mz_emit_fill_cut(ctx, p, &segs, to_stream) == 0)
                    {
                        /* A CLIP CUT TO NOTHING IS AN EMPTY CLIP, never none: a W with no path is not written, and
                         * whatever it clipped would then paint everywhere. A rectangle of no area, at a point outside
                         * every mark. */
                        fz_point q = fz_transform_point(mz_outside_point(p->options), to_stream);
                        chain->op_re(ctx, chain, q.x, q.y, 0, 0);
                    }
                    if (p->top_level)
                        p->options->clip_cut++;
                }
                else
                    mz_replay(ctx, p);
                if (clip == 2)
                    chain->op_Wstar(ctx, chain);
                else
                    chain->op_W(ctx, chain);
                chain->op_n(ctx, chain);
            }
            /* AN UNPAINTED PATH THAT ENTERS A MARK (n) paints nothing, and is dropped. */
        }
    }
    fz_always(ctx)
    {
        fz_free(ctx, fill_e.e);
        fz_free(ctx, stroke_e.e);
        mz_polys_free(ctx, &fill_p);
        mz_polys_free(ctx, &stroke_p);
        mz_polys_free(ctx, &clip_p);
        mz_segs_free(ctx, &segs);
        fz_drop_path(ctx, p->path);
        p->path = NULL;
        p->path = fz_new_path(ctx);
    }
    fz_catch(ctx)
        fz_rethrow(ctx);
}

static void mz_op_S(fz_context *ctx, pdf_processor *c) { c->op_S(ctx, c); }
static void mz_op_f(fz_context *ctx, pdf_processor *c) { c->op_f(ctx, c); }
static void mz_op_fstar(fz_context *ctx, pdf_processor *c) { c->op_fstar(ctx, c); }
static void mz_op_B(fz_context *ctx, pdf_processor *c) { c->op_B(ctx, c); }
static void mz_op_Bstar(fz_context *ctx, pdf_processor *c) { c->op_Bstar(ctx, c); }
static void mz_op_n(fz_context *ctx, pdf_processor *c) { c->op_n(ctx, c); }

static void mz_cut_S(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 0, 1, 0, mz_op_S); }
static void mz_cut_s(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 0, 1, 1, mz_op_S); }
static void mz_cut_f(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 1, 0, 0, mz_op_f); }
static void mz_cut_fstar(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 2, 0, 0, mz_op_fstar); }
static void mz_cut_B(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 1, 1, 0, mz_op_B); }
static void mz_cut_Bstar(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 2, 1, 0, mz_op_Bstar); }
static void mz_cut_b(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 1, 1, 1, mz_op_B); }
static void mz_cut_bstar(fz_context *ctx, pdf_processor *proc) { mz_cut_paint(ctx, proc, 2, 1, 1, mz_op_Bstar); }

static void mz_cut_n(fz_context *ctx, pdf_processor *proc)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    if (p->clip)
    {
        mz_cut_paint(ctx, proc, 0, 0, 0, mz_op_n);
        return;
    }
    /* NO CLIP AND NO PAINT: passed on as it came unless it enters a mark, in which case it is dropped. */
    {
        fz_matrix total = mz_total(p);
        mz_edges e = { 0 };
        int meets = 0;
        fz_var(e);
        fz_try(ctx)
        {
            mz_fill_edges(ctx, p, total, &e);
            meets = mz_ink_meets_marks(&e, p->options, 0, 1);
            if (!meets)
            {
                mz_replay(ctx, p);
                proc->chain->op_n(ctx, proc->chain);
            }
            else
                p->options->cut++;
        }
        fz_always(ctx)
        {
            fz_free(ctx, e.e);
            fz_drop_path(ctx, p->path);
            p->path = NULL;
            p->path = fz_new_path(ctx);
        }
        fz_catch(ctx)
            fz_rethrow(ctx);
    }
}

static void mz_cut_F(fz_context *ctx, pdf_processor *proc) { mz_cut_f(ctx, proc); }

static void mz_cut_drop(fz_context *ctx, pdf_processor *proc)
{
    mz_cut_processor *p = (mz_cut_processor *)proc;
    int i;
    for (i = 0; i < p->gs_n; i++)
        pdf_drop_obj(ctx, p->gs[i].dash);
    fz_free(ctx, p->gs);
    fz_drop_path(ctx, p->path);
    pdf_drop_document(ctx, p->doc);
}

static pdf_processor *mz_new_cut_filter(fz_context *ctx, pdf_document *doc, pdf_processor *chain, int struct_parents,
    fz_matrix transform, pdf_filter_options *global, void *options)
{
    mz_cut_processor *p = pdf_new_processor(ctx, sizeof *p);
    (void)struct_parents;
    (void)global;
    p->super.drop_processor = mz_cut_drop;
    p->super.op_q = mz_cut_q;
    p->super.op_Q = mz_cut_Q;
    p->super.op_cm = mz_cut_cm;
    p->super.op_w = mz_cut_w;
    p->super.op_J = mz_cut_J;
    p->super.op_j = mz_cut_j;
    p->super.op_M = mz_cut_M;
    p->super.op_d = mz_cut_d;
    p->super.op_m = mz_cut_m;
    p->super.op_l = mz_cut_l;
    p->super.op_c = mz_cut_c;
    p->super.op_v = mz_cut_v;
    p->super.op_y = mz_cut_y;
    p->super.op_h = mz_cut_h;
    p->super.op_re = mz_cut_re;
    p->super.op_S = mz_cut_S;
    p->super.op_s = mz_cut_s;
    p->super.op_F = mz_cut_F;
    p->super.op_f = mz_cut_f;
    p->super.op_fstar = mz_cut_fstar;
    p->super.op_B = mz_cut_B;
    p->super.op_Bstar = mz_cut_Bstar;
    p->super.op_b = mz_cut_b;
    p->super.op_bstar = mz_cut_bstar;
    p->super.op_n = mz_cut_n;
    p->super.op_W = mz_cut_W;
    p->super.op_Wstar = mz_cut_Wstar;
    p->super.op_CS = mz_cut_CS;
    p->super.op_SC_color = mz_cut_SC_color;
    p->super.op_SC_pattern = mz_cut_SC_pattern;
    p->super.op_SC_shade = mz_cut_SC_shade;
    p->super.op_G = mz_cut_G;
    p->super.op_RG = mz_cut_RG;
    p->super.op_K = mz_cut_K;
    p->super.op_gs_ca = mz_cut_gs_ca;
    p->super.op_gs_CA = mz_cut_gs_CA;
    p->super.op_gs_op = mz_cut_gs_op;
    p->super.op_gs_OP = mz_cut_gs_OP;
    p->super.op_gs_BM = mz_cut_gs_BM;
    p->super.chain = chain;
    p->super.requirements = chain->requirements;
    p->options = options;
    p->base = transform;
    p->top_level = fz_is_identity(transform);
    fz_try(ctx)
    {
        p->doc = pdf_keep_document(ctx, doc);
        p->gs = fz_malloc_array(ctx, 8, mz_cut_gstate);
        p->gs_cap = 8;
        p->gs_n = 1;
        p->gs[0].ctm = fz_identity;
        p->gs[0].linewidth = 1;
        p->gs[0].miterlimit = 10;
        p->gs[0].phase = 0;
        p->gs[0].cap = 0;
        p->gs[0].join = 0;
        p->gs[0].dash = NULL;
        memset(&p->gs[0].stroke_paint, 0, sizeof p->gs[0].stroke_paint);
        p->gs[0].stroke_paint.kind = MZ_PAINT_GRAY;
        p->gs[0].stroke_paint.n = 1;
        p->gs[0].fill_alpha = 1;
        p->gs[0].stroke_alpha = 1;
        p->gs[0].fill_overprint = 0;
        p->gs[0].stroke_overprint = 0;
        p->gs[0].blend_normal = 1;
        p->path = fz_new_path(ctx);
    }
    fz_catch(ctx)
    {
        pdf_drop_processor(ctx, &p->super);
        fz_rethrow(ctx);
    }
    return &p->super;
}

/* A mark's quad, counter-clockwise, its box beside it. */
static void mz_mark_from_points(mz_mark *m, fz_point a, fz_point b, fz_point c, fz_point d)
{
    fz_point v[4];
    fz_point centre;
    int i, j;
    v[0] = a;
    v[1] = b;
    v[2] = c;
    v[3] = d;
    centre.x = (a.x + b.x + c.x + d.x) / 4;
    centre.y = (a.y + b.y + c.y + d.y) / 4;
    /* SORTED BY ANGLE ROUND THE CENTRE: a quad's corner order is the writer's, a convex polygon's is not. */
    for (i = 1; i < 4; i++)
    {
        fz_point t = v[i];
        double ta = atan2(t.y - centre.y, t.x - centre.x);
        j = i - 1;
        while (j >= 0 && atan2(v[j].y - centre.y, v[j].x - centre.x) > ta)
        {
            v[j + 1] = v[j];
            j--;
        }
        v[j + 1] = t;
    }
    m->box = fz_empty_rect;
    for (i = 0; i < 4; i++)
    {
        m->v[i] = v[i];
        m->box = fz_include_point_in_rect(m->box, v[i]);
    }
}

/*
 * Cuts every drawing on `page` at its redaction marks' edges (ADR-0286). `cut_out` is how many paths were replaced.
 * A page with no /Redact is left alone.
 */
MZ_EXPORT int mz_cut_line_art(pdf_page *page, int *cut_out)
{
    fz_context *ctx = mzg_context();
    mz_cut_options options = { 0 };
    pdf_sanitize_filter_options sanitize;
    pdf_filter_factory list[3];
    pdf_filter_options filter;
    pdf_annot *annot;
    int cap = 0;

    if (cut_out)
        *cut_out = 0;
    if (ctx == NULL || page == NULL || cut_out == NULL)
        return MZ_ERR;

    fz_var(options);

    fz_try(ctx)
    {
        for (annot = pdf_first_annot(ctx, page); annot; annot = pdf_next_annot(ctx, annot))
        {
            pdf_obj *obj = pdf_annot_obj(ctx, annot);
            pdf_obj *qp;
            int n, i;
            if (pdf_dict_get(ctx, obj, PDF_NAME(Subtype)) != PDF_NAME(Redact))
                continue;
            qp = pdf_dict_get(ctx, obj, PDF_NAME(QuadPoints));
            n = pdf_array_len(ctx, qp) / 8;
            for (i = 0; i < (n > 0 ? n : 1); i++)
            {
                if (options.count == cap)
                {
                    cap = cap ? cap * 2 : 8;
                    options.marks = fz_realloc_array(ctx, options.marks, cap, mz_mark);
                }
                if (n > 0)
                {
                    /* IN USER SPACE, read raw, as MuPDF's own culler reads them (pdf_annot_quad_point turns them). */
                    fz_quad q = pdf_to_quad(ctx, qp, i * 8);
                    mz_mark_from_points(&options.marks[options.count], q.ul, q.ur, q.lr, q.ll);
                }
                else
                {
                    fz_rect r = pdf_dict_get_rect(ctx, obj, PDF_NAME(Rect));
                    mz_mark_from_points(&options.marks[options.count], fz_make_point(r.x0, r.y0),
                        fz_make_point(r.x1, r.y0), fz_make_point(r.x1, r.y1), fz_make_point(r.x0, r.y1));
                }
                if (!fz_is_empty_rect(options.marks[options.count].box))
                    options.count++;
            }
        }

        if (options.count > 0)
        {
            memset(&sanitize, 0, sizeof sanitize);
            memset(&filter, 0, sizeof filter);
            list[0].filter = pdf_new_sanitize_filter;
            list[0].options = &sanitize;
            list[1].filter = mz_new_cut_filter;
            list[1].options = &options;
            list[2].filter = NULL;
            list[2].options = NULL;
            filter.recurse = 0;
            filter.instance_forms = 1;
            filter.ascii = 1;
            filter.filters = list;
            pdf_filter_page_contents(ctx, page->doc, page, &filter);
        }
        *cut_out = options.cut;
    }
    fz_always(ctx)
        fz_free(ctx, options.marks);
    fz_catch(ctx)
        return MZ_ERR;
    return MZ_OK;
}

/*
 * ---------------------------------------------------------------------------
 * The burn-in, keeping each rewritten picture's kind (ADR-0288)
 *
 * MuPDF's pixels redaction (`pdf_redact_image_filter_pixels`, static in pdf-clean.c 1.28.0) decodes a picture a mark
 * touches, sets the covered pixels white and its mask opaque, and hands back `fz_new_image_from_pixmap`: a picture with
 * no compressed buffer, which `pdf_add_image` writes with no filter under a new name. So a JPEG photo came back as raw
 * samples. What it was is known only BEFORE the burn-in, from its compressed buffer, and the one thing that pairs a
 * replacement with its original is the transform it is drawn with, which the burn-in keeps.
 *
 * So: a device notes every picture the page draws, with its transform in device space and whether it was stored as
 * JPEG; MuPDF burns the page in, unchanged; and where a JPEG was noted, MuPDF's own content filter runs once more with an
 * image filter that hands back each replacement drawn at a transform where ONLY a JPEG was noted, written as JPEG.
 * Everything else passes through as it is. The filter's transform is in user space, so it is taken through the page's
 * own transform before it is compared, and compared within MZ_SAME_PLACE, since the burn-in writes numbers again as text.
 * ---------------------------------------------------------------------------
 */

#define MZ_SAME_PLACE 0.001f

typedef struct
{
    fz_matrix ctm;
    int jpeg;
} mz_noted_picture;

typedef struct
{
    fz_device super;
    mz_noted_picture *list;
    int count;
    int cap;
} mz_note_device;

typedef struct
{
    const mz_noted_picture *list;
    int count;
    fz_matrix page_ctm;
    int quality;
    int rewritten;
} mz_kind_state;

static void mz_note(fz_context *ctx, mz_note_device *dev, fz_matrix ctm, int jpeg)
{
    if (dev->count == dev->cap)
    {
        int cap = dev->cap ? dev->cap * 2 : 16;
        dev->list = fz_realloc_array(ctx, dev->list, cap, mz_noted_picture);
        dev->cap = cap;
    }
    dev->list[dev->count].ctm = ctm;
    dev->list[dev->count].jpeg = jpeg;
    dev->count++;
}

/* WHAT IT WAS STORED AS: the compressed buffer's own type, never the pixels. */
static int mz_stored_as_jpeg(fz_context *ctx, fz_image *image)
{
    fz_compressed_buffer *buffer = fz_compressed_image_buffer(ctx, image);
    return buffer != NULL && buffer->params.type == FZ_IMAGE_JPEG;
}

static void mz_note_fill_image(fz_context *ctx, fz_device *dev, fz_image *image, fz_matrix ctm, float alpha, fz_color_params params)
{
    (void)alpha;
    (void)params;
    mz_note(ctx, (mz_note_device *)dev, ctm, mz_stored_as_jpeg(ctx, image));
}

/* AN IMAGE MASK IS NEVER A JPEG: it is noted, so that a JPEG at the same place does not decide its replacement. */
static void mz_note_fill_image_mask(fz_context *ctx, fz_device *dev, fz_image *image, fz_matrix ctm, fz_colorspace *space, const float *color, float alpha, fz_color_params params)
{
    (void)image;
    (void)space;
    (void)color;
    (void)alpha;
    (void)params;
    mz_note(ctx, (mz_note_device *)dev, ctm, 0);
}

static int mz_same_place(fz_matrix a, fz_matrix b)
{
    const float x[6] = { a.a, a.b, a.c, a.d, a.e, a.f };
    const float y[6] = { b.a, b.b, b.c, b.d, b.e, b.f };
    int i;
    for (i = 0; i < 6; i++)
    {
        float bound = MZ_SAME_PLACE * fmaxf(1.0f, fmaxf(fabsf(x[i]), fabsf(y[i])));
        if (fabsf(x[i] - y[i]) > bound)
            return 0;
    }
    return 1;
}

/*
 * A filter's picture transform as the device sees it: the interpreter turns image space over before it draws (a picture's
 * rows run top down, `[1 0 0 -1 0 1]`, pdf-op-run.c 1.28.0 line 918), then the page's own transform. Measured 2026-11-06: an
 * 800 x 600 picture the filter saw at [400 0 0 -300 50 342] through the page was noted at [400 0 0 300 50 42].
 */
static fz_matrix mz_device_place(fz_matrix filter_ctm, fz_matrix page_ctm)
{
    return fz_concat(fz_concat(fz_make_matrix(1, 0, 0, -1, 0, 1), filter_ctm), page_ctm);
}

/* Whether a JPEG was noted at `ctm` and nothing else was: two kinds at one place keep the replacement lossless. */
static int mz_only_jpeg_at(const mz_kind_state *state, fz_matrix ctm)
{
    int jpeg = 0, other = 0, i;
    for (i = 0; i < state->count; i++)
    {
        if (!mz_same_place(state->list[i].ctm, ctm))
            continue;
        if (state->list[i].jpeg)
            jpeg = 1;
        else
            other = 1;
    }
    return jpeg && !other;
}

/*
 * MuPDF's image-filter contract (interpret.h, and pdf-op-filter.c's two callers): the picture handed back is a
 * reference the caller owns, so an unchanged one is handed back kept, as MuPDF's own pixels filter does.
 */
static fz_image *mz_kind_image_filter(fz_context *ctx, void *opaque, fz_matrix ctm, const char *name, fz_image *image, fz_rect scissor)
{
    mz_kind_state *state = opaque;
    fz_pixmap *pixmap = NULL;
    fz_buffer *buffer = NULL;
    fz_image *jpeg = NULL;
    fz_output *out = NULL;

    (void)name;
    (void)scissor;

    /*
     * THE BURN-IN'S REPLACEMENT, read back from the object `pdf_add_image` wrote, is stored RAW: no filter, or no buffer
     * where it is still the pixmap the burn-in made. A raw picture drawn where only a JPEG was drawn before the burn-in
     * can be nothing else, since a picture no mark touched is that JPEG itself.
     */
    {
        fz_compressed_buffer *stored = fz_compressed_image_buffer(ctx, image);
        if ((stored != NULL && stored->params.type != FZ_IMAGE_RAW) || image->imagemask)
            return fz_keep_image(ctx, image);
    }
    if (!mz_only_jpeg_at(state, mz_device_place(ctm, state->page_ctm)))
        return fz_keep_image(ctx, image);

    fz_var(pixmap);
    fz_var(buffer);
    fz_var(jpeg);
    fz_var(out);
    fz_try(ctx)
    {
        pixmap = fz_get_pixmap_from_image(ctx, image, NULL, NULL, NULL, NULL);
        /*
         * A JPEG holds no alpha channel, and only grey, RGB or CMYK samples: a pixmap with alpha, separations or another
         * colour space stays lossless rather than lose any of it, or refuse the redaction.
         */
        if (pixmap->alpha == 0 && pixmap->s == 0 && pixmap->colorspace != NULL &&
            (fz_colorspace_is_gray(ctx, pixmap->colorspace) || fz_colorspace_is_rgb(ctx, pixmap->colorspace) ||
                fz_colorspace_is_cmyk(ctx, pixmap->colorspace)))
        {
            fz_compressed_buffer *written;
            /*
             * THE PIXMAP'S OWN SPACE: fz_new_buffer_from_pixmap_as_jpeg converts any space but the device singletons to
             * RGB (jpeg_from_pixmap, output-jpeg.c 1.28.0), and the burn-in's pixmap of a CMYK photo is ICC-based, so a
             * CMYK photo came back RGB (measured 2026-11-07). Written as its samples, and said to be, so no /Decode turns
             * them over: fz_new_image_from_buffer takes every JPEG to be inverted CMYK.
             */
            buffer = fz_new_buffer(ctx, 1024);
            out = fz_new_output_with_buffer(ctx, buffer);
            fz_write_pixmap_as_jpeg(ctx, out, pixmap, state->quality, 0);
            fz_close_output(ctx, out);
            jpeg = fz_new_image_from_buffer(ctx, buffer);
            fz_drop_colorspace(ctx, jpeg->colorspace);
            jpeg->colorspace = fz_keep_colorspace(ctx, pixmap->colorspace);
            written = fz_compressed_image_buffer(ctx, jpeg);
            if (written != NULL)
                written->params.u.jpeg.invert_cmyk = 0;
            jpeg->mask = fz_keep_image(ctx, image->mask);
            state->rewritten++;
        }
    }
    fz_always(ctx)
    {
        fz_drop_output(ctx, out);
        fz_drop_pixmap(ctx, pixmap);
        fz_drop_buffer(ctx, buffer);
    }
    fz_catch(ctx)
    {
        fz_drop_image(ctx, jpeg);
        fz_rethrow(ctx);
    }
    return jpeg != NULL ? jpeg : fz_keep_image(ctx, image);
}

/*
 * Burns `page` in with MuPDF's own `pdf_redact_page` and the four options it takes, then writes each picture it
 * rebuilt from a JPEG as JPEG at `quality` (ADR-0288). `rewritten_out` is how many were.
 */
MZ_EXPORT int mz_redact_page(pdf_page *page, int black_boxes, int image_method, int line_art, int text, int quality, int *rewritten_out)
{
    fz_context *ctx = mzg_context();
    mz_note_device *notes = NULL;
    pdf_redact_options redact;
    pdf_sanitize_filter_options sanitize;
    pdf_filter_factory list[2];
    pdf_filter_options filter;
    mz_kind_state state;
    int jpegs = 0, i;

    if (rewritten_out)
        *rewritten_out = 0;
    if (ctx == NULL || page == NULL || rewritten_out == NULL || quality < 1 || quality > 100)
        return MZ_ERR;

    fz_var(notes);

    fz_try(ctx)
    {
        notes = fz_new_derived_device(ctx, mz_note_device);
        notes->super.fill_image = mz_note_fill_image;
        notes->super.fill_image_mask = mz_note_fill_image_mask;
        pdf_run_page_contents(ctx, page, &notes->super, fz_identity, NULL);
        fz_close_device(ctx, &notes->super);
        for (i = 0; i < notes->count; i++)
            jpegs += notes->list[i].jpeg;

        redact.black_boxes = black_boxes;
        redact.image_method = image_method;
        redact.line_art = line_art;
        redact.text = text;
        pdf_redact_page(ctx, page->doc, page, &redact);

        /* NO JPEG NOTED, NOTHING MORE: the page is exactly what MuPDF's burn-in wrote. */
        if (jpegs > 0)
        {
            memset(&state, 0, sizeof state);
            state.list = notes->list;
            state.count = notes->count;
            state.quality = quality;
            pdf_page_transform(ctx, page, NULL, &state.page_ctm);
            memset(&sanitize, 0, sizeof sanitize);
            memset(&filter, 0, sizeof filter);
            sanitize.opaque = &state;
            sanitize.image_filter = mz_kind_image_filter;
            list[0].filter = pdf_new_sanitize_filter;
            list[0].options = &sanitize;
            list[1].filter = NULL;
            list[1].options = NULL;
            /* THE BURN-IN'S OWN OPTIONS (init_redact_filter, pdf-clean.c 1.28.0), so this pass reaches what it reached. */
            filter.recurse = 0;
            filter.instance_forms = 1;
            filter.ascii = 1;
            filter.filters = list;
            pdf_filter_page_contents(ctx, page->doc, page, &filter);
            *rewritten_out = state.rewritten;
        }
    }
    fz_always(ctx)
    {
        if (notes != NULL)
        {
            fz_free(ctx, notes->list);
            notes->list = NULL;
            fz_drop_device(ctx, &notes->super);
        }
    }
    fz_catch(ctx)
        return MZ_ERR;
    return MZ_OK;
}
