/**
 * PoE2 Timeless Jewel — Interactive Skill Tree Renderer
 *
 * Canvas-based rendering with pan/zoom, jewel socket selection,
 * radius visualization, and timeless jewel mutation overlay.
 */
(async function () {
  'use strict';

  // ─── Constants ───
  const NODE_RADIUS = { small: 28, notable: 42, keystone: 56, socket: 38, start: 32 };
  const COLORS = {
    bg: '#0d0d1a',
    edge: '#2a2a3e',
    edgeHighlight: '#555',
    small: { fill: '#1e2a40', stroke: '#445', text: '#999' },
    notable: { fill: '#2a2010', stroke: '#c8a86e', text: '#c8a86e' },
    keystone: { fill: '#2a1015', stroke: '#e74c3c', text: '#e74c3c' },
    socket: { fill: '#1a102a', stroke: '#da70d6', text: '#da70d6' },
    start: { fill: '#102a1a', stroke: '#4a8', text: '#4a8' },
    allocated: { fill: '#1a3050', stroke: '#7ec8e3' },
    radiusFill: 'rgba(200, 168, 110, 0.06)',
    radiusStroke: 'rgba(200, 168, 110, 0.35)',
    mutatedFill: 'rgba(200, 168, 110, 0.12)',
    mutatedStroke: '#c8a86e',
    socketSelected: '#f0d090',
    hoverStroke: '#fff'
  };

  // ─── State ───
  const engine = new TimelessJewelEngine();
  let treeNodes = {};        // nodeId → { x, y, skill, type, r, connections: [nodeId] }
  let edgeList = [];         // [{from, to}]
  let jewelSockets = [];     // [nodeId, ...]
  let selectedSocket = null; // nodeId or null
  let mutationResults = null;// Map nodeId → mutated result
  let hoveredNode = null;

  // Camera
  let camX = 0, camY = 0, camZoom = 0.03;

  // Canvas
  const canvas = document.getElementById('tree-canvas');
  const ctx = canvas.getContext('2d');

  // ─── Load data ───
  const $loading = document.getElementById('loading');
  try {
    await engine.load('./data/data.min.json', './data/tree403.json');
  } catch (e) {
    $loading.textContent = `Error: ${e.message}`;
    return;
  }

  buildTreeGraph();
  initControls();
  resizeCanvas();
  centerCamera();
  $loading.classList.add('hidden');

  // ─── Build graph from engine data ───
  function buildTreeGraph() {
    const { nodes, groups } = engine.tree.passive_tree;
    const skills = engine.tree.passive_skills;
    const edgesSet = new Set();

    for (const [idStr, node] of Object.entries(nodes)) {
      const id = Number(idStr);
      const skill = skills[node.skill_id];
      if (!skill) continue;
      if (skill.ascendancy) continue; // skip ascendancy nodes

      const pos = engine.nodePositions[id];
      if (!pos) continue;

      let type = 'small';
      if (skill.is_keystone) type = 'keystone';
      else if (skill.is_notable) type = 'notable';
      else if (skill.is_jewel_socket) type = 'socket';
      else if (skill.starting_node) type = 'start';

      treeNodes[id] = {
        x: pos.x, y: pos.y,
        skill, type,
        r: NODE_RADIUS[type],
        connections: (node.connections || []).map(c => c.id)
      };

      if (skill.is_jewel_socket && !skill.ascendancy) {
        jewelSockets.push(id);
      }

      // Edges (deduplicate)
      for (const conn of node.connections || []) {
        const a = Math.min(id, conn.id), b = Math.max(id, conn.id);
        const key = a + '|' + b;
        if (!edgesSet.has(key)) {
          edgesSet.add(key);
          edgeList.push({ from: a, to: b });
        }
      }
    }
  }

  // ─── Controls ───
  function initControls() {
    const $jewelType = document.getElementById('jewel-type');
    const $keystoneVariant = document.getElementById('keystone-variant');
    const $applyBtn = document.getElementById('apply-btn');
    const $clearBtn = document.getElementById('clear-btn');

    // Populate jewel types
    for (const jt of engine.getJewelTypes()) {
      const opt = document.createElement('option');
      opt.value = jt.index;
      opt.textContent = jt.id;
      $jewelType.appendChild(opt);
    }

    function updateKeystoneVariants() {
      const versionIndex = Number($jewelType.value);
      $keystoneVariant.innerHTML = '';
      for (const v of engine.getKeystoneVariants(versionIndex)) {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ keystone: v.keystone, revision: v.revision });
        opt.textContent = v.name;
        $keystoneVariant.appendChild(opt);
      }
    }
    $jewelType.addEventListener('change', updateKeystoneVariants);
    updateKeystoneVariants();

    $applyBtn.addEventListener('click', () => {
      if (selectedSocket) applyMutation();
    });
    $clearBtn.addEventListener('click', () => {
      mutationResults = null;
      updateSidePanel();
      requestDraw();
    });

    // Side panel close
    document.querySelector('.sp-close').addEventListener('click', () => {
      selectedSocket = null;
      mutationResults = null;
      document.getElementById('side-panel').classList.remove('visible');
      requestDraw();
    });

    // Side panel search
    document.getElementById('sp-search').addEventListener('input', updateSidePanel);
  }

  function applyMutation() {
    const versionIndex = Number(document.getElementById('jewel-type').value);
    const seed = Number(document.getElementById('jewel-seed').value);
    const ksData = JSON.parse(document.getElementById('keystone-variant').value || '{}');
    const results = engine.calculateAll(selectedSocket, versionIndex, seed, ksData.keystone || 1, ksData.revision || 0);

    mutationResults = new Map();
    for (const r of results) {
      mutationResults.set(r.nodeId, r);
    }
    updateSidePanel();
    requestDraw();
  }

  // ─── Camera ───
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function centerCamera() {
    // Center on the tree
    let sumX = 0, sumY = 0, count = 0;
    for (const n of Object.values(treeNodes)) {
      sumX += n.x; sumY += n.y; count++;
    }
    if (count) {
      camX = sumX / count;
      camY = sumY / count;
    }
    // Fit the tree on screen
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of Object.values(treeNodes)) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const treeW = maxX - minX + 2000;
    const treeH = maxY - minY + 2000;
    camZoom = Math.min(canvas.width / treeW, canvas.height / treeH) * 0.95;
  }

  function worldToScreen(wx, wy) {
    const sx = (wx - camX) * camZoom + canvas.width / 2;
    const sy = (wy - camY) * camZoom + canvas.height / 2;
    return { x: sx, y: sy };
  }

  function screenToWorld(sx, sy) {
    const wx = (sx - canvas.width / 2) / camZoom + camX;
    const wy = (sy - canvas.height / 2) / camZoom + camY;
    return { x: wx, y: wy };
  }

  // ─── Input handling ───
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let dragCamStartX = 0, dragCamStartY = 0;
  let didDragMove = false;

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    isDragging = true;
    didDragMove = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragCamStartX = camX;
    dragCamStartY = camY;
    canvas.classList.add('grabbing');
  });

  window.addEventListener('mousemove', e => {
    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragMove = true;
      camX = dragCamStartX - dx / camZoom;
      camY = dragCamStartY - dy / camZoom;
      requestDraw();
    }
    updateHover(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', e => {
    if (isDragging) {
      isDragging = false;
      canvas.classList.remove('grabbing');
      if (!didDragMove) {
        handleClick(e.clientX, e.clientY);
      }
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const mouseWorld = screenToWorld(e.clientX, e.clientY);
    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.005, Math.min(0.5, camZoom * zoomFactor));

    // Zoom toward mouse position
    camX = mouseWorld.x - (e.clientX - canvas.width / 2) / newZoom;
    camY = mouseWorld.y - (e.clientY - canvas.height / 2) / newZoom;
    camZoom = newZoom;
    requestDraw();
    updateHover(e.clientX, e.clientY);
  }, { passive: false });

  // Touch support for mobile
  let lastTouchDist = 0;
  let lastTouchMid = null;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      didDragMove = false;
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      dragCamStartX = camX;
      dragCamStartY = camY;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const t = e.touches;
      lastTouchDist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      lastTouchMid = { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - dragStartX;
      const dy = e.touches[0].clientY - dragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragMove = true;
      camX = dragCamStartX - dx / camZoom;
      camY = dragCamStartY - dy / camZoom;
      requestDraw();
    } else if (e.touches.length === 2 && lastTouchMid) {
      const t = e.touches;
      const dist = Math.hypot(t[1].clientX - t[0].clientX, t[1].clientY - t[0].clientY);
      const mid = { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
      const scale = dist / lastTouchDist;
      const mouseWorld = screenToWorld(mid.x, mid.y);
      const newZoom = Math.max(0.005, Math.min(0.5, camZoom * scale));
      camX = mouseWorld.x - (mid.x - canvas.width / 2) / newZoom;
      camY = mouseWorld.y - (mid.y - canvas.height / 2) / newZoom;
      camZoom = newZoom;
      lastTouchDist = dist;
      lastTouchMid = mid;
      requestDraw();
    }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length === 0 && !didDragMove) {
      handleClick(dragStartX, dragStartY);
    }
    isDragging = false;
    lastTouchMid = null;
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    requestDraw();
  });

  // ─── Hit testing ───
  function nodeAtScreen(sx, sy) {
    const world = screenToWorld(sx, sy);
    let best = null, bestD2 = Infinity;
    // Only test nodes that would be visible — use a generous range
    for (const [idStr, n] of Object.entries(treeNodes)) {
      const dx = n.x - world.x, dy = n.y - world.y;
      const d2 = dx * dx + dy * dy;
      const hitR = n.r * 1.3; // slightly generous
      if (d2 < hitR * hitR && d2 < bestD2) {
        bestD2 = d2;
        best = Number(idStr);
      }
    }
    return best;
  }

  function updateHover(sx, sy) {
    const nodeId = nodeAtScreen(sx, sy);
    if (nodeId !== hoveredNode) {
      hoveredNode = nodeId;
      requestDraw();
      updateTooltip(sx, sy, nodeId);
    } else if (nodeId) {
      updateTooltip(sx, sy, nodeId);
    } else {
      hideTooltip();
    }
  }

  function handleClick(sx, sy) {
    const nodeId = nodeAtScreen(sx, sy);
    if (nodeId && treeNodes[nodeId].type === 'socket') {
      selectSocket(nodeId);
    }
  }

  // ─── Socket selection ───
  function selectSocket(nodeId) {
    selectedSocket = nodeId;
    mutationResults = null;
    // Auto-apply if seed > 0
    const seed = Number(document.getElementById('jewel-seed').value);
    if (seed > 0) applyMutation();
    else updateSidePanel();
    requestDraw();
  }

  // ─── Tooltip ───
  const $tooltip = document.getElementById('tooltip');

  function updateTooltip(sx, sy, nodeId) {
    if (!nodeId) { hideTooltip(); return; }
    const n = treeNodes[nodeId];
    if (!n) { hideTooltip(); return; }

    let html = '';
    const mutation = mutationResults?.get(nodeId);

    if (mutation && mutation.mutated) {
      const m = mutation.mutated;
      const typeClass = n.type === 'socket' ? 'socket' : (m.is_keystone ? 'keystone' : m.is_notable ? 'notable' : 'small');
      html += `<div class="tt-name ${typeClass}">${esc(m.name || n.skill.name)}</div>`;
      if (m.replaced) {
        html += `<div class="tt-replaced">Replaces: ${esc(n.skill.name)}</div>`;
      }
      for (const [statId, val] of Object.entries(m.stats)) {
        const isAdded = m.addedStats && m.addedStats[statId];
        html += `<div class="tt-stat${isAdded ? ' added' : ''}">${esc(engine.translateStat(statId, val))}</div>`;
      }
      if (m.flavour_text) html += `<div class="tt-flavour">${esc(m.flavour_text)}</div>`;
    } else {
      const typeClass = n.type;
      html += `<div class="tt-name ${typeClass}">${esc(n.skill.name)}</div>`;
      if (n.type === 'socket') {
        html += `<div class="tt-stat">Click to select this jewel socket</div>`;
      } else {
        for (const [statId, val] of Object.entries(n.skill.stats || {})) {
          html += `<div class="tt-stat">${esc(engine.translateStat(statId, val))}</div>`;
        }
      }
      if (n.skill.flavour_text) html += `<div class="tt-flavour">${esc(n.skill.flavour_text)}</div>`;
    }
    html += `<div class="tt-id">Node #${nodeId}</div>`;

    $tooltip.innerHTML = html;
    $tooltip.style.display = 'block';

    // Position tooltip near cursor
    const pad = 14;
    let tx = sx + pad, ty = sy + pad;
    const rect = $tooltip.getBoundingClientRect();
    if (tx + rect.width > window.innerWidth - 10) tx = sx - rect.width - pad;
    if (ty + rect.height > window.innerHeight - 10) ty = sy - rect.height - pad;
    $tooltip.style.left = tx + 'px';
    $tooltip.style.top = ty + 'px';
  }

  function hideTooltip() {
    $tooltip.style.display = 'none';
  }

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Side panel ───
  function updateSidePanel() {
    const $panel = document.getElementById('side-panel');
    if (!selectedSocket) {
      $panel.classList.remove('visible');
      return;
    }
    $panel.classList.add('visible');

    const socketNode = treeNodes[selectedSocket];
    document.getElementById('sp-title').textContent = `Socket #${selectedSocket}`;

    // Link to calculator
    const vIdx = document.getElementById('jewel-type').value;
    const seed = document.getElementById('jewel-seed').value;
    document.getElementById('sp-calc-link').href =
      `index.html?socket=${selectedSocket}&type=${vIdx}&seed=${seed}`;

    const nodesInRadius = engine.getNodesInRadius(selectedSocket);
    const searchTerm = document.getElementById('sp-search').value.trim().toLowerCase();

    let items = nodesInRadius.map(({ nodeId, skill }) => {
      const mutation = mutationResults?.get(nodeId);
      return { nodeId, skill, mutation };
    });

    // Filter by search
    if (searchTerm) {
      const terms = searchTerm.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
      items = items.filter(item => {
        const m = item.mutation?.mutated;
        const stats = m ? m.stats : item.skill.stats;
        const name = (m?.name || item.skill.name || '').toLowerCase();
        return terms.some(term => {
          if (name.includes(term)) return true;
          for (const [sid, val] of Object.entries(stats || {})) {
            if (engine.translateStat(sid, val).toLowerCase().includes(term)) return true;
          }
          return false;
        });
      });
    }

    // Summary
    const keystones = items.filter(i => (i.mutation?.mutated || i.skill).is_keystone).length;
    const notables = items.filter(i => (i.mutation?.mutated || i.skill).is_notable).length;
    const smalls = items.length - keystones - notables;
    const replaced = items.filter(i => i.mutation?.mutated?.replaced).length;

    document.getElementById('sp-summary').innerHTML =
      `<span class="count">${items.length}</span> nodes` +
      (mutationResults ? ` — <span class="count">${replaced}</span> replaced` : '') +
      (searchTerm ? ` — filtered` : '') +
      ` (${nodesInRadius.length} total)`;

    // Render nodes
    const $nodes = document.getElementById('sp-nodes');
    $nodes.innerHTML = '';

    // Sort: keystones, notables, smalls
    const order = n => n.skill.is_keystone ? 0 : n.skill.is_notable ? 1 : 2;
    items.sort((a, b) => order(a) - order(b));

    for (const item of items) {
      const div = document.createElement('div');
      const m = item.mutation?.mutated;
      const type = m ? (m.is_keystone ? 'keystone' : m.is_notable ? 'notable' : 'small') :
        (item.skill.is_keystone ? 'keystone' : item.skill.is_notable ? 'notable' : 'small');
      div.className = `sp-node ${type}`;

      let html = `<div class="sp-name">${esc(m?.name || item.skill.name)}</div>`;
      if (m?.replaced) {
        html += `<div class="sp-original">Was: ${esc(item.skill.name)}</div>`;
      }
      const stats = m ? m.stats : item.skill.stats;
      for (const [sid, val] of Object.entries(stats || {})) {
        const isAdded = m?.addedStats?.[sid];
        html += `<div class="sp-stat${isAdded ? ' added' : ''}">${esc(engine.translateStat(sid, val))}</div>`;
      }
      div.innerHTML = html;
      $nodes.appendChild(div);
    }
  }

  // ─── Drawing ───
  let drawQueued = false;
  function requestDraw() {
    if (!drawQueued) {
      drawQueued = true;
      requestAnimationFrame(draw);
    }
  }

  function draw() {
    drawQueued = false;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // Visible bounds in world coords (with padding)
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(W, H);
    const pad = 200;
    const viewMinX = tl.x - pad, viewMaxX = br.x + pad;
    const viewMinY = tl.y - pad, viewMaxY = br.y + pad;

    // Determine what's visible
    const visibleNodes = new Set();
    for (const [idStr, n] of Object.entries(treeNodes)) {
      if (n.x >= viewMinX && n.x <= viewMaxX && n.y >= viewMinY && n.y <= viewMaxY) {
        visibleNodes.add(Number(idStr));
      }
    }

    // Nodes in radius of selected socket
    const inRadius = new Set();
    if (selectedSocket) {
      const nodesInR = engine.getNodesInRadius(selectedSocket);
      for (const { nodeId } of nodesInR) inRadius.add(nodeId);
    }

    // ─── Draw radius circle ───
    if (selectedSocket && treeNodes[selectedSocket]) {
      const sc = treeNodes[selectedSocket];
      const baseRadius = engine.data.jewel_radii[5]?.radius || 1300;
      const maxRadius = baseRadius * 1.2;
      const sPos = worldToScreen(sc.x, sc.y);
      const sR = maxRadius * camZoom;
      ctx.beginPath();
      ctx.arc(sPos.x, sPos.y, sR, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.radiusFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.radiusStroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ─── Draw edges ───
    // At low zoom, skip edges for performance
    const drawEdges = camZoom > 0.012;
    if (drawEdges) {
      ctx.lineWidth = Math.max(1, 2 * camZoom / 0.03);
      for (const e of edgeList) {
        const fromN = treeNodes[e.from], toN = treeNodes[e.to];
        if (!fromN || !toN) continue;
        // Skip if both not visible
        if (!visibleNodes.has(e.from) && !visibleNodes.has(e.to)) continue;

        const fromS = worldToScreen(fromN.x, fromN.y);
        const toS = worldToScreen(toN.x, toN.y);

        // Highlight edges within radius
        const edgeInRadius = selectedSocket && inRadius.has(e.from) && inRadius.has(e.to);
        ctx.strokeStyle = edgeInRadius ? COLORS.edgeHighlight : COLORS.edge;

        ctx.beginPath();
        ctx.moveTo(fromS.x, fromS.y);
        ctx.lineTo(toS.x, toS.y);
        ctx.stroke();
      }
    }

    // ─── Draw nodes ───
    const screenR = (r) => Math.max(3, r * camZoom);

    for (const nodeId of visibleNodes) {
      const n = treeNodes[nodeId];
      const sPos = worldToScreen(n.x, n.y);
      const r = screenR(n.r);

      // Skip tiny nodes at far zoom
      if (r < 1.5 && n.type === 'small') continue;

      const isInRadius = inRadius.has(nodeId);
      const isMutated = mutationResults?.has(nodeId);
      const isSelected = nodeId === selectedSocket;
      const isHovered = nodeId === hoveredNode;
      const isSocket = n.type === 'socket';

      // Node fill
      let fillColor, strokeColor;
      if (isMutated) {
        fillColor = COLORS.mutatedFill;
        strokeColor = COLORS.mutatedStroke;
      } else if (isSelected) {
        fillColor = COLORS.socket.fill;
        strokeColor = COLORS.socketSelected;
      } else {
        const palette = COLORS[n.type] || COLORS.small;
        fillColor = palette.fill;
        strokeColor = isInRadius ? '#88a' : palette.stroke;
      }

      if (isHovered) strokeColor = COLORS.hoverStroke;

      // Draw shape
      ctx.beginPath();
      if (isSocket) {
        // Diamond shape for jewel sockets
        ctx.moveTo(sPos.x, sPos.y - r);
        ctx.lineTo(sPos.x + r, sPos.y);
        ctx.lineTo(sPos.x, sPos.y + r);
        ctx.lineTo(sPos.x - r, sPos.y);
        ctx.closePath();
      } else if (n.type === 'keystone') {
        // Octagon for keystones
        const sides = 8;
        for (let i = 0; i < sides; i++) {
          const a = (Math.PI * 2 * i / sides) - Math.PI / 2;
          const px = sPos.x + r * Math.cos(a);
          const py = sPos.y + r * Math.sin(a);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else if (n.type === 'notable') {
        // Rounded-square for notables
        const hr = r * 0.85;
        ctx.moveTo(sPos.x - hr, sPos.y - r);
        ctx.lineTo(sPos.x + hr, sPos.y - r);
        ctx.quadraticCurveTo(sPos.x + r, sPos.y - r, sPos.x + r, sPos.y - hr);
        ctx.lineTo(sPos.x + r, sPos.y + hr);
        ctx.quadraticCurveTo(sPos.x + r, sPos.y + r, sPos.x + hr, sPos.y + r);
        ctx.lineTo(sPos.x - hr, sPos.y + r);
        ctx.quadraticCurveTo(sPos.x - r, sPos.y + r, sPos.x - r, sPos.y + hr);
        ctx.lineTo(sPos.x - r, sPos.y - hr);
        ctx.quadraticCurveTo(sPos.x - r, sPos.y - r, sPos.x - hr, sPos.y - r);
      } else {
        // Circle for small passives and start nodes
        ctx.arc(sPos.x, sPos.y, r, 0, Math.PI * 2);
      }

      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = isHovered ? 3 : (isSelected ? 3 : (isMutated ? 2 : 1.5));
      ctx.stroke();

      // Label text at sufficient zoom
      if (r >= 10) {
        const name = n.skill.name || '';
        if (name && n.type !== 'small') {
          ctx.fillStyle = COLORS[n.type]?.text || '#999';
          const fontSize = Math.min(14, Math.max(8, r * 0.5));
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Truncate name to fit
          const maxChars = Math.floor(r * 2 / (fontSize * 0.55));
          const label = name.length > maxChars ? name.substring(0, maxChars - 1) + '…' : name;
          ctx.fillText(label, sPos.x, sPos.y);
        }
      }
    }

    // ─── Draw socket indicators (always visible even at low zoom) ───
    for (const sid of jewelSockets) {
      const n = treeNodes[sid];
      if (!n) continue;
      const sPos = worldToScreen(n.x, n.y);
      // Don't double-draw if already visible
      if (visibleNodes.has(sid)) continue;
      const r = Math.max(4, NODE_RADIUS.socket * camZoom);
      ctx.beginPath();
      ctx.moveTo(sPos.x, sPos.y - r);
      ctx.lineTo(sPos.x + r, sPos.y);
      ctx.lineTo(sPos.x, sPos.y + r);
      ctx.lineTo(sPos.x - r, sPos.y);
      ctx.closePath();
      ctx.fillStyle = sid === selectedSocket ? COLORS.socketSelected : COLORS.socket.stroke;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ─── Mini-legend ───
    drawLegend();
  }

  function drawLegend() {
    const x = 12, y = canvas.height - 100;
    ctx.fillStyle = 'rgba(22,33,62,0.85)';
    ctx.fillRect(x, y, 160, 92);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, 160, 92);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const items = [
      { label: 'Small Passive', color: COLORS.small.stroke, shape: 'circle' },
      { label: 'Notable', color: COLORS.notable.stroke, shape: 'square' },
      { label: 'Keystone', color: COLORS.keystone.stroke, shape: 'octagon' },
      { label: 'Jewel Socket', color: COLORS.socket.stroke, shape: 'diamond' },
    ];
    items.forEach((item, i) => {
      const iy = y + 14 + i * 19;
      ctx.fillStyle = item.color;
      if (item.shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(x + 14, iy - 6); ctx.lineTo(x + 20, iy);
        ctx.lineTo(x + 14, iy + 6); ctx.lineTo(x + 8, iy);
        ctx.closePath(); ctx.fill();
      } else if (item.shape === 'square') {
        ctx.fillRect(x + 8, iy - 5, 12, 10);
      } else if (item.shape === 'octagon') {
        ctx.beginPath();
        for (let j = 0; j < 8; j++) {
          const a = Math.PI * 2 * j / 8 - Math.PI / 2;
          const px = x + 14 + 7 * Math.cos(a), py = iy + 7 * Math.sin(a);
          j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x + 14, iy, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#bbb';
      ctx.fillText(item.label, x + 28, iy);
    });
  }

  // Initial draw
  requestDraw();
})();
