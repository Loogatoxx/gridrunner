'use strict';
/**
 * Market.js  --  Le "Darknet Market" (boutique rogue-like).
 * ----------------------------------------------------------------------------
 * Tire une sélection aléatoire d'augmentations à acheter. La logique est pure et
 * déterministe si on lui injecte un générateur aléatoire (`rng`) — ce qui la rend
 * testable : même graine → mêmes offres.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

const { AUGMENTATIONS } =
  (typeof module !== 'undefined' && module.exports)
    ? require('./PlayerBuild')
    : globalThis.HT;

class Market {
  constructor() {
    /** @type {Array} offres actuellement proposées */
    this.offers = [];
  }

  /**
   * Tire `n` offres distinctes, en excluant ce que le joueur possède déjà.
   * @param {PlayerBuild} build
   * @param {number} [n=3]
   * @param {function():number} [rng=Math.random]
   */
  roll(build, n = 3, rng = Math.random) {
    const bag = AUGMENTATIONS.filter((a) => !build.has(a.id));
    const chosen = [];
    while (chosen.length < n && bag.length) {
      const i = Math.floor(rng() * bag.length);
      chosen.push(bag.splice(i, 1)[0]);
    }
    this.offers = chosen;
    return this.offers;
  }

  /**
   * Achète l'offre à l'index donné.
   * @returns {{ok:boolean, item?:object, msg?:string}}
   */
  buy(build, index) {
    const item = this.offers[index];
    if (!item) return { ok: false, msg: 'offre inexistante' };
    if (build.has(item.id)) return { ok: false, msg: 'deja possede' };
    if (!build.canAfford(item)) return { ok: false, msg: 'credits insuffisants' };
    build.buy(item);
    this.offers.splice(index, 1); // retirée de l'étal
    return { ok: true, item };
  }
}

const api = { Market };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
