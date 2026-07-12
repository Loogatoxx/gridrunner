# Historique des prompts — Projet "Hacker Terminal"

Journal de bord automatique du projet. Une entrée par requête utilisateur :
prompt, résumé de la réponse, modifications concrètes, objectif.

---

## Entrée 001 — 2026-07-12 — Cadrage & plan d'attaque

**Prompt (résumé) :**
Créer un mini-jeu web interactif type "Hacker Terminal" (à la Hacknet / Uplink).
Exigences : progression pédagogique de difficulté (commandes de base `ls`/`cat`, puis
scan de ports, décryptage de hash, manipulation de logs pour effacer ses traces) ;
architecture JS propre et étudiable (State Machine, Virtual File System orienté objet,
Command Parser robuste, code commenté) ; direction artistique brutaliste/minimaliste
(monochrome vert néon / ambre / blanc sur fond noir, monospace, scanlines légères ;
ANTI-esthétique IA : pas de dégradés violets, pas de bordures dorées, pas d'emojis) ;
auto-tests intensifs (edge-cases, parseur qui ne crash jamais) ; créer un repo GitHub
PRIVÉ avec un nom stylé et pousser tout le code. Commencer par un plan + questions de
conception.

**Réponse (résumé) :**
Chargement du workflow projet (skill structure-projet-base). GitHub acté = nouveau repo
privé. Création de ce journal. Présentation du plan d'attaque (architecture OO, moteur
de jeu, DA, protocole de test, livraison Git) et de 4 questions de conception
(couleur DA, format du jeu, univers/ton, mécanique de traçage).

**Modifications :**
- Création de `historique_prompts.md` (ce fichier).

**Objectif :**
Cadrer le projet, tracer les décisions dès le départ, et valider les choix de design
structurants avant de lancer la génération complète.

---

## Entrée 002 — 2026-07-12 — Génération complète + tests + livraison GitHub

**Prompt (résumé) :**
(Réponses aux questions de conception) DA = blanc froid sur noir ; format =
campagne narrative ; univers = cyberpunk underground ; traçage = optionnel
(toggle, activé par défaut). Consigne : générer le projet complet et fonctionnel,
auto-tester intensivement, puis créer un repo GitHub privé et tout pousser.

**Réponse (résumé) :**
Génération intégrale du jeu "GRIDRUNNER". Architecture JS modulaire (chaque module
en IIFE, exposé sur window.HT / module.exports). Écriture de la suite de tests Node
(65 assertions : VFS, parser + fuzzing, FSM, crypto, campagne complète jouée
jusqu'à la victoire, mécanique de traçage, robustesse anti-crash) — tous verts.
Vérification dans un vrai navigateur (preview) : boot, rendu, partie complète en
5 missions jusqu'à VICTORY, traçage/déconnexion forcée, zéro erreur console.
Correction d'un bug de scope (collision de `const`/`class` au scope global des
<script>) en encapsulant chaque module dans une IIFE. Puis init Git + repo privé.

**Modifications :**
- `index.html`, `css/terminal.css` (DA brutaliste + scanlines).
- `js/core/` : VirtualFileSystem, CommandParser, StateMachine, Crypto, Network,
  world (contenu + 5 missions), CommandRegistry, GameEngine, commands.
- `js/ui/Terminal.js` (affichage, saisie, historique, autocomplétion) + `js/main.js`.
- `tests/run.js` (suite d'auto-tests) ; `README.md` ; `.gitignore` ; `.claude/launch.json`.

**Objectif :**
Livrer un jeu complet, robuste et pédagogique, avec une architecture propre à
étudier (State Machine, VFS orienté objet, Command Parser blindé), et le rendre
récupérable directement via un dépôt GitHub privé.
