<script lang="ts">
  import { onMount } from 'svelte';
  import { PERSONAS, RANDOM_PERSONA_ID, getPersonaById, getRandomPersona } from '../lib/personas.js';
  import {
    getStorage,
    setStorage,
    setWebsitePersona,
    removeWebsitePersona,
    saveDraft,
    deleteDraft,
    recordUsage,
  } from '../lib/storage.js';
  import { loadModel, rewriteText, isModelLoaded } from '../lib/transformer.js';
  import type { Draft, UsageStat, WebsitePersona } from '../types/index.js';

  type Tab = 'transform' | 'drafts' | 'websites' | 'stats';

  let activeTab: Tab = $state('transform');
  let inputText = $state('');
  let outputText = $state('');
  let selectedPersonaId = $state<string>('random');
  let isConverting = $state(false);
  let modelStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  let modelProgress = $state(0);
  let modelStatusText = $state('');
  let currentHostname = $state<string | null>(null);

  let drafts = $state<Draft[]>([]);
  let websitePersonas = $state<WebsitePersona[]>([]);
  let newWebsite = $state('');
  let newWebsitePersona = $state('random');
  let usageStats = $state<UsageStat[]>([]);

  let inputWordCount = $derived(
    inputText.trim() === '' ? 0 : inputText.trim().split(/\s+/).length
  );
  let outputWordCount = $derived(
    outputText.trim() === '' ? 0 : outputText.trim().split(/\s+/).length
  );

  let activePersona = $derived(
    selectedPersonaId === 'random' ? null : getPersonaById(selectedPersonaId)
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
    try {
      const persona =
        selectedPersonaId === RANDOM_PERSONA_ID ? getRandomPersona() : getPersonaById(selectedPersonaId)!;
      lastUsedPersonaId = persona.id;
      outputText = await rewriteText(inputText, persona.systemPrompt);
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
    // Use the persona that was actually used for conversion (consistent with output)
    const resolvedId = lastUsedPersonaId ?? (selectedPersonaId === RANDOM_PERSONA_ID ? getRandomPersona().id : selectedPersonaId);
    const persona = getPersonaById(resolvedId)!;
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
    if (currentHostname) {
      await setWebsitePersona(currentHostname, id);
      const data = await getStorage();
      websitePersonas = data.websitePersonas;
    }
  }

  async function handleDeleteDraft(id: string) {
    await deleteDraft(id);
    const data = await getStorage();
    drafts = data.drafts;
  }

  function handleLoadDraft(draft: Draft) {
    inputText = draft.originalText;
    outputText = draft.rewrittenText;
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
    return getPersonaById(top[0])?.name ?? top[0];
  }
</script>

<div class="app">
  <header>
    <div class="header-top">
      <span class="logo">🎭 Persona</span>
      {#if currentHostname}
        <span class="hostname" title={currentHostname}>{currentHostname}</span>
      {/if}
    </div>
    <div class="model-status" class:ready={modelStatus === 'ready'} class:loading={modelStatus === 'loading'} class:error={modelStatus === 'error'}>
      {#if modelStatus === 'loading'}
        <span class="dot loading-dot"></span>
        <span>{modelStatusText} {modelProgress > 0 ? `${modelProgress}%` : ''}</span>
      {:else if modelStatus === 'ready'}
        <span class="dot ready-dot"></span>
        <span>Model ready</span>
      {:else if modelStatus === 'error'}
        <span class="dot error-dot"></span>
        <span>{modelStatusText}</span>
        <button class="retry-btn" onclick={initModel}>Retry</button>
      {:else}
        <span class="dot idle-dot"></span>
        <span>Click Convert to load model</span>
      {/if}
    </div>
  </header>

  <div class="persona-bar">
    <span class="persona-label">Persona:</span>
    <div class="persona-pills">
      <button
        class="pill"
        class:active={selectedPersonaId === 'random'}
        onclick={() => handleSelectPersona('random')}
      >
        🎲 Random
      </button>
      {#each PERSONAS as persona (persona.id)}
        <button
          class="pill"
          class:active={selectedPersonaId === persona.id}
          onclick={() => handleSelectPersona(persona.id)}
          title={persona.description}
        >
          {persona.icon} {persona.name}
        </button>
      {/each}
    </div>
  </div>

  <nav class="tabs">
    <button class:active={activeTab === 'transform'} onclick={() => (activeTab = 'transform')}>Transform</button>
    <button class:active={activeTab === 'drafts'} onclick={() => (activeTab = 'drafts')}>
      Drafts {drafts.length > 0 ? `(${drafts.length})` : ''}
    </button>
    <button class:active={activeTab === 'websites'} onclick={() => (activeTab = 'websites')}>
      Websites {websitePersonas.length > 0 ? `(${websitePersonas.length})` : ''}
    </button>
    <button class:active={activeTab === 'stats'} onclick={() => (activeTab = 'stats')}>Stats</button>
  </nav>

  <main>
    {#if activeTab === 'transform'}
      <div class="transform-tab">
        <div class="text-section">
          <div class="section-header">
            <label for="input-text">Original Text</label>
            <span class="word-count">{inputWordCount} words</span>
          </div>
          <textarea
            id="input-text"
            bind:value={inputText}
            placeholder="Paste or type your text here to rewrite it with a persona..."
            class="text-area"
          ></textarea>
        </div>

        <div class="action-bar">
          <div class="persona-info">
            {#if selectedPersonaId === 'random'}
              <span title="A random persona will be chosen on each conversion">🎲 Random persona</span>
            {:else if activePersona}
              <span>{activePersona.icon} {activePersona.name}</span>
            {/if}
          </div>
          <div class="action-buttons">
            <button
              class="btn btn-primary"
              onclick={handleConvert}
              disabled={isConverting || !inputText.trim() || modelStatus === 'error'}
            >
              {#if isConverting}
                ⏳ Converting...
              {:else}
                ✨ Convert
              {/if}
            </button>
          </div>
        </div>

        <div class="text-section">
          <div class="section-header">
            <label for="output-text">Rewritten Text</label>
            <span class="word-count">{outputWordCount} words</span>
          </div>
          <textarea
            id="output-text"
            bind:value={outputText}
            placeholder="Your rewritten text will appear here..."
            class="text-area"
            readonly={isConverting}
          ></textarea>
        </div>

        <div class="output-actions">
          <button class="btn btn-secondary" onclick={handleCopy} disabled={!outputText}>
            📋 Copy
          </button>
          <button class="btn btn-secondary" onclick={handleSaveDraft} disabled={!outputText || !inputText}>
            💾 Save Draft
          </button>
        </div>
      </div>

    {:else if activeTab === 'drafts'}
      <div class="drafts-tab">
        {#if drafts.length === 0}
          <div class="empty-state">
            <span>💾</span>
            <p>No drafts saved yet.</p>
            <p class="hint">Convert some text and click "Save Draft" to save it here.</p>
          </div>
        {:else}
          <div class="drafts-list">
            {#each drafts as draft (draft.id)}
              <div class="draft-card">
                <div class="draft-header">
                  <span class="draft-title">{draft.title}</span>
                  <span class="draft-meta">
                    {getPersonaById(draft.personaId)?.icon ?? '🎭'} {draft.personaName} · {new Date(draft.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <div class="draft-preview">{draft.rewrittenText.slice(0, 100)}...</div>
                <div class="draft-actions">
                  <button class="btn btn-small btn-secondary" onclick={() => handleLoadDraft(draft)}>
                    📂 Load
                  </button>
                  <button class="btn btn-small btn-danger" onclick={() => handleDeleteDraft(draft.id)}>
                    🗑️ Delete
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'websites'}
      <div class="websites-tab">
        <p class="section-desc">Assign a specific persona to websites. When you visit a registered site, that persona will be auto-selected.</p>

        <div class="add-website">
          <input
            type="text"
            bind:value={newWebsite}
            placeholder="example.com"
            class="input"
          />
          <select bind:value={newWebsitePersona} class="select">
            <option value="random">🎲 Random</option>
            {#each PERSONAS as persona (persona.id)}
              <option value={persona.id}>{persona.icon} {persona.name}</option>
            {/each}
          </select>
          <button class="btn btn-primary btn-small" onclick={handleAddWebsite}>Add</button>
        </div>

        {#if websitePersonas.length === 0}
          <div class="empty-state">
            <span>🌐</span>
            <p>No websites registered.</p>
            <p class="hint">Add websites above to assign them specific personas.</p>
          </div>
        {:else}
          <div class="website-list">
            {#each websitePersonas as wp (wp.hostname)}
              <div class="website-row">
                <span class="site-name">{wp.hostname}</span>
                <span class="site-persona">
                  {wp.personaId === 'random' ? '🎲 Random' : (getPersonaById(wp.personaId)?.icon ?? '') + ' ' + (getPersonaById(wp.personaId)?.name ?? wp.personaId)}
                </span>
                <button class="btn btn-small btn-danger" onclick={() => handleRemoveWebsite(wp.hostname)}>✕</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    {:else if activeTab === 'stats'}
      <div class="stats-tab">
        <div class="stats-summary">
          <div class="stat-card">
            <span class="stat-value">{totalTransforms}</span>
            <span class="stat-label">Total Transforms</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{(totalChars / 1000).toFixed(1)}k</span>
            <span class="stat-label">Chars Processed</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{usageStats.length}</span>
            <span class="stat-label">Active Days</span>
          </div>
        </div>

        {#if usageStats.length === 0}
          <div class="empty-state">
            <span>📊</span>
            <p>No usage data yet.</p>
            <p class="hint">Start converting text to track your usage.</p>
          </div>
        {:else}
          <div class="stats-timeline">
            <h3 class="timeline-title">Recent Activity (last 30 days)</h3>
            {#each [...usageStats].reverse() as stat (stat.date)}
              <div class="stat-row">
                <span class="stat-date">{formatDate(stat.date)}</span>
                <div class="stat-bar-container">
                  <div class="stat-bar" style="width: {Math.min(100, (stat.count / maxStatCount) * 100)}%"></div>
                </div>
                <span class="stat-count">{stat.count}x</span>
                <span class="stat-top-persona">{getTopPersonaForStat(stat)}</span>
              </div>
            {/each}
          </div>

          <div class="persona-breakdown">
            <h3 class="timeline-title">Persona Usage</h3>
            {#each PERSONAS as persona (persona.id)}
              {@const count = usageStats.reduce((sum, s) => sum + (s.personaUsage[persona.id] ?? 0), 0)}
              {#if count > 0}
                <div class="persona-stat-row">
                  <span class="persona-stat-name">{persona.icon} {persona.name}</span>
                  <div class="stat-bar-container">
                    <div class="stat-bar persona-bar" style="width: {totalTransforms > 0 ? Math.min(100, (count / totalTransforms) * 100) : 0}%"></div>
                  </div>
                  <span class="stat-count">{count}x</span>
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
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f13;
    color: #e2e8f0;
    min-width: 480px;
    max-width: 600px;
  }

  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  header {
    padding: 12px 16px 8px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    border-bottom: 1px solid #2d3748;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .logo {
    font-size: 18px;
    font-weight: 700;
    color: #a78bfa;
  }

  .hostname {
    font-size: 11px;
    color: #718096;
    background: #1a202c;
    padding: 2px 8px;
    border-radius: 10px;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #718096;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .ready-dot { background: #48bb78; }
  .loading-dot {
    background: #ed8936;
    animation: pulse 1s infinite;
  }
  .error-dot { background: #fc8181; }
  .idle-dot { background: #718096; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .retry-btn {
    background: none;
    border: 1px solid #718096;
    color: #718096;
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 10px;
  }

  .persona-bar {
    padding: 8px 16px;
    background: #111827;
    border-bottom: 1px solid #1f2937;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .persona-bar::-webkit-scrollbar { display: none; }

  .persona-label {
    font-size: 11px;
    color: #4b5563;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    display: block;
    margin-bottom: 6px;
  }

  .persona-pills {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pill {
    background: #1f2937;
    border: 1px solid #374151;
    color: #9ca3af;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .pill:hover {
    background: #374151;
    color: #e2e8f0;
  }

  .pill.active {
    background: #7c3aed;
    border-color: #7c3aed;
    color: white;
  }

  .tabs {
    display: flex;
    background: #111827;
    border-bottom: 1px solid #1f2937;
  }

  .tabs button {
    flex: 1;
    padding: 10px 8px;
    background: none;
    border: none;
    color: #6b7280;
    font-size: 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s;
  }

  .tabs button:hover {
    color: #e2e8f0;
    background: #1f2937;
  }

  .tabs button.active {
    color: #a78bfa;
    border-bottom-color: #a78bfa;
  }

  main {
    flex: 1;
    overflow-y: auto;
  }

  .transform-tab {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .text-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    font-size: 12px;
    font-weight: 600;
    color: #9ca3af;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .word-count {
    font-size: 11px;
    color: #4b5563;
  }

  .text-area {
    width: 100%;
    min-height: 120px;
    max-height: 300px;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 8px;
    color: #e2e8f0;
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    font-family: inherit;
    transition: border-color 0.15s;
  }

  .text-area:focus {
    outline: none;
    border-color: #7c3aed;
  }

  .action-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .persona-info {
    font-size: 12px;
    color: #6b7280;
  }

  .action-buttons {
    display: flex;
    gap: 6px;
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: #7c3aed;
    color: white;
  }

  .btn-primary:hover:not(:disabled) {
    background: #6d28d9;
  }

  .btn-secondary {
    background: #1f2937;
    color: #9ca3af;
    border: 1px solid #374151;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #374151;
    color: #e2e8f0;
  }

  .btn-danger {
    background: #7f1d1d;
    color: #fca5a5;
    border: 1px solid #991b1b;
  }

  .btn-danger:hover:not(:disabled) {
    background: #991b1b;
  }

  .btn-small {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 6px;
  }

  .output-actions {
    display: flex;
    gap: 8px;
  }

  .drafts-tab {
    padding: 12px 16px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #4b5563;
  }

  .empty-state span {
    font-size: 36px;
    display: block;
    margin-bottom: 8px;
  }

  .empty-state p {
    font-size: 14px;
    margin-bottom: 4px;
  }

  .hint {
    font-size: 12px;
    color: #374151;
  }

  .drafts-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .draft-card {
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 10px 12px;
  }

  .draft-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 4px;
    gap: 8px;
  }

  .draft-title {
    font-size: 13px;
    font-weight: 600;
    color: #e2e8f0;
    flex: 1;
  }

  .draft-meta {
    font-size: 10px;
    color: #6b7280;
    white-space: nowrap;
  }

  .draft-preview {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 8px;
    line-height: 1.4;
  }

  .draft-actions {
    display: flex;
    gap: 6px;
  }

  .websites-tab {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-desc {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.5;
  }

  .add-website {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .input {
    flex: 1;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 6px;
    color: #e2e8f0;
    padding: 6px 10px;
    font-size: 12px;
    font-family: inherit;
  }

  .input:focus {
    outline: none;
    border-color: #7c3aed;
  }

  .select {
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 6px;
    color: #e2e8f0;
    padding: 6px 8px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
  }

  .website-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .website-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 6px;
    padding: 8px 12px;
  }

  .site-name {
    flex: 1;
    font-size: 12px;
    color: #e2e8f0;
    font-family: monospace;
  }

  .site-persona {
    font-size: 11px;
    color: #9ca3af;
    white-space: nowrap;
  }

  .stats-tab {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .stats-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .stat-card {
    background: #1f2937;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 12px 8px;
    text-align: center;
  }

  .stat-value {
    display: block;
    font-size: 22px;
    font-weight: 700;
    color: #a78bfa;
    margin-bottom: 4px;
  }

  .stat-label {
    font-size: 10px;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stats-timeline, .persona-breakdown {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .timeline-title {
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .stat-row, .persona-stat-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .stat-date {
    width: 48px;
    color: #6b7280;
    flex-shrink: 0;
  }

  .persona-stat-name {
    width: 130px;
    color: #9ca3af;
    flex-shrink: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stat-bar-container {
    flex: 1;
    height: 6px;
    background: #374151;
    border-radius: 3px;
    overflow: hidden;
  }

  .stat-bar {
    height: 100%;
    background: #7c3aed;
    border-radius: 3px;
    transition: width 0.3s;
    min-width: 4px;
  }

  .persona-bar {
    background: #06b6d4;
  }

  .stat-count {
    width: 28px;
    color: #6b7280;
    text-align: right;
    flex-shrink: 0;
  }

  .stat-top-persona {
    width: 80px;
    color: #4b5563;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
