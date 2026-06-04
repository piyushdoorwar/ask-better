// Model dropdown source of truth for the popup & options pages (loaded before
// popup.js / options.js).
//
// There is NO hardcoded model list. Dropdowns are populated purely from each
// provider's live catalogue (`GET /v1/models`, via the background worker), which
// is filtered down to the "main" general-purpose chat models by regex in
// background.js (see isMain*Model) so newer flagship models appear automatically
// and noise — embeddings, audio/TTS, vision, image/video, experimental builds,
// dated snapshots — is dropped. The live list is cached in chrome.storage.local
// for 24h, i.e. at most one network call per provider per day.
//
// The only per-provider constant kept anywhere is the single seed model in each
// DEFAULT_SETTINGS (a bootstrap value used before the first fetch / offline);
// once a live list loads, chooseModel() self-heals a stale or missing selection.

const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Live models discovered for this page session (provider -> string[]).
const MODELS_LIVE = { gemini: [], openai: [], anthropic: [] };

function normalizeModelProvider(value) {
  const provider = String(value || "").toLowerCase();
  return provider === "openai" || provider === "anthropic" ? provider : "gemini";
}

// The live, filtered model list we currently hold for a provider (may be empty
// before the first fetch, offline, or without a key).
function getProviderModels(provider) {
  const list = MODELS_LIVE[normalizeModelProvider(provider)];
  return Array.isArray(list) ? list.slice() : [];
}

// Which model the dropdown should land on: keep the stored choice when it's still
// offered, otherwise fall back to the newest live model (list is sorted newest
// first), otherwise keep whatever was stored (so nothing is lost offline).
function chooseModel(models, storedModel) {
  const stored = String(storedModel || "").trim();
  if (Array.isArray(models) && models.length) {
    if (stored && models.includes(stored)) return stored;
    return models[0];
  }
  return stored;
}

async function readModelCache() {
  try {
    const stored = await chrome.storage.local.get(["modelCache"]);
    return stored && stored.modelCache && typeof stored.modelCache === "object" ? stored.modelCache : {};
  } catch (_e) {
    return {};
  }
}

function fetchLiveModels(provider) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ASKBETTER_FETCH_MODELS", payload: { provider } },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response && response.ok && Array.isArray(response.models) ? response.models : null);
        }
      );
    } catch (_e) {
      resolve(null);
    }
  });
}

// Loads the live model list for a provider into MODELS_LIVE, hitting the provider
// only when the 24h cache is stale and a key is stored (the background worker
// resolves the key and short-circuits without a network call when none exists).
// Always resolves to the list it ended up with (possibly empty).
async function refreshProviderModels(provider) {
  const p = normalizeModelProvider(provider);
  const cache = await readModelCache();
  const entry = cache[p];
  const cached = entry && Array.isArray(entry.models) ? entry.models : null;
  const fresh = entry && typeof entry.ts === "number" && (Date.now() - entry.ts) < MODEL_CACHE_TTL_MS;

  if (fresh && cached) {
    MODELS_LIVE[p] = cached;
    return getProviderModels(p);
  }

  const live = await fetchLiveModels(p);
  if (live && live.length) {
    MODELS_LIVE[p] = live;
    cache[p] = { models: live, ts: Date.now() };
    try {
      await chrome.storage.local.set({ modelCache: cache });
    } catch (_e) {}
    return getProviderModels(p);
  }

  // Fetch unavailable (no/invalid key or offline) — keep the last known list.
  MODELS_LIVE[p] = cached || [];
  return getProviderModels(p);
}
