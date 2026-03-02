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

  // Create/edit persona form state
  let showCreateForm = $state(false);
  let editingPersonaId = $state<string | null>(null);
  let newPersonaName = $state('');
  let newPersonaIcon = $state('🤖');
  let newPersonaDesc = $state('');
  let newPersonaPrompt = $state('');

  // ── Toast / confirm system ────────────────────────────────────────────────
  type ToastType = 'success' | 'error' | 'warn' | 'info';
  interface ToastItem { id: string; type: ToastType; message: string; }
  interface ConfirmState {
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  }

  let toasts = $state<ToastItem[]>([]);
  let pendingConfirm = $state<ConfirmState | null>(null);

  function showToast(message: string, type: ToastType = 'info', duration = 2600) {
    const id = crypto.randomUUID();
    toasts = [...toasts, { id, type, message }];
    setTimeout(() => dismissToast(id), duration);
  }

  function dismissToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  function showConfirm(state: ConfirmState) {
    pendingConfirm = state;
  }

  function dismissConfirm() {
    pendingConfirm = null;
  }

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
          // progress.progress is already 0-100 in transformers.js v3; clamp defensively
          modelProgress = Math.min(100, Math.round(progress.progress));
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
    showToast('Copied to clipboard', 'success');
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
    showToast('Draft saved', 'success');
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
      id: editingPersonaId ?? `custom-${crypto.randomUUID()}`,
      name: newPersonaName.trim(),
      icon: newPersonaIcon.trim() || '🤖',
      description: newPersonaDesc.trim(),
      systemPrompt: newPersonaPrompt.trim(),
    };
    const wasEditing = editingPersonaId !== null;
    await saveCustomPersona(persona);
    const data = await getStorage();
    customPersonas = data.customPersonas;
    newPersonaName = '';
    newPersonaIcon = '🤖';
    newPersonaDesc = '';
    newPersonaPrompt = '';
    editingPersonaId = null;
    showCreateForm = false;
    showToast(wasEditing ? 'Persona updated' : 'Persona created', 'success');
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
    // If the deleted persona was being edited, cancel the form to avoid stale state
    if (editingPersonaId === id) {
      handleCancelCreateForm();
    }
  }

  function handleStartEditPersona(persona: Persona) {
    editingPersonaId = persona.id;
    newPersonaName = persona.name;
    newPersonaIcon = persona.icon;
    newPersonaDesc = persona.description;
    newPersonaPrompt = persona.systemPrompt;
    showCreateForm = true;
  }

  function handleCancelCreateForm() {
    editingPersonaId = null;
    newPersonaName = '';
    newPersonaIcon = '🤖';
    newPersonaDesc = '';
    newPersonaPrompt = '';
    showCreateForm = false;
  }

  async function handleRestoreDefaults() {
    showConfirm({
      message: 'Restore default personas?',
      detail: 'Custom personas will be removed and any deleted defaults will be restored.',
      confirmLabel: 'Restore',
      danger: true,
      onConfirm: async () => {
        await restoreDefaults();
        deletedDefaultPersonaIds = [];
        customPersonas = [];
        // Clear any in-progress edit since custom personas are gone
        handleCancelCreateForm();
        if (!PERSONAS.some((p) => p.id === selectedPersonaId)) {
          await handleSelectPersona('random');
        }
        showToast('Default personas restored', 'success');
      },
    });
  }

  async function handleResetStats() {
    showConfirm({
      message: 'Reset all usage stats?',
      detail: 'This cannot be undone.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: async () => {
        await resetUsageStats();
        usageStats = [];
        showToast('Stats reset', 'success');
      },
    });
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
        <button class="ghost-btn ghost-accent" onclick={() => { if (showCreateForm) handleCancelCreateForm(); else showCreateForm = true; }}>
          {showCreateForm ? '✕ Cancel' : '+ New'}
        </button>
        <button class="ghost-btn" onclick={handleRestoreDefaults} title="Restore default personas">↺ Restore</button>
      </div>
    </div>
    <div class="persona-pills">
      <button class="pill" class:active={selectedPersonaId === 'random'} onclick={() => handleSelectPersona('random')}>
        🎲 Random
      </button>
      {#each sortedPersonas as persona (persona.id)}
        {@const count = personaUsageCounts[persona.id] ?? 0}
        {@const isCustom = !PERSONAS.some((p) => p.id === persona.id)}
        <div class="pill-group">
          <button
            class="pill pill-main"
            class:active={selectedPersonaId === persona.id}
            onclick={() => handleSelectPersona(persona.id)}
            title={persona.description}
          >
            {persona.icon} {persona.name}{#if count > 0}<span class="pill-count"> {count}</span>{/if}
          </button>
          {#if isCustom}
            <button
              class="pill pill-mid pill-edit"
              class:active={selectedPersonaId === persona.id}
              onclick={() => handleStartEditPersona(persona)}
              aria-label="Edit persona"
            >✎</button>
          {/if}
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
        <span class="section-eyebrow" style="color: #a78bfa">{editingPersonaId ? 'Edit persona' : 'New persona'}</span>
        <div class="create-form-row">
          <input class="input create-icon-input" bind:value={newPersonaIcon} placeholder="🤖" maxlength="4" aria-label="Icon" />
          <input class="input" style="flex:1" bind:value={newPersonaName} placeholder="Name" aria-label="Name" />
        </div>
        <input class="input" bind:value={newPersonaDesc} placeholder="Short description" aria-label="Description" />
        <textarea class="text-area create-prompt" bind:value={newPersonaPrompt} placeholder="System prompt — describe how this persona writes…" aria-label="System prompt"></textarea>
        <div class="create-form-actions">
          <button class="btn btn-primary btn-small" onclick={handleCreatePersona} disabled={!newPersonaName.trim() || !newPersonaPrompt.trim()}>{editingPersonaId ? 'Update' : 'Save'}</button>
          <button class="btn btn-ghost btn-small" onclick={handleCancelCreateForm}>Cancel</button>
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
              <span class="spinner"></span> Processing…
            {:else}
              ▶ Transform
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

  <!-- ─── Toast / confirm overlay ──────────────────────────────────────────── -->
  {#if toasts.length > 0 || pendingConfirm}
    <div class="toast-container" aria-live="polite">
      {#each toasts as toast (toast.id)}
        <div class="toast toast-{toast.type}" role="alert">
          <span class="toast-icon">
            {#if toast.type === 'success'}✓{:else if toast.type === 'error'}✕{:else if toast.type === 'warn'}⚠{:else}ℹ{/if}
          </span>
          <span class="toast-msg">{toast.message}</span>
          <button class="toast-dismiss" onclick={() => dismissToast(toast.id)} aria-label="Dismiss">×</button>
        </div>
      {/each}
      {#if pendingConfirm}
        <div class="toast toast-confirm" role="dialog" aria-modal="true">
          <div class="confirm-content">
            <span class="confirm-message">{pendingConfirm.message}</span>
            {#if pendingConfirm.detail}
              <span class="confirm-detail">{pendingConfirm.detail}</span>
            {/if}
          </div>
          <div class="confirm-actions">
            <button class="btn btn-ghost btn-small" onclick={dismissConfirm}>
              {pendingConfirm.cancelLabel ?? 'Cancel'}
            </button>
            <button
              class="btn btn-small"
              class:btn-danger={pendingConfirm.danger}
              class:btn-primary={!pendingConfirm.danger}
              onclick={async () => { const fn = pendingConfirm!.onConfirm; dismissConfirm(); await fn(); }}
            >
              {pendingConfirm.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');

  /* ─── Design tokens ─────────────────────────────────────────────────────── */
  :global(:root) {
    --bg:         #000000;
    --bg-1:       #080808;
    --bg-2:       #111111;
    --border:     #1e1e1e;
    --border-hi:  #333333;
    --accent:     #ff4500;
    --accent-lo:  #6b1c00;
    --accent-glo: rgba(255,69,0,0.25);
    --white:      #ffffff;
    --gray:       #999999;
    --dim:        #444444;
    --green:      #00ff41;
    --red:        #ff2222;
    --yellow:     #ffb800;
    --cyan:       #00aaff;
    --font: 'Space Mono', ui-monospace, 'Cascadia Code', 'Source Code Pro',
            Menlo, Consolas, 'Courier New', monospace;
  }

  /* ─── Reset ─────────────────────────────────────────────────────────────── */
  :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    font-family: var(--font);
    background: var(--bg);
    color: var(--white);
    min-width: 480px;
    max-width: 600px;
    font-size: 11px;
    line-height: 1.5;
    letter-spacing: 0.02em;
  }

  /* Scanline texture overlay */
  :global(body::after) {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent 0px, transparent 3px,
      rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px
    );
    pointer-events: none;
    z-index: 99999;
  }

  /* ─── shell App */ ───────────────────────────────────────────────────────────
  .app { display: flex; flex-direction: column; min-height: 100vh; }

   /* ─── Header ────────────────────────────────────────────────────── */
  header {
    background: var(--bg);
    border-bottom: 1px solid var(--accent);
    padding: 10px 16px 0;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 10px;
  }

  .brand { display: flex; align-items: center; gap: 8px; }
  .brand-icon { font-size: 15px; }
  .brand-name {
    font-size: 14px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    text-shadow: 0 0 18px var(--accent-glo), 0 0 6px var(--accent-glo);
  }

  .header-right { display: flex; align-items: center; gap: 8px; }

  .hostname-chip {
    font-size: 9px;
    color: var(--dim);
    background: transparent;
    border: 1px solid var(--border);
    padding: 2px 8px;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9px;
    padding: 3px 9px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--dim);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-family: var(--font);
    transition: border-color 0.15s, color 0.15s;
  }
  .status-pill.status-ready {
    color: var(--green);
    border-color: var(--green);
    text-shadow: 0 0 8px rgba(0,255,65,0.6);
  }
  .status-pill.status-loading { color: var(--accent); border-color: var(--accent); }
  .status-pill.status-error   { color: var(--red);    border-color: var(--red); }

  .status-dot {
    width: 5px; height: 5px;
    background: currentColor;
    flex-shrink: 0;
  }
  .status-pill.status-loading .status-dot { animation: blink 1s step-start infinite; }

  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

  .retry-btn {
    background: none; border: none; color: inherit; cursor: pointer;
    font-size: 11px; padding: 0 2px; font-family: var(--font);
  }
  .retry-btn:hover { color: var(--accent); }

  .load-bar-track {
    height: 2px; background: var(--bg-2); overflow: hidden;
    margin: 0 -16px;
  }
  .load-bar-fill {
    height: 100%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent), 0 0 20px var(--accent-glo);
    transition: width 0.3s linear;
  }

  /* ─── Persona section ────────────────────────────────────────────────────── */
  .persona-section {
    padding: 10px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  .persona-bar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .section-eyebrow {
    font-size: 9px;
    font-weight: 700;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }

  .persona-bar-actions { display: flex; gap: 4px; }

  .ghost-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--dim);
    padding: 3px 9px;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.1s;
    font-family: var(--font);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .ghost-btn:hover {
    background: var(--bg-1);
    color: var(--white);
    border-color: var(--border-hi);
  }
  .ghost-accent { color: var(--accent); border-color: var(--accent-lo); }
  .ghost-accent:hover {
    background: rgba(255,69,0,0.08);
    border-color: var(--accent);
    color: var(--accent);
  }

  .persona-pills {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .pill {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--dim);
    padding: 3px 10px;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.1s;
    white-space: nowrap;
    font-family: var(--font);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pill:hover {
    background: var(--bg-1);
    color: var(--white);
    border-color: var(--border-hi);
  }
  .pill.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
    font-weight: 700;
    text-shadow: none;
    box-shadow: 0 0 12px var(--accent-glo);
  }

  .pill-group { display: inline-flex; align-items: center; }
  .pill-main  { border-right: none; }
  .pill-mid {
    background: transparent;
    border: 1px solid var(--border);
    border-right: none;
    color: var(--dim);
    padding: 3px 7px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.1s;
    line-height: 1;
    font-family: var(--font);
  }
  .pill-mid:hover { background: rgba(255,69,0,0.08); color: var(--accent); border-color: var(--accent-lo); }
  .pill-mid.active { background: rgba(255,69,0,0.12); border-color: var(--accent-lo); color: var(--accent); }
  .pill-edit { font-size: 11px; }
  .pill-del {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--dim);
    padding: 3px 7px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.1s;
    line-height: 1;
    font-family: var(--font);
  }
  .pill-del:hover { background: rgba(255,34,34,0.08); border-color: var(--red); color: var(--red); }
  .pill-del.active { background: rgba(255,69,0,0.12); border-color: var(--accent-lo); color: #000; }
  .pill-del.active:hover { background: rgba(255,34,34,0.08); border-color: var(--red); color: var(--red); }

  .pill-count { font-size: 8px; opacity: 0.45; margin-left: 2px; }

  /* Create / Edit form */
  .create-form {
    margin-top: 10px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .create-form-row { display: flex; gap: 6px; align-items: center; }
  .create-icon-input { flex: 0 0 42px; text-align: center; font-size: 14px; padding: 4px; }
  .create-prompt { min-height: 68px; max-height: 120px; font-size: 11px; }
  .create-form-actions { display: flex; gap: 6px; }

   /* ─── Tabs ──────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    flex: 1;
    padding: 9px 6px;
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--dim);
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.1s;
    font-family: var(--font);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .tabs button:last-child { border-right: none; }
  .tabs button:hover { color: var(--white); background: var(--bg-1); }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    background: var(--bg-1);
  }

  .tab-badge {
    background: var(--accent);
    color: #000;
    font-size: 8px;
    padding: 1px 4px;
    font-weight: 700;
    letter-spacing: 0;
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
    font-size: 9px;
    font-weight: 700;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }

  .word-count { font-size: 9px; color: var(--border-hi); }

  .text-area {
    width: 100%;
    min-height: 115px;
    max-height: 280px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--white);
    padding: 10px 13px;
    font-size: 11px;
    line-height: 1.65;
    resize: vertical;
    font-family: var(--font);
    transition: border-color 0.1s;
  }
  .text-area:focus {
    outline: none;
    border-color: var(--accent);
  }
  .text-area::placeholder { color: var(--dim); }

  /* Action row */
  .action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .persona-chip {
    font-size: 9px;
    color: var(--dim);
    background: transparent;
    border: 1px solid var(--border);
    padding: 4px 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--font);
  }
  .chip-label { color: var(--gray); }

  .btn-convert {
    font-size: 11px;
    padding: 9px 22px;
    display: flex;
    align-items: center;
    gap: 6px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }

  /* Block cursor spinner */
  .spinner {
    display: inline-block;
    width: 8px;
    height: 13px;
    background: #000;
    animation: blink 0.7s step-start infinite;
    vertical-align: middle;
    flex-shrink: 0;
  }

  /* ─── Quality card */ ─────────────────────────────────────
  .quality-card {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-left: 3px solid var(--dim);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: fadeIn 0.2s ease;
  }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }

  .quality-card.risk-low     { border-left-color: var(--green); }
  .quality-card.risk-medium  { border-left-color: var(--yellow); }
  .quality-card.risk-high    { border-left-color: var(--red); }
  .quality-card.risk-critical{ border-left-color: var(--red); }

  .quality-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .quality-title {
    font-size: 9px; font-weight: 700;
    color: var(--dim); text-transform: uppercase; letter-spacing: 0.16em;
  }

  .risk-badge {
    font-size: 8px; font-weight: 700;
    padding: 2px 7px; letter-spacing: 0.12em; text-transform: uppercase;
    border: 1px solid currentColor; background: transparent;
  }
  .risk-badge-low      { color: var(--green); }
  .risk-badge-medium   { color: var(--yellow); }
  .risk-badge-high     { color: var(--red); }
  .risk-badge-critical { color: var(--red); }

  .quality-metrics { display: flex; flex-direction: column; gap: 6px; }

  .metric-row { display: flex; align-items: center; gap: 8px; font-size: 10px; }
  .metric-label {
    width: 76px; color: var(--dim); flex-shrink: 0;
    text-transform: uppercase; font-size: 8px; letter-spacing: 0.1em;
  }
  .metric-track { flex: 1; height: 4px; background: var(--bg-2); overflow: hidden; }
  .metric-fill  { height: 100%; transition: width 0.6s ease; background: var(--dim); }
  .metric-fill.fill-good { background: var(--green); box-shadow: 0 0 6px rgba(0,255,65,0.5); }
  .metric-fill.fill-warn { background: var(--yellow); }
  .metric-fill.fill-bad  { background: var(--red); }
  .metric-value { width: 34px; text-align: right; color: var(--dim); font-size: 10px; flex-shrink: 0; }

  .rounds-note {
    font-size: 9px; color: var(--dim);
    text-transform: uppercase; letter-spacing: 0.06em;
  }

  .signal-list { display: flex; flex-wrap: wrap; gap: 5px; }
  .signal-tag {
    font-size: 8px; background: transparent;
    color: var(--yellow); border: 1px solid var(--yellow);
    padding: 1px 6px; text-transform: uppercase; letter-spacing: 0.06em;
  }

  .no-signals { font-size: 9px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.08em; }

  /* ─── Output actions ─────────────────────────────────────────────────────── */
  .output-actions { display: flex; gap: 8px; }

  /* ─── Shared content tab ─────────────────────────────────────────────────── */
  .content-tab {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-desc {
    font-size: 9px; color: var(--dim); line-height: 1.6;
    text-transform: uppercase; letter-spacing: 0.06em;
  }

  .section-action-row { display: flex; justify-content: flex-end; }

  /* ─── Item cards — drafts ───────────────────────────────────────────────── */
  .item-list { display: flex; flex-direction: column; gap: 5px; }

  .item-card {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-left: 2px solid var(--border);
    padding: 10px 12px;
    transition: border-left-color 0.1s;
  }
  .item-card:hover { border-left-color: var(--accent); }

  .item-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 5px;
  }

  .item-title {
    font-size: 11px; font-weight: 700; color: var(--white);
    flex: 1; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .item-meta    { font-size: 9px; color: var(--dim); white-space: nowrap; }
  .item-preview { font-size: 10px; color: var(--dim); margin-bottom: 9px; line-height: 1.5; }
  .item-actions { display: flex; gap: 6px; }

   /* ─── Websites ──────────────────────────────────────────────────── */
  .add-row { display: flex; gap: 6px; align-items: center; }

  .website-row {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-1); border: 1px solid var(--border);
    padding: 8px 12px;
    border-left: 2px solid transparent;
    transition: border-left-color 0.1s;
  }
  .website-row:hover { border-left-color: var(--accent); }
  .site-name   { flex: 1; font-size: 10px; color: var(--white); font-family: var(--font); text-transform: uppercase; }
  .site-persona { font-size: 9px; color: var(--dim); white-space: nowrap; text-transform: uppercase; }

   /* ─── Stats ─────────────────────────────────────────────────────── */
  .stats-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .stat-card {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-top: 2px solid var(--accent);
    padding: 13px 8px;
    text-align: center;
  }
  .stat-value {
    display: block;
    font-size: 22px; font-weight: 700;
    color: var(--accent);
    margin-bottom: 4px;
    text-shadow: 0 0 16px var(--accent-glo);
    letter-spacing: -0.02em;
  }
  .stat-label {
    font-size: 8px; color: var(--dim);
    text-transform: uppercase; letter-spacing: 0.16em;
  }

  .stats-block { display: flex; flex-direction: column; gap: 4px; }
  .block-title {
    font-size: 9px; font-weight: 700; color: var(--dim);
    text-transform: uppercase; letter-spacing: 0.16em;
    margin-bottom: 4px; padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .stat-row { display: flex; align-items: center; gap: 8px; font-size: 10px; }
  .stat-date { width: 50px; color: var(--dim); flex-shrink: 0; text-transform: uppercase; font-size: 9px; }

  .stat-bar-track { flex: 1; height: 4px; background: var(--bg-2); overflow: hidden; }
  .stat-bar-fill  { height: 100%; background: var(--accent); min-width: 2px; }
  .stat-bar-fill.persona-fill { background: var(--cyan); }

  .stat-count { width: 26px; color: var(--dim); text-align: right; flex-shrink: 0; font-size: 9px; }
  .stat-top   { width: 76px; color: var(--dim); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: uppercase; }

  /* ─── Empty states */ ───────────────────────────────────────────────
  .empty-state { text-align: center; padding: 40px 20px; color: var(--dim); }
  .empty-icon  { font-size: 26px; display: block; margin-bottom: 10px; filter: grayscale(1) brightness(0.5); }
  .empty-state p { font-size: 10px; margin-bottom: 4px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; }
  .hint          { font-size: 9px; color: var(--border-hi); text-transform: uppercase; letter-spacing: 0.08em; }

  /* ─── inputs Form */ ───────────────────────────────────────────────
  .input {
    flex: 1;
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--white);
    padding: 6px 10px;
    font-size: 11px;
    font-family: var(--font);
    transition: border-color 0.1s;
  }
  .input:focus { outline: none; border-color: var(--accent); }
  .input::placeholder { color: var(--dim); text-transform: uppercase; font-size: 9px; }

  .select {
    background: var(--bg-1);
    border: 1px solid var(--border);
    color: var(--white);
    padding: 6px 8px;
    font-size: 10px;
    font-family: var(--font);
    cursor: pointer;
    text-transform: uppercase;
  }
  .select:focus { outline: none; border-color: var(--accent); }
  .select option { background: var(--bg-1); }

   /* ─── Buttons ───────────────────────────────────────────────────── */
  .btn {
    padding: 8px 16px;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.1s;
    white-space: nowrap;
    font-family: var(--font);
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  .btn:disabled { opacity: 0.2; cursor: not-allowed; }

  .btn-primary { background: var(--accent); color: #000; border-color: var(--accent); }
  .btn-primary:hover:not(:disabled) {
    background: #ff5a20;
    border-color: #ff5a20;
    box-shadow: 0 0 14px var(--accent-glo);
  }

  .btn-secondary { background: transparent; color: var(--gray); border-color: var(--border); }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-1); color: var(--white); border-color: var(--border-hi); }

  .btn-ghost { background: transparent; color: var(--dim); border-color: var(--border); }
  .btn-ghost:hover:not(:disabled) { background: var(--bg-1); color: var(--white); border-color: var(--border-hi); }

  .btn-danger { background: transparent; color: var(--red); border-color: var(--red); }
  .btn-danger:hover:not(:disabled) { background: rgba(255,34,34,0.1); }

  .btn-small { padding: 3px 9px; font-size: 9px; }

  /* ─── Toast / confirm overlay */ 
  .toast-container {
    position: fixed;
    bottom: 12px;
    left: 10px;
    right: 10px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 9px 12px;
    font-size: 10px;
    pointer-events: all;
    animation: toastIn 0.18s ease;
    box-shadow: 0 0 24px rgba(0,0,0,0.9);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }

  .toast-success { border-color: var(--green);  border-left: 3px solid var(--green); }
  .toast-error   { border-color: var(--red);    border-left: 3px solid var(--red); }
  .toast-warn    { border-color: var(--yellow); border-left: 3px solid var(--yellow); }
  .toast-info    { border-color: var(--accent); border-left: 3px solid var(--accent); }

  .toast-icon { font-size: 11px; flex-shrink: 0; font-weight: 700; }
  .toast-success .toast-icon { color: var(--green); text-shadow: 0 0 8px rgba(0,255,65,0.6); }
  .toast-error   .toast-icon { color: var(--red); }
  .toast-warn    .toast-icon { color: var(--yellow); }
  .toast-info    .toast-icon { color: var(--accent); }

  .toast-msg { flex: 1; color: var(--white); line-height: 1.4; }

  .toast-dismiss {
    background: none; border: none; color: var(--dim);
    cursor: pointer; font-size: 13px; padding: 0 2px;
    line-height: 1; flex-shrink: 0; font-family: var(--font);
    transition: color 0.1s;
  }
  .toast-dismiss:hover { color: var(--white); }

  .toast-confirm {
    flex-direction: column; align-items: stretch; gap: 10px;
    background: var(--bg);
    border-color: var(--accent); border-left: 3px solid var(--accent);
  }
  .confirm-content { display: flex; flex-direction: column; gap: 3px; }
  .confirm-message { font-size: 11px; font-weight: 700; color: var(--white); }
  .confirm-detail  { font-size: 9px; color: var(--dim); line-height: 1.4; }
  .confirm-actions { display: flex; gap: 6px; justify-content: flex-end; }
</style>
