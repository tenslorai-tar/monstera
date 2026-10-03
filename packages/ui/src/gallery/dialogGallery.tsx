import { I18nProvider } from '@lingui/react';
import { StrictMode, useEffect } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import { useTheme } from '../App.js';
import { createRendererClient } from '../bridge.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { CLOSE_LABEL } from '../messages/en.js';
import { EN } from '../messages/en.js';
import { APPLICATION_DIALOGS } from '../registries/applicationDialogs.js';
import { DialogRegistry } from '../registries/dialogs.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { SettingsStore } from '../settingsStore.js';
import { hydrateSettings } from '../settingsSync.js';
import { DialogHost, useDialogHost } from '../surfaces/DialogHost.js';
import { DIALOG_SAMPLES } from './dialogSamples.js';

import '../tokens.css';
import '../primitives/primitives.css';
import '../app.css';

/**
 * THE DIALOG GALLERY: a capture tool, never shipped. It opens one registered dialog, in one of its sample states,
 * through the application's own registry and dialog host, so what is photographed is what a person sees.
 *
 * Built only by `scripts/build/gallery.vite.config.mjs` from `gallery.html`; the renderer's build has one entry,
 * `index.html`, so nothing here reaches the package. `?dialog=<id>&state=<name>` opens that state. With neither, the
 * page publishes its index — every registered id and the states each has — for the capture to derive its list from,
 * and the ids that have no sample or that no registry declares, which the capture refuses.
 */

const registry = new DialogRegistry(APPLICATION_DIALOGS);
const registered = APPLICATION_DIALOGS.map((dialog) => dialog.id);

interface GalleryIndex {
  readonly registered: readonly string[];
  readonly states: Readonly<Record<string, readonly string[]>>;
  readonly unsampled: readonly string[];
  readonly unregistered: readonly string[];
  readonly steps: Readonly<Record<string, unknown>>;
}

const index: GalleryIndex = {
  registered,
  states: Object.fromEntries(registered.map((id) => [id, (DIALOG_SAMPLES[id] ?? []).map((sample) => sample.state)])),
  unsampled: registered.filter((id) => (DIALOG_SAMPLES[id] ?? []).length === 0),
  unregistered: Object.keys(DIALOG_SAMPLES).filter((id) => !registered.includes(id)),
  steps: Object.fromEntries(
    Object.entries(DIALOG_SAMPLES).flatMap(([id, samples]) => samples.map((sample) => [`${id}|${sample.state}`, sample.steps ?? []])),
  ),
};
(window as unknown as { __dialogGallery: GalleryIndex }).__dialogGallery = index;

const query = new URLSearchParams(window.location.search);
const wanted = query.get('dialog');
const state = query.get('state');

activateCatalogue('en', EN);
const client = createRendererClient();
const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
void hydrateSettings(client, settings);

function Gallery(): ReactElement {
  useTheme(settings);
  const host = useDialogHost(registry);
  const { ask } = host;
  useEffect(() => {
    if (wanted === null) return;
    const sample = (DIALOG_SAMPLES[wanted] ?? []).find((one) => one.state === state);
    if (sample === undefined) {
      document.body.dataset['galleryProblem'] = `no sample ${String(state)} for ${wanted}`;
      return;
    }
    // THE APPLICATION'S OWN OPEN, so a sample its schema refuses is refused here too, and said on the page. The
    // schema check throws at the call, before any promise exists.
    const refused = (thrown: unknown): void => {
      document.body.dataset['galleryProblem'] = thrown instanceof Error ? thrown.message : String(thrown);
    };
    try {
      ask(wanted, sample.props).catch(refused);
    } catch (thrown) {
      refused(thrown);
    }
  }, [ask]);
  return (
    <DialogHost
      registry={registry}
      closeLabel={CLOSE_LABEL}
      open={host.open}
      onClose={host.close}
      onResolve={host.resolve}
      onUpdate={host.report}
    />
  );
}

const container = document.querySelector('#root');
if (container === null) throw new Error('the gallery document has no #root element to mount into');
createRoot(container).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <Gallery />
    </I18nProvider>
  </StrictMode>,
);
