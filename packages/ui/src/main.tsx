import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';

import './tokens.css';
import './app.css';

/**
 * The renderer entry point. Vite's only input; nothing imports this.
 *
 * ## The stylesheet import is load-bearing, not cosmetic
 *
 * Vite emits it as a `<link rel="stylesheet">` beside the bundle, which
 * invariant 27's `style-src 'self'` permits — and which nothing had exercised
 * before: `proof:rendererpolicy` covers delivery for all eleven directives and
 * *enforcement* for two. This is the first artefact whose absence would be
 * visible rather than theoretical.
 *
 * It is also the reason a Vite **dev server** is not part of this seam.
 * [ADR-0019](../../../docs/DECISIONS/0019-the-renderers-csp-is-pinned.md)
 * predicted the trip when it dropped `'unsafe-inline'`: dev-mode HMR injects
 * `<style>` elements, which this policy refuses. The build is the only mode, so
 * the prediction stays a prediction rather than becoming a grant.
 *
 * ## Why the missing root is a throw
 *
 * `createRoot(null)` fails inside React with a message about the container, one
 * stack frame removed from the fact that matters — the document this bundle was
 * built for did not contain `#root`. The throw is a developer-facing
 * programming error in the renderer's own process; it carries no path, crosses
 * no channel, and is not a `Failure`.
 */
const container = document.querySelector('#root');
if (container === null) {
  throw new Error('the renderer document has no #root element to mount into');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
