# ADR-0237 — The font list is kept on disk, so an edit starts no compose host

- **Status:** Accepted
- **Date:** 2026-10-14
- **Amends:** the font list's read (`composition.ts`' `fontFamilies`, W5's `heldRead`), which asked the compose host once
  a session. ADR-0172 Decision 2 (the hosts read the installed fonts' folder) and ADR-0060 (the compose host parses no
  document of the person's own in `main`) are unchanged.
- **Decided by:** the owner's cloud run 4, Part 2 item 13a: *"An edit must not start the compose host. It starts today
  only to answer the installed-font list. Keep the font list as a cache on disk, read once per install and refreshed when
  the system's fonts change, so an edit needs no compose host at all (about −200 MB while editing)."*

## Where it stood

Opening a block in *Edit text* asks `app.fontFamilies` for the font picker. `main` answered by starting the compose host,
whose catalogue reads every installed font with HarfBuzz, and paging its family list back (`engine/font-families`). The
answer was held for the session. So the first edit of every session started a contained process measured at 206 MB on
the owner's PC (run 3's memory walk), which then stayed until it retired, though an edit never composes anything.

## Decision

1. **The list is kept in one file under `userData`**, `font-families.json`: the families and the count past the bound,
   exactly as the host answered them, and the FINGERPRINT of the font folders they were read from.
2. **The fingerprint is the folders as listed, never their contents**: for the bundled folder and the installed fonts'
   folder, each file's name, size and modification time, from `readdir` and `stat`. `main` opens no font file and parses
   none, so ADR-0060's line is where it was. A font installed, removed or replaced changes a size or a time, or a name.
3. **Asked, `main` reads the folders' fingerprint and the file.** Where they match, the list is the file's and no host is
   started. Where they do not, or there is no file, or it does not read, the compose host is asked as before and the
   file is written from its answer. A list read from the host that fails is not written, as it was not held.
4. **The session hold stays**: the first answer of a session is held, from the file or the host, so the fingerprint is
   read once a session.

## Rejected

- **Watching the font folders.** A watcher holds a handle on `%SystemRoot%\Fonts` for the whole session (the chokidar
  mechanism CLAUDE.md's Rule 0 names), for an event that happens a few times a year. Reading the listing when the list is
  asked costs one `readdir` and a `stat` per file, once a session; its time on a Windows fonts folder is owed to the
  Windows session.
- **Parsing the fonts in `main`.** Faster than a host start, and the reason the compose host exists is that a font file
  is hostile input (ADR-0172).
- **Keying on the folders' own modification times.** A replaced file changes its own time and size and not always the
  folder's; the per-file listing is what changes when a font does.
