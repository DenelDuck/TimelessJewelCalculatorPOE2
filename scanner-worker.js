/**
 * Seed Scanner Web Worker
 *
 * Receives messages:
 *   { type: 'init', engineUrl, dataUrl, treeUrl }
 *   { type: 'scan', socketId, versionIndex, keystoneId, revision, searchStatIds, seedMin, seedMax }
 *   { type: 'abort' }
 *
 * Posts messages:
 *   { type: 'ready' }
 *   { type: 'progress', scanned, total }
 *   { type: 'result', rankings }  // top seeds sorted by match count
 *   { type: 'error', message }
 */

// Import the engine (it attaches to self/globalThis in worker context)
let engine = null;
let aborted = false;

self.onmessage = async function (e) {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      importScripts(msg.engineUrl);
      engine = new TimelessJewelEngine();
      // Fetch data directly in worker
      const [dataResp, treeResp] = await Promise.all([
        fetch(msg.dataUrl).then(r => r.json()),
        fetch(msg.treeUrl).then(r => r.json())
      ]);
      engine.data = dataResp;
      engine.tree = treeResp;
      engine.translator = new StatTranslator(engine.data.translations);
      engine._buildNodePositions();
      engine._buildJewelSocketMap();
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
    return;
  }

  if (msg.type === 'abort') {
    aborted = true;
    return;
  }

  if (msg.type === 'scan') {
    aborted = false;
    const { socketId, versionIndex, keystoneId, revision, searchStatIds, seedMin, seedMax } = msg;
    const nodesInRadius = engine.getNodesInRadius(socketId);
    const total = seedMax - seedMin + 1;
    const rankings = [];
    const BATCH = 500;
    const PROGRESS_INTERVAL = 1000;

    for (let seed = seedMin; seed <= seedMax; seed++) {
      if (aborted) {
        self.postMessage({ type: 'aborted' });
        return;
      }

      let matchCount = 0;
      let totalValue = 0;
      const matchingStats = {};

      for (const { nodeId, skill } of nodesInRadius) {
        const mutated = engine.mutateNode(nodeId, skill, versionIndex, seed, keystoneId, revision || 0);
        if (!mutated) continue;

        for (const statId of searchStatIds) {
          const val = mutated.stats[statId];
          if (val != null && val !== 0) {
            matchCount++;
            totalValue += Math.abs(val);
            matchingStats[statId] = (matchingStats[statId] || 0) + val;
          }
        }
      }

      if (matchCount > 0) {
        rankings.push({ seed, matchCount, totalValue, matchingStats });
      }

      // Send progress updates periodically
      if ((seed - seedMin) % PROGRESS_INTERVAL === 0) {
        self.postMessage({ type: 'progress', scanned: seed - seedMin + 1, total });
      }
    }

    // Sort by match count descending, then total value descending
    rankings.sort((a, b) => b.matchCount - a.matchCount || b.totalValue - a.totalValue);

    // Send top 100
    self.postMessage({
      type: 'result',
      rankings: rankings.slice(0, 100),
      totalSeeds: total,
      seedsWithMatches: rankings.length
    });
  }
};
