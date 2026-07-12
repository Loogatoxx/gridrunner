'use strict';
/**
 * VirtualFileSystem.js
 * ----------------------------------------------------------------------------
 * Système de fichiers virtuel, orienté objet.
 *
 * CHOIX TECHNIQUE :
 *  - Un arbre de `VfsNode`. Chaque nœud est soit un dossier (children: Map),
 *    soit un fichier (content: string). Pas de mélange : `type` tranche.
 *  - La résolution de chemin est centralisée dans `resolve()` et gère les
 *    chemins absolus (`/etc`), relatifs (`../logs`), le home (`~`), ainsi que
 *    `.` et `..`. Aucune commande ne réimplémente cette logique : elles
 *    délèguent toutes ici. C'est la clé de la robustesse (un seul endroit à
 *    tester, un seul endroit qui peut échouer proprement en renvoyant `null`).
 *  - On utilise une `Map` pour les enfants : lookup O(1) par nom et ordre
 *    d'insertion préservé (pratique pour un `ls` déterministe).
 *
 * Chaque hôte du réseau possède SA PROPRE instance de VirtualFileSystem.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

/**
 * Un nœud du système de fichiers : fichier OU dossier.
 */
class VfsNode {
  /**
   * @param {string} name  Nom du nœud (sans slash).
   * @param {'dir'|'file'} type
   * @param {object} [opts]
   * @param {string} [opts.content='']   Contenu (fichiers uniquement).
   * @param {string} [opts.owner='user'] Propriétaire logique.
   * @param {string} [opts.perms]        Permissions façon UNIX ('rwxr-xr-x').
   * @param {boolean} [opts.encrypted=false] Fichier chiffré (illisible via cat).
   * @param {string} [opts.encKey=null]  Clé attendue par `decrypt`.
   * @param {boolean} [opts.hidden=false] Caché (visible seulement avec `ls -a`).
   * @param {boolean} [opts.locked=false] Nécessite les privilèges root pour lire.
   */
  constructor(name, type, opts = {}) {
    this.name = name;
    this.type = type;
    this.owner = opts.owner || 'user';
    this.perms = opts.perms || (type === 'dir' ? 'rwxr-xr-x' : 'rw-r--r--');
    // Un fichier caché commence par un point OU porte le flag explicite.
    this.hidden = opts.hidden || name.startsWith('.');
    this.locked = opts.locked || false;
    this.mtime = opts.mtime || '2049-11-03 04:17';

    if (type === 'dir') {
      /** @type {Map<string, VfsNode>} */
      this.children = new Map();
    } else {
      this.content = opts.content || '';
      this.encrypted = opts.encrypted || false;
      this.encKey = opts.encKey || null;
    }
  }

  isDir() { return this.type === 'dir'; }
  isFile() { return this.type === 'file'; }

  /** Ajoute un enfant à un dossier et renvoie l'enfant (chaînage pratique). */
  addChild(node) {
    if (!this.isDir()) throw new Error(`'${this.name}' n'est pas un dossier`);
    this.children.set(node.name, node);
    return node;
  }

  getChild(name) {
    return this.isDir() ? (this.children.get(name) || null) : null;
  }

  removeChild(name) {
    return this.isDir() ? this.children.delete(name) : false;
  }

  /** Taille "affichable" : nb d'octets du contenu, ou nb d'entrées d'un dossier. */
  size() {
    return this.isDir() ? this.children.size : this.content.length;
  }
}

/**
 * Le système de fichiers d'un hôte. Encapsule la racine et la logique de
 * résolution de chemin. C'est l'unique porte d'entrée pour lire/écrire/lister.
 */
class VirtualFileSystem {
  /**
   * @param {object} [opts]
   * @param {string} [opts.home='/home/user'] Répertoire personnel (cible de `~`).
   */
  constructor(opts = {}) {
    this.root = new VfsNode('/', 'dir', { owner: 'root' });
    this.home = opts.home || '/home/user';
  }

  // -- Fabriques concises, utilisées pour décrire le "monde" de façon lisible --

  /** Crée un dossier détaché (à rattacher via addChild). */
  static dir(name, opts = {}, children = []) {
    const node = new VfsNode(name, 'dir', opts);
    children.forEach((c) => node.addChild(c));
    return node;
  }

  /** Crée un fichier détaché. */
  static file(name, content = '', opts = {}) {
    return new VfsNode(name, 'file', { ...opts, content });
  }

  /**
   * Résout un chemin en nœud. Cœur de la robustesse du FS.
   *
   * @param {string} path  Chemin à résoudre ('', '.', '/etc', '../x', '~/y'...).
   * @param {string} cwd   Répertoire courant (chemin absolu, ex '/home/user').
   * @returns {VfsNode|null}  Le nœud, ou null si le chemin n'existe pas.
   */
  resolve(path, cwd = '/') {
    // Entrée vide ou '.' → le répertoire courant lui-même.
    if (path === undefined || path === null) path = '';
    let segments;

    if (path.startsWith('~')) {
      // '~' ou '~/...' → depuis le home.
      const rest = path.slice(1).replace(/^\/+/, '');
      segments = this._split(this.home).concat(this._split(rest));
    } else if (path.startsWith('/')) {
      // Chemin absolu.
      segments = this._split(path);
    } else {
      // Chemin relatif : on part du cwd.
      segments = this._split(cwd).concat(this._split(path));
    }

    // Normalisation : on applique '.' et '..' pour obtenir un chemin canonique.
    const stack = [];
    for (const seg of segments) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { stack.pop(); continue; }
      stack.push(seg);
    }

    // Descente dans l'arbre.
    let node = this.root;
    for (const seg of stack) {
      if (!node || !node.isDir()) return null;
      node = node.getChild(seg);
      if (!node) return null;
    }
    return node || null;
  }

  /** Renvoie le chemin absolu canonique correspondant à (path, cwd). */
  canonical(path, cwd = '/') {
    let segments;
    if (path.startsWith('~')) {
      const rest = path.slice(1).replace(/^\/+/, '');
      segments = this._split(this.home).concat(this._split(rest));
    } else if (path.startsWith('/')) {
      segments = this._split(path);
    } else {
      segments = this._split(cwd).concat(this._split(path));
    }
    const stack = [];
    for (const seg of segments) {
      if (seg === '.' || seg === '') continue;
      if (seg === '..') { stack.pop(); continue; }
      stack.push(seg);
    }
    return '/' + stack.join('/');
  }

  /** Liste le contenu d'un dossier (renvoie un tableau de VfsNode). */
  list(path, cwd = '/') {
    const node = this.resolve(path, cwd);
    if (!node || !node.isDir()) return null;
    return [...node.children.values()];
  }

  /** Supprime un nœud. Renvoie true si supprimé. */
  remove(path, cwd = '/') {
    const node = this.resolve(path, cwd);
    if (!node || node === this.root) return false;
    const parentPath = this.canonical(path + '/..', cwd);
    const parent = this.resolve(parentPath, '/');
    if (!parent || !parent.isDir()) return false;
    return parent.removeChild(node.name);
  }

  /** Découpe un chemin en segments non vides. */
  _split(p) {
    return String(p).split('/').filter((s) => s.length > 0);
  }
}

/* ---------------------------------------------------------------------------
 * Export universel : le même fichier sert au jeu (balise <script> → window.HT)
 * et à la suite de tests exécutée sous Node (require).
 * ------------------------------------------------------------------------- */
const api = { VfsNode, VirtualFileSystem };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
