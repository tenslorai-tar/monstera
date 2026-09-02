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
#include <stdlib.h>
#include <string.h>

#include "mupdf/fitz.h"
#include "mupdf/pdf.h"

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
 * One page's structured text, as MuPDF's own JSON.
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
 */
MZ_EXPORT int mz_stext_json(mz_ctx *c, mz_doc *d, int number, int flags,
                            char *out_buf, int buf_len, double *needed_out)
{
    fz_stext_page *text = NULL;
    fz_buffer *buf = NULL;
    fz_output *out = NULL;
    fz_stext_options opts;
    unsigned char *data = NULL;
    size_t len = 0;

    if (c == NULL || d == NULL || out_buf == NULL || buf_len <= 0 || needed_out == NULL)
        return MZ_ERR;

    memset(&opts, 0, sizeof(opts));
    opts.flags = flags;

    /* All three are assigned inside the try and read from fz_always or
     * fz_catch, so all three take fz_var — the rule in this file's header, and
     * the failure it describes is a silent leak rather than a crash. */
    fz_var(text);
    fz_var(buf);
    fz_var(out);

    fz_try(c->fz) {
        text = fz_new_stext_page_from_page_number(c->fz, d->doc, number, &opts);
        buf = fz_new_buffer(c->fz, 4096);
        out = fz_new_output_with_buffer(c->fz, buf);
        fz_print_stext_page_as_json(c->fz, out, text, 1.0f);
        fz_close_output(c->fz, out);
        len = fz_buffer_storage(c->fz, buf, &data);
    }
    fz_always(c->fz) {
        fz_drop_output(c->fz, out);
    }
    fz_catch(c->fz) {
        fz_drop_buffer(c->fz, buf);
        fz_drop_stext_page(c->fz, text);
        mz_record(c);
        return MZ_ERR;
    }

    *needed_out = (double)len;
    {
        size_t room = (size_t)buf_len - 1;
        size_t take = (len < room) ? len : room;
        if (data != NULL && take > 0)
            memcpy(out_buf, data, take);
        out_buf[take] = '\0';
    }

    fz_drop_buffer(c->fz, buf);
    fz_drop_stext_page(c->fz, text);
    return MZ_OK;
}
