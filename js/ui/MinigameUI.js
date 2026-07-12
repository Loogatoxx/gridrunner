'use strict';
/**
 * MinigameUI.js  (couche UI — navigateur)
 * ----------------------------------------------------------------------------
 * RENDU des mini-jeux de hacking (la LOGIQUE vit dans js/core/Minigame.js).
 * `play(spec, onResult)` affiche un modal en surimpression, gère le chrono, la
 * saisie du joueur, puis appelle `onResult(win)` exactement une fois.
 *
 * Trois types (spec.kind) :
 *   sequence : on flashe une suite de cases, le joueur la reproduit (mémoire).
 *   hexgrid  : cliquer, dans l'ordre, des octets d'une grille (breach 2077-like).
 *   nodes    : cliquer des noeuds numérotés de 1 à N avant la fin du chrono.
 *
 * Robustesse : quoi qu'il arrive, `onResult` est appelé une seule fois (même en
 * cas d'erreur de rendu), pour ne jamais laisser le moteur "bloqué" (busy).
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

class MinigameUI {
  constructor(container, audio) {
    this.container = container;   // #minigame-root
    this.audio = audio;
  }

  /**
   * @param {object} spec  issu de Minigame.generate/generateKind
   * @param {function(boolean):void} onResult
   */
  play(spec, onResult) {
    let finished = false;
    let raf = null;
    let timerRunning = false;
    let start = 0;

    const overlay = el('div', 'mg-overlay');
    const panel = el('div', 'mg-panel');
    const head = el('div', 'mg-head');
    const title = el('span', 'mg-title', `INTRUSION // ${spec.kind.toUpperCase()} // niveau ${spec.level}`);
    const instr = el('span', 'mg-instr', '');
    head.appendChild(title); head.appendChild(instr);
    const timer = el('div', 'mg-timer');
    const fill = el('div', 'mg-timer-fill');
    timer.appendChild(fill);
    const area = el('div', 'mg-area');
    const status = el('div', 'mg-status', '');
    panel.appendChild(head); panel.appendChild(timer); panel.appendChild(area); panel.appendChild(status);
    overlay.appendChild(panel);

    const finish = (win) => {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      status.textContent = win ? '>> ACCES ACCORDE' : '>> ECHEC -- DETECTION';
      status.className = 'mg-status ' + (win ? 'ok' : 'err');
      panel.classList.add(win ? 'mg-win' : 'mg-lose');
      if (this.audio) { win ? this.audio.ok() : this.audio.error(); }
      setTimeout(() => { try { overlay.remove(); } catch (_) {} onResult(win); }, 620);
    };

    // Échap = abandon (= échec, avec sa pénalité).
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', (e) => e.stopPropagation());

    const startTimer = () => {
      timerRunning = true;
      start = performance.now();
      const loop = () => {
        if (finished) return;
        const remain = Math.max(0, spec.timeMs - (performance.now() - start));
        const frac = remain / spec.timeMs;
        fill.style.width = (frac * 100) + '%';
        if (frac <= 0.28) timer.classList.add('mg-crit');
        if (remain <= 0) { finish(false); return; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };

    try {
      if (spec.kind === 'sequence') this._sequence(spec, area, instr, finish, startTimer);
      else if (spec.kind === 'hexgrid') this._hexgrid(spec, area, instr, finish, startTimer);
      else this._nodes(spec, area, instr, finish, startTimer);
    } catch (err) {
      // Un défi qui plante ne doit jamais bloquer le moteur : on rend "perdu".
      finished = true;
      try { overlay.remove(); } catch (_) {}
      onResult(false);
      return;
    }

    this.container.appendChild(overlay);
  }

  // -- SEQUENCE (mémoire type Simon) -----------------------------------------
  _sequence(spec, area, instr, finish, startTimer) {
    instr.textContent = 'MEMORISE la sequence…';
    const grid = el('div', 'mg-cells');
    grid.style.gridTemplateColumns = `repeat(${Math.min(spec.cells, 6)}, 1fr)`;
    const cells = [];
    for (let i = 0; i < spec.cells; i++) {
      const c = el('button', 'mg-cell', String(i + 1));
      c.disabled = true;
      grid.appendChild(c);
      cells.push(c);
    }
    area.appendChild(grid);

    // Phase 1 : on flashe la séquence.
    const flashMs = 380, gapMs = 200;
    spec.steps.forEach((idx, k) => {
      setTimeout(() => {
        const c = cells[idx];
        if (!c) return;
        c.classList.add('mg-flash');
        if (this.audio) this.audio.beep();
        setTimeout(() => c.classList.remove('mg-flash'), flashMs - 60);
      }, k * (flashMs + gapMs) + 400);
    });

    // Phase 2 : saisie du joueur (le chrono démarre ici).
    const totalFlash = spec.steps.length * (flashMs + gapMs) + 500;
    setTimeout(() => {
      instr.textContent = 'REPRODUIS la sequence';
      const answer = [];
      cells.forEach((c, idx) => {
        c.disabled = false;
        c.addEventListener('click', () => {
          c.classList.add('mg-flash');
          setTimeout(() => c.classList.remove('mg-flash'), 160);
          if (this.audio) this.audio.key();
          answer.push(idx);
          const k = answer.length - 1;
          if (answer[k] !== spec.steps[k]) return finish(false);
          if (answer.length === spec.steps.length) return finish(true);
        });
      });
      startTimer();
    }, totalFlash);
  }

  // -- HEXGRID (breach protocol) ---------------------------------------------
  _hexgrid(spec, area, instr, finish, startTimer) {
    instr.textContent = 'Clique les octets cibles dans l\'ordre';
    const targetsRow = el('div', 'mg-targets');
    const chips = spec.targets.map((t, i) => {
      const chip = el('span', 'mg-chip' + (i === 0 ? ' mg-chip-on' : ''), t);
      targetsRow.appendChild(chip);
      return chip;
    });
    area.appendChild(targetsRow);

    const grid = el('div', 'mg-cells mg-hex');
    grid.style.gridTemplateColumns = `repeat(${spec.cols}, 1fr)`;
    const answer = [];
    spec.grid.forEach((byte) => {
      const c = el('button', 'mg-cell', byte);
      c.addEventListener('click', () => {
        if (c.disabled) return;
        const expected = spec.targets[answer.length];
        if (byte !== expected) { if (this.audio) this.audio.error(); return finish(false); }
        c.disabled = true;
        c.classList.add('mg-used');
        if (this.audio) this.audio.key();
        answer.push(byte);
        if (chips[answer.length - 1]) chips[answer.length - 1].classList.remove('mg-chip-on');
        if (chips[answer.length]) chips[answer.length].classList.add('mg-chip-on');
        if (answer.length === spec.targets.length) finish(true);
      });
      grid.appendChild(c);
    });
    area.appendChild(grid);
    startTimer();
  }

  // -- NODES (clique 1..N dans l'ordre) --------------------------------------
  _nodes(spec, area, instr, finish, startTimer) {
    instr.textContent = `Clique les noeuds de 1 a ${spec.count}`;
    const field = el('div', 'mg-field');
    let next = 1;
    spec.nodes.forEach((nd) => {
      const b = el('button', 'mg-node', String(nd.n));
      b.style.left = (nd.x * 100) + '%';
      b.style.top = (nd.y * 100) + '%';
      b.addEventListener('click', () => {
        if (b.disabled) return;
        if (nd.n !== next) { if (this.audio) this.audio.error(); return finish(false); }
        b.disabled = true;
        b.classList.add('mg-done');
        if (this.audio) this.audio.key();
        next++;
        if (next > spec.count) finish(true);
      });
      field.appendChild(b);
    });
    area.appendChild(field);
    startTimer();
  }
}

Object.assign(globalThis.HT || (globalThis.HT = {}), { MinigameUI });

})();
