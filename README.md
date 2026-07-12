# GRIDRUNNER

Un mini-jeu web **« hacker terminal »** dans l'esprit de *Hacknet* / *Uplink*.
Tu incarnes un runner recruté par une entité anonyme, **NULL**, pour infiltrer le
réseau de la méga-corpo **Aegis Dynamics**, remonter jusqu'à son mainframe interne
et en exfiltrer la preuve d'un programme de surveillance de masse — sans laisser
la moindre trace.

HTML / CSS / **JavaScript pur**, zéro dépendance, zéro build. Direction artistique
brutaliste : blanc froid sur noir profond, monospace, scanlines discrètes.

---

## Jouer

Deux façons :

```bash
# 1) Le plus simple : ouvrir le fichier directement
open index.html            # (macOS)  — double-cliquer marche aussi

# 2) Ou via un petit serveur local (recommandé, évite tout souci de cache)
python3 -m http.server 4173
# puis http://localhost:4173
```

Aucune installation, aucun paquet. Le jeu est 100 % hors-ligne.

Au démarrage, tape **`help`** pour la liste des commandes et **`mail`** pour lire
tes premiers ordres. La progression est sauvegardée automatiquement
(`localStorage`) ; `reset` repart de zéro.

---

## Progression pédagogique

La campagne enseigne les mécaniques d'intrusion par paliers :

| Mission | Nom | Ce que tu apprends |
|--------:|-----|--------------------|
| 1 | **ORIENTATION** | Se repérer : `ls`, `cat`, `cd`, `pwd` |
| 2 | **RECON** | Cartographier : `scan` (ports), `connect` (shell distant) |
| 3 | **ESCALADE** | `crack` (attaque de hash par dictionnaire), `su` (élévation), `decrypt` |
| 4 | **NETTOYAGE** | Anti-forensique : lire puis `shred` les journaux, gérer le **traçage** |
| 5 | **ORACLE** | Tout combiner : **pivoting** réseau, exfiltration, effacement complet |

**Le traçage** (optionnel) : à partir de la mission 4, chaque action sur un hôte
distant remplit une jauge de trace. Si elle sature, le SOC te localise et coupe
tout. Efface les logs (`shred`) pour la remettre à zéro… ou désactive la pression
avec `trace off`.

---

## Architecture du code

Le projet est découpé pour être **lisible et étudiable**. Chaque module coeur est
encapsulé dans une IIFE (scope privé) et s'expose sur `window.HT` (navigateur) ou
`module.exports` (Node) — le *même* fichier sert au jeu et aux tests.

```
index.html                 assemblage + ordre de chargement des scripts
css/terminal.css           direction artistique (brutaliste, scanlines CRT)
js/
  core/
    VirtualFileSystem.js   FS virtuel OO : arbre de VfsNode, résolution de chemins
    CommandParser.js        tokenizer robuste (guillemets, flags) -> commande structurée
    StateMachine.js         FSM générique + états du terminal (BOOT/LOCAL/CONNECTED/…)
    Crypto.js               hash de jeu (dictionnaire) + XOR — pédagogique, PAS sûr
    Network.js              Host / Port / Network : cibles, auth, logs, pivoting
    world.js                LE CONTENU : machine locale, réseau Aegis, 5 missions
    CommandRegistry.js      registre des commandes + exécution protégée (try/catch)
    GameEngine.js           l'orchestrateur : sessions, trace, missions, sauvegarde
    commands.js             toutes les commandes (help, ls, scan, crack, shred, …)
  ui/
    Terminal.js             couche DOM : affichage, saisie, historique, autocomplétion
  main.js                   point d'entrée : câble UI <-> moteur <-> commandes
tests/
  run.js                    suite d'auto-tests (node tests/run.js)
```

### Les trois pièces demandées

- **Virtual File System orienté objet** (`VirtualFileSystem.js`) — un arbre de
  `VfsNode` (fichier *ou* dossier). Toute la logique de chemins (absolu, relatif,
  `.`, `..`, `~`) est centralisée dans `resolve()` : un seul endroit à raisonner,
  un seul endroit qui échoue proprement (`null`) plutôt que de planter.

- **State Machine** (`StateMachine.js`) — une FSM générique réutilisable. L'état du
  terminal ne change que par des transitions **déclarées** ; une transition
  interdite lève immédiatement (fail-fast) au lieu de produire un état incohérent.

- **Command Parser robuste** (`CommandParser.js`) — un tokenizer qui gère les
  guillemets simples/doubles, l'échappement, les flags courts groupés (`-la`) et
  longs (`--key=val`). Il **ne lève jamais** : entrée vide, guillemet non fermé,
  octets aléatoires — tout est toléré.

### Le principe directeur

Les **commandes ne mutent jamais l'état directement** : elles valident leurs
arguments, appellent une méthode du **moteur** (`engine.connect`, `engine.escalate`,
`engine.download`…), puis affichent. Le moteur est le seul à toucher la pile de
sessions, la FSM et la trace. Résultat : logique testable sans DOM, et un
`CommandRegistry.execute()` qui enveloppe chaque commande dans un `try/catch` — un
bug de commande n'abat jamais la boucle de jeu.

---

## Commandes

`help` liste tout en jeu ; `help <cmd>` ou `man <cmd>` détaille une commande.

- **Base** : `help` `man` `ls` `cat` `cd` `pwd` `whoami` `echo` `clear` `history`
- **Réseau** : `ifconfig` `net` `scan` `connect` (`ssh`) `disconnect`
- **Intrusion / crypto** : `crack` `su` (`sudo`) `decrypt` `download`
- **Anti-forensique** : `shred` (`clean`) `rm` `trace`
- **Méta** : `mail` `mission` `reset`

Confort : **TAB** autocomplète (commandes puis chemins), **↑/↓** parcourt
l'historique, **Ctrl+L** efface l'écran.

---

## Tests

Toute la logique (hors DOM) tourne aussi sous Node, ce qui permet une suite
d'auto-tests exhaustive : VFS, parser (+ *fuzzing*), FSM, crypto, **une partie
complète jouée de bout en bout jusqu'à la victoire**, la mécanique de traçage, et
un bombardement d'entrées absurdes pour garantir que **le terminal ne plante
jamais**.

```bash
node tests/run.js
```

---

## Notes de conception

- **Adresses IP** : uniquement des plages de *documentation* (RFC 5737 / RFC 1918).
  Rien de réel, rien d'exploitable — c'est une fiction.
- **La « crypto »** est volontairement jouet (hash par dictionnaire, XOR) : elle
  illustre les concepts (attaque par dictionnaire, déchiffrement par clé) sans
  prétendre à la moindre sécurité. Dans la vraie vie : SHA-256 via WebCrypto.
- **Aucune esthétique superflue** : pas de dégradé, pas d'emoji, pas de fioriture.
  Deux teintes fonctionnelles seulement (ambre = alerte, rouge éteint = erreur),
  parce qu'un vrai terminal en a besoin pour rester lisible.
