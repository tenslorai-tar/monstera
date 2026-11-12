/**
 * The catalogue host's command line after its pipe name: the bundled fonts' folder, then the machine's installed fonts'
 * folder, each empty where the factory had none (`composeShimPathOf`'s rule for an absent path). ONE READING, for the
 * launcher and the module that serves.
 */
export function catalogueFoldersOf(argv: readonly string[]): { readonly bundled: string | null; readonly installed: string | null } {
  const at = (index: number): string | null => {
    const value = argv[index];
    return value === undefined || value.length === 0 ? null : value;
  };
  return { bundled: at(3), installed: at(4) };
}
