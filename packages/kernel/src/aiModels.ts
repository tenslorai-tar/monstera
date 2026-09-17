import { AI_PROVIDERS, type AiModel, type AiProviderId } from '@monstera/contract';

/**
 * What models a provider offers, asked of the provider
 * ([ADR-0081](../../../docs/DECISIONS/0081-an-ai-provider-is-a-declared-adapter-and-its-models-are-fetched.md)).
 *
 * Executes in `main` — invariant 25 gives the engine host no network — and takes its
 * `fetch`, so every case here drives it with an answer of its choosing and the application
 * passes the real one.
 *
 * ## Every URL below was PROBED, on 2026-09-17, with no key
 *
 * A list endpoint that answers `401` or `403` to an unauthenticated `GET` is a path that
 * exists and wants credentials; a `404` is a path that is wrong. Read that day:
 *
 * | provider | status | what it says |
 * |---|---|---|
 * | Anthropic | 401 | `x-api-key header is required` |
 * | OpenAI | 401 | `Missing bearer authentication in header` |
 * | Gemini | 403 | `callers without established identity` |
 * | Mistral | 401 | `Invalid API Key` |
 * | xAI | 401 | `no-credentials` |
 * | OpenRouter | **200** | the list is public |
 * | Groq | 401 | `Invalid API Key` |
 * | DeepSeek | 401 | `Authentication Fails` |
 * | Azure OpenAI | 401 | the resource's own *invalid subscription key* |
 * | Perplexity | **404** | there is no list at `/models` |
 *
 * So **Perplexity has no list to fetch** and is answered from what this build knows, which
 * is the honest shape rather than a URL that would always fail.
 *
 * ## A FALLBACK NAMES ONLY MODELS THIS BUILD HAS SEEN NAMED
 *
 * The fallback exists for a machine that cannot reach the provider. It would be easy to
 * fill with model ids from memory, and an id nobody read is a request that fails at the
 * service with a message about a model that does not exist — worse than an empty list,
 * which says *set a key and I will ask*. So a provider whose models this repository has
 * never read is declared empty, by name, with what it would take to fill it.
 */

/** Where a provider's list lives, and how the key is presented. */
interface ListEndpoint {
  /** The URL, or `null` where the provider publishes no list (Perplexity, measured). */
  readonly url: string | null;
  readonly auth: 'bearer' | 'x-api-key' | 'query-key' | 'azure-api-key';
  /** Which shape the answer is in. */
  readonly shape: 'openai-format' | 'anthropic' | 'gemini';
}

const LIST_ENDPOINTS: Readonly<Record<AiProviderId, ListEndpoint>> = {
  anthropic: { url: 'https://api.anthropic.com/v1/models', auth: 'x-api-key', shape: 'anthropic' },
  openai: { url: 'https://api.openai.com/v1/models', auth: 'bearer', shape: 'openai-format' },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    auth: 'query-key',
    shape: 'gemini',
  },
  mistral: { url: 'https://api.mistral.ai/v1/models', auth: 'bearer', shape: 'openai-format' },
  xai: { url: 'https://api.x.ai/v1/models', auth: 'bearer', shape: 'openai-format' },
  'azure-openai': { url: null, auth: 'azure-api-key', shape: 'openai-format' },
  openrouter: { url: 'https://openrouter.ai/api/v1/models', auth: 'bearer', shape: 'openai-format' },
  groq: { url: 'https://api.groq.com/openai/v1/models', auth: 'bearer', shape: 'openai-format' },
  // MEASURED 404: Perplexity publishes no model list at /models, so there is nothing to ask.
  perplexity: { url: null, auth: 'bearer', shape: 'openai-format' },
  deepseek: { url: 'https://api.deepseek.com/models', auth: 'bearer', shape: 'openai-format' },
};

/** The API version Azure's data-plane list takes; the resource itself is the person's. */
const AZURE_API_VERSION = '2024-10-21';

/**
 * What each provider answers when nothing can be fetched.
 *
 * **Anthropic's is the one model this repository has read a specification for** —
 * `claude-opus-5`, from Anthropic's models overview on 2026-09-13, which D6's recogniser
 * runs against and whose vision support is the reason it was chosen. Every other provider
 * is empty **on purpose**: filling it would mean writing model ids from memory.
 */
const FALLBACK_MODELS: Readonly<Record<AiProviderId, readonly AiModel[]>> = {
  anthropic: [
    { id: 'claude-opus-5', label: 'claude-opus-5', capabilities: { vision: true, streaming: true } },
  ],
  openai: [],
  gemini: [],
  mistral: [],
  xai: [],
  'azure-openai': [],
  openrouter: [],
  groq: [],
  perplexity: [],
  deepseek: [],
};

/** How a model list came to be. */
export type AiModelSource = 'fetched' | 'fallback' | 'no-list';

export interface AiModelList {
  readonly provider: AiProviderId;
  readonly models: readonly AiModel[];
  readonly source: AiModelSource;
  /** Present when a fetch was attempted and did not answer a list. */
  readonly problem?: 'unauthorised' | 'unreachable' | 'rejected' | 'unreadable';
}

export interface AiModelRequest {
  readonly provider: AiProviderId;
  /** The stored key. An empty string is *no key*, and no request is made. */
  readonly key: string;
  /** Azure OpenAI's own resource address; ignored by every other provider. */
  readonly endpoint?: string;
  /** Injected so a case drives the answer. The application passes the real one. */
  readonly fetchImpl?: typeof fetch;
}

/** The request's URL and headers, or `null` where this provider has no list. */
function request(provider: AiProviderId, key: string, endpoint: string): { url: string; headers: Record<string, string> } | null {
  const list = LIST_ENDPOINTS[provider];
  if (provider === 'azure-openai') {
    const base = endpoint.replace(/\/+$/u, '');
    if (base === '') return null;
    return { url: `${base}/openai/models?api-version=${AZURE_API_VERSION}`, headers: { 'api-key': key } };
  }
  if (list.url === null) return null;
  if (list.auth === 'query-key') return { url: `${list.url}?key=${encodeURIComponent(key)}`, headers: {} };
  if (list.auth === 'x-api-key') {
    return { url: list.url, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
  }
  return { url: list.url, headers: { authorization: `Bearer ${key}` } };
}

/** An id and, where the answer gives one, a label. */
function model(id: string, label?: string): AiModel {
  // CAPABILITIES ARE NULL, because a list endpoint does not state them. `null` is "the
  // provider did not say" and a surface shows such a model plainly rather than disabled.
  return { id, label: label ?? id, capabilities: { vision: null, streaming: null } };
}

/** Reads the models out of one provider's answer, or `null` when it is not that shape. */
export function readModels(shape: ListEndpoint['shape'], body: unknown): readonly AiModel[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;

  if (shape === 'gemini') {
    const models = record['models'];
    if (!Array.isArray(models)) return null;
    // GEMINI NAMES A MODEL `models/gemini-...`, and the id a request takes is that whole
    // name; the label drops the prefix so a list does not read as a path.
    return models.flatMap((entry) => {
      const name = (entry as Record<string, unknown>)['name'];
      return typeof name === 'string' ? [model(name, name.replace(/^models\//u, ''))] : [];
    });
  }

  // OPENAI-FORMAT AND ANTHROPIC BOTH ANSWER `{ data: [...] }`, and Anthropic's entries
  // carry a `display_name` the others do not.
  const data = record['data'];
  if (!Array.isArray(data)) return null;
  return data.flatMap((entry) => {
    const item = entry as Record<string, unknown>;
    const id = item['id'];
    if (typeof id !== 'string') return [];
    const display = item['display_name'];
    return [model(id, typeof display === 'string' ? display : undefined)];
  });
}

/**
 * The provider's models, or what this build knows when it cannot ask.
 *
 * **Never throws.** A list is a thing a surface shows, and a provider that is down must
 * leave the assistant usable — so every failure answers a `fallback` list with the
 * problem named, and the surface says which it is showing.
 */
export async function listModels({ provider, key, endpoint = '', fetchImpl = fetch }: AiModelRequest): Promise<AiModelList> {
  const fallback = FALLBACK_MODELS[provider];
  const asked = key === '' ? null : request(provider, key, endpoint);
  if (asked === null) {
    // NO KEY, no list endpoint, or no Azure resource: all three are "nothing to ask",
    // and they are told apart by the provider's own declaration rather than here.
    return { provider, models: fallback, source: LIST_ENDPOINTS[provider].url === null && provider !== 'azure-openai' ? 'no-list' : 'fallback' };
  }

  let response: Response;
  try {
    response = await fetchImpl(asked.url, { method: 'GET', headers: asked.headers });
  } catch {
    return { provider, models: fallback, source: 'fallback', problem: 'unreachable' };
  }
  if (response.status === 401 || response.status === 403) {
    return { provider, models: fallback, source: 'fallback', problem: 'unauthorised' };
  }
  if (!response.ok) return { provider, models: fallback, source: 'fallback', problem: 'rejected' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { provider, models: fallback, source: 'fallback', problem: 'unreadable' };
  }
  const models = readModels(LIST_ENDPOINTS[provider].shape, body);
  if (models === null || models.length === 0) {
    // AN EMPTY LIST IS NOT A LIST. A provider answering `{data: []}` has told us nothing a
    // person can pick from, and showing an empty picker reads as the feature being broken.
    return { provider, models: fallback, source: 'fallback', problem: 'unreadable' };
  }
  return { provider, models, source: 'fetched' };
}

/** Which providers have no list to fetch, by their own answer — for a surface that says so. */
export const PROVIDERS_WITHOUT_A_LIST: readonly AiProviderId[] = Object.keys(AI_PROVIDERS)
  .filter((id): id is AiProviderId => LIST_ENDPOINTS[id as AiProviderId].url === null && id !== 'azure-openai');
