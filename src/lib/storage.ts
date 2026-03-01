import type { StorageData, Draft, WebsitePersona, UsageStat } from '../types/index.js';

const MAX_DRAFTS = 50;
const USAGE_STATS_RETENTION_DAYS = 30;

const DEFAULT_STORAGE: StorageData = {
  websitePersonas: [],
  drafts: [],
  usageStats: [],
  selectedPersonaId: 'random',
};

export async function getStorage(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_STORAGE, (result) => {
      resolve(result as StorageData);
    });
  });
}

export async function setStorage(data: Partial<StorageData>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

export async function getWebsitePersona(hostname: string): Promise<string> {
  const data = await getStorage();
  const found = data.websitePersonas.find((wp) => wp.hostname === hostname);
  return found?.personaId ?? data.selectedPersonaId;
}

export async function setWebsitePersona(hostname: string, personaId: string): Promise<void> {
  const data = await getStorage();
  const existing = data.websitePersonas.findIndex((wp) => wp.hostname === hostname);
  if (existing >= 0) {
    data.websitePersonas[existing].personaId = personaId;
  } else {
    data.websitePersonas.push({ hostname, personaId });
  }
  await setStorage({ websitePersonas: data.websitePersonas });
}

export async function removeWebsitePersona(hostname: string): Promise<void> {
  const data = await getStorage();
  data.websitePersonas = data.websitePersonas.filter((wp) => wp.hostname !== hostname);
  await setStorage({ websitePersonas: data.websitePersonas });
}

export async function saveDraft(draft: Omit<Draft, 'id' | 'timestamp'>): Promise<Draft> {
  const data = await getStorage();
  const newDraft: Draft = {
    ...draft,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  data.drafts = [newDraft, ...data.drafts].slice(0, MAX_DRAFTS);
  await setStorage({ drafts: data.drafts });
  return newDraft;
}

export async function deleteDraft(id: string): Promise<void> {
  const data = await getStorage();
  data.drafts = data.drafts.filter((d) => d.id !== id);
  await setStorage({ drafts: data.drafts });
}

export async function recordUsage(personaId: string, charactersProcessed: number): Promise<void> {
  const data = await getStorage();
  const today = new Date().toISOString().split('T')[0];
  const existing = data.usageStats.find((s) => s.date === today);
  if (existing) {
    existing.count += 1;
    existing.charactersProcessed += charactersProcessed;
    existing.personaUsage[personaId] = (existing.personaUsage[personaId] ?? 0) + 1;
  } else {
    data.usageStats.push({
      date: today,
      count: 1,
      charactersProcessed,
      personaUsage: { [personaId]: 1 },
    });
  }
  data.usageStats = data.usageStats.slice(-USAGE_STATS_RETENTION_DAYS);
  await setStorage({ usageStats: data.usageStats });
}
