/*
 * A deterministic trigger for CVE-2026-7233 (out-of-bounds read in the CFF
 * index handler reached from fz_subset_cff_for_gids).
 *
 * This is a REGRESSION FIXTURE, not a tool. It links MuPDF's static libraries
 * and calls the vulnerable function directly on a malformed CFF, so the result
 * is a statement about the compiled engine rather than about the source.
 *
 * ## Why a guard page
 *
 * The over-read the fix prevents is small — a few bytes past the buffer. On the
 * heap those bytes are almost always mapped, so a vulnerable build would read
 * adjacent memory and NOT crash, and the test would wrongly report the bug
 * absent. So the malformed CFF is placed at the very end of an accessible page
 * with the next page unmapped (PAGE_NOACCESS). Now ANY read past the buffer is
 * an access violation, deterministically, which is exactly the property the
 * bounds check restores.
 *
 * ## Exit codes (read by scripts/security/cffOobProof.mjs)
 *
 *   0  fz_subset_cff_for_gids threw and was caught — the bounds check held.
 *   3  it returned without throwing — unexpected for this input; reported.
 *   (access violation / non-zero from the OS) the read ran off the page — the
 *      bounds check is absent. The runner treats any crash as "vulnerable".
 *
 * Usage: cff_poc.exe <fixture-path>
 */

#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

#include "mupdf/fitz.h"

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: cff_poc <fixture>\n");
        return 2;
    }

    /* Read the fixture. */
    FILE *f = fopen(argv[1], "rb");
    if (f == NULL) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0 || size > 4096) { fprintf(stderr, "bad fixture size %ld\n", size); return 2; }
    unsigned char *tmp = (unsigned char *)malloc((size_t)size);
    if (fread(tmp, 1, (size_t)size, f) != (size_t)size) { fprintf(stderr, "read failed\n"); return 2; }
    fclose(f);

    /* Two pages: accessible, then a guard. Place the fixture so its last byte is
     * the last byte of the accessible page — the next byte is unmapped. */
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    DWORD pageSize = si.dwPageSize;

    unsigned char *region = (unsigned char *)VirtualAlloc(
        NULL, (SIZE_T)pageSize * 2, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (region == NULL) { fprintf(stderr, "VirtualAlloc failed\n"); return 2; }

    DWORD old;
    if (!VirtualProtect(region + pageSize, pageSize, PAGE_NOACCESS, &old)) {
        fprintf(stderr, "VirtualProtect failed\n"); return 2;
    }

    unsigned char *cff = region + pageSize - size; /* ends exactly at the guard */
    memcpy(cff, tmp, (size_t)size);
    free(tmp);

    fz_context *ctx = fz_new_context(NULL, NULL, FZ_STORE_DEFAULT);
    if (ctx == NULL) { fprintf(stderr, "fz_new_context failed\n"); return 2; }

    int result = 3; /* returned without throwing, unless overwritten below */
    fz_buffer *buf = fz_new_buffer_from_shared_data(ctx, cff, (size_t)size);
    int gids[1] = { 0 };

    fz_try(ctx) {
        fz_buffer *out = fz_subset_cff_for_gids(ctx, buf, gids, 1, 0, 0);
        /* If it returns at all, the read did not run off the page. */
        fz_drop_buffer(ctx, out);
        printf("RETURNED without throwing\n");
        result = 3;
    }
    fz_catch(ctx) {
        printf("CAUGHT: %s\n", fz_caught_message(ctx));
        result = 0;
    }

    fz_drop_buffer(ctx, buf);
    fz_drop_context(ctx);
    return result;
}
