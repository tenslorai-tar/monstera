/**
 * The build-time switches this renderer reads (Vite replaces each with its value when the bundle is built, so an
 * unset one is a constant the bundler folds away with the branch it guards).
 */
interface ImportMetaEnv {
  /** `on` builds a renderer that shows the proof locale (`messages/pseudo.ts`). Never set for a build that ships. */
  readonly VITE_MONSTERA_PSEUDO_LOCALE?: string;
}
