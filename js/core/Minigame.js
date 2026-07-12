'use strict';
/**
 * Minigame.js  --  LOGIQUE des mini-jeux de hacking (sans DOM, donc testable).
 * ----------------------------------------------------------------------------
 * On sépare la logique (génération d'un défi + évaluation d'une réponse) du
 * RENDU (js/ui/MinigameUI.js). Ici : que des données et des fonctions pures.
 *   - `generate(level, rng)` -> une "spec" de défi (type, contenu, temps).
 *   - `evaluate(spec, answer)` -> true si la réponse du joueur résout le défi.
 *
 * `rng` est injectable : même graine, même défi (indispensable pour les tests).
 *
 * Trois types, dans l'esprit de Cyberpunk 2077 / Hacknet :
 *   sequence : mémoriser puis reproduire une suite de cases (jeu de mémoire).
 *   hexgrid  : cliquer, dans l'ordre, des octets hexa d'une grille (breach).
 *   nodes    : cliquer des noeuds numérotés dans le bon ordre avant le chrono.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

const HEX = '0123456789ABCDEF';
function hexByte(rng) { return HEX[Math.floor(rng() * 16)] + HEX[Math.floor(rng() * 16)]; }
function arrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const Minigame = {
  KINDS: ['sequence', 'hexgrid', 'nodes'],

  /** Génère un défi aléatoire (type inclus) pour un niveau donné. */
  generate(level, rng) {
    rng = rng || Math.random;
    level = Math.max(1, Math.min(3, (level | 0) || 1));
    const kind = this.KINDS[Math.floor(rng() * this.KINDS.length)];
    return this.generateKind(kind, level, rng);
  },

  /** Génère un défi d'un type précis. */
  generateKind(kind, level, rng) {
    rng = rng || Math.random;
    level = Math.max(1, Math.min(3, (level | 0) || 1));
    if (kind === 'sequence') return this._sequence(level, rng);
    if (kind === 'hexgrid') return this._hexgrid(level, rng);
    return this._nodes(level, rng);
  },

  _sequence(level, rng) {
    const cells = 6;
    const len = 3 + level;                       // 4 à 6 pas
    const steps = Array.from({ length: len }, () => Math.floor(rng() * cells));
    return { kind: 'sequence', level, cells, steps, timeMs: 5000 + level * 1500 };
  },

  _hexgrid(level, rng) {
    const cols = 4 + level, rows = 4 + level;    // grille 5x5 à 7x7
    const grid = Array.from({ length: rows * cols }, () => hexByte(rng));
    const seqLen = 2 + level;                     // 3 à 5 octets à trouver
    const idxs = [], used = new Set();
    while (idxs.length < seqLen) {
      const i = Math.floor(rng() * grid.length);
      if (!used.has(i)) { used.add(i); idxs.push(i); }
    }
    return {
      kind: 'hexgrid', level, rows, cols, grid,
      targets: idxs.map((i) => grid[i]),
      timeMs: 7000 + level * 2500,
    };
  },

  _nodes(level, rng) {
    const count = 4 + level;                      // 5 à 7 noeuds
    const nodes = Array.from({ length: count }, (_, i) => ({
      n: i + 1, x: 0.08 + rng() * 0.84, y: 0.12 + rng() * 0.76,
    }));
    return { kind: 'nodes', level, count, nodes, timeMs: 4500 + level * 1500 };
  },

  /**
   * Évalue la réponse du joueur.
   * @param {object} spec
   * @param {Array} answer  sequence -> indices de cases ; hexgrid -> octets cliqués ;
   *                        nodes -> numéros cliqués.
   * @returns {boolean}
   */
  evaluate(spec, answer) {
    if (!spec) return false;
    if (spec.kind === 'sequence') return arrEq(answer, spec.steps);
    if (spec.kind === 'hexgrid') return arrEq(answer, spec.targets);
    if (spec.kind === 'nodes') return arrEq(answer, spec.nodes.map((nd) => nd.n));
    return false;
  },
};

const api = { Minigame };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
