export interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  icon: string;
}

export interface WebsitePersona {
  hostname: string;
  personaId: string | 'random';
}

export interface Draft {
  id: string;
  title: string;
  originalText: string;
  rewrittenText: string;
  personaId: string;
  personaName: string;
  timestamp: number;
}

export interface UsageStat {
  date: string; // YYYY-MM-DD
  count: number;
  charactersProcessed: number;
  personaUsage: Record<string, number>;
}

export interface StorageData {
  websitePersonas: WebsitePersona[];
  drafts: Draft[];
  usageStats: UsageStat[];
  selectedPersonaId: string | 'random';
}
