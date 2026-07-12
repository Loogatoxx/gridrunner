'use strict';
/**
 * CommandParser.js
 * ----------------------------------------------------------------------------
 * Transforme une ligne de texte brute en une structure exploitable :
 *   "cat -n  '/etc/my file.txt'"  →
 *   { name: 'cat', args: ['/etc/my file.txt'], flags: {n:true}, raw: '...' }
 *
 * OBJECTIF N°1 : NE JAMAIS PLANTER.
 *  - Une entrée vide renvoie un parse "vide" (name === '').
 *  - Une entrée bancale (guillemet non fermé, flags collés, espaces multiples)
 *    est tolérée : on fait au mieux, on ne lève jamais d'exception.
 *  - Le tokenizer gère les guillemets simples et doubles pour permettre des
 *    arguments contenant des espaces.
 *
 * On sépare volontairement le PARSING (ici) de l'EXÉCUTION (CommandRegistry).
 * Le parseur ne connaît aucune commande : il ne fait que découper.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

class CommandParser {
  /**
   * Découpe une ligne en tokens en respectant les guillemets.
   * Machine à états volontairement simple : NORMAL / SINGLE_QUOTE / DOUBLE_QUOTE.
   *
   * @param {string} line
   * @returns {string[]} tokens
   */
  static tokenize(line) {
    const tokens = [];
    if (typeof line !== 'string') return tokens;

    let current = '';
    let state = 'NORMAL';
    let hasToken = false; // permet de conserver un token vide issu de "" ou ''

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (state === 'NORMAL') {
        if (ch === '"') { state = 'DOUBLE_QUOTE'; hasToken = true; }
        else if (ch === "'") { state = 'SINGLE_QUOTE'; hasToken = true; }
        else if (ch === ' ' || ch === '\t') {
          if (hasToken) { tokens.push(current); current = ''; hasToken = false; }
        } else if (ch === '\\' && i + 1 < line.length) {
          // Antislash d'échappement : on prend le caractère suivant tel quel.
          current += line[++i]; hasToken = true;
        } else { current += ch; hasToken = true; }
      } else if (state === 'DOUBLE_QUOTE') {
        if (ch === '"') state = 'NORMAL';
        else if (ch === '\\' && i + 1 < line.length) current += line[++i];
        else current += ch;
      } else { // SINGLE_QUOTE : pas d'échappement, littéral pur (comme un vrai shell).
        if (ch === "'") state = 'NORMAL';
        else current += ch;
      }
    }
    // Guillemet non fermé → on récupère quand même ce qui a été tapé (tolérance).
    if (hasToken) tokens.push(current);
    return tokens;
  }

  /**
   * Parse une ligne complète en commande structurée.
   *
   * @param {string} line
   * @returns {{name:string, args:string[], flags:object, tokens:string[], raw:string, rawArgs:string}}
   */
  static parse(line) {
    const raw = typeof line === 'string' ? line : '';
    const tokens = CommandParser.tokenize(raw.trim());

    if (tokens.length === 0) {
      return { name: '', args: [], flags: {}, tokens: [], raw, rawArgs: '' };
    }

    const name = tokens[0].toLowerCase();
    const rest = tokens.slice(1);
    const args = [];
    const flags = {};

    for (const tok of rest) {
      // Flags longs : --verbose  → flags.verbose = true
      if (tok.startsWith('--') && tok.length > 2) {
        const [k, v] = tok.slice(2).split('=');
        flags[k] = v === undefined ? true : v;
      }
      // Flags courts groupés : -la → flags.l = true, flags.a = true
      else if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) {
        for (const c of tok.slice(1)) flags[c] = true;
      }
      // Argument positionnel classique.
      else {
        args.push(tok);
      }
    }

    // rawArgs : tout ce qui suit le nom de commande, utile pour `echo`.
    const rawArgs = raw.trim().slice(tokens[0].length).trim();

    return { name, args, flags, tokens, raw, rawArgs };
  }
}

const api = { CommandParser };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
