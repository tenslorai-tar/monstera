import { type ContractClient, type FieldAction, type UrlFetchRefusal, schemeOf } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { confirmCopied } from '../commands/confirmWritten.js';
import { SUBMIT_FORM_DIALOG_ID, SUBMIT_FORM_RESULT, SUBMIT_FORM_SEND_RESULT, type SUBMIT_ROUTES } from '../dialogs/submitForm.js';
import type { DialogReports } from '../registries/dialogs.js';
import {
  BUTTON_PRESS_UNREAD,
  BUTTON_SUBMIT_BLOCKED,
  BUTTON_SUBMIT_CREDENTIALS,
  BUTTON_SUBMIT_MAIL_OPENED,
  BUTTON_SUBMIT_MAIL_WITHOUT_DATA,
  BUTTON_SUBMIT_MAIL_WITHOUT_DOCUMENT,
  BUTTON_SUBMIT_NOT_HTTPS,
  BUTTON_SUBMIT_NOT_OPENED,
  BUTTON_SUBMIT_NOT_TAKEN,
  BUTTON_SUBMIT_SENT,
  BUTTON_SUBMIT_SHARED,
  BUTTON_SUBMIT_SHARE_FAILED,
  BUTTON_SUBMIT_SHARE_UNAVAILABLE,
  BUTTON_SUBMIT_UNAVAILABLE,
  BUTTON_SUBMIT_UNREACHABLE,
  BUTTON_SUBMIT_UNREPRESENTABLE,
  BUTTON_SUBMIT_UNRESOLVABLE,
} from '../messages/en.js';
import type { ShowToast } from '../toasts.js';

/** What `main` answers a submission, and what a refused one said. */
type SubmitAnswer = Awaited<ReturnType<ContractClient['document.submitButtonForm']>>;

/** The route the person chose in the question, which `main` checks against the address it reads. */
export type SubmitRoute = (typeof SUBMIT_ROUTES)[number];

/**
 * Each guard reason's sentence for a SUBMISSION, in a total record keyed by the contract's list, for
 * `UrlOpenProblemBody`'s reason. Its own sentences rather than that dialog's: those say a PDF was not saved. The three
 * a POST never meets (a body past a ceiling, a body that is not a PDF, a redirect chain) read as the server not taking
 * it, which is what any of them would be.
 */
const REFUSED: Readonly<Record<UrlFetchRefusal, MessageKey>> = {
  'not-https': BUTTON_SUBMIT_NOT_HTTPS,
  credentials: BUTTON_SUBMIT_CREDENTIALS,
  'blocked-address': BUTTON_SUBMIT_BLOCKED,
  unresolvable: BUTTON_SUBMIT_UNRESOLVABLE,
  unreachable: BUTTON_SUBMIT_UNREACHABLE,
  'http-error': BUTTON_SUBMIT_NOT_TAKEN,
  'too-many-redirects': BUTTON_SUBMIT_NOT_TAKEN,
  'too-large': BUTTON_SUBMIT_NOT_TAKEN,
  'not-a-pdf': BUTTON_SUBMIT_NOT_TAKEN,
};

/** The application's own exports a submission falls back on when its data does not fit in a message. */
export type SubmitFallbackId = 'document.export-form-data-fdf' | 'document.export-form-data-xfdf';

/** What asking and sending needs: the dialog and its reports, a sentence, Export form data, and `main`'s clipboard. */
export interface ButtonSubmitDeps {
  readonly ask: (id: string, props: unknown, onUpdate?: DialogReports) => Promise<unknown>;
  readonly toast: ShowToast;
  readonly run: (id: SubmitFallbackId) => Promise<void>;
  readonly client: Pick<ContractClient, 'window.copyText'>;
}

/**
 * Who a `mailto:` address is to, as a person types it into a message: the part before any `?`, its escapes read
 * (RFC 6068). What Copy copies, since the Share sheet takes no recipient and a pasted `mailto:` is not an address.
 */
export function mailRecipient(address: string): string {
  const to = address.slice('mailto:'.length).split('?')[0] ?? '';
  try {
    return decodeURIComponent(to);
  } catch {
    // A STRAY `%` that names no escape is the address as written: shown and copied as it stands, never dropped.
    return to;
  }
}

/**
 * ASKED FIRST, then sent (ADR-0259 Decision 6): the question names the address, the encoding and the fields as the
 * button's action holds them, and only *Send* (or *Open in mail app*) calls `send`, which names the step and never the
 * address or the data. What `main` answers is then said: a send, a refusal by the guard's reason, or the mail app.
 *
 * WHERE THE DATA DID NOT FIT in a message, the mail app opened without it and the person is told so, and the
 * application's own Export form data runs, whose save dialog is its question, so they can attach the file themselves.
 * HTML form data has no export of its own and falls back on FDF, the encoding a submission writes with no flag.
 */
export async function askThenSubmit(
  deps: ButtonSubmitDeps,
  action: Extract<FieldAction, { kind: 'submit' }>,
  send: (route: SubmitRoute) => Promise<SubmitAnswer>,
): Promise<void> {
  const mail = schemeOf(action.address) === 'mailto:';
  const answer = await deps.ask(
    SUBMIT_FORM_DIALOG_ID,
    { address: action.address, format: action.format, fields: action.fields, mail },
    // COPY, REPORTED with the dialog left open: through `main`, which holds the clipboard, and *Copied* only when it says so.
    (reported) => {
      if (!mail || !SUBMIT_FORM_RESULT.safeParse(reported).success || !('copy' in (reported as object))) return;
      void deps.client['window.copyText']({ text: mailRecipient(action.address) }).then((copied) => {
        if (copied.ok && copied.value.copied) confirmCopied({ toast: deps.toast });
      });
    },
  );
  const chosen = SUBMIT_FORM_SEND_RESULT.safeParse(answer);
  if (!chosen.success) return;
  const sent = await send(chosen.data.route);
  if (!sent.ok) {
    deps.toast('problem', BUTTON_SUBMIT_UNAVAILABLE);
    return;
  }
  const outcome = sent.value;
  switch (outcome.kind) {
    case 'sent':
      deps.toast('done', BUTTON_SUBMIT_SENT);
      return;
    case 'mail-opened':
      deps.toast('done', BUTTON_SUBMIT_MAIL_OPENED);
      return;
    case 'mail-opened-without-data':
      deps.toast('problem', BUTTON_SUBMIT_MAIL_WITHOUT_DATA);
      await deps.run(action.format === 'xfdf' ? 'document.export-form-data-xfdf' : 'document.export-form-data-fdf');
      return;
    case 'mail-opened-without-document':
      deps.toast('problem', BUTTON_SUBMIT_MAIL_WITHOUT_DOCUMENT);
      return;
    case 'shared':
      deps.toast('done', BUTTON_SUBMIT_SHARED);
      return;
    case 'share-unavailable':
      deps.toast('problem', BUTTON_SUBMIT_SHARE_UNAVAILABLE);
      return;
    case 'share-failed':
      deps.toast('problem', BUTTON_SUBMIT_SHARE_FAILED);
      return;
    case 'refused':
      deps.toast('problem', REFUSED[outcome.reason]);
      return;
    case 'not-opened':
      deps.toast('problem', BUTTON_SUBMIT_NOT_OPENED);
      return;
    case 'unrepresentable':
      deps.toast('problem', BUTTON_SUBMIT_UNREPRESENTABLE);
      return;
    case 'stale':
    case 'no-such-submit':
      deps.toast('problem', BUTTON_PRESS_UNREAD);
      return;
  }
}
