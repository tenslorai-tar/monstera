// @ts-check
/**
 * Generates the malformed CFF that exercises CVE-2026-7233.
 *
 * SELF-GENERATED, and therefore allowed under the fixture provenance rule: this
 * is a hand-built 12-byte structure, not a captured real-world font. It is
 * produced at test time rather than committed — a `.bin` full of NUL bytes is
 * exactly what the file guard rejects, and rightly.
 *
 * ## What it triggers, and why these bytes
 *
 * `fz_subset_cff_for_gids` reads a CFF header, then calls `index_load` on the
 * name index at `headersize`. `index_load` computes the index's data extent from
 * attacker-controlled count and offset fields and — before CVE-2026-7233 was
 * fixed — walked that extent without checking it against the buffer length.
 *
 * These bytes make `index_load` compute a data_offset of 107 against a 12-byte
 * buffer:
 *
 *   [0]=1     major version
 *   [1]=0     minor version
 *   [2]=4     headersize  -> the name index begins at offset 4
 *   [3]=1     global offsize (must be 1..4)
 *   [4..5]=0x0064   name-index count = 100 (big-endian get16)
 *   [6]=1     name-index offsize = 1
 *   [7]=1     first offset; index_load requires this to equal 1 or it throws
 *             "Corrupt index" before reaching the vulnerable walk
 *   [8..11]=2,3,4,5   monotonically increasing offsets, so the loop does not
 *             trip "Index not monotonic" on the in-bounds bytes
 *
 * data_offset = 3 + (100+1)*1 - 1 + 4 = 107. The fix throws "Truncated index"
 * here because 107 > 12. WITHOUT the fix, the loop reads 100 single-byte offsets
 * starting at byte 8 — bytes 8..11 are in bounds, byte 12 is the first byte past
 * the buffer, and when the buffer is placed against a guard page that read is an
 * access violation.
 *
 * @returns {Buffer}
 */
export function malformedCff() {
  return Buffer.from([
    0x01, 0x00, 0x04, 0x01, // major, minor, headersize=4, offsize=1
    0x00, 0x64,             // name-index count = 100
    0x01,                   // name-index offsize = 1
    0x01,                   // first offset = 1 (required)
    0x02, 0x03, 0x04, 0x05, // in-bounds offsets, monotonic
  ]);
}

/** A well-formed-enough control the parser rejects cleanly for an ordinary reason. */
export function benignTruncatedCff() {
  // len < 4 -> "Truncated CFF" at the very top of fz_subset_cff_for_gids, long
  // before index_load. Confirms the harness distinguishes a clean throw from a
  // crash rather than calling every rejection a pass.
  return Buffer.from([0x01, 0x00]);
}
