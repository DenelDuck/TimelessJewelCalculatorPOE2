/**
 * PoE2 Timeless Jewel Calculator — UI
 */
(async function () {
  const engine = new TimelessJewelEngine();

  const $loading = document.getElementById('loading');
  const $controls = document.getElementById('controls');
  const $results = document.getElementById('results');
  const $jewelType = document.getElementById('jewel-type');
  const $jewelSeed = document.getElementById('jewel-seed');
  const $keystoneVariant = document.getElementById('keystone-variant');
  const $jewelSocket = document.getElementById('jewel-socket');
  const $statSearch = document.getElementById('stat-search');
  const $calculateBtn = document.getElementById('calculate-btn');
  const $summary = document.getElementById('summary');
  const $nodeList = document.getElementById('node-list');

  // ─── Load data ───
  try {
    $loading.textContent = 'Loading game data...';
    await engine.load('./data/data.min.json', './data/tree403.json');
    $loading.classList.add('hidden');
    $controls.classList.remove('hidden');
  } catch (e) {
    $loading.textContent = `Error loading data: ${e.message}. Make sure data.min.json and tree403.json are in the calculator/data/ folder.`;
    console.error(e);
    return;
  }

  // ─── Populate controls ───

  // Jewel types
  const jewelTypes = engine.getJewelTypes();
  for (const jt of jewelTypes) {
    const opt = document.createElement('option');
    opt.value = jt.index;
    opt.textContent = jt.id;
    $jewelType.appendChild(opt);
  }

  // Jewel sockets — find nearest class start to label each socket
  const classNames = {
    StrFour: 'Warrior', StrFourb: 'Warrior', DexFour: 'Ranger', DexFourb: 'Ranger',
    IntFour: 'Witch', IntFourb: 'Witch', StrDexFour: 'Mercenary', StrDexFourb: 'Mercenary',
    StrIntFour: 'Monk', StrIntFourb: 'Monk', DexIntFour: 'Sorceress', DexIntFourb: 'Sorceress'
  };
  const charStarts = engine.getCharacterStarts(classNames);
  const sockets = engine.getJewelSockets()
    .map(socket => {
      let nearestClass = '', bestDist = Infinity;
      for (const cs of charStarts) {
        const dx = socket.x - cs.x, dy = socket.y - cs.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; nearestClass = cs.label; }
      }
      return { ...socket, nearestClass };
    })
    .sort((a, b) => a.nearestClass.localeCompare(b.nearestClass) || a.nodeId - b.nodeId);
  for (const socket of sockets) {
    const opt = document.createElement('option');
    opt.value = socket.nodeId;
    const nodesInRadius = engine.getNodesInRadius(socket.nodeId);
    opt.textContent = `${socket.nearestClass} area — Socket #${socket.nodeId} (${nodesInRadius.length} nodes)`;
    $jewelSocket.appendChild(opt);
  }

  // Keystone variants (update when jewel type changes)
  function updateKeystoneVariants() {
    const versionIndex = Number($jewelType.value);
    $keystoneVariant.innerHTML = '';
    const variants = engine.getKeystoneVariants(versionIndex);
    for (const v of variants) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify({ keystone: v.keystone, revision: v.revision });
      opt.textContent = v.name;
      $keystoneVariant.appendChild(opt);
    }
  }
  $jewelType.addEventListener('change', updateKeystoneVariants);
  updateKeystoneVariants();

  // ─── Apply URL parameters ───
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('type')) {
    $jewelType.value = urlParams.get('type');
    updateKeystoneVariants();
  }
  if (urlParams.has('seed')) $jewelSeed.value = urlParams.get('seed');
  if (urlParams.has('socket')) {
    // Wait for sockets to be populated, then select
    const targetSocket = urlParams.get('socket');
    for (const opt of $jewelSocket.options) {
      if (opt.value === targetSocket) { $jewelSocket.value = targetSocket; break; }
    }
  }

  // ─── Calculate ───

  function formatStatLine(statId, value, isAdded) {
    const text = engine.translateStat(statId, value);
    const cls = isAdded ? 'stat-line added' : 'stat-line';
    return `<div class="${cls}">${escapeHtml(text)}</div>`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderResults(results, searchTerm) {
    $results.classList.remove('hidden');

    // Filter by search
    let filtered = results;
    if (searchTerm) {
      const terms = searchTerm.toLowerCase().split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      filtered = results.filter(r => {
        const allStats = Object.keys(r.mutated.stats);
        const statTexts = allStats.map(id => engine.translateStat(id, r.mutated.stats[id]).toLowerCase());
        const nameText = (r.mutated.name || '').toLowerCase();
        return terms.some(term =>
          statTexts.some(t => t.includes(term)) ||
          nameText.includes(term) ||
          allStats.some(id => id.includes(term))
        );
      });
    }

    // Summary
    const keystones = filtered.filter(r => r.type === 'keystone').length;
    const notables = filtered.filter(r => r.type === 'notable').length;
    const smalls = filtered.filter(r => r.type === 'small').length;
    const replaced = filtered.filter(r => r.mutated.replaced).length;

    $summary.innerHTML = `
      <span class="count">${filtered.length}</span> nodes shown
      (${keystones} keystones, ${notables} notables, ${smalls} small)
      — <span class="count">${replaced}</span> replaced
      ${searchTerm ? ` — filtered by "${escapeHtml(searchTerm)}"` : ''}
      ${filtered.length < results.length ? ` (${results.length} total in radius)` : ''}
    `;

    // Sort: keystones first, then notables, then small
    const order = { keystone: 0, notable: 1, small: 2 };
    filtered.sort((a, b) => (order[a.type] || 2) - (order[b.type] || 2));

    $nodeList.innerHTML = '';
    for (const r of filtered) {
      const card = document.createElement('div');
      card.className = `node-card ${r.type}`;
      if (searchTerm && r.mutated.replaced) card.classList.add('highlight');

      // Node type badge
      const typeBadge = r.mutated.replaced ? `${r.type} → replaced` : r.type;

      // Original name
      const originalLine = r.mutated.replaced
        ? `<div class="node-original">Was: <span class="name">${escapeHtml(r.original.name)}</span></div>`
        : '';

      // Stats
      let statsHtml = '';
      for (const [statId, value] of Object.entries(r.mutated.stats)) {
        const isAdded = r.mutated.addedStats && r.mutated.addedStats[statId];
        statsHtml += formatStatLine(statId, value, isAdded);
      }

      // Flavour text
      const flavourHtml = r.mutated.flavour_text
        ? `<div class="node-flavour">${escapeHtml(r.mutated.flavour_text)}</div>`
        : '';

      card.innerHTML = `
        <div class="node-header">
          <span class="node-name">${escapeHtml(r.mutated.name || r.original.name)}</span>
          <span class="node-type">${typeBadge}</span>
        </div>
        ${originalLine}
        <div class="node-stats">${statsHtml}</div>
        ${flavourHtml}
        <div class="node-id">Node #${r.nodeId}</div>
      `;
      $nodeList.appendChild(card);
    }
  }

  let lastResults = null;

  function doCalculate() {
    const versionIndex = Number($jewelType.value);
    const seed = Number($jewelSeed.value);
    const socketId = Number($jewelSocket.value);
    const ksData = JSON.parse($keystoneVariant.value || '{}');
    const keystoneId = ksData.keystone || 1;
    const revision = ksData.revision || 0;

    lastResults = engine.calculateAll(socketId, versionIndex, seed, keystoneId, revision);
    renderResults(lastResults, $statSearch.value.trim());
  }

  $calculateBtn.addEventListener('click', doCalculate);

  // Re-filter on search change
  $statSearch.addEventListener('input', () => {
    if (lastResults) renderResults(lastResults, $statSearch.value.trim());
  });

  // Enter key on seed triggers calculate
  $jewelSeed.addEventListener('keydown', e => {
    if (e.key === 'Enter') doCalculate();
  });
  $statSearch.addEventListener('keydown', e => {
    if (e.key === 'Enter') doCalculate();
  });

  // ═══════════════════════════════════════════
  //  Seed Scanner
  // ═══════════════════════════════════════════

  const $scanner = document.getElementById('scanner');
  const $statPickerSearch = document.getElementById('stat-picker-search');
  const $statDropdown = document.getElementById('stat-picker-dropdown');
  const $selectedStats = document.getElementById('selected-stats');
  const $scanSeedMin = document.getElementById('scan-seed-min');
  const $scanSeedMax = document.getElementById('scan-seed-max');
  const $scanBtn = document.getElementById('scan-btn');
  const $scanAbortBtn = document.getElementById('scan-abort-btn');
  const $scanProgress = document.getElementById('scan-progress');
  const $scanProgressFill = document.getElementById('scan-progress-fill');
  const $scanProgressText = document.getElementById('scan-progress-text');
  const $scanResults = document.getElementById('scan-results');
  const $scanSummary = document.getElementById('scan-summary');
  const $scanTableBody = document.getElementById('scan-table-body');

  // Show scanner once data is loaded
  $scanner.classList.remove('hidden');

  // All possible stats from timeless jewels
  const allStats = engine.getAllTimelessStats();
  const selectedStatIds = new Set();
  let worker = null;

  // ─── Stat picker autocomplete ───

  function renderDropdown(filter) {
    $statDropdown.innerHTML = '';
    const lower = filter.toLowerCase();
    const matches = allStats.filter(s =>
      !selectedStatIds.has(s.id) &&
      (s.translated.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower))
    ).slice(0, 30);

    if (matches.length === 0) {
      $statDropdown.classList.add('hidden');
      return;
    }

    for (const s of matches) {
      const div = document.createElement('div');
      div.className = 'stat-option';
      div.innerHTML = `${escapeHtml(s.translated)} <span class="stat-id">${escapeHtml(s.id)}</span>`;
      div.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent blur before click fires
        addStat(s.id);
        $statPickerSearch.value = '';
        $statDropdown.classList.add('hidden');
      });
      $statDropdown.appendChild(div);
    }
    $statDropdown.classList.remove('hidden');
  }

  $statPickerSearch.addEventListener('input', () => {
    const val = $statPickerSearch.value.trim();
    if (val.length > 0) renderDropdown(val);
    else $statDropdown.classList.add('hidden');
  });

  $statPickerSearch.addEventListener('focus', () => {
    const val = $statPickerSearch.value.trim();
    if (val.length > 0) renderDropdown(val);
  });

  $statPickerSearch.addEventListener('blur', () => {
    // Small delay to allow mousedown on dropdown to fire
    setTimeout(() => $statDropdown.classList.add('hidden'), 150);
  });

  function addStat(statId) {
    if (selectedStatIds.has(statId)) return;
    selectedStatIds.add(statId);
    renderSelectedStats();
  }

  function removeStat(statId) {
    selectedStatIds.delete(statId);
    renderSelectedStats();
  }

  function renderSelectedStats() {
    $selectedStats.innerHTML = '';
    for (const id of selectedStatIds) {
      const info = allStats.find(s => s.id === id);
      const tag = document.createElement('span');
      tag.className = 'stat-tag';
      tag.innerHTML = `${escapeHtml(info?.translated || id)} <span class="remove" data-id="${escapeHtml(id)}">&times;</span>`;
      tag.querySelector('.remove').addEventListener('click', () => removeStat(id));
      $selectedStats.appendChild(tag);
    }
  }

  // ─── Scanner ───

  function initWorker() {
    if (worker) worker.terminate();
    worker = new Worker('scanner-worker.js');
    worker.postMessage({
      type: 'init',
      engineUrl: 'engine.js',
      dataUrl: './data/data.min.json',
      treeUrl: './data/tree403.json'
    });
    return new Promise((resolve, reject) => {
      worker.onmessage = function handler(e) {
        if (e.data.type === 'ready') {
          worker.onmessage = null;
          resolve();
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message));
        }
      };
    });
  }

  let scanning = false;

  $scanBtn.addEventListener('click', async () => {
    if (scanning) return;
    if (selectedStatIds.size === 0) {
      alert('Please select at least one stat to search for.');
      return;
    }

    scanning = true;
    $scanBtn.disabled = true;
    $scanAbortBtn.classList.remove('hidden');
    $scanProgress.classList.remove('hidden');
    $scanResults.classList.add('hidden');
    $scanProgressFill.style.width = '0%';
    $scanProgressText.textContent = 'Initializing scanner...';

    try {
      await initWorker();

      const versionIndex = Number($jewelType.value);
      const socketId = Number($jewelSocket.value);
      const ksData = JSON.parse($keystoneVariant.value || '{}');

      worker.postMessage({
        type: 'scan',
        socketId,
        versionIndex,
        keystoneId: ksData.keystone || 1,
        revision: ksData.revision || 0,
        searchStatIds: [...selectedStatIds],
        seedMin: Number($scanSeedMin.value) || 1,
        seedMax: Number($scanSeedMax.value) || 8000
      });

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          const pct = ((msg.scanned / msg.total) * 100).toFixed(1);
          $scanProgressFill.style.width = pct + '%';
          $scanProgressText.textContent = `Scanned ${msg.scanned.toLocaleString()} / ${msg.total.toLocaleString()} seeds (${pct}%)`;
        } else if (msg.type === 'result') {
          finishScan(msg);
        } else if (msg.type === 'aborted') {
          $scanProgressText.textContent = 'Scan aborted.';
          scanning = false;
          $scanBtn.disabled = false;
          $scanAbortBtn.classList.add('hidden');
        }
      };
    } catch (err) {
      $scanProgressText.textContent = `Error: ${err.message}`;
      scanning = false;
      $scanBtn.disabled = false;
      $scanAbortBtn.classList.add('hidden');
    }
  });

  $scanAbortBtn.addEventListener('click', () => {
    if (worker) worker.postMessage({ type: 'abort' });
  });

  function finishScan(msg) {
    scanning = false;
    $scanBtn.disabled = false;
    $scanAbortBtn.classList.add('hidden');
    $scanProgressFill.style.width = '100%';
    $scanProgressText.textContent = `Done! Scanned ${msg.totalSeeds.toLocaleString()} seeds.`;

    $scanResults.classList.remove('hidden');
    $scanSummary.innerHTML =
      `<span class="count">${msg.seedsWithMatches.toLocaleString()}</span> seeds have matching stats out of ` +
      `<span class="count">${msg.totalSeeds.toLocaleString()}</span> scanned. Showing top ${msg.rankings.length}.`;

    $scanTableBody.innerHTML = '';
    msg.rankings.forEach((row, i) => {
      const tr = document.createElement('tr');

      // Stat breakdown
      let breakdownHtml = '';
      for (const [sid, val] of Object.entries(row.matchingStats)) {
        const text = engine.translateStat(sid, val);
        breakdownHtml += `<span>${escapeHtml(text)}</span> `;
      }

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><strong>${row.seed}</strong></td>
        <td>${row.matchCount}</td>
        <td>${row.totalValue}</td>
        <td class="stat-breakdown">${breakdownHtml}</td>
        <td><button class="use-seed-btn" data-seed="${row.seed}">Use</button></td>
      `;
      tr.querySelector('.use-seed-btn').addEventListener('click', () => {
        $jewelSeed.value = row.seed;
        doCalculate();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      $scanTableBody.appendChild(tr);
    });
  }
})();
