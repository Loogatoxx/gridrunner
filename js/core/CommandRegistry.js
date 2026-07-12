'use strict';
/**
 * CommandRegistry.js
 * ----------------------------------------------------------------------------
 * Registre des commandes + garde-fou d'exécution.
 *
 * CHOIX TECHNIQUE :
 *  - Chaque commande est un objet uniforme :
 *      { name, usage, summary, category, run(ctx) }
 *    Cette forme homogène permet à `help` de se générer TOUT SEUL à partir du
 *    registre (pas de liste d'aide à maintenir à la main), et de gérer les alias.
 *  - `execute()` enveloppe CHAQUE appel dans un try/catch. C'est le filet de
 *    sécurité ultime : même si une commande contient un bug, le terminal affiche
 *    une erreur propre et continue. La boucle de jeu ne meurt jamais.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

class CommandRegistry {
  constructor() {
    /** @type {Map<string, object>} nom canonique → commande */
    this.commands = new Map();
    /** @type {Map<string, string>} alias → nom canonique */
    this.aliases = new Map();
  }

  /**
   * Enregistre une commande.
   * @param {{name:string, run:function, usage?:string, summary?:string,
   *          category?:string, aliases?:string[]}} cmd
   */
  register(cmd) {
    if (!cmd || !cmd.name || typeof cmd.run !== 'function') {
      throw new Error('Commande invalide : il faut au moins { name, run() }');
    }
    this.commands.set(cmd.name, cmd);
    (cmd.aliases || []).forEach((a) => this.aliases.set(a, cmd.name));
    return this;
  }

  /** Résout un nom (ou alias) vers l'objet commande, ou null. */
  get(name) {
    if (this.commands.has(name)) return this.commands.get(name);
    if (this.aliases.has(name)) return this.commands.get(this.aliases.get(name));
    return null;
  }

  has(name) { return this.get(name) !== null; }

  /** Toutes les commandes (uniques), triées par nom. */
  all() {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Noms + alias, utile pour l'autocomplétion. */
  names() {
    return [...this.commands.keys(), ...this.aliases.keys()].sort();
  }

  /**
   * Exécute une commande par son nom, dans un contexte donné.
   * NE LÈVE JAMAIS : toute exception est capturée et transformée en message.
   *
   * @param {string} name
   * @param {object} ctx  Contexte passé à run() (engine, args, flags, io...).
   * @returns {{ok:boolean, notFound?:boolean}}
   */
  execute(name, ctx) {
    const cmd = this.get(name);
    if (!cmd) return { ok: false, notFound: true };
    try {
      cmd.run(ctx);
      return { ok: true };
    } catch (err) {
      // Filet de sécurité : un bug de commande n'abat pas le terminal.
      ctx.io.error(`erreur interne dans '${name}': ${err && err.message ? err.message : err}`);
      return { ok: false };
    }
  }
}

const api = { CommandRegistry };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
