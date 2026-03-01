<script lang="ts">
  import { onMount } from 'svelte';
  import { PERSONAS, RANDOM_PERSONA_ID } from '../lib/personas.js';
  import {
    getStorage,
    setStorage,
    setWebsitePersona,
    removeWebsitePersona,
    saveDraft,
    deleteDraft,
    recordUsage,
    resetUsageStats,
    saveCustomPersona,
    deleteDefaultPersona,
    deleteCustomPersona,
    restoreDefaults,
  } from '../lib/storage.js';
  import { loadModel, rewriteText, isModelLoaded } from '../lib/transformer.js';
  import type { Draft, UsageStat, WebsitePersona, Persona } from '../types/index.js';
  import type { RiskSignal } from '../lib/risk.js';

  type Tab = 'transform' | 'drafts' | 'websites' | 'stats';

  let activeTab: Tab = $state('transform');
  let inputText = $state('');
  let outputText = $state('');
  let selectedPersonaId = $state<string>('random');
  let isConverting = $state(false);
  let convertCompleted = $state(false);
  let modelStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let modelProgress = $state(0);
  let modelStatusText = $state('');
  let currentHostname = $state<string | null>(null);

  // Quality metrics from last conversion
  let lastRisk = $state(0);
  let lastConfidence = $state(0);
  let lastDivergence = $state(0);
  let lastRounds = $state(0);
  let lastSignals = $state<RiskSignal[]>([]);

  let riskLevel = $derived(
    lastRisk >= 0.75 ? 'critical' :
    lastRisk >= 0.50 ? 'high' :
    lastRisk >= 0.25 ? 'medium' : 'low'
  );

  let drafts = $state<Draft[]>([]);
  let websitePersonas = $state<WebsitePersona[]>([]);
  let newWebsite = $state('');
  let newWebsitePersona = $state('random');
  let usageStats = $state<UsageStat[]>([]);

  let customPersonas = $state<Persona[]>([]);
  let deletedDefaultPersonaIds = $state<string[]>([]);

  // Create-persona form state
  let showCreateForm = $state(false);
  let newPersonaName = $state('');
  let newPersonaIcon = $state('🤖');
  let newPersonaDesc = $state('');
  let newPersonaPrompt = $state('');

  let inputWordCount = $derived(
    inputText.trim() === '' ? 0 : inputText.trim().split(/\s+/).length
  );
  let outputWordCount = $derived(
    outputText.trim() === '' ? 0 : outputText.trim().split(/\s+/).length
  );

  // Active personas = defaults minus deleted + custom
  let activePersonas = $derived([
    ...PERSONAS.filter((p) => !deletedDefaultPersonaIds.includes(p.id)),
    ...customPersonas,
  ]);

  // Total usage count per persona across all usage stats (active personas only)
  let personaUsageCounts = $derived(
    Object.fromEntries(
      activePersonas.map((p) => [
        p.id,
        usageStats.reduce((sum, s) => sum + (s.personaUsage[p.id] ?? 0), 0),
      ])
    ) as Record<string, number>
  );

  // Personas sorted by usage count descending
  let sortedPersonas = $derived(
    [...activePersonas].sort(
      (a, b) => (personaUsageCounts[b.id] ?? 0) - (personaUsageCounts[a.id] ?? 0)
    )
  );

  function findPersona(id: string): Persona | undefined {
    return activePersonas.find((p) => p.id === id) ?? PERSONAS.find((p) => p.id === id);
  }

  let activePersona = $derived(
    selectedPersonaId === 'random' ? null : findPersona(selectedPersonaId)
  );

  // Track the last persona actually used for a conversion so draft saves are consistent
  let lastUsedPersonaId = $state<string | null>(null);

  let totalTransforms = $derived(usageStats.reduce((sum, s) => sum + s.count, 0));
  let totalChars = $derived(usageStats.reduce((sum, s) => sum + s.charactersProcessed, 0));
  let maxStatCount = $derived(usageStats.length > 0 ? Math.max(...usageStats.map((s) => s.count)) : 1);

  onMount(async () => {
    const data = await getStorage();
    selectedPersonaId = data.selectedPersonaId;
    drafts = data.drafts;
    websitePersonas = data.websitePersonas;
    usageStats = data.usageStats;
    customPersonas = data.customPersonas ?? [];
    deletedDefaultPersonaIds = data.deletedDefaultPersonaIds ?? [];

    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_HOSTNAME' }, (response) => {
      if (response?.hostname) {
        currentHostname = response.hostname;
        const wp = data.websitePersonas.find((w) => w.hostname === response.hostname);
        if (wp) {
          selectedPersonaId = wp.personaId;
        }
      }
    });

    await initModel();
  });

  async function initModel() {
    if (isModelLoaded()) {
      modelStatus = 'ready';
      return;
    }
    modelStatus = 'loading';
    modelStatusText = 'Initializing model...';
    try {
      await loadModel((progress) => {
        modelStatusText = progress.file
          ? `Loading ${progress.file}...`
          : progress.status;
        if (progress.progress !== undefined) {
          modelProgress = Math.round(progress.progress * 100);
        }
      });
      modelStatus = 'ready';
      modelStatusText = 'Model ready';
    } catch (e) {
      modelStatus = 'error';
      modelStatusText = 'Model failed to load';
      console.error('Model load error:', e);
    }
  }

  async function handleConvert() {
    if (!inputText.trim() || isConverting) return;
    if (modelStatus !== 'ready') {
      await initModel();
    }

    isConverting = true;
    // Reset quality metrics so stale data from a previous run never shows
    lastRisk = 0;
    lastConfidence = 0;
    lastDivergence = 0;
    lastRounds = 0;
    lastSignals = [];
    convertCompleted = false;
    try {
      const pool = sortedPersonas.length > 0 ? sortedPersonas : PERSONAS;
      const persona =
        selectedPersonaId === RANDOM_PERSONA_ID
          ? pool[Math.floor(Math.random() * pool.length)]
          : findPersona(selectedPersonaId)!;
      lastUsedPersonaId = persona.id;
      const result = await rewriteText(inputText, persona.systemPrompt);
      outputText = result.output;
      lastRisk = result.riskScore;
      lastConfidence = result.confidence;
      lastDivergence = result.divergence;
      lastRounds = result.rounds;
      lastSignals = result.signals;
      convertCompleted = true;
      await recordUsage(persona.id, inputText.length);
      const data = await getStorage();
      usageStats = data.usageStats;
    } catch (e) {
      console.error('Rewrite error:', e);
      outputText = 'Error: Failed to rewrite text. Please try again.';
    } finally {
      isConverting = false;
    }
  }

  async function handleCopy() {
    if (!outputText) return;
    await navigator.clipboard.writeText(outputText);
  }

  async function handleSaveDraft() {
    if (!inputText.trim() || !outputText.trim()) return;
    const pool = sortedPersonas.length > 0 ? sortedPersonas : PERSONAS;
    const resolvedId =
      lastUsedPersonaId ??
      (selectedPersonaId === RANDOM_PERSONA_ID
        ? pool[Math.floor(Math.random() * pool.length)].id
        : selectedPersonaId);
    const persona = findPersona(resolvedId)!;
    await saveDraft({
      title: inputText.slice(0, 50) + (inputText.length > 50 ? '...' : ''),
      originalText: inputText,
      rewrittenText: outputText,
      personaId: persona.id,
      personaName: persona.name,
    });
    const data = await getStorage();
    drafts = data.drafts;
  }

  async function handleSelectPersona(id: string) {
    selectedPersonaId = id;
    await setStorage({ selectedPersonaId: id });
  }

  $effect(() => {
    if (activeTab === 'websites') {
      newWebsite = currentHostname ?? '';
      newWebsitePersona = selectedPersonaId;
    }
  });

  async function handleDeleteDraft(id: string) {
    await deleteDraft(id);
    const data = await getStorage();
    drafts = data.drafts;
  }

  function handleLoadDraft(draft: Draft) {
    inputText = draft.originalText;
    outputText = draft.rewrittenText;
    // Reset quality card — metrics for this draft are unknown
    convertCompleted = false;
    lastRisk = 0;
    lastConfidence = 0;
    lastDivergence = 0;
    lastRounds = 0;
    lastSignals = [];
    activeTab = 'transform';
  }

  async function handleAddWebsite() {
    if (!newWebsite.trim()) return;
    const hostname = newWebsite.trim().replace(/^https?:\/\//, '').split('/')[0];
    await setWebsitePersona(hostname, newWebsitePersona);
    const data = await getStorage();
    websitePersonas = data.websitePersonas;
    newWebsite = '';
    newWebsitePersona = 'random';
  }

  async function handleRemoveWebsite(hostname: string) {
    await removeWebsitePersona(hostname);
    const data = await getStorage();
    websitePersonas = data.websitePersonas;
  }

  async function handleCreatePersona() {
    if (!newPersonaName.trim() || !newPersonaPrompt.trim()) return;
    const persona: Persona = {
      id: `custom-${crypto.randomUUID()}`,
      name: newPersonaName.trim(),
      icon: newPersonaIcon.trim() || '🤖',
      description: newPersonaDesc.trim(),
      systemPrompt: newPersonaPrompt.trim(),
    };
    await saveCustomPersona(persona);
    const data = await getStorage();
    customPersonas = data.customPersonas;
    newPersonaName = '';
    newPersonaIcon = '🤖';
    newPersonaDesc = '';
    newPersonaPrompt = '';
    showCreateForm = false;
  }

  async function handleDeletePersona(id: string) {
    const isDefault = PERSONAS.some((p) => p.id === id);
    if (isDefault) {
      await deleteDefaultPersona(id);
      const data = await getStorage();
      deletedDefaultPersonaIds = data.deletedDefaultPersonaIds;
    } else {
      await deleteCustomPersona(id);
      const data = await getStorage();
      customPersonas = data.customPersonas;
    }
    if (selectedPersonaId === id) {
      await handleSelectPersona('random');
    }
  }

  async function handleRestoreDefaults() {
    await restoreDefaults();
    deletedDefaultPersonaIds = [];
    customPersonas = [];
    if (!PERSONAS.some((p) => p.id === selectedPersonaId)) {
      await handleSelectPersona('random');
    }
  }

  async function handleResetStats() {
    if (!confirm('Reset all usage stats? This cannot be undone.')) return;
    await resetUsageStats();
    usageStats = [];
  }

  function formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  function getTopPersonaForStat(stat: UsageStat): string {
    const entries = Object.entries(stat.personaUsage);
    if (entries.length === 0) return 'None';
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return findPersona(top[0])?.name ?? top[0];
  }
</script>

<div class="app">
  <!-- ─── Header ──────────────────────────────────────────────────────────── -->
  <header>
    <div class="header-row">
      <div class="brand">
        <span class="brand-icon">🎭</span>
        <span class="brand-name">Persona</span>
      </div>
      <div class="header-right">
        {#if currentHostname}
          <span class="hostname-chip">{currentHostname}</span>
        {/if}
        <div class="status-pill" class:status-ready={modelStatus === 'ready'} class:status-loading={modelStatus === 'loading'} class:status-error={modelStatus === 'error'}>
          <span class="status-dot"></span>
          {#if modelStatus === 'loading'}
            {modelProgress > 0 ? `${modelProgress}%` : 'Loading…'}
          {:else if modelStatus === 'ready'}
            Ready
          {:else if modelStatus === 'error'}
            Error
            <button class="retry-btn" onclick={initModel}>↺</button>
          {:else}
            Idle
          {/if}
        </div>
      </div>
    </div>
    {#if modelStatus === 'loading'}
      <div class="load-bar-track">
        <div class="load-bar-fill" style="width: {modelProgress}%"></div>
      </div>
    {/if}
  </header>

  <!-- ─── Persona bar ──────────────────────────────────────────────────────── -->
  <div class="persona-section">
    <div class="persona-bar-header">
      <span class="section-eyebrow">Persona</span>
      <div class="persona-bar-actions">
        <button class="ghost-btn ghost-accent" onclick={() => (showCreateForm = !showCreateForm)}>
          {showCreateForm ? '✕ Cancel' : '+ New'}
        </button>
        <button class="ghost-btn" onclick={handleRestoreDefaults} title="Restore defaults">↺</button>
      </div>
    </div>
    <div class="persona-pills">
      <button class="pill" class:active={selectedPersonaId === 'random'} onclick={() => handleSelectPersona('random')}>
        🎲 Random
      </button>
      {#each sortedPersonas as persona (persona.id)}
        {@const count = personaUsageCounts[persona.id] ?? 0}
        <div class="pill-group">
          <button
            class="pill pill-main"
            class:active={selectedPersonaId === persona.id}
            onclick={() => handleSelectPersona(persona.id)}
            title={persona.description}
          >
            {persona.icon} {persona.name}{#if count > 0}<span class="pill-count"> {count}</span>{/if}
          </button>
          <button
            class="pill pill-del"
            class:active={selectedPersonaId === persona.id}
            onclick={() => handleDeletePersona(persona.id)}
            aria-label="Delete persona"
          >×</button>
        </div>
      {/each}
    </div>

    {#if showCreateForm}
      <div class="create-form">
        <span class="section-eyebrow" style="color: #a78bfa">New persona</span>
        <div class="create-form-row">
          <input class="input create-icon-input" bind:value={newPersonaIcon} placeholder="🤖" maxlength="4" aria-label="Icon" />
          <input class="input" style="flex:1" bind:value={newPersonaName} placeholder="Name" aria-label="Name" />
        </div>
        <input class="input" bind:value={newPersonaDesc} placeholder="Short description" aria-label="Description" />
        <textarea class="text-area create-prompt" bind:value={newPersonaPrompt} placeholder="System prompt — describe how this persona writes…" aria-label="System prompt"></textarea>
        <div class="create-form-actions">
          <button class="btn btn-primary btn-small" onclick={handleCreatePersona} disabled={!newPersonaName.trim() || !newPersonaPrompt.trim()}>Save</button>
          <button class="btn btn-ghost btn-small" onclick={() => (showCreateForm = false)}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>

  <!-- ─── Tabs ─────────────────────────────────────────────────────────────── -->
  <nav class="tabs">
    <button class:active={activeTab === 'transform'} onclick={() => (activeTab = 'transform')}>Transform</button>
    <button class:active={activeTab === 'drafts'} onclick={() => (activeTab = 'drafts')}>
      Drafts{#if drafts.length > 0} <span class="tab-badge">{drafts.length}</span>{/if}
    </button>
    <button class:active={activeTab === 'websites'} onclick={() => (activeTab = 'websites')}>
      Sites{#if websitePersonas.length > 0} <span class="tab-badge">{websitePersonas.length}</span>{/if}
    </button>
    <button class:active={activeTab === 'stats'} onclick={() => (activeTab = 'stats')}>Stats</button>
  </nav>

  <!-- ─── Main content ─────────────────────────────────────────────────────── -->
  <main>
    {#if activeTab === 'transform'}
      <div class="transform-tab">

        <!-- Input -->
        <div class="text-section">
          <div class="section-header">
            <label for="input-text">Input</label>
            <span class="word-count">{inputWordCount} words</span>
          </div>
          <textarea
            id="input-text"
            bind:value={inputText}
            placeholder="Paste or type your text here…"
            class="text-area"
          ></textarea>
        </div>

        <!-- Convert action row -->
        <div class="action-row">
          <div class="persona-chip">
            {#if selectedPersonaId === 'random'}
              <span>🎲 <span class="chip-label">Random</span></span>
            {:else if activePersona}
              <span>{activePersona.icon} <span class="chip-label">{activePersona.name}</span></span>
            {/if}
          </div>
          <button
            class="btn btn-primary btn-convert"
            onclick={handleConvert}
            disabled={isConverting || !inputText.trim() || modelStatus === 'error'}
          >
            {#if isConverting}
              <span class="spinner"></span> Transforming…
            {:else}
              ✨ Transform
            {/if}
          </button>
        </div>

        <!-- Output -->
        <div class="text-section">
          <div class="section-header">
            <label for="output-text">Output</label>
            <span class="word-count">{outputWordCount} words</span>
          </div>
          <textarea
            id="output-text"
            bind:value={outputText}
            placeholder="Transformed text will appear here…"
            class="text-area"
            readonly={isConverting}
          ></textarea>
        </div>

        <!-- Quality card – always shown after first conversion -->
        {#if convertCompleted && outputText}
          <div class="quality-card risk-{riskLevel}">
            <div class="quality-header">
              <span class="quality-title">🛡️ Transform quality</span>
              <span class="risk-badge risk-badge-{riskLevel}">{riskLevel.toUpperCase()}</span>
            </div>

            <div class="quality-metrics">
              <div class="metric-row">
                <span class="metric-label">Confidence</span>
                <div class="metric-track">
                  <div class="metric-fill" style="width: {(lastConfidence * 100).toFixed(0)}%" class:fill-good={lastConfidence >= 0.7} class:fill-warn={lastConfidence >= 0.4 && lastConfidence < 0.7} class:fill-bad={lastConfidence < 0.4}></div>
                </div>
                <span class="metric-value">{(lastConfidence * 100).toFixed(0)}%</span>
              </div>
              <div class="metric-row">
                <span class="metric-label">Divergence</span>
                <div class="metric-track">
                  <div class="metric-fill" style="width: {(lastDivergence * 100).toFixed(0)}%" class:fill-good={lastDivergence >= 0.7} class:fill-warn={lastDivergence >= 0.4 && lastDivergence < 0.7} class:fill-bad={lastDivergence < 0.4}></div>
                </div>
                <span class="metric-value">{(lastDivergence * 100).toFixed(0)}%</span>
              </div>
            </div>

            {#if lastRounds > 1}
              <div class="rounds-note">↺ Rewrote {lastRounds}× to reach divergence target</div>
            {/if}

            {#if lastSignals.length > 0}
              <div class="signal-list">
                {#each lastSignals as signal (signal.name)}
                  <span class="signal-tag">{signal.label}{#if signal.count > 1} ×{signal.count}{/if}</span>
                {/each}
              </div>
            {:else}
              <p class="no-signals">No risk signals detected in output</p>
            {/if}
          </div>
        {/if}

        <!-- Output actions -->
        <div class="output-actions">
          {#if convertCompleted && outputText}
            <button class="btn btn-secondary" onclick={handleSaveDraft} disabled={!inputText}>
              💾 Save
            </button>
          {/if}
          <button class="btn btn-primary" onclick={handleCopy} disabled={!outputText}>
            📋 Copy
          </button>
        </div>

      </div>

    {:else if activeTab === 'drafts'}
      <div class="content-tab">
        {#if drafts.length === 0}
          <div class="empty-state">
            <span class="empty-icon">💾</span>
            <p>No drafts saved yet</p>
            <p class="hint">Convert text then hit Save to store it here</p>
          </div>
        {:else}
          <div class="item-list">
            {#each drafts as draft (draft.id)}
              <div class="item-card">
                <div class="item-card-header">
                  <span class="item-title">{draft.title}</span>
                  <span class="item-meta">{findPersona(draft.personaId)?.icon ?? '🎭'} {draft.personaName} · {new Date(draft.timestamp).toLocaleDateString()}</span>
                </div>
                <p class="item-preview">{draft.rewrittenText.slice(0, 100)}…</p>
                <div class="item-actions">
                  <button class="btn btn-secondary btn-small" onclick={() => handleLoadDraft(draft)}>Load</button>
                  <button class="btn btn-danger btn-small" onclick={() => handleDeleteDraft(draft.id)}>Delete</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'websites'}
      <div class="content-tab">
        <p class="section-desc">Assign a persona to specific sites. The matching persona auto-selects when you visit.</p>
        <div class="add-row">
          <input type="text" bind:value={newWebsite} placeholder="example.com" class="input" />
          <select bind:value={newWebsitePersona} class="select">
            <option value="random">🎲 Random</option>
            {#each sortedPersonas as persona (persona.id)}
              <option value={persona.id}>{persona.icon} {persona.name}</option>
            {/each}
          </select>
          <button class="btn btn-primary btn-small" onclick={handleAddWebsite}>Add</button>
        </div>
        {#if websitePersonas.length === 0}
          <div class="empty-state">
            <span class="empty-icon">🌐</span>
            <p>No websites registered</p>
            <p class="hint">Add sites above to lock a persona to them</p>
          </div>
        {:else}
          <div class="item-list">
            {#each websitePersonas as wp (wp.hostname)}
              <div class="website-row">
                <span class="site-name">{wp.hostname}</span>
                <span class="site-persona">
                  {wp.personaId === 'random' ? '🎲 Random' : (findPersona(wp.personaId)?.icon ?? '') + ' ' + (findPersona(wp.personaId)?.name ?? wp.personaId)}
                </span>
                <button class="btn btn-danger btn-small" onclick={() => handleRemoveWebsite(wp.hostname)}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'stats'}
      <div class="content-tab">
        <div class="stats-summary">
          <div class="stat-card">
            <span class="stat-value">{totalTransforms}</span>
            <span class="stat-label">Transforms</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{(totalChars / 1000).toFixed(1)}k</span>
            <span class="stat-label">Characters</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{usageStats.length}</span>
            <span class="stat-label">Active days</span>
          </div>
        </div>

        {#if usageStats.length > 0}
          <div class="section-action-row">
            <button class="btn btn-danger btn-small" onclick={handleResetStats}>Reset stats</button>
          </div>
        {/if}

        {#if usageStats.length === 0}
          <div class="empty-state">
            <span class="empty-icon">📊</span>
            <p>No usage data yet</p>
            <p class="hint">Start converting text to see stats here</p>
          </div>
        {:else}
          <div class="stats-block">
            <h3 class="block-title">Recent activity</h3>
            {#each [...usageStats].reverse() as stat (stat.date)}
              <div class="stat-row">
                <span class="stat-date">{formatDate(stat.date)}</span>
                <div class="stat-bar-track">
                  <div class="stat-bar-fill" style="width: {Math.min(100, (stat.count / maxStatCount) * 100)}%"></div>
                </div>
                <span class="stat-count">{stat.count}×</span>
                <span class="stat-top">{getTopPersonaForStat(stat)}</span>
              </div>
            {/each}
          </div>
          <div class="stats-block">
            <h3 class="block-title">Persona usage</h3>
            {#each activePersonas as persona (persona.id)}
              {@const count = usageStats.reduce((sum, s) => sum + (s.personaUsage[persona.id] ?? 0), 0)}
              {#if count > 0}
                <div class="stat-row">
                  <span class="stat-date" style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{persona.icon} {persona.name}</span>
                  <div class="stat-bar-track">
                    <div class="stat-bar-fill persona-fill" style="width: {totalTransforms > 0 ? Math.min(100, (count / totalTransforms) * 100) : 0}%"></div>
                  </div>
                  <span class="stat-count">{count}×</span>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  /* ─── Reset & global ─────────────────────────────────────────────────────── */
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #09090f;
    color: #dde1f0;
    min-width: 480px;
    max-width: 600px;
    font-size: 13px;
  }

  /* ─── App shell ──────────────────────────────────────────────────────────── */
  .app { display: flex; flex-direction: column; min-height: 100vh; }

  /* ─── Header ─────────────────────────────────────────────────────────────── */
  header {
    background: linear-gradient(160deg, #12101e 0%, #0e1220 100%);
    border-bottom: 1px solid #1e1e2e;
    padding: 10px 16px 0;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
  }

  .brand { display: flex; align-items: center; gap: 7px; }
  .brand-icon { font-size: 18px; }
  .brand-name { font-size: 15px; font-weight: 700; color: #c4b5fd; letter-spacing: -0.3px; }

  .header-right { display: flex; align-items: center; gap: 8px; }

  .hostname-chip {
    font-size: 10px;
    color: #6b7280;
    background: #16161f;
    border: 1px solid #252535;
    padding: 2px 8px;
    border-radius: 10px;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    padding: 3px 9px;
    border-radius: 20px;
    border: 1px solid #252535;
    background: #13131c;
    color: #6b7280;
    transition: all 0.2s;
  }
  .status-pill.status-ready  { color: #34d399; border-color: #1a3a2a; background: #0d1f16; }
  .status-pill.status-loading{ color: #fb923c; border-color: #3a2010; background: #1c1008; }
  .status-pill.status-error  { color: #f87171; border-color: #3a1010; background: #1c0808; }

  .status-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    background: currentColor;
  }
  .status-pill.status-loading .status-dot { animation: pulse 1.2s infinite; }

  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }

  .retry-btn {
    background: none; border: none; color: inherit; cursor: pointer;
    font-size: 12px; padding: 0 2px; opacity: 0.8;
  }
  .retry-btn:hover { opacity: 1; }

  .load-bar-track {
    height: 2px; background: #1a1a28; border-radius: 1px; overflow: hidden;
    margin: 0 -16px;
  }
  .load-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #7c3aed, #a78bfa);
    border-radius: 1px;
    transition: width 0.4s ease;
  }

  /* ─── Persona section ────────────────────────────────────────────────────── */
  .persona-section {
    padding: 10px 16px;
    background: #0e0e18;
    border-bottom: 1px solid #1a1a28;
  }

  .persona-bar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .section-eyebrow {
    font-size: 10px;
    font-weight: 600;
    color: #4b5563;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .persona-bar-actions { display: flex; gap: 4px; }

  .ghost-btn {
    background: none;
    border: 1px solid #252535;
    color: #6b7280;
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .ghost-btn:hover { background: #1a1a28; color: #dde1f0; border-color: #373753; }
  .ghost-accent { color: #a78bfa; border-color: #2e1f5e; }
  .ghost-accent:hover { background: #1a1040; border-color: #4c2fa0; color: #c4b5fd; }

  .persona-pills {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .pill {
    background: #14141f;
    border: 1px solid #252535;
    color: #8b92b0;
    padding: 4px 11px;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    font-family: inherit;
  }
  .pill:hover { background: #1e1e30; color: #dde1f0; border-color: #373753; }
  .pill.active {
    background: #4c1d95;
    border-color: #6d28d9;
    color: #ede9fe;
    box-shadow: 0 0 0 1px #7c3aed22, 0 2px 8px #7c3aed18;
  }

  .pill-group { display: inline-flex; align-items: center; }
  .pill-main { border-radius: 20px 0 0 20px; border-right: none; }
  .pill-del {
    background: #14141f;
    border: 1px solid #252535;
    color: #4b5563;
    padding: 4px 8px;
    border-radius: 0 20px 20px 0;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1;
    font-family: inherit;
  }
  .pill-del:hover { background: #3b0d0d; border-color: #7f1d1d; color: #fca5a5; }
  .pill-del.active { background: #3b1f72; border-color: #5b21b6; color: #c4b5fd; }
  .pill-del.active:hover { background: #3b0d0d; border-color: #7f1d1d; color: #fca5a5; }

  .pill-count { font-size: 9px; opacity: 0.6; margin-left: 2px; }

  /* Create form */
  .create-form {
    margin-top: 10px;
    background: #11111c;
    border: 1px solid #252535;
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .create-form-row { display: flex; gap: 6px; align-items: center; }
  .create-icon-input { flex: 0 0 42px; text-align: center; font-size: 15px; padding: 4px 4px; }
  .create-prompt { min-height: 68px; max-height: 120px; font-size: 12px; }
  .create-form-actions { display: flex; gap: 6px; }

  /* ─── Tabs ───────────────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    background: #0e0e18;
    border-bottom: 1px solid #1a1a28;
  }

  .tabs button {
    flex: 1;
    padding: 9px 6px;
    background: none;
    border: none;
    color: #4b5563;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .tabs button:hover { color: #dde1f0; background: #131320; }
  .tabs button.active { color: #a78bfa; border-bottom-color: #7c3aed; background: #13101e; }

  .tab-badge {
    background: #2d1f5e;
    color: #c4b5fd;
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 8px;
    font-weight: 600;
  }

  main { flex: 1; overflow-y: auto; }

  /* ─── Transform tab ──────────────────────────────────────────────────────── */
  .transform-tab {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .text-section { display: flex; flex-direction: column; gap: 5px; }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    font-size: 10px;
    font-weight: 700;
    color: #5b6280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .word-count { font-size: 10px; color: #373753; }

  .text-area {
    width: 100%;
    min-height: 115px;
    max-height: 280px;
    background: #0d0d18;
    border: 1px solid #1e1e30;
    border-radius: 10px;
    color: #dde1f0;
    padding: 10px 13px;
    font-size: 13px;
    line-height: 1.65;
    resize: vertical;
    font-family: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .text-area:focus {
    outline: none;
    border-color: #5b21b6;
    box-shadow: 0 0 0 3px #7c3aed12;
  }

  /* Action row */
  .action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .persona-chip {
    font-size: 12px;
    color: #6b7280;
    background: #12121c;
    border: 1px solid #1e1e2e;
    padding: 4px 10px;
    border-radius: 8px;
  }
  .chip-label { color: #9ca3af; }

  .btn-convert {
    font-size: 13px;
    padding: 9px 22px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Spinner */
  .spinner {
    width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.25);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ─── Quality card ───────────────────────────────────────────────────────── */
  .quality-card {
    background: #0d0d18;
    border: 1px solid #1e1e30;
    border-left: 3px solid #374151;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: fadeIn 0.3s ease;
  }
  @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }

  .quality-card.risk-low    { border-left-color: #059669; }
  .quality-card.risk-medium { border-left-color: #d97706; }
  .quality-card.risk-high   { border-left-color: #dc2626; }
  .quality-card.risk-critical{ border-left-color: #be123c; }

  .quality-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .quality-title { font-size: 11px; font-weight: 600; color: #8b92b0; }

  .risk-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    letter-spacing: 0.06em;
  }
  .risk-badge-low      { background: #052e16; color: #34d399; border: 1px solid #064e27; }
  .risk-badge-medium   { background: #2d1800; color: #fbbf24; border: 1px solid #451e00; }
  .risk-badge-high     { background: #2d0808; color: #f87171; border: 1px solid #450c0c; }
  .risk-badge-critical { background: #2d0414; color: #fb7185; border: 1px solid #450618; }

  .quality-metrics { display: flex; flex-direction: column; gap: 6px; }

  .metric-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .metric-label { width: 76px; color: #5b6280; flex-shrink: 0; }

  .metric-track {
    flex: 1;
    height: 5px;
    background: #1a1a2e;
    border-radius: 3px;
    overflow: hidden;
  }

  .metric-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.6s ease;
    background: #374151;
  }
  .metric-fill.fill-good { background: linear-gradient(90deg, #059669, #34d399); }
  .metric-fill.fill-warn { background: linear-gradient(90deg, #b45309, #fbbf24); }
  .metric-fill.fill-bad  { background: linear-gradient(90deg, #991b1b, #f87171); }

  .metric-value { width: 34px; text-align: right; color: #8b92b0; font-size: 11px; flex-shrink: 0; }

  .rounds-note {
    font-size: 10px;
    color: #4b5563;
    background: #111120;
    border: 1px solid #1e1e30;
    padding: 3px 8px;
    border-radius: 6px;
    align-self: flex-start;
  }

  .signal-list { display: flex; flex-wrap: wrap; gap: 5px; }

  .signal-tag {
    font-size: 10px;
    background: #2d1800;
    color: #fbbf24;
    border: 1px solid #3d2200;
    padding: 2px 8px;
    border-radius: 8px;
  }

  .no-signals {
    font-size: 10px;
    color: #374151;
  }

  /* ─── Output actions ─────────────────────────────────────────────────────── */
  .output-actions { display: flex; gap: 8px; }

  /* ─── Shared content tab ─────────────────────────────────────────────────── */
  .content-tab {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-desc { font-size: 12px; color: #4b5563; line-height: 1.5; }

  .section-action-row { display: flex; justify-content: flex-end; }

  /* ─── Item cards (drafts) ────────────────────────────────────────────────── */
  .item-list { display: flex; flex-direction: column; gap: 8px; }

  .item-card {
    background: #0e0e18;
    border: 1px solid #1e1e30;
    border-radius: 10px;
    padding: 11px 13px;
    transition: border-color 0.15s;
  }
  .item-card:hover { border-color: #2e2e48; }

  .item-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 5px;
  }

  .item-title { font-size: 12px; font-weight: 600; color: #dde1f0; flex: 1; }
  .item-meta  { font-size: 10px; color: #4b5563; white-space: nowrap; }
  .item-preview { font-size: 11px; color: #4b5563; margin-bottom: 9px; line-height: 1.45; }
  .item-actions { display: flex; gap: 6px; }

  /* ─── Websites ───────────────────────────────────────────────────────────── */
  .add-row { display: flex; gap: 6px; align-items: center; }

  .website-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0e0e18;
    border: 1px solid #1e1e30;
    border-radius: 8px;
    padding: 8px 12px;
  }
  .site-name  { flex: 1; font-size: 11px; color: #dde1f0; font-family: monospace; }
  .site-persona { font-size: 10px; color: #6b7280; white-space: nowrap; }

  /* ─── Stats ──────────────────────────────────────────────────────────────── */
  .stats-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .stat-card {
    background: #0e0e18;
    border: 1px solid #1e1e30;
    border-radius: 10px;
    padding: 13px 8px;
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 22px;
    font-weight: 700;
    color: #a78bfa;
    margin-bottom: 3px;
  }

  .stat-label {
    font-size: 9px;
    color: #4b5563;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .stats-block { display: flex; flex-direction: column; gap: 5px; }
  .block-title {
    font-size: 10px;
    font-weight: 700;
    color: #4b5563;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 4px;
  }

  .stat-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .stat-date { width: 50px; color: #5b6280; flex-shrink: 0; }

  .stat-bar-track {
    flex: 1;
    height: 5px;
    background: #1a1a2e;
    border-radius: 3px;
    overflow: hidden;
  }

  .stat-bar-fill {
    height: 100%;
    background: #7c3aed;
    border-radius: 3px;
    transition: width 0.3s;
    min-width: 3px;
  }

  .stat-bar-fill.persona-fill { background: #0891b2; }

  .stat-count { width: 26px; color: #4b5563; text-align: right; flex-shrink: 0; }
  .stat-top { width: 76px; color: #374151; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ─── Empty states ───────────────────────────────────────────────────────── */
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #374151;
  }
  .empty-icon { font-size: 34px; display: block; margin-bottom: 10px; }
  .empty-state p { font-size: 13px; margin-bottom: 4px; color: #4b5563; }
  .hint { font-size: 11px; color: #2d3748; }

  /* ─── Form inputs ────────────────────────────────────────────────────────── */
  .input {
    flex: 1;
    background: #0d0d18;
    border: 1px solid #1e1e30;
    border-radius: 7px;
    color: #dde1f0;
    padding: 6px 10px;
    font-size: 12px;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .input:focus { outline: none; border-color: #5b21b6; }

  .select {
    background: #0d0d18;
    border: 1px solid #1e1e30;
    border-radius: 7px;
    color: #dde1f0;
    padding: 6px 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }
  .select:focus { outline: none; }

  /* ─── Buttons ────────────────────────────────────────────────────────────── */
  .btn {
    padding: 8px 16px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    white-space: nowrap;
    font-family: inherit;
  }
  .btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .btn-primary { background: #5b21b6; color: white; }
  .btn-primary:hover:not(:disabled) { background: #6d28d9; box-shadow: 0 0 0 3px #7c3aed18; }

  .btn-secondary {
    background: #12121c;
    color: #8b92b0;
    border: 1px solid #252535;
  }
  .btn-secondary:hover:not(:disabled) { background: #1a1a2e; color: #dde1f0; }

  .btn-ghost {
    background: transparent;
    color: #6b7280;
    border: 1px solid #1e1e30;
  }
  .btn-ghost:hover:not(:disabled) { background: #1a1a28; color: #dde1f0; }

  .btn-danger { background: #3b0d0d; color: #fca5a5; border: 1px solid #7f1d1d; }
  .btn-danger:hover:not(:disabled) { background: #7f1d1d; color: white; }

  .btn-small { padding: 4px 10px; font-size: 11px; border-radius: 7px; }
</style>
