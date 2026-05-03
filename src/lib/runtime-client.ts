export interface RuntimeHealthSummary {
  status: 'live' | 'offline';
  detail: string;
  model?: string;
}

export type RuntimeModelSource = 'served' | 'model-zoo-local' | 'model-zoo-candidate';

export type RuntimeModelStatus = 'served' | 'local-loadable' | 'local-incomplete' | 'registry-candidate';

export interface RuntimeModelOption {
  id: string;
  label: string;
  source: RuntimeModelSource;
  status: RuntimeModelStatus;
  served: boolean;
  downloaded: boolean;
  loadable: boolean;
  localPath?: string;
  sourceId?: string;
  sourceUrl?: string;
  capabilities?: string[];
  aliases?: string[];
  evidence?: string[];
  visibilityClass?: string;
  normalSelectable?: boolean;
  reason?: string | null;
}

export interface RuntimeModelCatalog {
  llmModels: string[];
  servedModels: string[];
  options: RuntimeModelOption[];
  totalModels: number;
  hiddenModels: number;
  zooLocalModels: number;
  zooCandidateModels: number;
  incompleteModels: number;
}

type ModelDescriptor = string | {
  id?: string;
  model?: string;
  name?: string;
  owned_by?: string;
  _audio_lane?: string;
  _service?: string;
};

type GatewayModelCatalog = {
  llmModels: string[];
  totalModels: number;
  hiddenModels: number;
  options?: RuntimeModelOption[];
};

type ModelZooSnapshot = {
  models?: Array<Partial<RuntimeModelOption> & {
    id?: string;
    runtimeId?: string;
    status?: RuntimeModelStatus;
    type?: string;
    task?: string;
  }>;
};

const HIDDEN_MODEL_TERMS = ['llasa', 'nsfw', 'abliterated', 'utena'];

function isProductionEligibleModelId(id: string): boolean {
  const lowered = id.toLowerCase();
  return !HIDDEN_MODEL_TERMS.some((term) => lowered.includes(term));
}

function isLlmModel(item: ModelDescriptor): boolean {
  if (typeof item === 'string') return isProductionEligibleModelId(item);
  const id = item.id || item.model || item.name || '';
  if (!isProductionEligibleModelId(id)) return false;
  if (item._audio_lane || item.owned_by === 'mlx-audio') return false;
  return item._service === 'mlx-llm' || id.startsWith('text/') || (!item._service && Boolean(id));
}

function getModelList(data: unknown): ModelDescriptor[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { models?: unknown[] } | null)?.models)
      ? (data as { models: unknown[] }).models
      : Array.isArray((data as { data?: unknown[] } | null)?.data)
        ? (data as { data: unknown[] }).data
        : [];

  return list as ModelDescriptor[];
}

function normalizeModelList(data: unknown): GatewayModelCatalog {
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown[] }).data)) {
    const candidate = data as { data: unknown[]; hidden_models?: number; model_profile?: string };
    const isPolicyCatalog = Boolean(candidate.model_profile || candidate.hidden_models)
      || candidate.data.some((model) => (
        model !== null
        && typeof model === 'object'
        && ('served' in model || 'status' in model || 'loadable' in model)
      ));
    if (!isPolicyCatalog) return normalizePlainModelList(data);

    const payload = data as { data: Array<Partial<RuntimeModelOption> & { object?: string; owned_by?: string; status?: RuntimeModelStatus }>; hidden_models?: number };
    const options = payload.data
      .map((model): RuntimeModelOption | null => {
        const id = model.id || '';
        if (!id || !isProductionEligibleModelId(id)) return null;
        const capabilities = (model.capabilities || []).map(String).join(',').toLowerCase();
        if (capabilities.includes('embedding')) return null;
        const status: RuntimeModelStatus = model.status || (model.served ? 'served' : model.loadable ? 'local-loadable' : 'registry-candidate');
        if (status === 'local-incomplete') return null;
        const source: RuntimeModelSource = model.served ? 'served' : statusToSource(status);
        return {
          id,
          label: model.label || id.replace(/^text\//, ''),
          source,
          status,
          served: Boolean(model.served),
          downloaded: Boolean(model.downloaded || model.served),
          loadable: Boolean(model.loadable || model.served),
          localPath: model.localPath || (model as { local_path?: string }).local_path,
          sourceId: model.sourceId || (model as { source_id?: string }).source_id,
          sourceUrl: model.sourceUrl || (model as { source_url?: string }).source_url,
          capabilities: model.capabilities || [],
          aliases: model.aliases || [id, id.replace(/^text\//, '')],
          evidence: model.evidence || [`Reported by gateway /v1/models as ${status}`],
          visibilityClass: (model as { visibility_class?: string }).visibility_class,
          normalSelectable: (model as { normal_selectable?: boolean }).normal_selectable,
          reason: (model as { reason?: string | null }).reason,
        } satisfies RuntimeModelOption;
      })
      .filter((model): model is RuntimeModelOption => Boolean(model));

    return {
      llmModels: options.map((model) => model.id),
      totalModels: payload.data.length,
      hiddenModels: Math.max(Number(payload.hidden_models || 0), payload.data.length - options.length),
      options,
    };
  }

  return normalizePlainModelList(data);
}

function normalizePlainModelList(data: unknown): GatewayModelCatalog {
  const list = getModelList(data);
  const llmModels = list
    .filter(isLlmModel)
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.model || item?.name || null))
    .filter((item): item is string => Boolean(item));

  return {
    llmModels,
    totalModels: list.length,
    hiddenModels: Math.max(0, list.length - llmModels.length),
  };
}

function createEmptyGatewayCatalog(): GatewayModelCatalog {
  return {
    llmModels: [],
    totalModels: 0,
    hiddenModels: 0,
  };
}

function createEmptyRuntimeModelCatalog(): RuntimeModelCatalog {
  return {
    llmModels: [],
    servedModels: [],
    options: [],
    totalModels: 0,
    hiddenModels: 0,
    zooLocalModels: 0,
    zooCandidateModels: 0,
    incompleteModels: 0,
  };
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return response.json() as Promise<unknown>;
  } catch {
    return null;
  }
}

function modelMatches(option: RuntimeModelOption, modelId: string): boolean {
  if (option.id === modelId) return true;
  if (option.aliases?.includes(modelId)) return true;
  return option.id.endsWith(`/${modelId}`) || modelId.endsWith(`/${option.id}`);
}

function statusToSource(status?: RuntimeModelStatus): RuntimeModelSource {
  if (status === 'local-loadable' || status === 'local-incomplete') return 'model-zoo-local';
  return 'model-zoo-candidate';
}

function mergeModelOptions(
  servedModels: string[],
  snapshot: ModelZooSnapshot | null,
): RuntimeModelOption[] {
  const options: RuntimeModelOption[] = [];

  for (const servedModel of servedModels) {
    if (!isProductionEligibleModelId(servedModel)) continue;
    options.push({
      id: servedModel,
      label: servedModel.replace(/^text\//, ''),
      source: 'served',
      status: 'served',
      served: true,
      downloaded: true,
      loadable: true,
      aliases: [servedModel, servedModel.replace(/^text\//, '')],
      evidence: ['Reported by OpenResponses model discovery'],
      visibilityClass: 'served',
      normalSelectable: true,
      reason: null,
    });
  }

  const zooModels = Array.isArray(snapshot?.models) ? snapshot.models : [];
  for (const zooModel of zooModels) {
    const id = zooModel.runtimeId || zooModel.id;
    if (!id) continue;
    const loweredType = String(zooModel.type || '').toLowerCase();
    const loweredTask = String(zooModel.task || '').toLowerCase();
    const capabilities = (zooModel.capabilities || []).map(String).join(',').toLowerCase();
    if (!isProductionEligibleModelId(id)) continue;
    if (loweredType === 'embedding' || loweredTask.includes('embedding') || capabilities.includes('embedding')) continue;
    const status = zooModel.status || (zooModel.loadable ? 'local-loadable' : 'registry-candidate');
    if (status === 'local-incomplete') continue;
    const existing = options.find((option) => modelMatches(option, id));
    const aliases = Array.from(new Set([
      ...(existing?.aliases || []),
      ...(zooModel.aliases || []),
      id,
      id.replace(/^text\//, ''),
    ]));
    const source = statusToSource(status);

    if (existing) {
      existing.label = zooModel.label || existing.label;
      existing.source = 'served';
      existing.status = 'served';
      existing.downloaded = Boolean(zooModel.downloaded || existing.downloaded);
      existing.loadable = Boolean(zooModel.loadable || existing.loadable);
      existing.localPath = zooModel.localPath || existing.localPath;
      existing.sourceId = zooModel.sourceId || existing.sourceId;
      existing.sourceUrl = zooModel.sourceUrl || existing.sourceUrl;
      existing.capabilities = Array.from(new Set([...(existing.capabilities || []), ...(zooModel.capabilities || [])]));
      existing.aliases = aliases;
      existing.evidence = Array.from(new Set([...(existing.evidence || []), ...(zooModel.evidence || [])]));
      continue;
    }

    options.push({
      id,
      label: zooModel.label || id.replace(/^text\//, ''),
      source,
      status,
      served: false,
      downloaded: Boolean(zooModel.downloaded),
      loadable: Boolean(zooModel.loadable),
      localPath: zooModel.localPath,
      sourceId: zooModel.sourceId,
      sourceUrl: zooModel.sourceUrl,
      capabilities: zooModel.capabilities || [],
      aliases,
      evidence: zooModel.evidence || ['Known by Vega Lab model-zoo snapshot'],
      visibilityClass: (zooModel as { visibilityClass?: string }).visibilityClass,
      normalSelectable: (zooModel as { normalSelectable?: boolean }).normalSelectable,
      reason: (zooModel as { reason?: string | null }).reason,
    });
  }

  const rank: Record<RuntimeModelStatus, number> = {
    served: 0,
    'local-loadable': 1,
    'local-incomplete': 2,
    'registry-candidate': 3,
  };

  return options.sort((a, b) => rank[a.status] - rank[b.status] || a.id.localeCompare(b.id));
}

function countIncompleteSnapshotModels(snapshot: ModelZooSnapshot | null): number {
  const zooModels = Array.isArray(snapshot?.models) ? snapshot.models : [];
  return zooModels.filter((model) => {
    const id = model.runtimeId || model.id || '';
    const capabilities = (model.capabilities || []).map(String).join(',').toLowerCase();
    return model.status === 'local-incomplete'
      && isProductionEligibleModelId(id)
      && String(model.type || '').toLowerCase() !== 'embedding'
      && !String(model.task || '').toLowerCase().includes('embedding')
      && !capabilities.includes('embedding');
  }).length;
}

async function fetchModelZooSnapshot(): Promise<ModelZooSnapshot | null> {
  const snapshot = await fetchJson('/model-zoo-text-models.json');
  if (!snapshot || typeof snapshot !== 'object') return null;
  return snapshot as ModelZooSnapshot;
}

export async function fetchRuntimeModels(busUrl: string): Promise<string[]> {
  const catalog = await fetchRuntimeModelCatalog(busUrl);
  return catalog.llmModels;
}

export async function fetchRuntimeModelCatalog(busUrl: string): Promise<RuntimeModelCatalog> {
  let gatewayCatalog = createEmptyGatewayCatalog();

  for (const path of [`${busUrl}/v1/models`, `${busUrl}/models?task_kind=llm`]) {
    const data = await fetchJson(path);
    const catalog = normalizeModelList(data);
    if (catalog.llmModels.length > 0 || catalog.totalModels > 0) {
      gatewayCatalog = catalog;
      break;
    }
  }

  const snapshot = await fetchModelZooSnapshot();
  const options = gatewayCatalog.options?.length
    ? gatewayCatalog.options
    : mergeModelOptions(gatewayCatalog.llmModels, snapshot);
  const incompleteModels = countIncompleteSnapshotModels(snapshot);
  if (options.length === 0) return createEmptyRuntimeModelCatalog();

  return {
    llmModels: options.map((option) => option.id),
    servedModels: gatewayCatalog.llmModels,
    options,
    totalModels: gatewayCatalog.totalModels,
    hiddenModels: gatewayCatalog.hiddenModels,
    zooLocalModels: options.filter((option) => option.status === 'local-loadable').length,
    zooCandidateModels: options.filter((option) => option.source === 'model-zoo-candidate').length,
    incompleteModels,
  };
}

export async function fetchRuntimeHealth(busUrl: string): Promise<RuntimeHealthSummary> {
  const health = await fetchJson(`${busUrl}/health`);
  if (health && typeof health === 'object') {
    const payload = health as {
      status?: string;
      service?: string;
      current_model?: string;
      services?: Record<string, { status?: string; current_model?: string }>;
      dependencies?: Record<string, { status?: string; current_model?: string }>;
    };
    const llm = payload.services?.['mlx-llm'] || payload.dependencies?.['mlx-llm'];
    const model = llm?.current_model;
    const llmStatus = llm?.status ? `; mlx-llm ${llm.status}` : '';
    return {
      status: payload.status === 'healthy' ? 'live' : 'offline',
      detail: `${payload.service || 'MLX OpenResponses gateway'} ${payload.status || 'reachable'}${llmStatus}`,
      model: payload.current_model || model,
    };
  }

  const settings = await fetchJson(`${busUrl}/settings`);
  if (settings && typeof settings === 'object') {
    const defaultModel =
      'models' in settings
      && settings.models
      && typeof settings.models === 'object'
      && 'default_model' in settings.models
      && typeof settings.models.default_model === 'string'
        ? settings.models.default_model
        : undefined;
    return {
      status: 'live',
      detail: 'OpenResponses settings endpoint ready',
      model: defaultModel,
    };
  }

  return {
    status: 'offline',
    detail: `${busUrl}/health and ${busUrl}/settings unavailable`,
  };
}
