import { I18nProvider } from '@lingui/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { createRendererClient } from './bridge.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { THEME_SETTING } from './settings/appearance.js';
import { SettingsStore } from './settingsStore.js';
import { hydrateSettings, persistSettings } from './settingsSync.js';

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
 * ## Composition happens HERE and nowhere else
 *
 * The bridge, the catalogue and the client are assembled at this one point and
 * handed down as values. `App` takes a client rather than reaching for the
 * bridge, so it is renderable in a test against a client built from the
 * contract — and a missing preload becomes a failure at this line, where the
 * message can say so, rather than a component that renders and does nothing.
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

// Before the first render, because a control that renders while the catalogue is
// still loading would throw `MessageMissing` for every key it holds — and the
// failure would look like a missing translation rather than an ordering bug.
activateCatalogue('en', EN);

const client = createRendererClient();
const settings = new SettingsStore(new SettingsRegistry([THEME_SETTING]));

// NOTHING HERE WAITS FOR MAIN, and that is the point of the shape.
//
// Subscribing first means a change arriving during startup is not lost.
// `persistSettings` ignores the `'*'` a hydrate emits, so subscribing before
// hydrating does not write the file back over itself — which matters because
// `hydrate` drops ids this build's registry does not know, so a write triggered
// by a hydrate would delete a newer build's settings from disk on startup.
//
// The hydrate is FIRED, not awaited. Awaiting it — even with a bound — makes the
// renderer's first paint depend on an IPC answer, and `proof:rendererpolicy`
// reddened twice saying so: it loads this bundle with no handlers registered,
// which is exactly what a missing preload looks like to a user. The theme
// arrives a round trip later and `useTheme` applies it in a LAYOUT effect, so
// the correction lands before the next paint.
persistSettings(client, settings);
void hydrateSettings(client, settings);

createRoot(container).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App client={client} settings={settings} />
    </I18nProvider>
  </StrictMode>,
);
