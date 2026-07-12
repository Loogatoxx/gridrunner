'use strict';
/**
 * GameEngine.js
 * ----------------------------------------------------------------------------
 * Le chef d'orchestre. Il relie tout le reste et détient l'ÉTAT du jeu :
 *   - la pile de sessions (machine locale → hôte distant → pivot...),
 *   - la machine à états du terminal (FSM),
 *   - le compteur de traçage,
 *   - la progression de la campagne + la messagerie,
 *   - la persistance (localStorage).
 *
 * PRINCIPE CLÉ — les commandes ne modifient JAMAIS l'état "à la main". Elles
 * appellent des méthodes du moteur (`connect`, `escalate`, `download`, `wipe`,
 * `emit`...). Le moteur est le seul à muter la pile de sessions, la FSM et la
 * trace. Résultat : un seul endroit à raisonner, un seul endroit à tester.
 *
 * PILE DE SESSIONS — modélise le pivoting réseau : se connecter EMPILE une
 * session ; se déconnecter la DÉPILE. On revient donc naturellement sur l'hôte
 * précédent (et non directement chez soi), comme un vrai rebond.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

const _e = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({},
      require('./StateMachine'),
      require('./CommandParser'),
      require('./CommandRegistry'),
      require('./Crypto'),
      require('./world'),
      require('./PlayerBuild'),
      require('./Market'))
  : globalThis.HT;
const { createTerminalFSM, TERMINAL_STATES, CommandParser, CommandRegistry,
        Crypto, buildWorld, PlayerBuild, Market } = _e;

const SAVE_KEY = 'gridrunner.save.v2';

class GameEngine {
  /**
   * @param {object} opts
   * @param {object} opts.io  Sorties : { print(text,cls), error(text), clear(), status(engine)? }
   */
  constructor(opts = {}) {
    // Sorties. Valeurs par défaut inoffensives pour l'exécution sous Node (tests).
    this.io = Object.assign(
      { print() {}, error() {}, clear() {}, status() {} },
      opts.io || {}
    );

    this.registry = new CommandRegistry();
    this.fsm = createTerminalFSM((from, to) => this._onStateChange(from, to));

    // -- Méta-progression rogue-like : survit aux Game Over (pas au `reset`). --
    this.build = new PlayerBuild();   // crédits + augmentations achetées
    this.market = new Market();       // le Darknet Market
    this.meta = { detections: 0 };    // stats méta (nb de fois grillé…)
    this.busy = false;                // true pendant un mini-jeu (bloque la saisie)
    this._rng = Math.random;          // injectable pour rendre les défis déterministes

    this._initWorld();
  }

  /** (Re)construit un monde neuf et remet l'état de jeu à zéro. */
  _initWorld() {
    const world = buildWorld();
    this.localHost = world.localHost;
    this.network = world.network;
    this.missions = world.missions;
    this.wordlist = world.wordlist;

    // Pile de sessions. La session courante = sommet de la pile.
    this.sessions = [{
      host: this.localHost,
      user: 'runner',
      isRoot: false,
      cwd: this.localHost.vfs.home,
    }];

    this.trace = { enabled: true, armed: false, level: 0, max: 100 };
    this.mailbox = [];
    this.missionIndex = 0;
    this.finished = false;
    this.commandHistory = []; // lignes saisies (pour la commande `history`)
  }

  // -- Accès rapides à la session courante -----------------------------------
  get session() { return this.sessions[this.sessions.length - 1]; }
  get vfs() { return this.session.host.vfs; }
  get cwd() { return this.session.cwd; }
  set cwd(v) { this.session.cwd = v; }
  location() { return this.session.host.ip; }
  isRoot() { return this.session.isRoot; }
  isRemote() { return this.session.host.ip !== 'localhost'; }
  currentMission() { return this.missions[this.missionIndex] || null; }

  // ==========================================================================
  // DÉMARRAGE
  // ==========================================================================
  boot() {
    this.fsm.transition(TERMINAL_STATES.LOCAL);
    // Charge une éventuelle sauvegarde, sinon démarre la première mission.
    if (!this.load()) {
      this.startMission(this.currentMission(), { silent: false, firstBoot: true });
    } else {
      this.io.print(`~ progression restauree : mission ${this.missionIndex + 1}/${this.missions.length}. Tape  mission  pour reprendre.`, 'sys');
      const m = this.currentMission();
      if (m && m.armsTrace) this.trace.armed = true;
    }
    this.io.status(this);
  }

  // ==========================================================================
  // BOUCLE PRINCIPALE : exécuter une ligne saisie
  // ==========================================================================
  /**
   * Parse une ligne et exécute la commande. Ne lève jamais.
   * @param {string} line
   */
  runLine(line) {
    const parsed = CommandParser.parse(line);

    // Ligne vide : rien à faire (on ne considère pas ça comme une erreur).
    if (parsed.name === '') return;

    // Journalise la ligne pour la commande `history`.
    this.commandHistory.push(parsed.raw.trim());

    const cmd = this.registry.get(parsed.name);
    if (!cmd) {
      this.io.error(`${parsed.name}: commande introuvable. Tape 'help' pour la liste.`);
      return;
    }

    const ctx = {
      engine: this,
      io: this.io,
      args: parsed.args,
      flags: parsed.flags,
      rawArgs: parsed.rawArgs,
      raw: parsed.raw,
      cmd,
    };

    this.registry.execute(parsed.name, ctx);

    // Crypto-Miner : l'augmentation génère des crédits à chaque commande tapée.
    const mined = this.build.creditsPerCommand();
    if (mined) this.build.addCredits(mined);

    // Traçage : chaque action "réelle" sur un hôte distant fait monter la trace.
    if (this.trace.enabled && this.trace.armed && this.isRemote() && !cmd.noTrace) {
      this._tickTrace();
    }
    this.io.status(this);
    this.save();
  }

  _tickTrace() {
    // La vitesse de base de l'hôte est modulée par les augmentations (Ghost-Mask…).
    const rate = Math.max(1, Math.round(this.session.host.traceRate * this.build.traceRateMultiplier()));
    this.trace.level = Math.min(this.trace.max, this.trace.level + rate);
    if (this.trace.level >= this.trace.max) this._gameOver();
  }

  /**
   * Pénalité de traçage (échec de mini-jeu). Réduite par Black-ICE.
   * @returns {{applied:boolean, dmg?:number}}
   */
  penalizeTrace(n) {
    if (!(this.trace.armed && this.trace.enabled)) return { applied: false };
    const dmg = Math.max(1, Math.round(n * this.build.failPenaltyMultiplier()));
    this.trace.level = Math.min(this.trace.max, this.trace.level + dmg);
    if (this.trace.level >= this.trace.max) this._gameOver();
    return { applied: true, dmg };
  }

  /**
   * Lance un défi (mini-jeu) et exécute `onResult(win)` à la fin.
   * En mode sans UI (tests Node), le défi est auto-réussi : la logique de jeu
   * reste testable de bout en bout sans DOM.
   */
  startChallenge(spec, onResult) {
    this.busy = true;
    const done = (win) => {
      this.busy = false;
      try { onResult(!!win); }
      finally { this.io.status(this); this.save(); }
    };
    if (typeof this.io.minigame === 'function') this.io.minigame(spec, done);
    else done(true);
  }

  /**
   * GAME OVER — le traçage a atteint 100%. Boucle rogue-like : le "run" est
   * perdu (réseau réinitialisé, sessions coupées, objectifs de la mission
   * courante remis à zéro) MAIS la méta-progression est conservée : crédits et
   * augmentations restent acquis. On repart au début de la mission courante.
   */
  _gameOver() {
    this.meta.detections = (this.meta.detections || 0) + 1;
    this.io.print('', '');
    this.io.print('  ############  GAME OVER  ############', 'err');
    this.io.print('  Trace 100% -- le SOC AEGIS a verrouille ta position.', 'err');
    this.io.print('  Run perdu. Credits et augmentations CONSERVES (meta-progression).', 'dim');
    this.io.print('  Le reseau se reinitialise -- retente la mission courante.', 'dim');
    if (this.io.sfx) this.io.sfx('alarm');
    if (this.fsm.is(TERMINAL_STATES.CONNECTED)) {
      this.fsm.transition(TERMINAL_STATES.TRACED_OUT);
      this.fsm.transition(TERMINAL_STATES.LOCAL);
    }
    const idx = this.missionIndex;
    this._rebuildRun();
    this._rehydrateToMission(idx);
    this.save();
  }

  /** Monde neuf + sessions locales, SANS toucher à la méta (build, missionIndex). */
  _rebuildRun() {
    const world = buildWorld();
    this.localHost = world.localHost;
    this.network = world.network;
    this.missions = world.missions;
    this.wordlist = world.wordlist;
    this.sessions = [{ host: this.localHost, user: 'runner', isRoot: false, cwd: this.localHost.vfs.home }];
    this.trace = { enabled: this.trace.enabled, armed: false, level: 0, max: 100 };
    this.mailbox = [];
    this.finished = false;
  }

  /** Rejoue silencieusement les missions déjà franchies et (ré)arme la courante. */
  _rehydrateToMission(idx) {
    idx = Math.max(0, Math.min(this.missions.length - 1, idx | 0));
    for (let i = 0; i < idx; i++) {
      this.missions[i].completed = true;
      this.missions[i].objectives.forEach((o) => { o.done = true; });
    }
    this.missionIndex = idx;
    const cur = this.currentMission();
    if (cur) {
      cur.completed = false;
      cur.objectives.forEach((o) => { o.done = false; });
      if (cur.armsTrace) this.trace.armed = true;
      if (cur.mail) {
        this.mailbox.push({
          from: cur.mail.from, subject: cur.mail.subject,
          body: cur.mail.body, unread: true, missionId: cur.id,
        });
      }
    }
  }

  // ==========================================================================
  // ACTIONS DE JEU (appelées par les commandes)
  // ==========================================================================

  /** Résout un chemin dans le FS de la session courante. */
  resolve(path) { return this.vfs.resolve(path, this.cwd); }
  canonical(path) { return this.vfs.canonical(path, this.cwd); }

  /**
   * Se connecter à un hôte. Gère joignabilité (pivot) et authentification.
   * @returns {{ok:boolean, msg?:string}}
   */
  connect(ip, user, pass) {
    const host = this.network.get(ip);
    if (!host || !host.isReachableFrom(this.location())) {
      return { ok: false, msg: `aucune route vers l'hote ${ip} (hors de portee d'ici)` };
    }
    const firstTime = !host.compromised; // prime versée à la 1re intrusion
    if (host.requiresAuth) {
      if (!user || pass === undefined) {
        return { ok: false, msg: `authentification requise. Usage: connect ${ip} <user> <pass>` };
      }
      const auth = host.authenticate(user, pass);
      if (!auth.ok) return { ok: false, msg: `acces refuse (${auth.reason})` };
      host.discovered = host.scanned = host.compromised = true;
      host.writeLog(`${host.mtime} sshd[0]: Accepted password for ${user} from 0.0.0.0 [INTRUS]`);
      this.sessions.push({ host, user, isRoot: !!auth.root, cwd: host.vfs.home });
    } else {
      host.discovered = host.compromised = true;
      this.sessions.push({ host, user: user || 'anon', isRoot: false, cwd: host.vfs.home });
    }
    // Nouvelle prise de pied → compteur de trace neuf.
    this.trace.level = 0;
    if (this.fsm.is(TERMINAL_STATES.LOCAL)) this.fsm.transition(TERMINAL_STATES.CONNECTED);
    let bounty = 0;
    if (firstTime) { bounty = host.bounty || 15; this.build.addCredits(bounty); }
    this.emit({ type: 'connect', ip: host.ip, user: this.session.user, root: this.session.isRoot });
    return { ok: true, host, bounty };
  }

  /** Cherche le clair d'une empreinte SANS émettre d'évènement (pour `crack`). */
  crackLookup(hash) { return Crypto.crackWithWordlist(hash, this.wordlist); }

  /**
   * Revend un fichier de ~/loot contre des crédits (× multiplicateur de revente).
   * @returns {{ok:boolean, value?:number, name?:string, msg?:string}}
   */
  sellFile(name) {
    const loot = this.localHost.vfs.resolve('/home/runner/loot', '/');
    if (!loot || !loot.isDir()) return { ok: false, msg: 'pas de butin' };
    const node = loot.getChild(name);
    if (!node) return { ok: false, msg: `aucun butin nomme '${name}'` };
    const base = node.value != null ? node.value : (10 + Math.floor((node.content || '').length / 6));
    const value = Math.round(base * this.build.sellMultiplier());
    loot.removeChild(name);
    this.build.addCredits(value);
    return { ok: true, value, name };
  }

  /**
   * Se déconnecter de l'hôte courant (dépile). Émet les évènements de sortie.
   * @returns {{ok:boolean, msg?:string, ip?:string}}
   */
  disconnect() {
    if (!this.isRemote()) return { ok: false, msg: 'tu es deja sur ta propre machine.' };
    const leaving = this.session.host;
    this.sessions.pop();
    this.trace.level = 0;
    if (!this.isRemote() && this.fsm.is(TERMINAL_STATES.CONNECTED)) {
      this.fsm.transition(TERMINAL_STATES.LOCAL);
    }
    // Évènement pour l'hôte quitté...
    this.emit({ type: 'disconnect', ip: leaving.ip });
    // ...et, si on est revenu tout en bas, évènement "sorti pour de bon".
    if (!this.isRemote()) this.emit({ type: 'disconnect', ip: 'localhost' });
    return { ok: true, ip: leaving.ip };
  }

  /**
   * Élever ses privilèges sur l'hôte courant (su / sudo).
   * @returns {{ok:boolean, msg?:string, root?:boolean}}
   */
  escalate(user, pass) {
    if (!this.isRemote()) return { ok: false, msg: 'aucun privilege a elever sur ta propre machine.' };
    const host = this.session.host;
    const auth = host.authenticate(user, pass);
    if (!auth.ok) return { ok: false, msg: `echec de l'elevation (${auth.reason})` };
    this.session.user = user;
    this.session.isRoot = !!auth.root;
    host.writeLog(`${host.mtime} su[0]: session opened for user ${user} [INTRUS]`);
    this.emit({ type: 'escalate', ip: host.ip, user });
    return { ok: true, root: this.session.isRoot };
  }

  /** Attaque par dictionnaire. @returns {string|null} le mot de passe trouvé. */
  crack(hash) {
    const plain = Crypto.crackWithWordlist(hash, this.wordlist);
    if (plain) this.emit({ type: 'crack', hash: String(hash).toLowerCase().trim(), plain });
    return plain;
  }

  /** Copie un fichier de l'hôte courant vers ~/loot/ de la machine locale. */
  download(node, path) {
    const loot = this.localHost.vfs.resolve('/home/runner/loot', '/');
    if (!loot || !loot.isDir()) return { ok: false, msg: 'dossier ~/loot introuvable' };
    // Copie défensive : le fichier exfiltré est indépendant de l'original.
    const VfsNode = node.constructor;
    const dup = new VfsNode(node.name, 'file', { content: node.content, owner: 'runner' });
    // Valeur de revente : les fichiers d'un hôte "important" valent plus cher.
    dup.value = (node.value != null ? node.value : 12) + Math.floor((this.session.host.bounty || 10) / 2);
    loot.children.set(dup.name, dup);
    this.emit({ type: 'download', path: this.canonical(path), ip: this.location() });
    return { ok: true, value: dup.value };
  }

  /** Émet un évènement de jeu vers la mission courante puis teste sa complétion. */
  emit(evt) {
    const m = this.currentMission();
    if (m && typeof m.onEvent === 'function') {
      try { m.onEvent(this, evt); } catch (_) { /* une mission bancale ne casse pas le jeu */ }
    }
    this._checkMissionComplete();
  }

  // ==========================================================================
  // CAMPAGNE
  // ==========================================================================
  startMission(mission, opts = {}) {
    if (!mission) return;
    mission.objectives.forEach((o) => { o.done = false; });
    mission.completed = false;
    if (mission.armsTrace) this.trace.armed = true;
    if (mission.mail) {
      this.mailbox.push({
        from: mission.mail.from, subject: mission.mail.subject,
        body: mission.mail.body, unread: true, missionId: mission.id,
      });
    }
    if (!opts.silent) {
      this.io.print(`>> nouveau message de ${mission.mail ? mission.mail.from : 'NULL'}. Tape  mail  pour le lire.`, 'ok');
    }
  }

  _checkMissionComplete() {
    const m = this.currentMission();
    if (!m || m.completed) return;
    if (m.objectives.length && m.objectives.every((o) => o.done)) {
      m.completed = true;
      this.io.print('', '');
      this.io.print(`== OBJECTIF ATTEINT -- ${m.codename} ==`, 'ok');
      this.io.print(`Mission "${m.title}" terminee.`, 'ok');
      this.missionIndex++;
      if (this.missionIndex < this.missions.length) {
        this.startMission(this.currentMission());
      } else {
        this._victory();
      }
      this.save();
    }
  }

  _victory() {
    this.finished = true;
    if (this.fsm.can(TERMINAL_STATES.VICTORY)) this.fsm.transition(TERMINAL_STATES.VICTORY);
    this.io.print('', '');
    this.io.print('  ================================================', 'ok');
    this.io.print('   CAMPAGNE TERMINEE -- LA PREUVE EST SUR LA GRILLE', 'ok');
    this.io.print('  ================================================', 'ok');
    this.io.print('', '');
    this.io.print('  blackfile exfiltre. Journaux effaces. Aucune trace.', 'bright');
    this.io.print('  ORACLE ne restera pas un secret.', 'bright');
    this.io.print('', '');
    this.io.print('  "Tu n\'as jamais existe sur ce reseau, runner. C\'est', 'dim');
    this.io.print('   la plus belle chose qu\'on puisse dire d\'un hackeur."', 'dim');
    this.io.print('                                            -- NULL', 'dim');
    this.io.print('', '');
    this.io.print('  Tape  reset  pour rejouer depuis le debut.', 'sys');
  }

  // ==========================================================================
  // ÉTAT / AFFICHAGE
  // ==========================================================================
  _onStateChange(from, to) { /* point d'extension : hooks d'UI si besoin */ }

  /** Chaîne d'invite (prompt) reflétant l'utilisateur, l'hôte et le cwd. */
  promptString() {
    const s = this.session;
    const shortHost = s.host.hostname.split('.')[0];
    let path = this.cwd;
    // Abréviation du home en '~' (confort de lecture, comme un vrai shell).
    if (path === s.host.vfs.home) path = '~';
    else if (path.startsWith(s.host.vfs.home + '/')) path = '~' + path.slice(s.host.vfs.home.length);
    const sigil = s.isRoot ? '#' : '$';
    return `${s.user}@${shortHost}:${path}${sigil} `;
  }

  // ==========================================================================
  // PERSISTANCE (localStorage) — tolérante à l'absence de localStorage (Node).
  // ==========================================================================
  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        missionIndex: this.missionIndex,
        traceEnabled: this.trace.enabled,
        build: this.build.toJSON(),   // méta : crédits + augmentations
        meta: this.meta,
      }));
    } catch (_) { /* quota / mode privé : on ignore, le jeu marche sans sauvegarde */ }
  }

  load() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      // Méta-progression d'abord (crédits, augmentations, stats).
      this.build = PlayerBuild.fromJSON(data.build);
      this.meta = data.meta || { detections: 0 };
      this.trace.enabled = data.traceEnabled !== false;
      // Puis on se replace à la bonne mission (marque les précédentes + mail).
      this._rehydrateToMission(data.missionIndex | 0);
      return true;
    } catch (_) { return false; }
  }

  /** Réinitialisation TOTALE (choix du joueur) : efface aussi la méta-progression. */
  reset() {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
    }
    this.build = new PlayerBuild();
    this.market = new Market();
    this.meta = { detections: 0 };
    // FSM neuve + monde neuf.
    this.fsm = createTerminalFSM((from, to) => this._onStateChange(from, to));
    this.fsm.transition(TERMINAL_STATES.LOCAL);
    this._initWorld();
    this.startMission(this.currentMission(), { silent: false });
  }
}

// -- Export universel (Node module.exports OU navigateur window.HT) --------
const api = { GameEngine };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
