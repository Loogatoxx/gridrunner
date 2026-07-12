'use strict';
/**
 * PlayerBuild.js
 * ----------------------------------------------------------------------------
 * Le système d'augmentations rogue-like (méta-progression).
 *
 * MODÈLE — chaque augmentation est un "StatsModifier" : un objet de données qui
 * déclare ses effets dans `mods`. La classe `PlayerBuild` détient les items
 * possédés + les crédits, et **replie dynamiquement** tous les `mods` en
 * modificateurs de stats effectifs (multiplicateur de traçage, temps de mini-jeu,
 * niveau d'auto-bruteforce, crédits par commande, multiplicateur de revente…).
 *
 * On sépare volontairement les DONNÉES (le pool `AUGMENTATIONS`) de la LOGIQUE
 * d'application (`PlayerBuild`) : on peut ajouter un item au pool sans toucher au
 * moteur, et la boutique (`Market.js`) pioche simplement dans ce pool.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

/**
 * Le pool d'augmentations achetables. `mods` = effets bruts additionnés/pris au
 * max par PlayerBuild. Rareté : commun < rare < epique (indicatif).
 */
const AUGMENTATIONS = [
  { id: 'proxychain',  name: 'Proxy-Chain',     price: 55,  rarity: 'commun', desc: '-15% de vitesse de tracage',                       mods: { traceRate: -0.15 } },
  { id: 'overclock',   name: 'Overclock CPU',   price: 60,  rarity: 'commun', desc: '+20% de temps sur les mini-jeux de hacking',       mods: { minigameTime: +0.20 } },
  { id: 'blackice',    name: 'Black-ICE',       price: 70,  rarity: 'commun', desc: 'divise par 2 la penalite de tracage en cas d echec', mods: { failPenalty: -0.50 } },
  { id: 'coldwallet',  name: 'Cold-Wallet',     price: 80,  rarity: 'commun', desc: '+50% sur la revente de fichiers',                  mods: { sellMult: +0.50 } },
  { id: 'ghostmask',   name: 'Ghost-Mask',      price: 95,  rarity: 'rare',   desc: '-30% de vitesse de tracage',                       mods: { traceRate: -0.30 } },
  { id: 'stealthos',   name: 'Stealth-OS',      price: 100, rarity: 'rare',   desc: '-20% de vitesse de tracage',                       mods: { traceRate: -0.20 } },
  { id: 'cryptominer', name: 'Crypto-Miner',    price: 110, rarity: 'rare',   desc: '+1 credit a chaque commande tapee',                mods: { creditsPerCmd: +1 } },
  { id: 'neuralboost', name: 'Neural-Boost',    price: 120, rarity: 'rare',   desc: '+35% de temps sur les mini-jeux',                  mods: { minigameTime: +0.35 } },
  { id: 'autobrute',   name: 'Auto-Bruteforce', price: 135, rarity: 'rare',   desc: 'contourne auto les hacks de niveau 1',             mods: { autoBypass: 1 } },
  { id: 'quantumcpu',  name: 'Quantum-CPU',     price: 200, rarity: 'epique', desc: '+50% de temps sur les mini-jeux',                  mods: { minigameTime: +0.50 } },
  { id: 'minerfarm',   name: 'Miner-Farm',      price: 210, rarity: 'epique', desc: '+3 credits a chaque commande',                     mods: { creditsPerCmd: +3 } },
  { id: 'rootkit',     name: 'Rootkit v9',      price: 240, rarity: 'epique', desc: 'contourne auto les hacks jusqu au niveau 2',       mods: { autoBypass: 2 } },
];
const AUG_BY_ID = {};
AUGMENTATIONS.forEach((a) => { AUG_BY_ID[a.id] = a; });

class PlayerBuild {
  constructor() {
    this.credits = 0;
    this.augments = new Set(); // ids possédés
  }

  has(id) { return this.augments.has(id); }
  own(id) { if (AUG_BY_ID[id]) this.augments.add(id); }
  items() { return [...this.augments].map((id) => AUG_BY_ID[id]).filter(Boolean); }

  // -- Repliage des StatsModifiers -------------------------------------------
  // `_sum` additionne un mod sur tous les items ; `_max` en prend le plus haut.
  _sum(key) { return this.items().reduce((s, it) => s + (it.mods[key] || 0), 0); }
  _max(key) { return this.items().reduce((m, it) => Math.max(m, it.mods[key] || 0), 0); }

  /** Multiplicateur de vitesse de traçage (plus bas = plus discret). >= 0.10 */
  traceRateMultiplier()   { return Math.max(0.10, 1 + this._sum('traceRate')); }
  /** Multiplicateur de temps accordé sur les mini-jeux (plus haut = plus facile). */
  minigameTimeMultiplier() { return Math.max(0.25, 1 + this._sum('minigameTime')); }
  /** Niveau de hack contourné automatiquement (0 = aucun). */
  autoBypassLevel()       { return this._max('autoBypass'); }
  /** Crédits générés à chaque commande (crypto-miner). */
  creditsPerCommand()     { return this._sum('creditsPerCmd'); }
  /** Multiplicateur de revente des fichiers. */
  sellMultiplier()        { return Math.max(0.1, 1 + this._sum('sellMult')); }
  /** Multiplicateur de la pénalité de traçage en cas d'échec de mini-jeu. */
  failPenaltyMultiplier() { return Math.max(0, 1 + this._sum('failPenalty')); }

  canAfford(item) { return !!item && this.credits >= item.price; }
  addCredits(n) { this.credits = Math.max(0, this.credits + Math.round(n)); }

  /** Achète un item (unique). @returns {boolean} succès. */
  buy(item) {
    if (!item || this.has(item.id) || !this.canAfford(item)) return false;
    this.credits -= item.price;
    this.augments.add(item.id);
    return true;
  }

  // -- Sérialisation (persistance méta) --------------------------------------
  toJSON() { return { credits: this.credits, augments: [...this.augments] }; }
  static fromJSON(o) {
    const b = new PlayerBuild();
    if (o) { b.credits = o.credits | 0; (o.augments || []).forEach((id) => b.own(id)); }
    return b;
  }
}

const api = { AUGMENTATIONS, AUG_BY_ID, PlayerBuild };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
