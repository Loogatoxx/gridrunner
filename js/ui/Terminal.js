'use strict';
/**
 * Terminal.js  (couche UI — navigateur uniquement)
 * ----------------------------------------------------------------------------
 * Fait le pont entre le DOM et le GameEngine. Responsabilités STRICTEMENT UI :
 *   - afficher les lignes de sortie (avec leur classe de style),
 *   - capturer la frappe : Entrée, historique ↑/↓, autocomplétion TAB, Ctrl+L,
 *     et surtout un CURSEUR POSITIONNEL (flèches ←/→) + sélection souris +
 *     copier/coller natifs,
 *   - tenir la barre de statut, la carte réseau cliquable et le rig,
 *   - déléguer les mini-jeux (MinigameUI) et les sons (AudioFX).
 *
 * AUCUNE règle de jeu ici. L'UI expose un objet `io` que le moteur utilise
 * (print/error/clear/status + sfx/minigame/setMuted), et appelle en retour
 * `engine.runLine(...)`. Ce découplage permet de tester tout le moteur sans DOM.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

const HT = globalThis.HT;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

class Terminal {
  constructor(root) {
    this.root = root;
    this.output      = root.querySelector('#output');
    this.screen      = root.querySelector('#screen');
    this.promptEl    = root.querySelector('#prompt');
    this.typedEl     = root.querySelector('#typed');
    this.cursorEl    = root.querySelector('#cursor');
    this.afterEl     = root.querySelector('#after');
    this.input       = root.querySelector('#hidden-input');
    this.statusLeft  = root.querySelector('#status-left');
    this.statusRight = root.querySelector('#status-right');
    // Sidebar (carte réseau + crédits + rig).
    this.sideCredits = root.querySelector('#side-credits');
    this.sideNodes   = root.querySelector('#side-nodes');
    this.sideBuild   = root.querySelector('#side-build');

    this.history = [];
    this.histIdx = 0;
    this.ready = false;
    this.engine = null;
    this._clockStr = '';
    this._traceStr = '';
    this._traceCrit = false;
    this._wasCrit = false;

    // Sous-systèmes UI.
    this.audio = new HT.AudioFX();
    this.minigameUI = new HT.MinigameUI(root.querySelector('#minigame-root'), this.audio);

    // Interface de sortie fournie au moteur.
    this.io = {
      print: (t, c) => this.print(t, c),
      error: (t) => this.print(t, 'err'),
      clear: () => this.clearScreen(),
      status: (e) => this.updateStatus(e),
      sfx: (name) => { if (this.audio && typeof this.audio[name] === 'function') this.audio[name](); },
      setMuted: (v) => this.audio.setMuted(v),
      minigame: (spec, cb) => this._openMinigame(spec, cb),
    };

    this._wireEvents();
    this._startClock();
  }

  bind(engine) { this.engine = engine; }

  // ==========================================================================
  // AFFICHAGE
  // ==========================================================================
  print(text, cls) {
    const parts = String(text).split('\n');
    for (const part of parts) {
      const div = el('div', 'line' + (cls ? ' ' + cls : ''), part);
      this.output.appendChild(div);
    }
    this._scrollToBottom();
  }

  _echoInput(raw) {
    const div = el('div', 'line');
    div.appendChild(el('span', 'prompt-echo', this.engine.promptString()));
    div.appendChild(el('span', 'cmd-echo', raw));
    this.output.appendChild(div);
  }

  clearScreen() { this.output.innerHTML = ''; }
  _scrollToBottom() { this.screen.scrollTop = this.screen.scrollHeight; }

  // ==========================================================================
  // SAISIE — curseur positionnel + sélection souris + presse-papiers
  // ==========================================================================
  _wireEvents() {
    // Reflète la valeur ET la position du curseur (d'où le rendu en 3 morceaux).
    const rerender = () => this._renderInput();
    this.input.addEventListener('input', rerender);
    this.input.addEventListener('keyup', rerender);     // capte le déplacement ←/→
    this.input.addEventListener('click', rerender);
    this.input.addEventListener('select', rerender);
    this.input.addEventListener('keydown', (e) => this._onKey(e));

    this.input.addEventListener('focus', () => { this.cursorEl.classList.remove('idle'); rerender(); });
    this.input.addEventListener('blur',  () => this.cursorEl.classList.add('idle'));

    // Collage : on nettoie les retours à la ligne (une ligne de commande = 1 ligne).
    this.input.addEventListener('paste', (e) => {
      e.preventDefault();
      const raw = (e.clipboardData || window.clipboardData).getData('text') || '';
      const clean = raw.replace(/\s*\n\s*/g, ' ');
      const s = this.input.selectionStart, en = this.input.selectionEnd;
      this.input.value = this.input.value.slice(0, s) + clean + this.input.value.slice(en);
      const np = s + clean.length;
      this.input.setSelectionRange(np, np);
      this._renderInput();
    });

    // SÉLECTION SOURIS : on ne vole le focus QUE sur un simple clic (sélection
    // vide). Si l'utilisateur a sélectionné du texte (IP, hash…), on ne touche
    // à rien -> la sélection reste, et Ctrl+C / clic droit > Copier marchent.
    document.addEventListener('mouseup', () => {
      if (this.engine && this.engine.busy) return;      // mini-jeu en cours
      const sel = window.getSelection && window.getSelection();
      const hasSelection = sel && !sel.isCollapsed && String(sel).length > 0;
      if (!hasSelection) this._focusInput();
    });
  }

  /** Reconstruit la ligne visible : texte avant | bloc-curseur | texte après. */
  _renderInput() {
    const val = this.input.value;
    let pos = this.input.selectionStart;
    if (pos == null || pos < 0) pos = val.length;
    this.typedEl.textContent = val.slice(0, pos);
    const at = val.slice(pos, pos + 1);
    this.cursorEl.textContent = at.length ? at : ' ';   // char sous le curseur (ou bloc vide)
    this.afterEl.textContent = val.slice(pos + 1);
  }

  _focusInput() { if (this.input) this.input.focus(); }

  /** Insère du texte à la position du curseur (clic sur la carte réseau). */
  _insertToInput(text) {
    if (this.engine && this.engine.busy) return;
    const s = this.input.selectionStart != null ? this.input.selectionStart : this.input.value.length;
    const e = this.input.selectionEnd != null ? this.input.selectionEnd : s;
    this.input.value = this.input.value.slice(0, s) + text + this.input.value.slice(e);
    const np = s + text.length;
    this._focusInput();
    this.input.setSelectionRange(np, np);
    this._renderInput();
  }

  _onKey(e) {
    if (this.engine && this.engine.busy) return;   // pendant un mini-jeu, l'UI dédiée gère
    if (!this.ready) { e.preventDefault(); return; }

    // Son de frappe (touches "utiles"), sans bloquer le presse-papiers.
    if (this.audio && !e.ctrlKey && !e.metaKey &&
        (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter')) {
      this.audio.key();
    }

    if (e.key === 'Enter') { e.preventDefault(); this._submit(this.input.value); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this._historyNav(-1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this._historyNav(1); return; }
    if (e.key === 'Tab') { e.preventDefault(); this._autocomplete(); return; }
    if ((e.key === 'l' || e.key === 'L') && e.ctrlKey) { e.preventDefault(); this.clearScreen(); return; }
    // ←/→/Home/End/Backspace… : comportement natif de l'input, puis re-rendu (keyup).
  }

  _submit(raw) {
    this._echoInput(raw);
    const trimmed = raw.trim();
    if (trimmed && this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed);
    this.histIdx = this.history.length;

    try { this.engine.runLine(raw); }
    catch (err) { this.print('erreur inattendue: ' + (err && err.message), 'err'); }

    this.input.value = '';
    this._renderInput();
    this._refreshPrompt();
    this._scrollToBottom();
  }

  _historyNav(dir) {
    if (this.history.length === 0) return;
    this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + dir));
    const val = this.histIdx >= this.history.length ? '' : this.history[this.histIdx];
    this.input.value = val;
    this._renderInput();
    requestAnimationFrame(() => { this.input.setSelectionRange(val.length, val.length); this._renderInput(); });
  }

  _autocomplete() {
    try {
      const val = this.input.value;
      const hasSpace = /\s/.test(val.trim()) || /\s$/.test(val);
      let candidates = [];
      let apply = (choice) => { this.input.value = choice; };

      if (!hasSpace) {
        const prefix = val.trim();
        candidates = this.engine.registry.names().filter((n) => n.startsWith(prefix));
        apply = (c) => { this.input.value = c + ' '; };
      } else {
        const parts = val.split(/\s+/);
        const last = parts[parts.length - 1];
        const slash = last.lastIndexOf('/');
        const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
        const frag = slash >= 0 ? last.slice(slash + 1) : last;
        const dirNode = this.engine.resolve(dirPart || '.');
        if (!dirNode || !dirNode.isDir()) return;
        candidates = [...dirNode.children.values()]
          .filter((n) => !n.hidden || frag.startsWith('.'))
          .map((n) => n.name + (n.isDir() ? '/' : ''))
          .filter((n) => n.startsWith(frag));
        apply = (c) => { parts[parts.length - 1] = dirPart + c; this.input.value = parts.join(' '); };
      }

      if (candidates.length === 1) {
        apply(candidates[0]);
      } else if (candidates.length > 1) {
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
        }
        this.print(candidates.join('   '), 'dim');
      }
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      this._renderInput();
    } catch (_) { /* l'autocomplétion ne doit jamais casser la saisie */ }
  }

  _commonPrefix(list) {
    if (list.length === 0) return '';
    let p = list[0];
    for (const s of list) { while (!s.startsWith(p)) p = p.slice(0, -1); if (!p) break; }
    return p;
  }

  // ==========================================================================
  // MINI-JEUX
  // ==========================================================================
  _openMinigame(spec, cb) {
    this.input.blur();
    this.minigameUI.play(spec, (win) => { this._focusInput(); cb(win); });
  }

  // ==========================================================================
  // BARRE DE STATUT + SIDEBAR
  // ==========================================================================
  _refreshPrompt() { if (this.engine) this.promptEl.textContent = this.engine.promptString(); }

  updateStatus(engine) {
    this._refreshPrompt();

    // -- Barre de statut : session + mission -------------------------------
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

    // -- Traçage (barre) ---------------------------------------------------
    const t = engine.trace;
    if (!t.armed) { this._traceStr = 'TRACE ————————'; this._traceCrit = false; }
    else if (!t.enabled) { this._traceStr = 'TRACE OFF'; this._traceCrit = false; }
    else {
      const cells = 12;
      const filled = Math.round((t.level / t.max) * cells);
      const bar = '#'.repeat(filled) + '-'.repeat(cells - filled);
      this._traceStr = `TRACE [${bar}] ${Math.round((t.level / t.max) * 100)}%`;
      this._traceCrit = (t.level / t.max) >= 0.8;
    }
    this._renderRight();

    // -- Flash d'alarme rouge quand la trace devient critique --------------
    if (this._traceCrit) {
      this.root.classList.add('alarm');
      if (!this._wasCrit && this.audio) this.audio.alarm();
    } else {
      this.root.classList.remove('alarm');
    }
    this._wasCrit = this._traceCrit;

    // -- Sidebar : crédits, carte réseau, rig ------------------------------
    this._renderSidebar(engine);
  }

  _renderRight() {
    this.statusRight.innerHTML = '';
    const trace = el('span', this._traceCrit ? 'crit' : '', this._traceStr);
    const clock = el('span', '', this._clockStr);
    this.statusRight.appendChild(trace);
    this.statusRight.appendChild(clock);
  }

  _renderSidebar(engine) {
    if (this.sideCredits) this.sideCredits.textContent = engine.build.credits + ' ₡';

    if (this.sideNodes) {
      this.sideNodes.innerHTML = '';
      const hosts = engine.network.discovered();
      if (hosts.length === 0) {
        this.sideNodes.appendChild(el('div', 'side-empty', 'aucun noeud repere'));
      } else {
        hosts.forEach((h) => {
          const st = h.compromised ? 'COMPROMIS' : (h.bypassed ? 'FORCE' : (h.scanned ? 'SCANNE' : 'REPERE'));
          const btn = el('button', 'node-btn' + (h.compromised ? ' owned' : ''));
          btn.appendChild(el('span', 'node-ip', h.ip));
          btn.appendChild(el('span', 'node-name', h.hostname));
          btn.appendChild(el('span', 'node-state', st));
          btn.title = 'inserer ' + h.ip + ' dans la ligne de commande';
          btn.addEventListener('click', () => this._insertToInput(h.ip + ' '));
          this.sideNodes.appendChild(btn);
        });
      }
    }

    if (this.sideBuild) {
      this.sideBuild.innerHTML = '';
      const items = engine.build.items();
      if (items.length === 0) this.sideBuild.appendChild(el('div', 'side-empty', 'rig nu — visite shop'));
      else items.forEach((it) => this.sideBuild.appendChild(el('div', 'aug-line', '+ ' + it.name)));
    }
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
      { t: '[ ok ] noyau blackout 3.4 charge',              c: 'dim' },
      { t: '[ ok ] montage du systeme de fichiers virtuel', c: 'dim' },
      { t: '[ ok ] module crypto initialise',               c: 'dim' },
      { t: '[ ok ] interface eth0 up  ->  10.0.0.66',       c: 'dim' },
      { t: '[ ok ] tunnel chiffre vers la Grille etabli',   c: 'dim' },
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
        this.print("Tape  help  pour les commandes, ou  mail  pour tes ordres.", 'sys');
        this.print("Nouveau : mini-jeux (crack/bypass), boutique (shop), rig (build).", 'sys');
        this.print('', '');
        this.engine.boot();
        this.ready = true;
        this._refreshPrompt();
        this._renderInput();
        this._focusInput();
        this._scrollToBottom();
      }
    };
    step();
  }
}

Object.assign(globalThis.HT || (globalThis.HT = {}), { Terminal });

})();
