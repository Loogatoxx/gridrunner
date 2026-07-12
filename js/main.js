'use strict';
/**
 * main.js  --  Point d'entrée (navigateur).
 * ----------------------------------------------------------------------------
 * Assemble les pièces : UI (Terminal) <-> moteur (GameEngine) <-> commandes.
 * L'ordre de chargement des <script> dans index.html garantit que tout est déjà
 * présent sur `window.HT` quand ce fichier s'exécute.
 * ----------------------------------------------------------------------------
 */
(function () {
  const HT = window.HT;
  const rootEl = document.getElementById('crt');

  // 1) L'UI expose l'interface de sortie `io`.
  const terminal = new HT.Terminal(rootEl);

  // 2) Le moteur est construit avec cette io, puis on branche les commandes.
  const engine = new HT.GameEngine({ io: terminal.io });
  HT.registerCommands(engine.registry);

  // 3) On relie et on démarre (séquence de boot animée, puis 1re mission).
  terminal.bind(engine);
  terminal.boot();

  // Pratique pour l'inspection depuis la console du navigateur.
  window.__gridrunner = { engine, terminal };
})();
