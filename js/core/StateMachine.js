'use strict';
/**
 * StateMachine.js
 * ----------------------------------------------------------------------------
 * Machine à états finis (FSM) générique + la définition des états du terminal.
 *
 * POURQUOI UNE FSM ?
 *  L'état du terminal (démarrage, shell local, session distante, "grillé" par un
 *  traçage, victoire) doit changer de façon CONTRÔLÉE. Sans FSM, on finit avec
 *  des booléens éparpillés (`isConnected`, `isBooting`, `isCaught`...) et des
 *  bugs de transitions impossibles. Ici, chaque transition est déclarée : passer
 *  d'un état à un autre non autorisé lève une erreur explicite (fail-fast en
 *  dev), plutôt qu'un état incohérent silencieux.
 * ----------------------------------------------------------------------------
 */

// (IIFE : scope de module privé — cf. la note dans Network.js.)
(function () {

/** FSM générique et réutilisable. */
class StateMachine {
  /**
   * @param {object} config
   * @param {string} config.initial            État de départ.
   * @param {Object<string,string[]>} config.transitions  état → états atteignables.
   * @param {function(string,string):void} [config.onChange]  callback (from, to).
   */
  constructor(config) {
    this.state = config.initial;
    this.transitions = config.transitions;
    this.onChange = config.onChange || null;
    this.history = [config.initial];
  }

  /** true si l'on peut aller vers `to` depuis l'état courant. */
  can(to) {
    const allowed = this.transitions[this.state] || [];
    return allowed.includes(to);
  }

  /**
   * Effectue la transition. Lève si elle n'est pas déclarée : c'est voulu,
   * une transition interdite est un bug de logique, pas une entrée utilisateur.
   */
  transition(to) {
    if (!this.can(to)) {
      throw new Error(`Transition interdite : ${this.state} → ${to}`);
    }
    const from = this.state;
    this.state = to;
    this.history.push(to);
    if (this.onChange) this.onChange(from, to);
    return to;
  }

  is(state) { return this.state === state; }
}

/**
 * États du terminal du jeu.
 *  BOOT        : séquence de démarrage animée (aucune commande acceptée).
 *  LOCAL       : shell sur la machine du joueur.
 *  CONNECTED   : shell sur un hôte distant compromis/en cours.
 *  TRACED_OUT  : le traçage a abouti, connexion coupée de force.
 *  VICTORY     : campagne terminée.
 */
const TERMINAL_STATES = {
  BOOT: 'BOOT',
  LOCAL: 'LOCAL',
  CONNECTED: 'CONNECTED',
  TRACED_OUT: 'TRACED_OUT',
  VICTORY: 'VICTORY',
};

/** Fabrique la FSM du terminal avec ses transitions autorisées. */
function createTerminalFSM(onChange) {
  const S = TERMINAL_STATES;
  return new StateMachine({
    initial: S.BOOT,
    onChange,
    transitions: {
      [S.BOOT]:       [S.LOCAL],
      [S.LOCAL]:      [S.CONNECTED, S.VICTORY],
      [S.CONNECTED]:  [S.LOCAL, S.CONNECTED, S.TRACED_OUT, S.VICTORY],
      [S.TRACED_OUT]: [S.LOCAL],
      [S.VICTORY]:    [S.LOCAL],
    },
  });
}

const api = { StateMachine, TERMINAL_STATES, createTerminalFSM };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
