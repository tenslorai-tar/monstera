# ADR-0245 — The contract proof checks every case in one program

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decided by:** the owner's cloud run 4, Part 5 item H1: *"Check all the cases in one TypeScript program or
  language-service run, keeping each case's own verdict and its control, so nothing less is checked. ADR first. Measure
  before and after."*

## The mechanism

`contract.proof.mjs` proves the IPC contract is exhaustive by compiling code that must not compile, each case beside a
control that must. It ran one `tsc` process per case. A process pays TypeScript's start, the standard library and the
contract's built declarations every time, and that is nearly all of a case's cost: sixty-three cases took 270 to 337 s
on the owner's two-core machine, and 86.6 s in a four-core cloud container (2026-10-15, `node
scripts/proofs/contract.proof.mjs`, timed by the shell). Every commit that reaches the contract pays it.

## Decision

1. **One program, one file per case.** The proof writes each case to its own file and builds one program over all of
   them through the compiler API (`ts.createProgram`), with the options the probe tsconfig always had. The libraries and
   the declarations are read once.
2. **Each case keeps its own verdict.** A case's diagnostics are `getPreEmitDiagnostics(program, file)` for its file,
   which is what `tsc` reports for that file, and they are printed by `formatDiagnostics`, the routine `tsc --pretty
   false` prints through. So `diagnose`, the reason matcher and its resolution test read the same text as before, and
   every reject case still stands beside its allow control.
3. **No case can see another.** Each file is a module, whose names are its own; under the repository's `NodeNext` and
   `"type": "module"` the compiler treats every `.ts` file as one. The proof reads that same decision
   (`isExternalModule`) and refuses a file the compiler would put in the shared global scope, so a configuration that
   changed it fails the run rather than letting cases leak into each other.
4. **A diagnostic that belongs to no file fails the run.** An options or global diagnostic would be every case's at
   once, so it is never shared out among them.

## Measured

On the cloud container, the same tree: 86.6 s before; 5.9, 5.9 and 5.9 s after (three runs). The proof's printed
output is byte-identical before and after.

Two mutations, run once by hand: reading each file's diagnostics into the NEXT case's verdict turns the proof red at
the resolution test; forcing `moduleDetection: 'legacy'` with a case of one `const` is refused by the module check.

## One case changed, and why it is not a loosening

`a command carrying a non-quarter-turn rotation` anchored on the printed order of a literal union, `2 | 3 | 1`.
TypeScript prints a union in the order its member types were created in the program, so in one program the order moves
with the other cases (`1 | 2 | 3` among the sixty-three). The anchor is now the set, spelt as its six orders: every
order of {1, 2, 3} is the same union, and a character class, which would also match `1 | 1 | 2`, is still refused.

## Rejected

- **A language-service run.** It answers the same question through more machinery, for an editor's incremental needs
  this proof does not have.
- **Running the processes in parallel.** On two cores it would halve the time at best and still pay sixty-three starts.
- **Fewer cases.** The owner's order is that nothing less is checked.

## Owed

The owner's two-core figure after the change is for the Windows session to read.
