'use strict';
/**
 * Terminal.js  (couche UI — navigateur uniquement)
 * ----------------------------------------------------------------------------
 * Fait le pont entre le DOM et le GameEngine. Responsabilités STRICTEMENT UI :
 *   - afficher les lignes de sortie (avec leur classe de style),
 *   - capturer la frappe (Entrée, historique ↑/↓, autocomplétion TAB, Ctrl+L),
 *   - dessiner l'invite (prompt) et le curseur bloc,
 *   - tenir la barre de statut (session, mission, traçage, horloge).
 *
 * AUCUNE règle de jeu ici. L'UI expose un objet `io` (print/error/clear/status)
 * que le moteur utilise ; en retour, elle appelle `engine.runLine(...)`. Ce
 * découplage est ce qui permet de tester tout le moteur sous Node sans DOM.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

class Terminal {
  constructor(root) {
    this.root = root;
    this.output      = root.querySelector('#output');
    this.screen      = root.querySelector('#screen');
    this.promptEl    = root.querySelector('#prompt');
    this.typedEl     = root.querySelector('#typed');
    this.cursorEl    = root.querySelector('#cursor');
    this.input       = root.querySelector('#hidden-input');
    this.statusLeft  = root.querySelector('#status-left');
    this.statusRight = root.querySelector('#status-right');

    this.history = [];      // historique de saisie (flèche haut)
    this.histIdx = -1;
    this.ready = false;     // true une fois la séquence de boot terminée
    this.engine = null;
    this._clockStr = '';
    this._traceStr = '';

    // Interface de sortie fournie au moteur. print() gère le multi-ligne.
    this.io = {
      print: (t, c) => this.print(t, c),
      error: (t) => this.print(t, 'err'),
      clear: () => this.clearScreen(),
      status: (e) => this.updateStatus(e),
    };

    this._wireEvents();
    this._startClock();
  }

  /** Associe le moteur (créé avec this.io). */
  bind(engine) { this.engine = engine; }

  // ==========================================================================
  // AFFICHAGE
  // ==========================================================================
  /** Ajoute une (ou plusieurs) ligne(s). Sûr : passe par textContent. */
  print(text, cls) {
    const parts = String(text).split('\n');
    for (const part of parts) {
      const div = document.createElement('div');
      div.className = 'line' + (cls ? ' ' + cls : '');
      div.textContent = part;
      this.output.appendChild(div);
    }
    this._scrollToBottom();
  }

  /** Ré-affiche la ligne saisie (prompt + commande) dans l'historique visuel. */
  _echoInput(raw) {
    const div = document.createElement('div');
    div.className = 'line';
    const p = document.createElement('span');
    p.className = 'prompt-echo';
    p.textContent = this.engine.promptString();
    const c = document.createElement('span');
    c.className = 'cmd-echo';
    c.textContent = raw;
    div.appendChild(p);
    div.appendChild(c);
    this.output.appendChild(div);
  }

  clearScreen() { this.output.innerHTML = ''; }

  _scrollToBottom() { this.screen.scrollTop = this.screen.scrollHeight; }

  // ==========================================================================
  // SAISIE
  // ==========================================================================
  _wireEvents() {
    // Reflète la valeur tapée dans la ligne visible.
    this.input.addEventListener('input', () => {
      this.typedEl.textContent = this.input.value;
      this._scrollToBottom();
    });

    this.input.addEventListener('keydown', (e) => this._onKey(e));

    // Cliquer n'importe où (re)donne le focus au champ de saisie.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target.tagName !== 'A') {
        // Laisse la sélection de texte se faire, mais garde le focus utile.
        setTimeout(() => this.input.focus(), 0);
      }
    });
    // État visuel du curseur selon le focus.
    this.input.addEventListener('focus', () => this.cursorEl.classList.remove('idle'));
    this.input.addEventListener('blur',  () => this.cursorEl.classList.add('idle'));
  }

  _onKey(e) {
    if (!this.ready) { e.preventDefault(); return; }

    if (e.key === 'Enter') {
      e.preventDefault();
      const raw = this.input.value;
      this._submit(raw);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._historyNav(-1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._historyNav(1);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this._autocomplete();
      return;
    }
    if ((e.key === 'l' || e.key === 'L') && e.ctrlKey) {
      e.preventDefault();
      this.clearScreen();
      return;
    }
  }

  _submit(raw) {
    this._echoInput(raw);
    const trimmed = raw.trim();
    if (trimmed) {
      // Évite les doublons consécutifs dans l'historique.
      if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed);
    }
    this.histIdx = this.history.length;

    // Exécution : le moteur ne jette jamais, mais on double la ceinture.
    try { this.engine.runLine(raw); }
    catch (err) { this.print('erreur inattendue: ' + (err && err.message), 'err'); }

    this.input.value = '';
    this.typedEl.textContent = '';
    this._refreshPrompt();
    this._scrollToBottom();
  }

  _historyNav(dir) {
    if (this.history.length === 0) return;
    this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + dir));
    const val = this.histIdx >= this.history.length ? '' : this.history[this.histIdx];
    this.input.value = val;
    this.typedEl.textContent = val;
    // Place le curseur en fin de champ.
    requestAnimationFrame(() => this.input.setSelectionRange(val.length, val.length));
  }

  /** Autocomplétion TAB : noms de commandes (1er mot) ou chemins (ensuite). */
  _autocomplete() {
    try {
      const val = this.input.value;
      const hasSpace = /\s/.test(val.trim()) || /\s$/.test(val);
      let candidates = [];
      let apply = (choice) => { this.input.value = choice; };

      if (!hasSpace) {
        // Complétion de commande.
        const prefix = val.trim();
        candidates = this.engine.registry.names().filter((n) => n.startsWith(prefix));
        apply = (c) => { this.input.value = c + ' '; };
      } else {
        // Complétion de chemin sur le dernier token.
        const parts = val.split(/\s+/);
        const last = parts[parts.length - 1];
        const slash = last.lastIndexOf('/');
        const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
        const frag = slash >= 0 ? last.slice(slash + 1) : last;
        const dirNode = this.engine.resolve(dirPart || '.');
        if (!dirNode || !dirNode.isDir()) return;
        const names = [...dirNode.children.values()]
          .filter((n) => !n.hidden || frag.startsWith('.'))
          .map((n) => n.name + (n.isDir() ? '/' : ''))
          .filter((n) => n.startsWith(frag));
        candidates = names;
        apply = (c) => {
          parts[parts.length - 1] = dirPart + c;
          this.input.value = parts.join(' ');
        };
      }

      if (candidates.length === 1) {
        apply(candidates[0]);
        this.typedEl.textContent = this.input.value;
      } else if (candidates.length > 1) {
        // Complète le plus long préfixe commun, puis liste les possibilités.
        const common = this._commonPrefix(candidates);
        if (common) {
          if (!hasSpace) this.input.value = common;
          else {
            const parts = this.input.value.split(/\s+/);
            const last = parts[parts.length - 1];
            const slash = last.lastIndexOf('/');
            parts[parts.length - 1] = (slash >= 0 ? last.slice(0, slash + 1) : '') + common;
            this.input.value = parts.join(' ');
          }
          this.typedEl.textContent = this.input.value;
        }
        this.print(candidates.join('   '), 'dim');
      }
    } catch (_) { /* l'autocomplétion ne doit jamais casser la saisie */ }
  }

  _commonPrefix(list) {
    if (list.length === 0) return '';
    let p = list[0];
    for (const s of list) {
      while (!s.startsWith(p)) p = p.slice(0, -1);
      if (!p) break;
    }
    return p;
  }

  // ==========================================================================
  // BARRE DE STATUT + INVITE
  // ==========================================================================
  _refreshPrompt() {
    if (this.engine) this.promptEl.textContent = this.engine.promptString();
  }

  updateStatus(engine) {
    this._refreshPrompt();

    // Gauche : session + mission.
    const s = engine.session;
    const shortHost = s.host.hostname.split('.')[0];
    const who = `${s.user}@${shortHost}${s.isRoot ? ' #' : ''}`;
    let mission;
    if (engine.finished) mission = 'CAMPAGNE TERMINEE';
    else {
      const m = engine.currentMission();
      mission = m ? `${m.codename}  M${engine.missionIndex + 1}/${engine.missions.length}` : '';
    }
    this.statusLeft.textContent = `${who}  //  ${mission}`;

    // Droite : traçage (barre) — puis horloge (gérée par _startClock).
    const t = engine.trace;
    if (!t.armed) {
      this._traceStr = 'TRACE ————————';
      this._traceCrit = false;
    } else if (!t.enabled) {
      this._traceStr = 'TRACE OFF';
      this._traceCrit = false;
    } else {
      const cells = 12;
      const filled = Math.round((t.level / t.max) * cells);
      const bar = '#'.repeat(filled) + '-'.repeat(cells - filled);
      const pct = Math.round((t.level / t.max) * 100);
      this._traceStr = `TRACE [${bar}] ${pct}%`;
      this._traceCrit = pct >= 80;
    }
    this._renderRight();
  }

  _renderRight() {
    this.statusRight.innerHTML = '';
    const trace = document.createElement('span');
    trace.textContent = this._traceStr;
    if (this._traceCrit) trace.className = 'crit';
    const clock = document.createElement('span');
    clock.textContent = this._clockStr;
    this.statusRight.appendChild(trace);
    this.statusRight.appendChild(clock);
  }

  _startClock() {
    const tick = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      this._clockStr = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      this._renderRight();
    };
    tick();
    setInterval(tick, 1000);
  }

  // ==========================================================================
  // SÉQUENCE DE DÉMARRAGE
  // ==========================================================================
  boot() {
    const bootLog = [
      { t: '[ ok ] noyau blackout 3.4 charge',                     c: 'dim' },
      { t: '[ ok ] montage du systeme de fichiers virtuel',        c: 'dim' },
      { t: '[ ok ] module crypto initialise',                      c: 'dim' },
      { t: '[ ok ] interface eth0 up  ->  10.0.0.66',              c: 'dim' },
      { t: '[ ok ] tunnel chiffre vers la Grille etabli',          c: 'dim' },
      { t: '', c: '' },
    ];
    const banner = [
      '  ############################################################',
      '  #                                                          #',
      '  #     G R I D R U N N E R      terminal d\'intrusion        #',
      '  #     deck OS 3.4 "blackout"   session anonyme             #',
      '  #                                                          #',
      '  ############################################################',
      '',
    ];

    let i = 0;
    const step = () => {
      if (i < bootLog.length) {
        this.print(bootLog[i].t, bootLog[i].c);
        i++;
        setTimeout(step, 130);
      } else {
        banner.forEach((l) => this.print(l, 'bright'));
        this.print("Tape  help  pour la liste des commandes, ou  mail  pour tes ordres.", 'sys');
        this.print('', '');
        // Le moteur prend le relais : première mission + statut.
        this.engine.boot();
        this.ready = true;
        this._refreshPrompt();
        this.input.focus();
        this._scrollToBottom();
      }
    };
    step();
  }
}

// Export navigateur (pas de Node ici : cette couche dépend du DOM).
Object.assign(globalThis.HT || (globalThis.HT = {}), { Terminal });

})();
