'use strict';
/**
 * AudioFX.js  (couche UI — navigateur)
 * ----------------------------------------------------------------------------
 * Effets sonores rétro synthétisés à la volée via l'API Web Audio (aucun fichier
 * son à charger). Chaque effet est une petite enveloppe sur un oscillateur.
 *
 * Contrainte navigateur : un AudioContext ne peut démarrer que suite à un geste
 * utilisateur. On le crée donc paresseusement (au premier son, forcément
 * déclenché par une touche/un clic) et on le `resume()` au besoin.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastKey = 0;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (_) { this.ctx = null; } }
    }
    if (this.ctx && this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (_) {} }
    return this.ctx;
  }

  /** @param {boolean} [v] si absent, bascule. @returns {boolean} muted final. */
  setMuted(v) { this.muted = (v === undefined) ? !this.muted : !!v; return this.muted; }

  /** Un bip élémentaire : oscillateur + enveloppe exponentielle. */
  _blip(freq, dur, type, gain) {
    if (this.muted) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.04, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // -- Effets nommés (appelés via io.sfx('nom')) -----------------------------
  key() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._lastKey < 22) return;      // throttle : évite le mitraillage
    this._lastKey = now;
    this._blip(200 + Math.random() * 90, 0.028, 'square', 0.018);
  }
  ok()    { this._blip(620, 0.07, 'square', 0.04); setTimeout(() => this._blip(940, 0.09, 'square', 0.04), 60); }
  error() { this._blip(180, 0.16, 'sawtooth', 0.05); setTimeout(() => this._blip(120, 0.18, 'sawtooth', 0.05), 80); }
  coin()  { this._blip(880, 0.05, 'square', 0.04); setTimeout(() => this._blip(1320, 0.10, 'square', 0.04), 55); }
  beep()  { this._blip(760, 0.05, 'square', 0.03); }
  alarm() {
    // Deux-tons descendants, répétés : sirène courte.
    for (let i = 0; i < 3; i++) {
      setTimeout(() => { this._blip(440, 0.14, 'sawtooth', 0.05); }, i * 260);
      setTimeout(() => { this._blip(300, 0.14, 'sawtooth', 0.05); }, i * 260 + 130);
    }
  }
}

Object.assign(globalThis.HT || (globalThis.HT = {}), { AudioFX });

})();
