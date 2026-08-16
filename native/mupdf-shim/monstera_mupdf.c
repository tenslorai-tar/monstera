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

static size_t g_live_bytes = 0;
static size_t g_peak_bytes = 0;
static size_t g_live_blocks = 0;

static void mz_account_add(size_t n)
{
    g_live_bytes += n;
    if (g_live_bytes > g_peak_bytes)
        g_peak_bytes = g_live_bytes;
}

static void mz_account_sub(size_t n)
{
    /* Defensive: an underflow here would silently produce a huge number and
     * make the instrument lie in the direction of "nothing was freed". */
    g_live_bytes = (g_live_bytes >= n) ? g_live_bytes - n : 0;
}

static void *mz_alloc_malloc(void *user, size_t size)
{
    void *p = malloc(size);
    (void)user;
    if (p != NULL) {
        mz_account_add(_msize(p));
        g_live_blocks++;
    }
    return p;
}

static void *mz_alloc_realloc(void *user, void *old, size_t size)
{
    size_t before = (old != NULL) ? _msize(old) : 0;
    void *p;
    (void)user;

    p = realloc(old, size);
    if (p == NULL) {
        /* realloc failed: `old` is still live and still counted. Nothing to do.
         * (size == 0 with a NULL return is a free on some CRTs, but MSVC's
         * realloc(ptr, 0) frees and returns NULL, so account for it.) */
        if (size == 0 && old != NULL) {
            mz_account_sub(before);
            g_live_blocks--;
        }
        return NULL;
    }

    if (old == NULL)
        g_live_blocks++;
    mz_account_sub(before);
    mz_account_add(_msize(p));
    return p;
}

static void mz_alloc_free(void *user, void *p)
{
    (void)user;
    if (p == NULL)
        return;
    mz_account_sub(_msize(p));
    g_live_blocks--;
    free(p);
}

static fz_alloc_context mz_allocator = {
    NULL,
    mz_alloc_malloc,
    mz_alloc_realloc,
    mz_alloc_free,
};

#ifdef _WIN32
#define MZ_EXPORT __declspec(dllexport)
#else
#define MZ_EXPORT __attribute__((visibility("default")))
#endif

#define MZ_OK 0
#define MZ_ERR 1

struct mz_ctx {
    fz_context *fz;
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

MZ_EXPORT int mz_init(mz_ctx **out)
{
    mz_ctx *c = (mz_ctx *)calloc(1, sizeof(mz_ctx));
    if (c == NULL)
        return MZ_ERR;

    /* No fz_try here: fz_new_context returns NULL on failure rather than
     * throwing, because there is no context to throw through yet. */
    g_live_bytes = 0;
    g_peak_bytes = 0;
    g_live_blocks = 0;
    c->fz = fz_new_context(&mz_allocator, NULL, FZ_STORE_DEFAULT);
    if (c->fz == NULL) {
        free(c);
        return MZ_ERR;
    }

    fz_try(c->fz)
        fz_register_document_handlers(c->fz);
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

/* Live bytes and blocks currently held inside MuPDF, independent of the OS. */
MZ_EXPORT void mz_alloc_stats(double *live, double *peak, double *blocks)
{
    /* double, not size_t: koffi marshals it cleanly and these never approach
     * the range where a double loses integer precision. */
    *live = (double)g_live_bytes;
    *peak = (double)g_peak_bytes;
    *blocks = (double)g_live_blocks;
}

/*
 * Bytes currently held by the RESOURCE STORE specifically — decoded images,
 * fonts, display lists — as opposed to parsed PDF objects in the xref.
 *
 * There is no public accessor, but fz_debug_store prints
 * "STORE\tmax=%zu, size=%zu, actual size=%zu", so the documented route is to
 * render it to a buffer and read the field. Parsing our own debug output is
 * ugly; inventing a private struct layout for fz_store would be worse, because
 * it would break silently on any upstream change.
 */
MZ_EXPORT int mz_store_size(mz_ctx *c, double *size_out, double *max_out)
{
    fz_buffer *buf = NULL;
    fz_output *out = NULL;
    unsigned char *data = NULL;
    size_t len = 0;
    double size = -1, max = -1;

    fz_try(c->fz) {
        buf = fz_new_buffer(c->fz, 256);
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

    if (data != NULL && len > 0) {
        const char *p = strstr((const char *)data, "max=");
        if (p != NULL)
            max = (double)strtoull(p + 4, NULL, 10);
        p = strstr((const char *)data, "size=");
        if (p != NULL)
            size = (double)strtoull(p + 5, NULL, 10);
    }

    fz_drop_buffer(c->fz, buf);
    *size_out = size;
    *max_out = max;
    return MZ_OK;
}

MZ_EXPORT int mz_shrink_store(mz_ctx *c, int percent)
{
    fz_try(c->fz)
        fz_shrink_store(c->fz, (unsigned int)percent);
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }
    return MZ_OK;
}

/*
 * Page geometry WITHOUT loading the page.
 *
 * fz_load_page materialises resources, annotations and content streams. Scroll
 * layout needs only the page's size and rotation, which are dictionary reads.
 * If this is cheap, then a full page walk measures a workload the viewer never
 * performs.
 */
MZ_EXPORT int mz_page_geometry(mz_ctx *c, mz_doc *d, int number,
                               float *width, float *height, int *rotate)
{
    float w = 0, h = 0;
    int r = 0;

    fz_try(c->fz) {
        pdf_obj *page = pdf_lookup_page_obj(c->fz, d->pdf, number);
        pdf_obj *box = pdf_dict_get_inheritable(c->fz, page, PDF_NAME(MediaBox));
        fz_rect rect = pdf_to_rect(c->fz, box);
        w = rect.x1 - rect.x0;
        h = rect.y1 - rect.y0;
        r = pdf_dict_get_int(c->fz, page, PDF_NAME(Rotate));
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
    mz_doc *d = (mz_doc *)calloc(1, sizeof(mz_doc));
    if (d == NULL)
        return MZ_ERR;

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
        strncpy(c->error, "not a PDF", sizeof(c->error) - 1);
        fz_drop_document(c->fz, d->doc);
        free(d);
        return MZ_ERR;
    }

    *out = d;
    return MZ_OK;
}

MZ_EXPORT int mz_close(mz_ctx *c, mz_doc *d)
{
    if (d == NULL)
        return MZ_OK;
    fz_try(c->fz)
        fz_drop_document(c->fz, d->doc);
    fz_catch(c->fz) {
        mz_record(c);
        free(d);
        return MZ_ERR;
    }
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
MZ_EXPORT int mz_purge_objects(mz_ctx *c, mz_doc *d,
                               int *cached_before, int *droppable, int *pinned)
{
    int before = 0, free_now = 0, held = 0;

    /* Counted before the call, mirroring pdf_clear_xref's own test, so that
     * "purging reclaimed nothing" can be told apart from "purging was never
     * going to reclaim anything because everything is still referenced". The
     * two have opposite consequences: one is our bug, the other is a genuine
     * upstream constraint. */
    fz_try(c->fz) {
        int len = pdf_xref_len(c->fz, d->pdf);
        int i;
        for (i = 0; i < len; i++) {
            pdf_xref_entry *e = pdf_get_xref_entry_no_null(c->fz, d->pdf, i);
            if (e == NULL || e->obj == NULL)
                continue;
            before++;
            if (e->stm_buf != NULL)
                held++;
            else if (pdf_obj_refs(c->fz, e->obj) == 1)
                free_now++;
            else
                held++;
        }
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
    }
    fz_catch(c->fz) {
        mz_record(c);
        return MZ_ERR;
    }

    *cached_before = before;
    *droppable = free_now;
    *pinned = held;
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
    fz_pixmap *pix = NULL;
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
    return MZ_OK;
}

MZ_EXPORT void mz_free_pixmap(mz_ctx *c, void *pixmap)
{
    if (c == NULL || pixmap == NULL)
        return;
    fz_drop_pixmap(c->fz, (fz_pixmap *)pixmap);
}
