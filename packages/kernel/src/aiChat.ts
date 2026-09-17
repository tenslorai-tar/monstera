import { AI_PROVIDERS, type AiProviderId } from '@monstera/contract';

/**
 * Asking a provider, and reading the answer as it arrives
 * ([ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)).
 *
 * Executes in `main` — invariant 25 gives the engine host no network — and takes its
 * `fetch`, so every case drives it with an answer of its choosing.
 *
 * ## Every URL was PROBED on 2026-09-17, with no key and an empty body
 *
 * A path that answers `401`, `403` or a complaint about the body is a path that exists;
 * `404` is one that is wrong. Read that day: Anthropic, OpenAI, Mistral, OpenRouter, Groq,
 * Perplexity, DeepSeek and Azure OpenAI answered **401**, Gemini **403**, and xAI **400 —
 * `Messages cannot be empty`**, which says the request reached the handler.
 *
 * ## Three shapes, and the streaming form of each
 *
 * All three stream as server-sent events, and the delta sits in a different place:
 *
 * | shape | event body | the text |
 * |---|---|---|
 * | OpenAI-format | `{choices:[{delta:{content}}]}` | `choices[0].delta.content`, ending at `[DONE]` |
 * | Anthropic | `{type:'content_block_delta',delta:{text}}` | `delta.text` |
 * | Gemini | `{candidates:[{content:{parts:[{text}]}}]}` | every part's `text` |
 *
 * ## Stop is the caller's signal, and a stopped answer is kept
 *
 * The composer's send becomes **Stop** while an answer streams, so stopping is ordinary
 * rather than an error: the text received so far is returned with `stopped: true`. A
 * request that fails is a refusal **by name**, and the text already streamed is returned
 * with it — a person watching words appear must not see them vanish.
 */

/** One turn of a conversation. */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** Why an answer did not happen, or did not finish. */
export type ChatRefusal = 'no-key' | 'unauthorised' | 'rejected' | 'unreachable' | 'unreadable';

export interface ChatAnswer {
  readonly text: string;
  /** True when the caller's signal aborted it; the text so far is kept. */
  readonly stopped: boolean;
  /** Absent when the provider answered normally. */
  readonly refusal?: ChatRefusal;
}

export interface ChatRequest {
  readonly provider: AiProviderId;
  readonly model: string;
  readonly key: string;
  /** Azure OpenAI's own resource; ignored elsewhere. */
  readonly endpoint?: string;
  readonly messages: readonly ChatMessage[];
  /** Called with each piece of text as it arrives. */
  readonly onDelta?: (text: string) => void;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

/** How long an answer may run before it is cut off, in tokens. */
const MAX_OUTPUT_TOKENS = 4096;

/** Where each OpenAI-format provider's chat lives. Azure's is the person's resource. */
const OPENAI_FORMAT_BASES: Readonly<Partial<Record<AiProviderId, string>>> = {
  openai: 'https://api.openai.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  perplexity: 'https://api.perplexity.ai',
  deepseek: 'https://api.deepseek.com',
};

const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const AZURE_API_VERSION = '2024-10-21';

interface Prepared {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** The request one provider takes, or `null` when there is nothing to send it to. */
export function prepareChat(request: Omit<ChatRequest, 'onDelta' | 'signal' | 'fetchImpl'>): Prepared | null {
  const { provider, model, key, endpoint = '', messages } = request;
  if (key === '' || model === '' || messages.length === 0) return null;
  const shape = AI_PROVIDERS[provider].adapter;

  if (shape === 'anthropic') {
    return {
      url: ANTHROPIC_MESSAGES,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        messages: messages.map((message) => ({ role: message.role, content: message.text })),
      }),
    };
  }

  if (shape === 'gemini') {
    return {
      url: `${GEMINI_BASE}/${model.replace(/^models\//u, 'models/')}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // GEMINI'S ROLES ARE `user` AND `model`, not `assistant`, and a request using the
        // other word is refused by the service rather than misread.
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.text }],
        })),
      }),
    };
  }

  const openAiBody = JSON.stringify({
    model,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: messages.map((message) => ({ role: message.role, content: message.text })),
  });
  if (provider === 'azure-openai') {
    const base = endpoint.replace(/\/+$/u, '');
    if (base === '') return null;
    // AZURE NAMES A DEPLOYMENT WHERE THE OTHERS NAME A MODEL, and the deployment's name is
    // what its list answers, so `model` carries it here.
    return {
      url: `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${AZURE_API_VERSION}`,
      headers: { 'api-key': key, 'content-type': 'application/json' },
      body: openAiBody,
    };
  }
  const base = OPENAI_FORMAT_BASES[provider];
  if (base === undefined) return null;
  return {
    url: `${base}/chat/completions`,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: openAiBody,
  };
}

/** The text a single server-sent event carries, in this provider's shape. */
export function deltaOf(shape: 'openai-format' | 'anthropic' | 'gemini', data: string): string {
  if (data === '[DONE]') return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A LINE THAT IS NOT JSON IS SKIPPED rather than thrown on: a stream carries comments
    // and keep-alives, and one of them must not end an answer a person is reading.
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const event = parsed as Record<string, unknown>;

  if (shape === 'anthropic') {
    const delta = event['delta'];
    if (event['type'] !== 'content_block_delta' || typeof delta !== 'object' || delta === null) return '';
    const text = (delta as Record<string, unknown>)['text'];
    return typeof text === 'string' ? text : '';
  }

  if (shape === 'gemini') {
    const candidates = event['candidates'];
    if (!Array.isArray(candidates)) return '';
    return candidates
      .flatMap((candidate) => {
        const content = (candidate as Record<string, unknown>)['content'];
        const parts = typeof content === 'object' && content !== null ? (content as Record<string, unknown>)['parts'] : undefined;
        if (!Array.isArray(parts)) return [];
        return parts.map((part) => {
          const text = (part as Record<string, unknown>)['text'];
          return typeof text === 'string' ? text : '';
        });
      })
      .join('');
  }

  const choices = event['choices'];
  if (!Array.isArray(choices)) return '';
  const delta = (choices[0] as Record<string, unknown> | undefined)?.['delta'];
  if (typeof delta !== 'object' || delta === null) return '';
  const content = (delta as Record<string, unknown>)['content'];
  return typeof content === 'string' ? content : '';
}

/** Splits a server-sent-event stream into its `data:` payloads, across chunk boundaries. */
export async function* dataEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let held = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // A CHUNK IS NOT A LINE. The decoder is given `stream: true` so a multi-byte character
    // split across two chunks is not turned into two replacement characters.
    held += decoder.decode(value, { stream: true });
    const lines = held.split('\n');
    held = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed.startsWith('data:')) yield trimmed.slice('data:'.length).trim();
    }
  }
  const last = held.trimEnd();
  if (last.startsWith('data:')) yield last.slice('data:'.length).trim();
}

/**
 * Asks the provider and streams the answer.
 *
 * **Never throws**, for `listModels`' reason: an assistant that crashes the process when a
 * service is down is worse than one that says the service is down.
 */
export async function streamChat(request: ChatRequest): Promise<ChatAnswer> {
  const { provider, onDelta, signal, fetchImpl = fetch } = request;
  const prepared = prepareChat(request);
  if (prepared === null) return { text: '', stopped: false, refusal: 'no-key' };

  let response: Response;
  try {
    response = await fetchImpl(prepared.url, {
      method: 'POST',
      headers: prepared.headers,
      body: prepared.body,
      // SPREAD RATHER THAN `signal: undefined`: under `exactOptionalPropertyTypes` a caller
      // with no signal must omit the field, not pass nothing in it.
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    // AN ABORT ARRIVES HERE TOO, and it is not a failure: the person pressed Stop before
    // the first byte.
    return signal?.aborted === true
      ? { text: '', stopped: true }
      : { text: '', stopped: false, refusal: 'unreachable' };
  }

  if (response.status === 401 || response.status === 403) return { text: '', stopped: false, refusal: 'unauthorised' };
  if (!response.ok) return { text: '', stopped: false, refusal: 'rejected' };
  if (response.body === null) return { text: '', stopped: false, refusal: 'unreadable' };

  const shape = AI_PROVIDERS[provider].adapter;
  let text = '';
  try {
    for await (const data of dataEvents(response.body)) {
      const delta = deltaOf(shape, data);
      if (delta === '') continue;
      text += delta;
      onDelta?.(delta);
    }
  } catch {
    // WHAT ARRIVED IS KEPT. A stream that ends badly has still shown the person words, and
    // taking them back is the failure this shape exists to avoid.
    return signal?.aborted === true ? { text, stopped: true } : { text, stopped: false, refusal: 'unreadable' };
  }
  return { text, stopped: signal?.aborted === true };
}
