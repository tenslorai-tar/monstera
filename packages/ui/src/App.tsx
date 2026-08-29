import type { ReactElement } from 'react';

/**
 * The renderer's root component.
 *
 * ## What is deliberately NOT here
 *
 * No ribbon, no toolbar, no start screen, no dialog host, no keyboard listener.
 * The wired-tools rule makes a control that renders and does nothing a defect
 * rather than a stepping stone, and every one of those surfaces is a
 * **projection of the command registry** — with no command registered, each
 * would render an empty container that looks like a surface under construction.
 *
 * `DialogHost` is the near miss worth naming, because it is built, proven, and
 * still wrong to mount here: its `closeLabel` is a resolved string and there is
 * no message catalogue, so mounting it now would put an untranslated literal on
 * screen and call B9 satisfied. It lands with the first registered dialog, which
 * is where the catalogue question has to be answered anyway.
 *
 * ## What IS here, and why it is not a placeholder
 *
 * One landmark: the surface a page renders into. It is a container rather than
 * a control — it claims nothing, offers nothing to click, and is the element
 * exit clause 2 fills. Without it `#root` stays empty after mounting, and an
 * empty root is exactly what a renderer that never mounted produces, so the
 * shell would be unprovable.
 */
export function App(): ReactElement {
  return <main className="m-document-surface" />;
}
