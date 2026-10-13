import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { AI_SETUP_OFFER, AI_SETUP_OFFER_SET_UP, AI_SETUP_OFFER_SKIP } from './messages/en.js';
import { Button } from './primitives/Button.js';

/**
 * *Set up the AI assistant?* — BUILD-PROMPT E5's first-run onboarding step, on the start screen below its Open buttons.
 *
 * **Inline and not a dialog that opens by itself.** Whether the offer is due is known only from two answers from main
 * (the stored settings, and which keys are stored), and the first paint never waits for main (`main.tsx`: a missing
 * preload would otherwise be an empty window). So a dialog opened on those answers always arrived after the start
 * screen was drawn, and landed over the Open button a person was about to press. Drawn here, below the buttons, it
 * covers nothing and moves nothing above it.
 *
 * *Set up…* runs the registered *Set up AI…* command, so the dialog has one route (B3a). *Skip* is the dialog's own Skip:
 * the stored `false` that stops the offer.
 */
export function AiSetupOffer({
  onSetUp,
  onSkip,
}: {
  readonly onSetUp: () => void;
  readonly onSkip: () => void;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <section aria-label={_(AI_SETUP_OFFER)} className="m-ai-offer" data-ai-offer="">
      <p className="m-ai-offer__question">{_(AI_SETUP_OFFER)}</p>
      <div className="m-ai-offer__actions">
        <Button label={AI_SETUP_OFFER_SET_UP} onClick={onSetUp} />
        <Button label={AI_SETUP_OFFER_SKIP} onClick={onSkip} />
      </div>
    </section>
  );
}
