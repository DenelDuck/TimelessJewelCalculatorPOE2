/**
 * PoE2 Timeless Jewel Calculator Engine
 *
 * Ported from Maxroll's planner source code.
 * All calculation is deterministic and client-side.
 */

// ─── PRNG (WELL512 variant from Maxroll) ───

class RandomGenerator {
  constructor(...seed) {
    this.state = new Uint32Array([0x40336050, 0xcfa3723c, 0x3cac5f6f, 0x3793fdff]);
    const state = this.state;
    let index = 1;
    for (const v of seed) {
      let round = state[index] ^ state[(index + 1) & 3] ^ state[(index + 3) & 3];
      round = Math.imul(round ^ (round >>> 27), 0x19660d);
      state[(index + 1) & 3] += round;
      round = (round + v + index) | 0;
      state[(index + 2) & 3] += round;
      state[index] = round;
      index = (index + 1) & 3;
    }
    for (let i = 0; i < 5; ++i) {
      let round = state[index] ^ state[(index + 1) & 3] ^ state[(index + 3) & 3];
      round = Math.imul(round ^ (round >>> 27), 0x19660d);
      state[(index + 1) & 3] += round;
      round = (round + index) | 0;
      state[(index + 2) & 3] += round;
      state[index] = round;
      index = (index + 1) & 3;
    }
    for (let i = 0; i < 4; ++i) {
      let round = (state[index] + state[(index + 1) & 3] + state[(index + 3) & 3]) | 0;
      round = Math.imul(round ^ (round >>> 27), 0x5d588b65);
      state[(index + 1) & 3] ^= round;
      round = (round - index) | 0;
      state[(index + 2) & 3] ^= round;
      state[index] = round;
      index = (index + 1) & 3;
    }
    for (let i = 0; i < 8; ++i) {
      this._next();
    }
  }

  _next() {
    const state = this.state;
    let a = state[3];
    let b = (state[0] & 0x7fffffff) ^ state[1] ^ state[2];
    a ^= a << 1;
    b ^= (b >>> 1) ^ a;
    state[0] = state[1];
    state[1] = state[2];
    state[2] = a ^ (b << 10);
    state[3] = b;
    state[1] ^= -(b & 1) & 0x8f7011ee;
    state[2] ^= -(b & 1) & 0xfc78ff1f;
  }

  _temper() {
    const state = this.state;
    let a = state[3];
    let b = (state[0] + (state[2] >>> 8)) | 0;
    a ^= b;
    if (b & 1) a ^= 0x3793fdff;
    return a;
  }

  uint() {
    this._next();
    return this._temper() >>> 0;
  }

  modulo(mod) {
    return this.uint() % mod;
  }

  range(a, b) {
    return (this.uint() % (b - a + 1)) + a;
  }
}

// ─── Stat helpers ───

function statsExtend(dst, ...srcs) {
  for (const src of srcs) {
    if (!src) continue;
    for (const [id, value] of Object.entries(src)) {
      dst[id] = (dst[id] || 0) + value;
    }
  }
  return dst;
}

function rollStats(rng, stats) {
  const result = {};
  for (const { id, min, max } of stats) {
    result[id] = max > min ? rng.range(min, max) : max;
  }
  return result;
}

// ─── Skill type classification ───

function skillType(skill) {
  if (skill.is_keystone) return 8;
  if (skill.is_notable) return 4;
  const keys = Object.keys(skill.stats);
  if (keys.length !== 1) return 2;
  return keys[0] === 'base_strength' ||
    keys[0] === 'base_dexterity' ||
    keys[0] === 'base_intelligence'
    ? 1
    : 2;
}

function skillTypeLabel(skill) {
  if (skill.is_keystone) return 'keystone';
  if (skill.is_notable) return 'notable';
  return 'small';
}

// ─── Node position calculation ───

const orbitRadii = [0, 82, 162, 335, 493, 662, 846, 251, 1080, 1322];
const skillsPerOrbit = [1, 12, 24, 24, 72, 72, 72, 24, 72, 144];

// Special angle tables
const angles16 = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
const angles40 = [
  0, 10, 20, 30, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130, 135,
  140, 150, 160, 170, 180, 190, 200, 210, 220, 225, 230, 240, 250, 260,
  270, 280, 290, 300, 310, 315, 320, 330, 340, 350
];

function getOrbitAngle(size, index) {
  if (size === 16) return angles16[index] || 0;
  if (size === 40) return angles40[index] || 0;
  return (360 * index) / size;
}

function computeNodePosition(node, groups) {
  const group = groups[node.parent];
  if (!group) return null;
  const orbit = node.radius || 0;
  const r = orbitRadii[orbit] || 0;
  const orbitSize = skillsPerOrbit[orbit] || 1;
  const arc = ((getOrbitAngle(orbitSize, node.position || 0) - 90) * Math.PI) / 180;
  return {
    x: group.x + r * Math.cos(arc),
    y: group.y + r * Math.sin(arc)
  };
}

// ─── Stat translation (simplified) ───

class StatTranslator {
  constructor(translations) {
    // Build a map: stat_id → { string, format, negate, ids, index }
    this.statMap = {};
    for (const domain of translations) {
      if (domain.name !== 'global' && domain.name !== 'passive_skill') continue;
      for (const entry of domain.data) {
        if (entry.hidden && domain.name === 'global') continue;
        for (const statId of entry.ids) {
          if (this.statMap[statId] && domain.name !== 'passive_skill') continue;
          const eng = entry.English[0]; // take the first (positive) translation
          if (!eng) continue;
          const index = entry.ids.indexOf(statId);
          const handler = eng.index_handlers?.[index] || [];
          this.statMap[statId] = {
            string: eng.string,
            format: eng.format || [],
            handlers: handler,
            ids: entry.ids,
            index,
            allHandlers: eng.index_handlers || [],
            allEnglish: entry.English,
            domain: domain.name
          };
        }
      }
    }
  }

  translate(statId, value, placeholder) {
    const info = this.statMap[statId];
    if (!info) return `${statId}: ${placeholder != null ? placeholder : value}`;
    // Simple single-stat translation
    let displayValue = value;
    if (info.handlers.includes('negate')) {
      displayValue = -displayValue;
    }
    if (info.handlers.includes('per_minute_to_per_second')) {
      displayValue = Math.round(displayValue / 60 * 10) / 10;
    }
    if (info.handlers.includes('divide_by_one_hundred')) {
      displayValue = displayValue / 100;
    }
    if (info.handlers.includes('milliseconds_to_seconds')) {
      displayValue = displayValue / 1000;
    }

    // Pick the right English variant based on condition
    let str = info.string;
    for (const eng of info.allEnglish) {
      const cond = eng.condition?.[info.index];
      if (!cond) { str = eng.string; break; }
      const v = displayValue;
      if (cond.min != null && v < cond.min) continue;
      if (cond.max != null && v > cond.max) continue;
      str = eng.string;
      // Re-apply handlers from this variant
      const handler = eng.index_handlers?.[info.index] || [];
      let dv = value;
      if (handler.includes('negate')) dv = -dv;
      displayValue = dv;
      break;
    }

    // Replace {N} placeholders
    const displayStr = placeholder != null ? placeholder : String(displayValue);
    let result = str;
    if (info.ids.length === 1) {
      result = result.replace(/\{0\}/g, displayStr);
    } else {
      result = result.replace(/\{(\d+)\}/g, (_, n) => {
        if (Number(n) === info.index) return displayStr;
        return `{${n}}`;
      });
    }

    // Strip [tag] markup: [ShortId|Display Text] → Display Text, [tag] → tag
    result = result.replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]]*)\]/g, '$1');
    return result;
  }
}

// ─── Main Engine ───

class TimelessJewelEngine {
  constructor() {
    this.data = null;
    this.tree = null;
    this.nodePositions = {};
    this.translator = null;
  }

  async load(dataPath, treePath) {
    const [dataResp, treeResp] = await Promise.all([
      fetch(dataPath).then(r => r.json()),
      fetch(treePath).then(r => r.json())
    ]);
    this.data = dataResp;
    this.tree = treeResp;
    this.translator = new StatTranslator(this.data.translations);
    this._buildNodePositions();
    this._buildJewelSocketMap();
  }

  _buildNodePositions() {
    const { nodes, groups } = this.tree.passive_tree;
    const skills = this.tree.passive_skills;
    this.nodePositions = {};
    this.nodeSkills = {};

    for (const [idStr, node] of Object.entries(nodes)) {
      const id = Number(idStr);
      const pos = computeNodePosition(node, groups);
      if (!pos) continue;

      const skill = skills[node.skill_id];
      if (!skill) continue;

      this.nodePositions[id] = { x: pos.x, y: pos.y };
      this.nodeSkills[id] = {
        ...skill,
        skillId: node.skill_id
      };
    }
  }

  _buildJewelSocketMap() {
    const { nodes } = this.tree.passive_tree;
    const skills = this.tree.passive_skills;
    this.jewelSockets = {};

    for (const [idStr, node] of Object.entries(nodes)) {
      const id = Number(idStr);
      const skill = skills[node.skill_id];
      if (!skill || !skill.is_jewel_socket) continue;
      // Skip ascendancy jewel sockets for timeless jewels
      if (skill.ascendancy) continue;
      this.jewelSockets[id] = {
        nodeId: id,
        skillId: node.skill_id,
        name: skill.name,
        x: this.nodePositions[id]?.x || 0,
        y: this.nodePositions[id]?.y || 0
      };
    }
  }

  getJewelTypes() {
    return this.data.alternate_tree_versions
      .map((v, i) => ({ index: i, id: v.id, ...v }))
      .filter(v => v.id !== 'None');
  }

  getKeystoneVariants(versionIndex) {
    const keystones = this.data.alternate_passive_skills.filter(
      sk => sk.version === versionIndex && sk.types === 8
    );
    // Group by keystone number, take latest revision
    const byKeystone = {};
    for (const ks of keystones) {
      const key = ks.keystone;
      if (!byKeystone[key] || ks.revision > byKeystone[key].revision) {
        byKeystone[key] = ks;
      }
    }
    return Object.values(byKeystone);
  }

  getJewelSockets() {
    return Object.values(this.jewelSockets);
  }

  getCharacterStarts(classNames) {
    const { nodes, groups } = this.tree.passive_tree;
    const skills = this.tree.passive_skills;
    const starts = [];
    for (const [idStr, node] of Object.entries(nodes)) {
      const skill = skills[node.skill_id];
      if (!skill || !skill.starting_node) continue;
      const pos = computeNodePosition(node, groups);
      if (!pos) continue;
      const label = skill.starting_node
        .map(c => classNames[c] || c)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join('/');
      starts.push({ nodeId: Number(idStr), label, x: pos.x, y: pos.y });
    }
    return starts;
  }

  /**
   * Get all nodes within the jewel radius of a socket.
   * Timeless jewels use Large radius (index 5 = 1300) × 1.2 = 1560.
   */
  getNodesInRadius(socketNodeId) {
    const center = this.nodePositions[socketNodeId];
    if (!center) return [];

    // Timeless jewels use Large radius
    const baseRadius = this.data.jewel_radii[5]?.radius || 1300;
    const maxRadius = baseRadius * 1.2;
    const maxR2 = maxRadius * maxRadius;

    const result = [];
    for (const [idStr, pos] of Object.entries(this.nodePositions)) {
      const id = Number(idStr);
      if (id === socketNodeId) continue;

      const skill = this.nodeSkills[id];
      if (!skill) continue;
      // Skip jewel sockets, ascendancy nodes
      if (skill.is_jewel_socket) continue;
      if (skill.ascendancy) continue;
      if (skill.is_multiple_choice_option) continue;

      const dx = pos.x - center.x;
      const dy = pos.y - center.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= maxR2) {
        result.push({ nodeId: id, skill, distance: Math.sqrt(d2) });
      }
    }
    return result.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Core: Mutate a single node based on timeless jewel parameters.
   * Port of mutateTreeTimeless from Maxroll source.
   */
  mutateNode(nodeId, skill, versionIndex, seed, keystoneId, revision) {
    const tree = this.data.alternate_tree_versions[versionIndex];
    if (!tree) return null;

    const rng = new RandomGenerator(nodeId, seed);

    // Keystones
    if (skill.is_keystone) {
      const entry =
        this.data.alternate_passive_skills.find(
          sk => sk.version === versionIndex && sk.keystone === keystoneId && sk.revision === revision
        ) ||
        this.data.alternate_passive_skills.find(
          sk => sk.version === versionIndex && sk.keystone === keystoneId
        );
      if (!entry) return null;
      return this._createSkill(rng, entry, versionIndex);
    }

    // Notables and small passives
    const type = skillType(skill);
    let replace, random;

    if (skill.is_notable) {
      const roll = rng.range(0, 100);
      replace = tree.replaceNotableWeight >= 100 || roll < tree.replaceNotableWeight;
      random = tree.randomNotable;
    } else {
      replace = type === 1 ? tree.replaceSmallAttributes : tree.replaceSmallNormal;
      random = type === 1 ? tree.randomAttributes : tree.randomNormal;
    }

    let result;
    if (replace) {
      let candidate = undefined;
      let weight = 0;
      for (const entry of this.data.alternate_passive_skills) {
        if (entry.version !== versionIndex) continue;
        if (!(entry.types & type)) continue;
        weight += entry.weight;
        if (rng.modulo(weight) < entry.weight) {
          candidate = entry;
        }
      }
      if (!candidate) {
        result = { ...skill, replaced: false };
      } else {
        result = this._createSkill(rng, candidate, versionIndex);
        result.replaced = true;
        random = { min: candidate.randomMin, max: candidate.randomMax };
      }
    } else {
      result = { ...skill, stats: { ...skill.stats }, replaced: false };
    }

    // Random additions
    const randomVal = random.max > random.min ? rng.range(random.min, random.max) : random.max;
    if (!randomVal) return result;

    if (!result.replaced && !result._cloned) {
      result = { ...result, stats: { ...result.stats }, _cloned: true };
    }
    result.baseStats = result.replaced ? { ...result.stats } : { ...skill.stats };

    const additions = this.data.alternate_passive_additions.filter(
      row => row.version === versionIndex && (row.types & type)
    );
    const totalWeight = additions.reduce((sum, row) => sum + row.weight, 0);
    result.addedStats = {};

    for (let i = 0; i < randomVal; ++i) {
      let roll = rng.modulo(totalWeight);
      let candidate = additions[0];
      for (const row of additions) {
        candidate = row;
        if (roll < row.weight) break;
        roll -= row.weight;
      }
      if (candidate) {
        const rolled = rollStats(rng, candidate.stats);
        statsExtend(result.stats, rolled);
        statsExtend(result.addedStats, rolled);
      }
    }

    return result;
  }

  _createSkill(rng, entry, versionIndex) {
    const skill = {
      name: entry.name,
      icon: entry.icon,
      alternate: this.data.alternate_tree_versions[versionIndex].id,
      stats: rollStats(rng, entry.stats),
      replaced: true
    };
    if (entry.flavour_text) skill.flavour_text = entry.flavour_text;
    if (entry.types & 4) skill.is_notable = true;
    if (entry.types & 8) skill.is_keystone = true;
    return skill;
  }

  /**
   * Calculate all mutations for nodes in a jewel socket's radius.
   */
  calculateAll(socketNodeId, versionIndex, seed, keystoneId, revision) {
    const nodesInRadius = this.getNodesInRadius(socketNodeId);
    const results = [];

    for (const { nodeId, skill, distance } of nodesInRadius) {
      const mutated = this.mutateNode(nodeId, skill, versionIndex, seed, keystoneId, revision || 0);
      if (!mutated) continue;

      results.push({
        nodeId,
        distance,
        original: skill,
        mutated,
        type: skillTypeLabel(skill)
      });
    }

    return results;
  }

  translateStat(statId, value, placeholder) {
    if (!this.translator) return `${statId}: ${placeholder != null ? placeholder : value}`;
    return this.translator.translate(statId, value, placeholder);
  }

  /**
   * Get all stat IDs that can appear from timeless jewel mutations.
   * Returns [{id, translated}] sorted by translated name.
   */
  getAllTimelessStats() {
    const statIds = new Set();
    for (const sk of this.data.alternate_passive_skills) {
      for (const s of sk.stats || []) statIds.add(s.id);
    }
    for (const add of this.data.alternate_passive_additions) {
      for (const s of add.stats || []) statIds.add(s.id);
    }
    // Remove dummy/keystone stats
    const ignore = ['dummy_stat_display_nothing'];
    for (const i of ignore) statIds.delete(i);
    for (const id of statIds) {
      if (id.startsWith('keystone_')) statIds.delete(id);
    }

    return [...statIds].map(id => ({
      id,
      translated: this.translateStat(id, 1, '#')
    })).sort((a, b) => a.translated.localeCompare(b.translated));
  }
}

// Export — works in both window and Web Worker contexts
if (typeof window !== 'undefined') {
  window.TimelessJewelEngine = TimelessJewelEngine;
  window.StatTranslator = StatTranslator;
} else if (typeof self !== 'undefined') {
  self.TimelessJewelEngine = TimelessJewelEngine;
  self.StatTranslator = StatTranslator;
}
