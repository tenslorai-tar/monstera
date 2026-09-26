import { AI_PROVIDERS, type AiProviderId, MAX_WEB_SOURCES, webSearchOf } from '@monstera/contract';

import { anthropicErrorMessage, isAnthropicOutOfCredit } from './anthropicCredit.js';

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
 * ## And two more when the web is on (ADR-0108)
 *
 * A provider's own search tool is not always on the endpoint the plain answer uses. OpenAI, Azure OpenAI and xAI
 * search through their **Responses** API (`response.output_text.delta` carries the text), and Mistral only through
 * **Conversations** (`message.output.delta`). Anthropic, OpenRouter, Perplexity and Groq keep their usual endpoint and
 * gain a tool or a flag. Each shape also carries where the search shows itself — the evidence that one ran, and the
 * pages it cited — read by {@link readEvent} beside the text.
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

/** A picture, base64-encoded, as all three shapes take one. PNG is what the host draws. */
export interface ChatImage {
  readonly mediaType: 'image/png';
  readonly base64: string;
}

/** Why an answer did not happen, or did not finish. */
export type ChatRefusal =
  | 'no-key'
  | 'unauthorised'
  | 'out-of-credit'
  | 'rejected'
  | 'unreachable'
  | 'unreadable'
  // A *Document only* ask to a model that searches before every answer (ADR-0108), refused before anything is sent.
  | 'searches-the-web';

/** A page the provider's web search cited or found (ADR-0108). HTTPS only: the one route that opens it refuses others. */
export interface WebSource {
  readonly url: string;
  readonly title: string;
}

export interface ChatAnswer {
  readonly text: string;
  /** True when the caller's signal aborted it; the text so far is kept. */
  readonly stopped: boolean;
  /** Absent when the provider answered normally. */
  readonly refusal?: ChatRefusal;
  /** Whether the provider reported running a web search for this answer (ADR-0108). */
  readonly searched: boolean;
  /** The pages it cited — or, where it cited none, the pages its searches found. Empty when it did not search. */
  readonly sources: readonly WebSource[];
}

export interface ChatRequest {
  readonly provider: AiProviderId;
  readonly model: string;
  readonly key: string;
  /** Azure OpenAI's own resource; ignored elsewhere. */
  readonly endpoint?: string;
  readonly messages: readonly ChatMessage[];
  /**
   * An instruction ahead of the conversation — the document window an ask carries (ADR-0088).
   * Each shape has its own place for it; absent, the request carries none.
   */
  readonly system?: string;
  /**
   * A picture sent with the LAST user turn, in each shape's own form (ADR-0090). Earlier turns
   * carry text only, so a conversation does not re-send a picture per question.
   */
  readonly image?: ChatImage;
  /**
   * *Document + web* (ADR-0108): the provider's own search tool goes with the request. `false` sends none, turns a
   * provider's default search off where it has one (Perplexity), and refuses a model that always searches.
   */
  readonly web: boolean;
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

/** How a response streams — the three answer shapes, and the two a provider's web search moves it to. */
export type StreamShape = 'openai-chat' | 'anthropic' | 'gemini' | 'responses' | 'conversations';

interface Prepared {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly shape: StreamShape;
}

/**
 * The most searches one Anthropic answer may run (ADR-0108) — the owner's bound for the live run, and the cost a
 * person's own key carries at $10 per thousand.
 */
const MAX_WEB_SEARCHES = 5;

/** Where the Responses API lives for the two providers whose address is fixed. Azure's is the person's resource. */
const RESPONSES_URLS: Readonly<Partial<Record<AiProviderId, string>>> = {
  openai: 'https://api.openai.com/v1/responses',
  xai: 'https://api.x.ai/v1/responses',
};

const MISTRAL_CONVERSATIONS = 'https://api.mistral.ai/v1/conversations';

/** The request one provider takes, or `null` when there is nothing to send it to. */
export function prepareChat(request: Omit<ChatRequest, 'onDelta' | 'signal' | 'fetchImpl'>): Prepared | null {
  const { provider, model, key, endpoint = '', messages, system, image, web } = request;
  if (key === '' || model === '' || messages.length === 0) return null;
  const adapter = AI_PROVIDERS[provider].adapter;
  // THE WEB ONLY WHERE THIS PROVIDER AND MODEL CAN SEARCH — `webSearchOf` is the one reading (ADR-0108); a provider
  // that cannot is asked the ordinary way, and the answer comes back with nothing searched.
  const searching = web && webSearchOf(provider, model).kind !== 'none';
  // AN EMPTY INSTRUCTION IS NO INSTRUCTION: each shape refuses or ignores an empty one
  // differently, so none is sent.
  const instruction = system === undefined || system === '' ? null : system;
  // THE TURN THE PICTURE RIDES ON: the last one the person wrote, which is the one asking.
  const pictured = image === undefined ? -1 : messages.map((message) => message.role).lastIndexOf('user');
  const dataUrl = image === undefined ? '' : `data:${image.mediaType};base64,${image.base64}`;

  if (searching && (provider === 'openai' || provider === 'xai' || provider === 'azure-openai')) {
    // THE RESPONSES API, one body for the three (the Azure page's wire format is OpenAI's). A deployment's name is
    // Azure's `model`, as on its chat path.
    const base = endpoint.replace(/\/+$/u, '');
    const url = provider === 'azure-openai' ? (base === '' ? null : `${base}/openai/v1/responses`) : RESPONSES_URLS[provider];
    if (url === null || url === undefined) return null;
    return {
      url,
      headers:
        provider === 'azure-openai'
          ? { 'api-key': key, 'content-type': 'application/json' }
          : { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      shape: 'responses',
      body: JSON.stringify({
        model,
        stream: true,
        // NOT KEPT ON THE PROVIDER'S SIDE. The Responses API stores a response by default — OpenAI's data-controls page
        // says for 30 days — where a chat completion was never stored; without this, *Document + web* would leave the
        // document's text there. Mistral's Conversations path sends the same (the privacy draft's finding, 2026-09-26).
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        ...(instruction === null ? {} : { instructions: instruction }),
        input: messages.map((message, at) =>
          at === pictured && image !== undefined
            ? {
                role: message.role,
                content: [
                  { type: 'input_text', text: message.text },
                  { type: 'input_image', image_url: dataUrl },
                ],
              }
            : { role: message.role, content: message.text },
        ),
        tools: [{ type: 'web_search' }],
      }),
    };
  }

  if (searching && provider === 'mistral') {
    // CONVERSATIONS, since Mistral's search "aren't supported in the Chat Completions API" — and `store: false`, so
    // the conversation is not kept on Mistral's side, which a chat completion never was.
    return {
      url: MISTRAL_CONVERSATIONS,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      shape: 'conversations',
      body: JSON.stringify({
        model,
        stream: true,
        store: false,
        ...(instruction === null ? {} : { instructions: instruction }),
        inputs: messages.map((message, at) =>
          at === pictured && image !== undefined
            ? {
                role: message.role,
                content: [
                  { type: 'text', text: message.text },
                  { type: 'image_url', image_url: dataUrl },
                ],
              }
            : { role: message.role, content: message.text },
        ),
        tools: [{ type: 'web_search' }],
        completion_args: { max_tokens: MAX_OUTPUT_TOKENS },
      }),
    };
  }

  if (adapter === 'anthropic') {
    return {
      url: ANTHROPIC_MESSAGES,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      shape: 'anthropic',
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        ...(instruction === null ? {} : { system: instruction }),
        // THE BASIC TOOL VERSION: the newer two need programmatic tool calling, which Haiku 4.5 does not support
        // (Anthropic's server-tools page, read 2026-09-26).
        ...(searching ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }] } : {}),
        // ANTHROPIC'S IMAGE BLOCK, before the text as its vision guide places it.
        messages: messages.map((message, at) =>
          at === pictured && image !== undefined
            ? {
                role: message.role,
                content: [
                  { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                  { type: 'text', text: message.text },
                ],
              }
            : { role: message.role, content: message.text },
        ),
      }),
    };
  }

  if (adapter === 'gemini') {
    return {
      url: `${GEMINI_BASE}/${model.replace(/^models\//u, 'models/')}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      headers: { 'content-type': 'application/json' },
      shape: 'gemini',
      body: JSON.stringify({
        ...(instruction === null ? {} : { systemInstruction: { parts: [{ text: instruction }] } }),
        // GEMINI'S ROLES ARE `user` AND `model`, not `assistant`, and a request using the
        // other word is refused by the service rather than misread.
        contents: messages.map((message, at) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          // GEMINI'S INLINE DATA PART, beside the text part of the same turn.
          parts:
            at === pictured && image !== undefined
              ? [{ inline_data: { mime_type: image.mediaType, data: image.base64 } }, { text: message.text }]
              : [{ text: message.text }],
        })),
      }),
    };
  }

  const openAiBody = JSON.stringify({
    model,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
    // THE CHAT PATH'S OWN WEB SWITCHES (ADR-0108). OpenRouter's server tool; Groq's browser search, which only the
    // `gpt-oss` models take (`webSearchOf` has already said this one can); and Perplexity, which searches BY DEFAULT —
    // so *Document only* is the one that must say something there.
    ...(searching && provider === 'openrouter'
      ? { tools: [{ type: 'openrouter:web_search', parameters: { max_results: MAX_WEB_SEARCHES } }] }
      : {}),
    ...(searching && provider === 'groq' ? { tools: [{ type: 'browser_search' }] } : {}),
    ...(provider === 'perplexity' && !searching ? { disable_search: true } : {}),
    messages: [
      ...(instruction === null ? [] : [{ role: 'system', content: instruction }]),
      // THE OPENAI FORMAT'S `image_url` PART, carrying the picture as a data URL.
      ...messages.map((message, at) =>
        at === pictured && image !== undefined
          ? {
              role: message.role,
              content: [
                { type: 'text', text: message.text },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            }
          : { role: message.role, content: message.text },
      ),
    ],
  });
  if (provider === 'azure-openai') {
    const base = endpoint.replace(/\/+$/u, '');
    if (base === '') return null;
    // AZURE NAMES A DEPLOYMENT WHERE THE OTHERS NAME A MODEL, and the deployment's name is
    // what its list answers, so `model` carries it here.
    return {
      url: `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${AZURE_API_VERSION}`,
      headers: { 'api-key': key, 'content-type': 'application/json' },
      shape: 'openai-chat',
      body: openAiBody,
    };
  }
  const base = OPENAI_FORMAT_BASES[provider];
  if (base === undefined) return null;
  return {
    url: `${base}/chat/completions`,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    shape: 'openai-chat',
    body: openAiBody,
  };
}

/** What one server-sent event carried: text, and whatever it said about a web search (ADR-0108). */
export interface EventReading {
  readonly text: string;
  /** The provider reported a search running, in this event. */
  readonly searched: boolean;
  /** Pages the answer CITED, in this event. */
  readonly cited: readonly WebSource[];
  /** Pages a search FOUND, in this event — shown only when the answer cited none. */
  readonly found: readonly WebSource[];
  /** The kind of content block this event STARTED, where the shape has blocks (Anthropic's). */
  readonly block?: string;
}

const NOTHING: EventReading = { text: '', searched: false, cited: [], found: [] };

/** A record's field, or `undefined` — the one way this file looks inside a provider's JSON. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;
}

/**
 * A page as a source, or `null` for one this application will not open: HTTPS only, since `main`'s browser route
 * refuses anything else. A title that is missing — or is xAI's citation NUMBER, which its docs warn is what `title`
 * holds for a text citation — is replaced by the site's host.
 */
function sourceOf(url: unknown, title: unknown): WebSource | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const named = typeof title === 'string' && title.trim() !== '' && !/^\d+$/u.test(title.trim()) ? title.trim() : parsed.host;
  return { url: parsed.href, title: named };
}

/** The sources in a list of `url_citation` annotations — OpenRouter nests them one level, OpenAI does not. */
function citationsIn(annotations: unknown): WebSource[] {
  if (!Array.isArray(annotations)) return [];
  return annotations.flatMap((annotation: unknown) => {
    if (field(annotation, 'type') !== 'url_citation') return [];
    const nested = field(annotation, 'url_citation');
    const holder = nested === undefined ? annotation : nested;
    const source = sourceOf(field(holder, 'url'), field(holder, 'title'));
    return source === null ? [] : [source];
  });
}

/** The text a single server-sent event carries, in this provider's shape. */
export function deltaOf(shape: 'openai-format' | 'anthropic' | 'gemini', data: string): string {
  return readEvent(shape === 'openai-format' ? 'openai-chat' : shape, data).text;
}

/** Everything a single server-sent event carries, in this stream's shape (ADR-0108). */
export function readEvent(shape: StreamShape, data: string): EventReading {
  if (data === '[DONE]') return NOTHING;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A LINE THAT IS NOT JSON IS SKIPPED rather than thrown on: a stream carries comments
    // and keep-alives, and one of them must not end an answer a person is reading.
    return NOTHING;
  }
  if (typeof parsed !== 'object' || parsed === null) return NOTHING;
  const event = parsed as Record<string, unknown>;
  const type = event['type'];

  if (shape === 'anthropic') {
    // THE SEARCH SHOWS ITSELF THREE WAYS (Anthropic's streaming and web-search pages): a `server_tool_use` block
    // naming the tool, a `web_search_tool_result` block carrying the results whole, and the search count on the
    // closing `message_delta`. Citations arrive as `citations_delta` on the answer's text block.
    if (type === 'content_block_start') {
      const block = event['content_block'];
      const kind = field(block, 'type');
      const started = typeof kind === 'string' ? { block: kind } : {};
      if (kind === 'server_tool_use' && field(block, 'name') === 'web_search') {
        return { ...NOTHING, ...started, searched: true };
      }
      if (kind === 'web_search_tool_result') {
        const content = field(block, 'content');
        // AN ERROR IS ONE OBJECT, not a list — the search was attempted and found nothing to show.
        if (!Array.isArray(content)) return { ...NOTHING, ...started, searched: true };
        const found = content.flatMap((result) => {
          const source = sourceOf(field(result, 'url'), field(result, 'title'));
          return source === null ? [] : [source];
        });
        return { ...NOTHING, ...started, searched: true, found };
      }
      return { ...NOTHING, ...started };
    }
    if (type === 'message_delta') {
      const requests = field(field(field(event, 'usage'), 'server_tool_use'), 'web_search_requests');
      return typeof requests === 'number' && requests > 0 ? { ...NOTHING, searched: true } : NOTHING;
    }
    const delta = event['delta'];
    if (type !== 'content_block_delta' || typeof delta !== 'object' || delta === null) return NOTHING;
    if (field(delta, 'type') === 'citations_delta') {
      const citation = field(delta, 'citation');
      if (field(citation, 'type') !== 'web_search_result_location') return NOTHING;
      const source = sourceOf(field(citation, 'url'), field(citation, 'title'));
      return source === null ? NOTHING : { ...NOTHING, cited: [source] };
    }
    const text = (delta as Record<string, unknown>)['text'];
    return typeof text === 'string' ? { ...NOTHING, text } : NOTHING;
  }

  if (shape === 'responses') {
    // THE RESPONSES API's events (OpenAI's SDK types, read 2026-09-26): text deltas, a `web_search_call` output
    // item for each search, and each citation as its own annotation event.
    if (type === 'response.output_text.delta') {
      const text = event['delta'];
      return typeof text === 'string' ? { ...NOTHING, text } : NOTHING;
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = event['item'];
      if (field(item, 'type') !== 'web_search_call') return NOTHING;
      const sources = field(field(item, 'action'), 'sources');
      const found = Array.isArray(sources)
        ? sources.flatMap((entry) => {
            const source = sourceOf(field(entry, 'url'), undefined);
            return source === null ? [] : [source];
          })
        : [];
      return { ...NOTHING, searched: true, found };
    }
    if (type === 'response.output_text.annotation.added') {
      return { ...NOTHING, cited: citationsIn([event['annotation']]) };
    }
    return NOTHING;
  }

  if (shape === 'conversations') {
    // MISTRAL'S CONVERSATIONS STREAM: `tool.execution.started` names the search, and a `message.output.delta`'s
    // content is either text or a list of chunks, where a `tool_reference` chunk is a cited page.
    if (type === 'tool.execution.started') {
      const name = event['name'];
      return typeof name === 'string' && name.startsWith('web_search') ? { ...NOTHING, searched: true } : NOTHING;
    }
    if (type !== 'message.output.delta') return NOTHING;
    const content = event['content'];
    if (typeof content === 'string') return { ...NOTHING, text: content };
    if (!Array.isArray(content)) return NOTHING;
    let text = '';
    const cited: WebSource[] = [];
    for (const chunk of content) {
      const kind = field(chunk, 'type');
      const piece = field(chunk, 'text');
      if (kind === 'text' && typeof piece === 'string') text += piece;
      if (kind === 'tool_reference') {
        const source = sourceOf(field(chunk, 'url'), field(chunk, 'title'));
        if (source !== null) cited.push(source);
      }
    }
    return { ...NOTHING, text, cited };
  }

  if (shape === 'gemini') {
    const candidates = event['candidates'];
    if (!Array.isArray(candidates)) return NOTHING;
    const text = candidates
      .flatMap((candidate) => {
        const content = (candidate as Record<string, unknown>)['content'];
        const parts = typeof content === 'object' && content !== null ? (content as Record<string, unknown>)['parts'] : undefined;
        if (!Array.isArray(parts)) return [];
        return parts.map((part) => {
          const piece = (part as Record<string, unknown>)['text'];
          return typeof piece === 'string' ? piece : '';
        });
      })
      .join('');
    return { ...NOTHING, text };
  }

  // THE CHAT-COMPLETIONS SHAPE, and three providers' ways of saying they searched on it: OpenRouter's
  // `url_citation` annotations and its search count; Perplexity's `citations` and `search_results`, top level; and
  // Groq's `executed_tools`, whose place in a stream its docs do not state — read wherever a chunk carries it.
  const choice = Array.isArray(event['choices']) ? (event['choices'] as unknown[])[0] : undefined;
  const delta = field(choice, 'delta');
  const content = field(delta, 'content');
  const text = typeof content === 'string' ? content : '';
  const cited = [...citationsIn(field(delta, 'annotations')), ...citationsIn(field(field(choice, 'message'), 'annotations'))];

  const found: WebSource[] = [];
  const results = event['search_results'];
  if (Array.isArray(results)) {
    for (const result of results) {
      const source = sourceOf(field(result, 'url'), field(result, 'title'));
      if (source !== null) found.push(source);
    }
  }
  const urls = event['citations'];
  if (Array.isArray(urls)) {
    for (const url of urls) {
      const source = sourceOf(url, undefined);
      if (source !== null) found.push(source);
    }
  }
  const executed = field(delta, 'executed_tools') ?? field(field(choice, 'message'), 'executed_tools');
  if (Array.isArray(executed)) {
    for (const tool of executed) {
      const listed = field(field(tool, 'search_results'), 'results');
      if (!Array.isArray(listed)) continue;
      for (const result of listed) {
        const source = sourceOf(field(result, 'url'), field(result, 'title'));
        if (source !== null) found.push(source);
      }
    }
  }
  const requests = field(field(event['usage'], 'server_tool_use'), 'web_search_requests');
  const searched =
    cited.length > 0 ||
    found.length > 0 ||
    (Array.isArray(executed) && executed.length > 0) ||
    (typeof requests === 'number' && requests > 0);
  return { text, searched, cited, found };
}

/** Sources in the order first seen, each address once, at most the contract's bound. */
function distinct(sources: readonly WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const kept: WebSource[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    kept.push(source);
    if (kept.length === MAX_WEB_SOURCES) break;
  }
  return kept;
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
  const { provider, model, web, onDelta, signal, fetchImpl = fetch } = request;
  // NOTHING SEARCHED AND NOTHING FOUND, which every answer that ends before its stream says.
  const unsearched = { searched: false, sources: [] } as const;
  // *DOCUMENT ONLY* NEVER REACHES A MODEL THAT ALWAYS SEARCHES (ADR-0108): the question — and the document window
  // riding with it — would go to a search engine the person chose not to use. Refused before anything is sent.
  if (!web && webSearchOf(provider, model).kind === 'always') {
    return { text: '', stopped: false, refusal: 'searches-the-web', ...unsearched };
  }
  const prepared = prepareChat(request);
  if (prepared === null) return { text: '', stopped: false, refusal: 'no-key', ...unsearched };

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
      ? { text: '', stopped: true, ...unsearched }
      : { text: '', stopped: false, refusal: 'unreachable', ...unsearched };
  }

  if (response.status === 401 || response.status === 403) {
    return { text: '', stopped: false, refusal: 'unauthorised', ...unsearched };
  }
  // OUT OF CREDIT IS ITS OWN ANSWER, for Anthropic alone: its 400 is shared with a malformed
  // request, and only one of the two is the person's to fix — by paying, which *rejected* never
  // says. `anthropicCredit.ts` owns the reading, because the recognition engine asks it too.
  if (
    provider === 'anthropic' &&
    response.status === 400 &&
    isAnthropicOutOfCredit(response.status, await anthropicErrorMessage(response))
  ) {
    return { text: '', stopped: false, refusal: 'out-of-credit', ...unsearched };
  }
  if (!response.ok) return { text: '', stopped: false, refusal: 'rejected', ...unsearched };
  if (response.body === null) return { text: '', stopped: false, refusal: 'unreadable', ...unsearched };

  let text = '';
  let searched = false;
  const cited: WebSource[] = [];
  const found: WebSource[] = [];
  // THE CITED PAGES WHERE THERE ARE ANY, else what the searches found — a provider's display terms ask for the
  // citations, and an answer that searched and cited nothing still owes the person where it looked.
  const webPart = (): Pick<ChatAnswer, 'searched' | 'sources'> => ({
    searched,
    sources: distinct(cited.length > 0 ? cited : found),
  });
  // THE BLOCK BEFORE THIS ONE. Anthropic answers in several text blocks, split around a search and at every citation;
  // the citation splits fall mid-sentence and join with nothing, but a text block after a SEARCH starts a new thought
  // and joined with nothing reads "…this detail.Joseph B. Strauss…" — seen in the live run of 2026-09-26.
  let previousBlock: string | undefined;
  try {
    for await (const data of dataEvents(response.body)) {
      const reading = readEvent(prepared.shape, data);
      if (reading.searched) searched = true;
      cited.push(...reading.cited);
      found.push(...reading.found);
      if (reading.block !== undefined) {
        if (reading.block === 'text' && previousBlock !== undefined && previousBlock !== 'text' && text !== '') {
          text += '\n\n';
          onDelta?.('\n\n');
        }
        previousBlock = reading.block;
      }
      if (reading.text === '') continue;
      text += reading.text;
      onDelta?.(reading.text);
    }
  } catch {
    // WHAT ARRIVED IS KEPT. A stream that ends badly has still shown the person words, and
    // taking them back is the failure this shape exists to avoid.
    return signal?.aborted === true
      ? { text, stopped: true, ...webPart() }
      : { text, stopped: false, refusal: 'unreadable', ...webPart() };
  }
  return { text, stopped: signal?.aborted === true, ...webPart() };
}
