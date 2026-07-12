'use strict';
/**
 * tests/run.js
 * ----------------------------------------------------------------------------
 * Suite de tests / auto-vérifications, exécutable sous Node :  node tests/run.js
 *
 * Elle couvre :
 *   1. le Virtual File System (résolution de chemins, cas limites),
 *   2. le Command Parser (guillemets, flags, entrées bancales, FUZZING),
 *   3. la State Machine (transitions valides / interdites),
 *   4. la crypto de jeu (hash déterministe, attaque par dictionnaire),
 *   5. une PARTIE COMPLÈTE jouée de bout en bout (5 missions → victoire),
 *   6. un bombardement d'entrées absurdes : le terminal ne doit JAMAIS planter.
 *
 * Sortie : rapport lisible + code de sortie non nul si un test échoue (CI-ready).
 * ----------------------------------------------------------------------------
 */

const { VfsNode, VirtualFileSystem } = require('../js/core/VirtualFileSystem');
const { CommandParser } = require('../js/core/CommandParser');
const { StateMachine, createTerminalFSM, TERMINAL_STATES } = require('../js/core/StateMachine');
const { Crypto } = require('../js/core/Crypto');
const { buildWorld } = require('../js/core/world');
const { GameEngine } = require('../js/core/GameEngine');
const { registerCommands } = require('../js/core/commands');
const { Minigame } = require('../js/core/Minigame');
const { PlayerBuild, AUGMENTATIONS, AUG_BY_ID } = require('../js/core/PlayerBuild');
const { Market } = require('../js/core/Market');

// RNG déterministe (mulberry32) pour tester génération de défis / boutique.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- Mini framework de test --------------------------------------------------
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (detail ? `  -> ${detail}` : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
}
function noThrow(name, fn) {
  try { fn(); ok(name, true); }
  catch (e) { ok(name, false, 'exception: ' + (e && e.message)); }
}
function section(t) { console.log('\n\x1b[1m### ' + t + '\x1b[0m'); }

// io factice : capture les lignes affichées (aucune sortie réelle).
function makeIO() {
  const lines = [];
  return {
    lines,
    text: () => lines.map((l) => l.text).join('\n'),
    print(text, cls) { lines.push({ text: String(text), cls: cls || '' }); },
    error(text) { lines.push({ text: String(text), cls: 'err', error: true }); },
    clear() { lines.length = 0; },
    status() {},
  };
}
function newGame() {
  const io = makeIO();
  const engine = new GameEngine({ io });
  registerCommands(engine.registry);
  engine.boot();
  return { engine, io };
}

// ============================================================================
section('1. VirtualFileSystem');
{
  const vfs = new VirtualFileSystem({ home: '/home/runner' });
  const F = VirtualFileSystem.file, D = VirtualFileSystem.dir;
  vfs.root.addChild(D('home', {}, [ D('runner', {}, [
    F('a.txt', 'hello'),
    D('sub', {}, [ F('b.txt', 'deep') ]),
    F('.hidden', 'secret', { hidden: true }),
  ]) ]));
  vfs.root.addChild(D('etc', {}, [ F('conf', 'x') ]));

  ok('resolve absolu', vfs.resolve('/home/runner/a.txt') && vfs.resolve('/home/runner/a.txt').content === 'hello');
  ok('resolve ~', vfs.resolve('~/a.txt') !== null);
  ok('resolve relatif depuis cwd', vfs.resolve('a.txt', '/home/runner') !== null);
  ok('resolve .. remonte', vfs.resolve('../a.txt', '/home/runner/sub') !== null);
  ok('resolve .. puis redescend', vfs.resolve('../sub/b.txt', '/home/runner/sub') !== null);
  ok('resolve . = courant', vfs.resolve('.', '/home/runner').name === 'runner');
  eq('resolve inexistant -> null', vfs.resolve('/nope/nope'), null);
  eq('resolve fichier-comme-dossier -> null', vfs.resolve('/home/runner/a.txt/x'), null);
  eq('canonical normalise', vfs.canonical('~/sub/../a.txt', '/'), '/home/runner/a.txt');
  ok('.. au-dela de la racine ne casse pas', vfs.resolve('/../../..') === vfs.root);
  eq('list dossier', vfs.list('/home/runner').length, 3);
  eq('list fichier -> null', vfs.list('/home/runner/a.txt'), null);
  ok('remove supprime', vfs.remove('/etc/conf') && vfs.resolve('/etc/conf') === null);
  ok('remove racine refuse', vfs.remove('/') === false);
  noThrow('resolve(null) ne jette pas', () => vfs.resolve(null, '/'));
  noThrow('resolve(undefined) ne jette pas', () => vfs.resolve(undefined, '/'));
}

// ============================================================================
section('2. CommandParser');
{
  eq('ligne vide -> name vide', CommandParser.parse('').name, '');
  eq('espaces seuls -> name vide', CommandParser.parse('     ').name, '');
  eq('nom en minuscule', CommandParser.parse('LS').name, 'ls');
  const p1 = CommandParser.parse('cat "/etc/my file.txt"');
  eq('guillemets doubles -> 1 arg', p1.args.length, 1);
  eq('guillemets: contenu', p1.args[0], '/etc/my file.txt');
  const p2 = CommandParser.parse("echo 'a b c'");
  eq('guillemets simples', p2.args[0], 'a b c');
  const p3 = CommandParser.parse('ls -la /tmp');
  ok('flags groupes -la', p3.flags.l === true && p3.flags.a === true);
  eq('flags: arg positionnel restant', p3.args[0], '/tmp');
  const p4 = CommandParser.parse('cmd --key=val --flag');
  eq('flag long =valeur', p4.flags.key, 'val');
  eq('flag long booleen', p4.flags.flag, true);
  eq('rawArgs preserve tout', CommandParser.parse('echo hello   world').rawArgs, 'hello   world');
  const p5 = CommandParser.parse('connect   198.51.100.23    guest   guest');
  eq('espaces multiples ignores', p5.args.length, 3);
  const p6 = CommandParser.parse('cat "non ferme');
  ok('guillemet non ferme tolere', p6.args.length === 1 && p6.args[0] === 'non ferme');

  // FUZZING : 2000 lignes aléatoires ne doivent jamais faire jeter le parseur.
  const alphabet = 'abc -"\'\\/|;&<>  \t.$*?~[]{}()=';
  let parserSurvived = true;
  for (let i = 0; i < 2000; i++) {
    let s = '';
    const len = Math.floor(Math.random() * 40);
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    try { CommandParser.parse(s); } catch (_) { parserSurvived = false; break; }
  }
  ok('FUZZ parseur : 2000 entrees absurdes sans crash', parserSurvived);
}

// ============================================================================
section('3. StateMachine');
{
  const fsm = new StateMachine({
    initial: 'A', transitions: { A: ['B'], B: ['A', 'C'], C: [] },
  });
  ok('transition valide', fsm.transition('B') === 'B' && fsm.is('B'));
  ok('can() correct', fsm.can('C') === true && fsm.can('A') === true);
  let threw = false;
  try { fsm.transition('A'); fsm.transition('C'); } catch (_) { threw = true; }
  ok('transition interdite -> exception', threw);

  const tfsm = createTerminalFSM();
  ok('FSM terminal demarre en BOOT', tfsm.is(TERMINAL_STATES.BOOT));
  ok('BOOT -> LOCAL autorise', tfsm.can(TERMINAL_STATES.LOCAL));
}

// ============================================================================
section('4. Crypto (de jeu)');
{
  eq('hash deterministe', Crypto.hash('dragon'), Crypto.hash('dragon'));
  eq('hash longueur 32', Crypto.hash('whatever').length, 32);
  ok('hash hexadecimal', /^[0-9a-f]{32}$/.test(Crypto.hash('x')));
  ok('hash sensible a l\'entree', Crypto.hash('a') !== Crypto.hash('b'));
  const wl = ['foo', 'dragon', 'bar'];
  eq('crack trouve le mot', Crypto.crackWithWordlist(Crypto.hash('dragon'), wl), 'dragon');
  eq('crack echoue proprement', Crypto.crackWithWordlist(Crypto.hash('absent'), wl), null);
  eq('xor reversible', Crypto.xorCipher(Crypto.xorCipher('message secret', 'k3y'), 'k3y'), 'message secret');
}

// ============================================================================
section('5. Partie complete (5 missions -> victoire)');
{
  const { engine } = newGame();
  const play = (line) => engine.runLine(line);
  const H = Crypto.hash; // pour fabriquer les empreintes attendues

  eq('demarrage: mission 0', engine.missionIndex, 0);

  // --- M0 : ORIENTATION ---
  play('cat ~/readme.txt');
  play('cd ~/intel');
  play('cat target.txt');
  eq('M0 terminee -> mission 1', engine.missionIndex, 1);

  // --- M1 : RECON ---
  play('scan 198.51.100.23');
  play('connect 198.51.100.23 guest guest');
  ok('connecte a gate en tant que guest', engine.isRemote() && engine.session.user === 'guest');
  play('cat /home/guest/notes.txt');
  eq('M1 terminee -> mission 2', engine.missionIndex, 2);

  // --- M2 : ESCALADE ---
  play('cat /etc/shadow');
  play('crack ' + H('dragon'));
  play('su root dragon');
  ok('privileges root obtenus', engine.isRoot());
  play('decrypt /root/vault.enc AEGIS-CORE-9');
  eq('M2 terminee -> mission 3', engine.missionIndex, 3);
  ok('tracage arme a partir de M3', engine.trace.armed === true);

  // --- M3 : NETTOYAGE ---
  play('download /root/vault.enc');
  play('cat /var/log/auth.log');
  play('shred /var/log/auth.log');
  eq('trace remise a zero apres shred', engine.trace.level, 0);
  play('disconnect');
  eq('M3 terminee -> mission 4', engine.missionIndex, 4);
  ok('revenu sur la machine locale', !engine.isRemote());

  // --- M4 : PIVOT / ORACLE (finale) ---
  play('connect 198.51.100.23 root dragon');
  play('scan 10.10.10.9');
  play('crack ' + H('ncc1701'));
  play('connect 10.10.10.9 sysop ncc1701');
  ok('pivot sur le mainframe', engine.location() === '10.10.10.9');
  play('decrypt /data/blackfile.enc ORACLE');
  play('download /data/blackfile.enc');
  play('shred /var/log/auth.log');
  play('disconnect'); // mainframe -> gate
  play('disconnect'); // gate -> deck
  ok('CAMPAGNE TERMINEE (finished)', engine.finished === true);
  ok('FSM en VICTORY', engine.fsm.is(TERMINAL_STATES.VICTORY));
  ok('blackfile exfiltre dans ~/loot', engine.localHost.vfs.resolve('/home/runner/loot/blackfile.enc') !== null);
}

// ============================================================================
section('6. Robustesse : le terminal ne plante jamais');
{
  const { engine } = newGame();
  const garbage = [
    '', '   ', 'ls', 'cat', 'cd', 'cat /nope', 'cd /nope', 'connect', 'scan',
    'connect 1.2.3.4', 'scan 9.9.9.9', 'su', 'sudo', 'decrypt', 'download',
    'shred', 'rm', 'crack', 'crack zzz', 'crack ' + 'f'.repeat(32),
    'ls -la -x --y=1 /', 'cat "', "echo 'unterminated", 'cd ../../../../..',
    'connect root@10.10.10.9 x', 'disconnect', 'disconnect', 'disconnect',
    'trace', 'trace off', 'trace on', 'mail', 'mail 99', 'mission',
    'help', 'help nope', 'man', 'man ls', 'whoami', 'pwd', 'history',
    'DROP TABLE users;', '../../etc/passwd', 'ls; rm -rf /', 'ééà€ñ😀',
    'connect;;;;', 'cat cat cat cat', String.fromCharCode(0, 1, 2, 3),
  ];
  let survived = true, err = null;
  for (const line of garbage) {
    try { engine.runLine(line); }
    catch (e) { survived = false; err = `'${line}' -> ${e.message}`; break; }
  }
  ok('40+ entrees hostiles enchainees sans crash', survived, err);

  // Fuzz brut sur le moteur complet.
  const chars = 'abcls catdconnect scan 0123456789. /-"\'~;|&';
  let engineSurvived = true;
  for (let i = 0; i < 1500; i++) {
    let s = '';
    const len = Math.floor(Math.random() * 30);
    for (let j = 0; j < len; j++) s += chars[Math.floor(Math.random() * chars.length)];
    try { engine.runLine(s); } catch (e) { engineSurvived = false; err = s + ' -> ' + e.message; break; }
  }
  ok('FUZZ moteur : 1500 lignes aleatoires sans crash', engineSurvived, err);
}

// ============================================================================
section('7. Mécanique de traçage (se faire griller)');
{
  const { engine } = newGame();
  engine.trace.armed = true;
  const r = engine.connect('198.51.100.23', 'guest', 'guest');
  ok('connexion ok, session distante', r.ok && engine.isRemote());
  let threw = null, ticks = 0;
  try { for (let i = 0; i < 40 && engine.isRemote(); i++) { engine.runLine('ls'); ticks++; } }
  catch (e) { threw = e.message; }
  ok('traçage abouti sans crash', threw === null, threw);
  ok('deconnexion forcee vers la machine locale', !engine.isRemote());
  eq('FSM revenue en LOCAL', engine.fsm.state, TERMINAL_STATES.LOCAL);
  eq('trace remise a zero apres coupure', engine.trace.level, 0);
  ok('grille apres un nombre borne d\'actions', ticks > 0 && ticks <= 10, 'ticks=' + ticks);

  // Toggle OFF : plus aucune montee de trace, meme connecte.
  const g2 = newGame();
  g2.engine.trace.armed = true;
  g2.engine.runLine('trace off');
  g2.engine.connect('198.51.100.23', 'guest', 'guest');
  for (let i = 0; i < 30; i++) g2.engine.runLine('ls');
  ok('trace OFF : jamais grille', g2.engine.isRemote() && g2.engine.trace.level === 0);
}

// ============================================================================
section('8. Mini-jeux (logique)');
{
  // Déterminisme : même graine -> même défi.
  const a = Minigame.generateKind('hexgrid', 2, mulberry32(42));
  const b = Minigame.generateKind('hexgrid', 2, mulberry32(42));
  ok('generation deterministe (meme graine)', JSON.stringify(a.targets) === JSON.stringify(b.targets));
  ok('hexgrid: bonne reponse validee', Minigame.evaluate(a, a.targets.slice()));
  ok('hexgrid: mauvaise reponse rejetee', !Minigame.evaluate(a, ['ZZ', 'YY']));

  const seq = Minigame.generateKind('sequence', 3, mulberry32(1));
  ok('sequence: reproduction correcte validee', Minigame.evaluate(seq, seq.steps.slice()));
  ok('sequence: reproduction fausse rejetee', !Minigame.evaluate(seq, seq.steps.slice().reverse().concat(9)));

  const nodes = Minigame.generateKind('nodes', 2, mulberry32(2));
  ok('nodes: ordre correct (1..n) valide', Minigame.evaluate(nodes, nodes.nodes.map((n) => n.n)));
  ok('nodes: mauvais ordre rejete', !Minigame.evaluate(nodes, nodes.nodes.map((n) => n.n).reverse()));

  const gen = Minigame.generate(2, mulberry32(5));
  ok('generate() renvoie un type connu', Minigame.KINDS.includes(gen.kind));
  ok('generate() fixe un chrono', typeof gen.timeMs === 'number' && gen.timeMs > 0);
  noThrow('evaluate tolere une entree nulle', () => Minigame.evaluate(gen, null));
}

// ============================================================================
section('9. PlayerBuild / StatsModifier');
{
  const b = new PlayerBuild();
  b.addCredits(300);
  const gm = AUG_BY_ID['ghostmask'];
  ok('canAfford correct', b.canAfford(gm));
  ok('buy debite et possede', b.buy(gm) && b.credits === 300 - gm.price && b.has('ghostmask'));
  ok('buy refuse un doublon', b.buy(gm) === false);
  eq('traceRateMultiplier (Ghost-Mask -30%)', b.traceRateMultiplier(), 0.70);
  b.own('overclock');
  eq('minigameTimeMultiplier (Overclock +20%)', Number(b.minigameTimeMultiplier().toFixed(2)), 1.20);
  b.own('rootkit');
  eq('autoBypassLevel prend le max', b.autoBypassLevel(), 2);
  b.own('cryptominer');
  eq('creditsPerCommand', b.creditsPerCommand(), 1);
  b.own('coldwallet');
  eq('sellMultiplier (Cold-Wallet +50%)', b.sellMultiplier(), 1.5);

  const poor = new PlayerBuild();
  ok('buy refuse si credits insuffisants', poor.buy(AUG_BY_ID['rootkit']) === false);

  // Sérialisation méta.
  const j = b.toJSON();
  const b2 = PlayerBuild.fromJSON(j);
  ok('serialisation conserve credits + augments', b2.credits === b.credits && b2.has('ghostmask') && b2.has('rootkit'));
}

// ============================================================================
section('10. Darknet Market');
{
  const b = new PlayerBuild(); b.addCredits(1000);
  const m = new Market();
  const offers = m.roll(b, 3, mulberry32(7));
  eq('roll propose 3 offres', offers.length, 3);
  ok('offres distinctes', new Set(offers.map((o) => o.id)).size === 3);

  b.own(offers[0].id);
  const offers2 = m.roll(b, 3, mulberry32(7));
  ok('roll exclut ce qui est deja possede', offers2.every((o) => o.id !== offers[0].id));

  const before = b.credits;
  const target = m.offers[0];
  const res = m.buy(b, 0);
  ok('buy reussit et debite', res.ok && b.credits === before - target.price && b.has(target.id));
  eq('offre retiree de l etal apres achat', m.offers.length, 2);
}

// ============================================================================
section('11. Economie in-game');
{
  const { engine } = newGame();
  const play = (l) => engine.runLine(l);
  eq('credits de depart', engine.build.credits, 0);

  play('scan 198.51.100.23');
  play('connect 198.51.100.23 guest guest');
  eq('prime de premiere intrusion (gate bounty 20)', engine.build.credits, 20);

  play('download /home/guest/notes.txt');
  const c0 = engine.build.credits;
  play('sell notes.txt');
  ok('la revente rapporte des credits', engine.build.credits > c0);

  // Crypto-Miner : +1 credit par commande.
  engine.build.own('cryptominer');
  const c1 = engine.build.credits;
  play('pwd');
  eq('crypto-miner : +1 credit par commande', engine.build.credits, c1 + 1);
}

// ============================================================================
section('12. Game Over rogue-like (meta-progression)');
{
  const { engine } = newGame();
  engine.build.addCredits(100);
  engine.build.own('ghostmask');            // -30% de tracage
  engine.trace.armed = true;
  engine.connect('198.51.100.23', 'guest', 'guest'); // +20 credits, session distante
  const creditsBefore = engine.build.credits;

  let caught = false;
  for (let i = 0; i < 60 && !caught; i++) {
    engine.runLine('ls');
    if (!engine.isRemote()) caught = true;   // le Game Over ramene en local
  }
  ok('Game Over declenche (trace 100%)', caught);
  ok('credits CONSERVES apres Game Over', engine.build.credits >= creditsBefore);
  ok('augmentation CONSERVEE apres Game Over', engine.build.has('ghostmask'));
  eq('detection comptabilisee (meta)', engine.meta.detections, 1);
  eq('mission courante conservee', engine.missionIndex, 0);
  ok('reseau reinitialise (hote non compromis)', engine.network.get('198.51.100.23').compromised === false);
  eq('trace remise a zero apres reset', engine.trace.level, 0);

  // Ghost-Mask ralentit vraiment : plus de coups pour tomber qu'un build nu.
  const g2 = newGame(); g2.engine.trace.armed = true;
  g2.engine.connect('198.51.100.23', 'guest', 'guest');
  let ticksNu = 0; while (g2.engine.isRemote() && ticksNu < 60) { g2.engine.runLine('ls'); ticksNu++; }
  const g3 = newGame(); g3.engine.build.own('ghostmask'); g3.engine.trace.armed = true;
  g3.engine.connect('198.51.100.23', 'guest', 'guest');
  let ticksMask = 0; while (g3.engine.isRemote() && ticksMask < 60) { g3.engine.runLine('ls'); ticksMask++; }
  ok('Ghost-Mask retarde la detection', ticksMask > ticksNu, `nu=${ticksNu}, masque=${ticksMask}`);
}

// ============================================================================
console.log('\n' + '='.repeat(60));
if (failed === 0) {
  console.log(`\x1b[32mTOUS LES TESTS PASSENT\x1b[0m  (${passed} assertions)`);
  process.exit(0);
} else {
  console.log(`\x1b[31m${failed} ECHEC(S)\x1b[0m sur ${passed + failed} assertions :`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
