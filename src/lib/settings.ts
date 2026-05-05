import { EVENT_BUS_URL } from './orchestrator';

export type RuntimeMode = 'local' | 'inference';
export type LegacyRuntimeMode = RuntimeMode | 'web';
export type InferenceProviderId =
  | 'gemini'
  | 'openrouter'
  | 'huggingface'
  | 'cloudflare-workers-ai'
  | 'groq'
  | 'mistral';

export interface InferenceProviderPreset {
  id: InferenceProviderId;
  label: string;
  freeTier: string;
  defaultModel: string;
  apiBaseUrl: string;
  keyEnv: string;
  docsUrl: string;
}

export interface RuntimeSettings {
  mode: RuntimeMode;
  localModel: string;
  localBusUrl: string;
  inferenceProvider: InferenceProviderId;
  inferenceModel: string;
  inferenceBusUrl: string;
  inferenceApiBaseUrl: string;
  inferenceKeyEnv: string;
}

export const SETTINGS_STORAGE_KEY = 'vega-lab:runtime-settings';
export const LEGACY_SETTINGS_STORAGE_KEY = 'git-stars:runtime-settings';
export const SETTINGS_EVENT = 'vega-lab:settings-changed';
export const LEGACY_SETTINGS_EVENT = 'git-stars:settings-changed';
export const PREFERRED_LOCAL_MODEL = 'text/gemma-4-31b-it-4bit';
export const LEGACY_LOCAL_MODEL_DEFAULTS = new Set([
  'text/Meta-Llama-3.1-8B-Instruct-4bit',
  'Meta-Llama-3.1-8B-Instruct-4bit',
]);

export const INFERENCE_PROVIDER_PRESETS: InferenceProviderPreset[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    freeTier: 'Free API tier for supported models; strong default for low-cost deployed testing.',
    defaultModel: 'gemini-2.5-flash',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyEnv: 'GEMINI_API_KEY',
    docsUrl: 'https://ai.google.dev/pricing',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter Free Router',
    freeTier: 'Routes to currently available free community models through openrouter/free.',
    defaultModel: 'openrouter/free',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    docsUrl: 'https://openrouter.ai/docs/guides/routing/routers/free-models-router',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference',
    freeTier: 'Monthly free credits for Inference Providers, then pay as you go.',
    defaultModel: 'meta-llama/Llama-3.1-8B-Instruct',
    apiBaseUrl: 'https://router.huggingface.co/v1',
    keyEnv: 'HF_TOKEN',
    docsUrl: 'https://huggingface.co/docs/inference-providers/pricing',
  },
  {
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    freeTier: 'Daily free allocation on Workers AI, useful when the Event Bus runs at the edge.',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    apiBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/v1',
    keyEnv: 'CLOUDFLARE_API_TOKEN',
    docsUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
  },
  {
    id: 'groq',
    label: 'Groq',
    freeTier: 'Free developer tier for build-and-test workloads with account rate limits.',
    defaultModel: 'llama-3.1-8b-instant',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    docsUrl: 'https://console.groq.com/settings/billing/plans',
  },
  {
    id: 'mistral',
    label: 'Mistral Experiment',
    freeTier: 'Experiment plan can test the API for free after account verification.',
    defaultModel: 'mistral-small-latest',
    apiBaseUrl: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    docsUrl: 'https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan',
  },
];

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  mode: 'local',
  localModel: PREFERRED_LOCAL_MODEL,
  localBusUrl: EVENT_BUS_URL,
  inferenceProvider: 'gemini',
  inferenceModel: 'gemini-2.5-flash',
  inferenceBusUrl: EVENT_BUS_URL,
  inferenceApiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  inferenceKeyEnv: 'GEMINI_API_KEY',
};

type StoredRuntimeSettings = Partial<Omit<RuntimeSettings, 'mode' | 'inferenceProvider'>> & {
  mode?: LegacyRuntimeMode;
  inferenceProvider?: string;
  webModel?: string;
  webBusUrl?: string;
};

function normalizeBusUrl(value?: string): string {
  const trimmed = value?.trim() || '';
  if (!trimmed) return EVENT_BUS_URL;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeMode(value?: LegacyRuntimeMode): RuntimeMode {
  return value === 'inference' || value === 'web' ? 'inference' : 'local';
}

export function getInferenceProviderPreset(provider?: string): InferenceProviderPreset {
  return INFERENCE_PROVIDER_PRESETS.find((entry) => entry.id === provider)
    || INFERENCE_PROVIDER_PRESETS[0];
}

function normalizeProvider(provider?: string): InferenceProviderId {
  return getInferenceProviderPreset(provider).id;
}

function normalizeRuntimeSettings(settings: StoredRuntimeSettings): RuntimeSettings {
  const inferenceProvider = normalizeProvider(settings.inferenceProvider);
  const providerPreset = getInferenceProviderPreset(inferenceProvider);
  const rawLocalModel = settings.localModel?.trim();
  const localModel = !rawLocalModel || LEGACY_LOCAL_MODEL_DEFAULTS.has(rawLocalModel)
    ? PREFERRED_LOCAL_MODEL
    : rawLocalModel;

  return {
    mode: normalizeMode(settings.mode),
    localModel,
    localBusUrl: normalizeBusUrl(settings.localBusUrl || DEFAULT_RUNTIME_SETTINGS.localBusUrl),
    inferenceProvider,
    inferenceModel:
      settings.inferenceModel?.trim()
      || settings.webModel?.trim()
      || providerPreset.defaultModel,
    inferenceBusUrl: normalizeBusUrl(
      settings.inferenceBusUrl || settings.webBusUrl || DEFAULT_RUNTIME_SETTINGS.inferenceBusUrl,
    ),
    inferenceApiBaseUrl:
      settings.inferenceApiBaseUrl?.trim()
      || providerPreset.apiBaseUrl,
    inferenceKeyEnv:
      settings.inferenceKeyEnv?.trim()
      || providerPreset.keyEnv,
  };
}

export function loadRuntimeSettings(): RuntimeSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_RUNTIME_SETTINGS;
  }

  try {
    const currentRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const legacyRaw = window.localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    const raw = currentRaw || legacyRaw;
    if (!raw) return DEFAULT_RUNTIME_SETTINGS;
    const parsed = JSON.parse(raw) as StoredRuntimeSettings;
    const normalized = normalizeRuntimeSettings(parsed);
    if (!currentRaw || parsed.mode === 'web') {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

export function saveRuntimeSettings(settings: RuntimeSettings) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeRuntimeSettings(settings);
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: normalized }));
  window.dispatchEvent(new CustomEvent(LEGACY_SETTINGS_EVENT, { detail: normalized }));
}

export function resolveRuntimeTarget(settings: RuntimeSettings) {
  const isInference = settings.mode === 'inference';
  const busUrl = isInference ? settings.inferenceBusUrl : settings.localBusUrl;
  return {
    busUrl,
    model: isInference ? settings.inferenceModel : settings.localModel,
    mode: settings.mode,
    provider: isInference ? settings.inferenceProvider : 'local',
    responsesPath: '/v1/responses',
    modelsPath: '/v1/models',
    healthPath: '/health',
    modelProfile: isInference ? 'inference' : 'balanced-32gb',
  };
}
