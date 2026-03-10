/**
 * Quick test to verify the timeless jewel engine logic works.
 * Run: node calculator/test.js
 */
const fs = require('fs');
const path = require('path');

// Load engine (inline the parts we need for Node)
const engineSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf-8');
// Evaluate in a context with window mock
const vm = require('vm');
const ctx = { window: {}, Math, console, Uint32Array, fetch: null };
vm.createContext(ctx);
vm.runInContext(engineSrc, ctx);

const TimelessJewelEngine = ctx.window.TimelessJewelEngine;

// Manually load data
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'data.min.json'), 'utf-8'));
const tree = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tree403.json'), 'utf-8'));

const engine = new TimelessJewelEngine();
engine.data = data;
engine.tree = tree;
// Just test the low-level parts
engine._buildNodePositions();
engine._buildJewelSocketMap();
engine.translator = { translate: (id, v) => `${id}: ${v}` }; // stub

console.log('=== Engine test ===');
console.log(`Jewel types: ${engine.getJewelTypes().map(j => j.id).join(', ')}`);
console.log(`Jewel sockets: ${engine.getJewelSockets().length}`);

// Pick first socket
const sockets = engine.getJewelSockets();
if (sockets.length === 0) {
  console.error('No jewel sockets found!');
  process.exit(1);
}

const socket = sockets[0];
console.log(`\nTest socket: #${socket.nodeId}`);

const nodesInRadius = engine.getNodesInRadius(socket.nodeId);
console.log(`Nodes in radius: ${nodesInRadius.length}`);
console.log(`  Keystones: ${nodesInRadius.filter(n => n.skill.is_keystone).length}`);
console.log(`  Notables: ${nodesInRadius.filter(n => n.skill.is_notable).length}`);
console.log(`  Small: ${nodesInRadius.filter(n => !n.skill.is_keystone && !n.skill.is_notable).length}`);

// Test Vaal (version 1) with seed 12345
const versionIndex = 1; // Vaal
const seed = 12345;
const keystoneId = 1;

console.log(`\nCalculating Vaal, seed=${seed}, keystone=${keystoneId}...`);
const results = engine.calculateAll(socket.nodeId, versionIndex, seed, keystoneId, 0);
console.log(`Results: ${results.length} nodes mutated`);
console.log(`  Replaced: ${results.filter(r => r.mutated.replaced).length}`);

// Show first 5
for (const r of results.slice(0, 5)) {
  const original = r.original.name;
  const name = r.mutated.name || original;
  const replaced = r.mutated.replaced ? ' [REPLACED]' : '';
  const stats = Object.entries(r.mutated.stats).map(([k, v]) => `    ${k}: ${v}`).join('\n');
  console.log(`\n  Node #${r.nodeId} (${r.type}): ${name}${replaced}`);
  if (r.mutated.replaced) console.log(`    Was: ${original}`);
  console.log(stats);
}

console.log('\n=== Test passed ===');
