'use strict';
/**
 * Crypto.js
 * ----------------------------------------------------------------------------
 * Primitives cryptographiques *de jeu*. Volontairement simples, déterministes
 * et sans dépendance, pour rester lisibles et testables.
 *
 * ⚠️ AVERTISSEMENT PÉDAGOGIQUE : ce ne sont PAS de vraies primitives sûres.
 *  - `hash()` est une variante de FNV-1a 32 bits répétée pour produire 32 chars
 *    hexadécimaux (ça *ressemble* à un MD5, mais n'en est pas un). Dans la vraie
 *    vie on utilise MD5/SHA-256 via l'API WebCrypto (`crypto.subtle.digest`).
 *  - `xorCipher()` est un simple XOR répété par la clé. Réversible, éducatif,
 *    trivial à casser. À ne jamais utiliser pour protéger quoi que ce soit.
 *
 * Le but ici est de faire VIVRE la mécanique de jeu (attaque par dictionnaire,
 * déchiffrement par clé) de façon compréhensible, pas de faire de la vraie crypto.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

const Crypto = {
  /**
   * Hash de jeu : 32 caractères hexadécimaux, déterministe.
   * @param {string} input
   * @returns {string}
   */
  hash(input) {
    const str = String(input);
    // Quatre passes FNV-1a avec des graines différentes → 4 × 8 = 32 hex.
    const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe];
    return seeds.map((seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    }).join('');
  },

  /**
   * Attaque par dictionnaire : essaie chaque mot de la wordlist et renvoie
   * celui dont le hash correspond, ou null si aucun ne matche.
   * @param {string} targetHash
   * @param {string[]} wordlist
   * @returns {string|null}
   */
  crackWithWordlist(targetHash, wordlist) {
    const target = String(targetHash).toLowerCase().trim();
    for (const word of wordlist) {
      if (Crypto.hash(word) === target) return word;
    }
    return null;
  },

  /**
   * Chiffrement XOR répété (réversible : chiffrer = déchiffrer avec la même clé).
   * @param {string} text
   * @param {string} key
   * @returns {string}
   */
  xorCipher(text, key) {
    if (!key) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
      out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  },
};

const api = { Crypto };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
