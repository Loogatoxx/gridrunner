'use strict';
/**
 * Network.js
 * ----------------------------------------------------------------------------
 * Modélise le réseau : un ensemble d'hôtes (`Host`), chacun avec ses ports, ses
 * comptes utilisateurs, son propre système de fichiers, et sa politique de logs.
 *
 * CHOIX TECHNIQUE :
 *  - `Host` encapsule TOUT ce qui concerne une cible : découverte (scan),
 *    authentification, privilèges, journalisation. Les commandes ne manipulent
 *    jamais ces champs directement dans le désordre : elles passent par des
 *    méthodes (`authenticate`, `writeLog`, `wipeLogs`).
 *  - `reachableFrom` modélise le pivoting : certains hôtes internes ne sont
 *    joignables que depuis un autre hôte déjà compromis.
 *
 * NOTE D'ARCHITECTURE — pourquoi une IIFE ?
 *  Dans le navigateur, toutes les balises <script> partagent UN SEUL scope
 *  global. Sans encapsulation, les `const`/`class` de chaque fichier se
 *  marcheraient dessus. On enveloppe donc chaque module dans une IIFE pour lui
 *  offrir un scope privé, et on n'expose QUE l'API voulue (sur window.HT côté
 *  navigateur, sur module.exports côté Node). C'est le même code des deux côtés.
 * ----------------------------------------------------------------------------
 */
(function () {

  /** Un port réseau et son service annoncé. */
  class Port {
    constructor(number, service, opts = {}) {
      this.number = number;
      this.service = service;
      this.state = opts.state || 'open';   // open | filtered | closed
      this.banner = opts.banner || '';     // bannière renvoyée lors du scan
    }
  }

  /** Un hôte du réseau. */
  class Host {
    /**
     * @param {object} cfg
     * @param {string} cfg.ip
     * @param {string} cfg.hostname
     * @param {Port[]} [cfg.ports]
     * @param {Object<string,{password?:string,root?:boolean}>} [cfg.users]
     * @param {VirtualFileSystem} cfg.vfs
     * @param {boolean} [cfg.requiresAuth=true]  Identifiants requis pour un shell ?
     * @param {string[]} [cfg.reachableFrom]     IPs d'où l'hôte est joignable ('*' = partout).
     * @param {boolean} [cfg.logging=true]       L'hôte journalise-t-il les accès ?
     * @param {number} [cfg.traceRate=8]         Points de traçage gagnés par action.
     */
    constructor(cfg) {
      this.ip = cfg.ip;
      this.hostname = cfg.hostname;
      this.ports = cfg.ports || [];
      this.users = cfg.users || { root: { password: 'toor', root: true } };
      this.vfs = cfg.vfs;
      this.requiresAuth = cfg.requiresAuth !== false;
      this.reachableFrom = cfg.reachableFrom || ['*'];
      this.logging = cfg.logging !== false;
      this.traceRate = cfg.traceRate != null ? cfg.traceRate : 8;
      this.logPath = cfg.logPath || '/var/log/auth.log';
      this.secLevel = cfg.secLevel || 1;                      // niveau du pare-feu (mini-jeu)
      this.bounty = cfg.bounty != null ? cfg.bounty : 10;     // crédits à la 1re intrusion

      // État de progression (muté en cours de partie).
      this.discovered = false;   // apparu via `net` / mission
      this.scanned = false;      // ports révélés via `scan`
      this.compromised = false;  // au moins un shell obtenu
      this.bypassed = false;     // pare-feu forcé via `bypass`
    }

    /** Ports ouverts uniquement. */
    openPorts() { return this.ports.filter((p) => p.state === 'open'); }

    /** L'hôte est-il joignable depuis l'emplacement courant (ip ou 'localhost') ? */
    isReachableFrom(fromIp) {
      return this.reachableFrom.includes('*') || this.reachableFrom.includes(fromIp);
    }

    /**
     * Vérifie un couple identifiant / mot de passe.
     * @returns {{ok:boolean, root?:boolean, reason?:string}}
     */
    authenticate(user, password) {
      const account = this.users[user];
      if (!account) return { ok: false, reason: 'utilisateur inconnu' };
      if (account.password !== password) return { ok: false, reason: 'mot de passe incorrect' };
      return { ok: true, root: !!account.root };
    }

    /** Écrit une ligne dans le journal d'authentification de l'hôte. */
    writeLog(line) {
      if (!this.logging) return;
      const node = this.vfs.resolve(this.logPath, '/');
      if (node && node.isFile()) {
        const sep = (node.content === '' || node.content.endsWith('\n')) ? '' : '\n';
        node.content += sep + line + '\n';
      }
    }

    /** true si le journal contient encore des traces de notre passage. */
    hasTraces() {
      const node = this.vfs.resolve(this.logPath, '/');
      if (!node || !node.isFile()) return false;
      return /INTRUS|breach|0\.0\.0\.0/i.test(node.content);
    }
  }

  /** Conteneur de tous les hôtes, indexés par IP. */
  class Network {
    constructor() {
      /** @type {Map<string, Host>} */
      this.hosts = new Map();
    }
    add(host) { this.hosts.set(host.ip, host); return host; }
    get(ip) { return this.hosts.get(ip) || null; }
    has(ip) { return this.hosts.has(ip); }
    /** Hôtes déjà découverts par le joueur (pour la commande `net`). */
    discovered() { return [...this.hosts.values()].filter((h) => h.discovered); }
  }

  // -- Export universel (Node module.exports OU navigateur window.HT) --------
  const api = { Port, Host, Network };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
