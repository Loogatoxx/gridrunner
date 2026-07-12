'use strict';
/**
 * commands.js
 * ----------------------------------------------------------------------------
 * TOUTES les commandes du terminal. Chaque commande est un objet homogène :
 *
 *   { name, usage, summary, category, aliases?, noTrace?, run(ctx) }
 *
 *   - `usage`/`summary`/`category` alimentent automatiquement `help`.
 *   - `noTrace: true` marque une commande "inoffensive" (méta / hors-ligne) qui
 *     ne fait PAS monter le compteur de traçage.
 *   - `run(ctx)` reçoit { engine, io, args, flags, rawArgs, raw }.
 *
 * Les commandes ne touchent JAMAIS l'état du jeu directement : elles passent par
 * les méthodes du moteur (engine.connect, engine.escalate, engine.download...).
 * Elles se contentent de : valider les arguments, appeler le moteur, afficher.
 * C'est ce qui les rend courtes, lisibles et impossibles à faire planter.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

function registerCommands(registry) {

  // -- Détail d'aide d'une commande (partagé par `help <cmd>` et `man`). ------
  function showManual(io, cmd) {
    io.print(`  ${cmd.name}${cmd.aliases && cmd.aliases.length ? '  (alias: ' + cmd.aliases.join(', ') + ')' : ''}`, 'bright');
    io.print(`    ${cmd.summary || ''}`, '');
    if (cmd.usage) io.print(`    usage: ${cmd.usage}`, 'dim');
  }

  // ==========================================================================
  // CATÉGORIE : BASE
  // ==========================================================================
  registry.register({
    name: 'help', aliases: ['?'], category: 'base', noTrace: true,
    usage: 'help [commande]',
    summary: 'Liste les commandes, ou détaille une commande précise.',
    run(ctx) {
      const { io, engine, args } = ctx;
      if (args[0]) {
        const cmd = engine.registry.get(args[0]);
        if (!cmd) return io.error(`help: commande inconnue '${args[0]}'`);
        return showManual(io, cmd);
      }
      // Vue d'ensemble, groupée par catégorie.
      const order = ['base', 'reseau', 'crypto', 'anti-forensic', 'meta'];
      const labels = {
        base: 'BASE', reseau: 'RESEAU', crypto: 'INTRUSION / CRYPTO',
        'anti-forensic': 'ANTI-FORENSIQUE', meta: 'META',
      };
      const byCat = {};
      engine.registry.all().forEach((c) => {
        (byCat[c.category] = byCat[c.category] || []).push(c);
      });
      io.print('COMMANDES DISPONIBLES', 'bright');
      order.forEach((cat) => {
        if (!byCat[cat]) return;
        io.print('', '');
        io.print(`  [${labels[cat] || cat}]`, 'dim');
        byCat[cat].forEach((c) => {
          io.print(`    ${c.name.padEnd(12)} ${c.summary || ''}`, '');
        });
      });
      io.print('', '');
      io.print("  Astuce : 'help <commande>' pour le detail. TAB pour completer.", 'sys');
    },
  });

  registry.register({
    name: 'man', category: 'base', noTrace: true,
    usage: 'man <commande>',
    summary: 'Affiche le manuel d\'une commande.',
    run(ctx) {
      const { io, engine, args } = ctx;
      if (!args[0]) return io.error('man: quelle commande ? Usage: man <commande>');
      const cmd = engine.registry.get(args[0]);
      if (!cmd) return io.error(`man: aucune entree pour '${args[0]}'`);
      showManual(io, cmd);
    },
  });

  registry.register({
    name: 'ls', aliases: ['dir', 'll'], category: 'base',
    usage: 'ls [-l] [-a] [chemin]',
    summary: 'Liste le contenu d\'un dossier.',
    run(ctx) {
      const { io, engine, args, flags } = ctx;
      const target = args[0] || '.';
      const node = engine.resolve(target);
      if (!node) return io.error(`ls: ${target}: fichier ou dossier introuvable`);

      // ls sur un fichier : affiche juste son nom (comportement UNIX).
      if (node.isFile()) return io.print(node.name, '');

      let entries = [...node.children.values()];
      if (!flags.a) entries = entries.filter((n) => !n.hidden);
      entries.sort((a, b) => a.name.localeCompare(b.name));

      if (entries.length === 0) return; // dossier vide → rien

      if (flags.l) {
        // Format long : type+perms  owner  taille  date  nom
        entries.forEach((n) => {
          const type = n.isDir() ? 'd' : '-';
          const lock = n.locked ? ' *' : '  ';
          const line = `${type}${n.perms}${lock} ${String(n.owner).padEnd(6)} ${String(n.size()).padStart(5)} ${n.mtime} ${n.name}${n.isDir() ? '/' : ''}`;
          io.print(line, n.isDir() ? 'bright' : '');
        });
      } else {
        // Format court : noms sur une ligne, dossiers suffixés de '/'.
        const names = entries.map((n) => n.name + (n.isDir() ? '/' : ''));
        io.print(names.join('   '), '');
      }
    },
  });

  registry.register({
    name: 'cat', aliases: ['read', 'less', 'more'], category: 'base',
    usage: 'cat <fichier> [fichier2 ...]',
    summary: 'Affiche le contenu d\'un ou plusieurs fichiers.',
    run(ctx) {
      const { io, engine, args } = ctx;
      if (args.length === 0) return io.error('cat: quel fichier ? Usage: cat <fichier>');
      for (const path of args) {
        const node = engine.resolve(path);
        if (!node) { io.error(`cat: ${path}: fichier introuvable`); continue; }
        if (node.isDir()) { io.error(`cat: ${path}: est un dossier`); continue; }
        if (node.locked && !engine.isRoot()) {
          io.error(`cat: ${path}: permission refusee (privileges root requis)`); continue;
        }
        if (node.encrypted) {
          io.print('[[ FICHIER CHIFFRE ]]', 'warn');
          // Aperçu volontairement illisible pour matérialiser le chiffrement.
          const garble = node.content.replace(/[^\s]/g, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]);
          io.print(garble.split('\n').slice(0, 4).join('\n'), 'dim');
          io.print(`utilise: decrypt ${path} <cle>`, 'sys');
          continue;
        }
        io.print(node.content.replace(/\n$/, ''), '');
        // Évènement de lecture (les missions écoutent 'read').
        engine.emit({ type: 'read', ip: engine.location(), path: engine.canonical(path) });
      }
    },
  });

  registry.register({
    name: 'cd', category: 'base',
    usage: 'cd [chemin]',
    summary: 'Change de répertoire courant.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const target = args[0] || '~';
      const node = engine.resolve(target);
      if (!node) return io.error(`cd: ${target}: dossier introuvable`);
      if (!node.isDir()) return io.error(`cd: ${target}: n'est pas un dossier`);
      engine.cwd = engine.canonical(target);
    },
  });

  registry.register({
    name: 'pwd', category: 'base', noTrace: true,
    summary: 'Affiche le chemin du répertoire courant.',
    run(ctx) { ctx.io.print(ctx.engine.cwd, ''); },
  });

  registry.register({
    name: 'clear', aliases: ['cls'], category: 'base', noTrace: true,
    summary: 'Efface l\'écran.',
    run(ctx) { ctx.io.clear(); },
  });

  registry.register({
    name: 'whoami', category: 'base', noTrace: true,
    summary: 'Affiche l\'utilisateur courant.',
    run(ctx) {
      const s = ctx.engine.session;
      ctx.io.print(`${s.user}${s.isRoot ? ' (root)' : ''} @ ${s.host.hostname}`, '');
    },
  });

  registry.register({
    name: 'echo', category: 'base', noTrace: true,
    usage: 'echo <texte>',
    summary: 'Affiche du texte.',
    run(ctx) { ctx.io.print(ctx.rawArgs, ''); },
  });

  registry.register({
    name: 'history', category: 'base', noTrace: true,
    summary: 'Affiche l\'historique des commandes tapées.',
    run(ctx) {
      const h = ctx.engine.commandHistory;
      if (h.length === 0) return ctx.io.print('(historique vide)', 'dim');
      h.forEach((line, i) => ctx.io.print(`${String(i + 1).padStart(4)}  ${line}`, 'dim'));
    },
  });

  // ==========================================================================
  // CATÉGORIE : RESEAU
  // ==========================================================================
  registry.register({
    name: 'ifconfig', aliases: ['ip'], category: 'reseau', noTrace: true,
    summary: 'Affiche l\'interface réseau de l\'hôte courant.',
    run(ctx) {
      const h = ctx.engine.session.host;
      const ip = h.ip === 'localhost' ? '10.0.0.66' : h.ip;
      ctx.io.print(`eth0   inet ${ip}   host ${h.hostname}`, '');
    },
  });

  registry.register({
    name: 'net', aliases: ['map', 'hosts'], category: 'reseau', noTrace: true,
    summary: 'Liste les hôtes découverts sur le réseau.',
    run(ctx) {
      const { io, engine } = ctx;
      const hosts = engine.network.discovered();
      if (hosts.length === 0) {
        return io.print("aucun hote connu. Scanne une cible (scan <ip>) ou lis tes intel.", 'dim');
      }
      io.print('HOTES CONNUS', 'bright');
      hosts.forEach((h) => {
        const state = h.compromised ? 'COMPROMIS' : (h.scanned ? 'scanne' : 'repere');
        io.print(`  ${h.ip.padEnd(15)} ${h.hostname.padEnd(20)} [${state}]`, '');
      });
    },
  });

  registry.register({
    name: 'scan', aliases: ['nmap'], category: 'reseau',
    usage: 'scan <ip>',
    summary: 'Scanne les ports ouverts d\'un hôte.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const ip = args[0];
      if (!ip) return io.error('scan: quelle cible ? Usage: scan <ip>');
      const host = engine.network.get(ip);
      if (!host || !host.isReachableFrom(engine.location())) {
        return io.error(`scan: aucune reponse de ${ip} (hote injoignable d'ici)`);
      }
      host.discovered = true;
      host.scanned = true;
      io.print(`scan de ${host.hostname} (${ip}) ...`, 'dim');
      io.print('PORT     ETAT       SERVICE', 'bright');
      host.ports.forEach((p) => {
        io.print(`  ${String(p.number).padEnd(6)} ${p.state.padEnd(10)} ${p.service}${p.banner ? '  -- ' + p.banner : ''}`, '');
      });
      const open = host.openPorts().length;
      io.print(`${host.ports.length} ports, ${open} ouvert(s).`, 'dim');
      engine.emit({ type: 'scan', ip });
    },
  });

  registry.register({
    name: 'connect', aliases: ['ssh'], category: 'reseau',
    usage: 'connect <ip> [user] [pass]   |   ssh user@ip [pass]',
    summary: 'Ouvre un shell sur un hôte distant.',
    run(ctx) {
      const { io, engine, args } = ctx;
      let ip = args[0], user = args[1], pass = args[2];
      // Forme ssh : user@ip [pass]
      if (ip && ip.includes('@')) {
        const [u, h] = ip.split('@');
        user = u; ip = h; pass = args[1];
      }
      if (!ip) return io.error('connect: quelle cible ? Usage: connect <ip> [user] [pass]');
      const res = engine.connect(ip, user, pass);
      if (!res.ok) return io.error(`connect: ${res.msg}`);
      io.print(`[+] connexion etablie -> ${res.host.hostname} (${res.host.ip})`, 'ok');
      const motd = res.host.vfs.resolve('/etc/motd', '/');
      if (motd && motd.isFile()) io.print(motd.content.replace(/\n$/, ''), 'dim');
      io.print(`session ${engine.session.user}${engine.session.isRoot ? ' (root)' : ''}. Tape 'ls' pour explorer, 'disconnect' pour sortir.`, 'sys');
    },
  });

  registry.register({
    name: 'disconnect', aliases: ['logout', 'exit', 'dc'], category: 'reseau', noTrace: true,
    summary: 'Ferme la session distante courante (revient à l\'hôte précédent).',
    run(ctx) {
      const { io, engine } = ctx;
      const res = engine.disconnect();
      if (!res.ok) return io.print(res.msg, 'dim');
      io.print(`[+] connexion fermee (${res.ip}). Retour sur ${engine.session.host.hostname}.`, 'ok');
    },
  });

  // ==========================================================================
  // CATÉGORIE : INTRUSION / CRYPTO
  // ==========================================================================
  registry.register({
    name: 'crack', aliases: ['hashcat', 'john'], category: 'crypto', noTrace: true,
    usage: 'crack <empreinte>',
    summary: 'Attaque une empreinte par dictionnaire.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const hash = args[0];
      if (!hash) return io.error('crack: quelle empreinte ? Usage: crack <hash>');
      if (!/^[0-9a-f]+$/i.test(hash)) {
        return io.error("crack: ceci ne ressemble pas a une empreinte hexadecimale.");
      }
      io.print(`attaque par dictionnaire (${engine.wordlist.length} entrees) ...`, 'dim');
      const plain = engine.crack(hash);
      if (plain) io.print(`[+] EMPREINTE CASSEE : ${hash}  =>  ${plain}`, 'ok');
      else io.print(`[-] aucune correspondance. Empreinte resistante au dictionnaire.`, 'warn');
    },
  });

  registry.register({
    name: 'su', aliases: ['sudo'], category: 'crypto',
    usage: 'su <user> <pass>   |   sudo <pass>',
    summary: 'Élève les privilèges (change d\'utilisateur sur l\'hôte courant).',
    run(ctx) {
      const { io, engine, args, raw } = ctx;
      let user, pass;
      if (/^\s*sudo\b/i.test(raw)) { user = 'root'; pass = args[0]; }
      else { user = args[0]; pass = args[1]; }
      if (!user || pass === undefined) {
        return io.error('su: usage: su <user> <pass>   (ou: sudo <pass>)');
      }
      const res = engine.escalate(user, pass);
      if (!res.ok) return io.error(`su: ${res.msg}`);
      io.print(`[+] privileges eleves : tu es desormais ${user}${res.root ? ' (root)' : ''}.`, 'ok');
    },
  });

  registry.register({
    name: 'decrypt', category: 'crypto',
    usage: 'decrypt <fichier> <cle>',
    summary: 'Déchiffre un fichier avec une clé.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const path = args[0], key = args[1];
      if (!path || key === undefined) return io.error('decrypt: usage: decrypt <fichier> <cle>');
      const node = engine.resolve(path);
      if (!node) return io.error(`decrypt: ${path}: fichier introuvable`);
      if (node.isDir()) return io.error(`decrypt: ${path}: est un dossier`);
      if (node.locked && !engine.isRoot()) return io.error(`decrypt: ${path}: permission refusee (root requis)`);
      if (!node.encrypted) return io.print(`decrypt: ${path} n'est pas chiffre.`, 'dim');
      if (key !== node.encKey) return io.print('[-] cle invalide. Dechiffrement echoue.', 'warn');
      node.encrypted = false;
      io.print('[+] dechiffrement reussi :', 'ok');
      io.print(node.content.replace(/\n$/, ''), '');
      engine.emit({ type: 'decrypt', ip: engine.location(), path: engine.canonical(path) });
    },
  });

  registry.register({
    name: 'download', aliases: ['get', 'scp', 'exfil'], category: 'crypto',
    usage: 'download <fichier>',
    summary: 'Exfiltre un fichier distant vers ~/loot/ sur ta machine.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const path = args[0];
      if (!path) return io.error('download: quel fichier ? Usage: download <fichier>');
      if (!engine.isRemote()) return io.error('download: rien a exfiltrer depuis ta propre machine.');
      const node = engine.resolve(path);
      if (!node) return io.error(`download: ${path}: fichier introuvable`);
      if (node.isDir()) return io.error(`download: ${path}: est un dossier`);
      if (node.encrypted) return io.error(`download: ${path} est chiffre. Dechiffre-le d'abord (decrypt).`);
      if (node.locked && !engine.isRoot()) return io.error(`download: ${path}: permission refusee (root requis)`);
      const res = engine.download(node, path);
      if (!res.ok) return io.error(`download: ${res.msg}`);
      io.print(`[+] ${node.name} exfiltre -> ~/loot/${node.name}`, 'ok');
    },
  });

  // ==========================================================================
  // CATÉGORIE : ANTI-FORENSIQUE
  // ==========================================================================
  registry.register({
    name: 'shred', aliases: ['wipe', 'clean'], category: 'anti-forensic', noTrace: true,
    usage: 'shred <fichier>   |   clean',
    summary: 'Détruit un fichier. Sur un journal, efface les traces et remet la trace à zéro.',
    run(ctx) {
      const { io, engine, args, raw } = ctx;
      const host = engine.session.host;
      // `clean` (sans argument) cible directement le journal de l'hôte courant.
      let path = args[0];
      if (/^\s*clean\b/i.test(raw) && !path) path = host.logPath;
      if (!path) return io.error('shred: quel fichier ? Usage: shred <fichier> (ou: clean)');
      if (!engine.isRemote()) return io.error('shred: reserve aux hotes distants.');

      const node = engine.resolve(path);
      if (!node) return io.error(`shred: ${path}: fichier introuvable`);
      if (node.isDir()) return io.error(`shred: ${path}: est un dossier`);

      const canon = engine.canonical(path);
      const isLog = canon === host.logPath || node.name.endsWith('.log');
      engine.vfs.remove(path, engine.cwd);

      if (isLog) {
        engine.trace.level = 0;
        io.print(`[+] ${node.name} detruit. Journal efface -- TRACE remise a zero.`, 'ok');
        engine.emit({ type: 'wipe', ip: engine.location(), path: canon });
      } else {
        io.print(`[+] '${node.name}' ecrase et detruit (irrecuperable).`, 'ok');
      }
    },
  });

  registry.register({
    name: 'rm', aliases: ['del'], category: 'anti-forensic',
    usage: 'rm <fichier>',
    summary: 'Supprime un fichier.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const path = args[0];
      if (!path) return io.error('rm: quel fichier ? Usage: rm <fichier>');
      const node = engine.resolve(path);
      if (!node) return io.error(`rm: ${path}: fichier introuvable`);
      if (node.isDir()) return io.error(`rm: ${path}: est un dossier (suppression de dossier non supportee)`);
      if (node.locked && !engine.isRoot()) return io.error(`rm: ${path}: permission refusee`);
      engine.vfs.remove(path, engine.cwd);
      io.print(`'${node.name}' supprime.`, 'dim');
    },
  });

  registry.register({
    name: 'trace', category: 'anti-forensic', noTrace: true,
    usage: 'trace [on|off]',
    summary: 'Affiche ou (dés)active la pression de traçage.',
    run(ctx) {
      const { io, engine, args } = ctx;
      const t = engine.trace;
      const arg = (args[0] || '').toLowerCase();
      if (arg === 'off') { t.enabled = false; return io.print('traçage DESACTIVE. Aucune pression temporelle.', 'sys'); }
      if (arg === 'on') { t.enabled = true; return io.print('traçage ACTIVE. Reste discret.', 'sys'); }
      io.print(`TRACE  : ${t.enabled ? 'ON' : 'OFF'}`, t.enabled ? 'warn' : 'dim');
      io.print(`armee  : ${t.armed ? 'oui' : 'non (missions d\'apprentissage)'}`, 'dim');
      io.print(`niveau : ${t.level}/${t.max}`, 'dim');
    },
  });

  // ==========================================================================
  // CATÉGORIE : META
  // ==========================================================================
  registry.register({
    name: 'mail', aliases: ['inbox', 'mails'], category: 'meta', noTrace: true,
    usage: 'mail [numero]',
    summary: 'Consulte ta messagerie chiffrée (briefings de NULL).',
    run(ctx) {
      const { io, engine, args } = ctx;
      const box = engine.mailbox;
      if (box.length === 0) return io.print('messagerie vide.', 'dim');
      if (args[0]) {
        const i = parseInt(args[0], 10) - 1;
        if (isNaN(i) || i < 0 || i >= box.length) return io.error(`mail: message ${args[0]} inexistant.`);
        const m = box[i];
        m.unread = false;
        io.print(`De    : ${m.from}`, 'bright');
        io.print(`Sujet : ${m.subject}`, 'bright');
        io.print('----------------------------------------', 'dim');
        io.print(m.body, '');
        return;
      }
      io.print('MESSAGERIE', 'bright');
      box.forEach((m, i) => {
        io.print(`  ${String(i + 1).padStart(2)}. ${m.unread ? '[NOUVEAU]' : '         '} ${m.from.padEnd(6)}  ${m.subject}`, m.unread ? '' : 'dim');
      });
      io.print("  (lire : mail <numero>)", 'sys');
    },
  });

  registry.register({
    name: 'mission', aliases: ['objectives', 'status', 'obj'], category: 'meta', noTrace: true,
    summary: 'Affiche la mission courante et l\'état des objectifs.',
    run(ctx) {
      const { io, engine } = ctx;
      if (engine.finished) {
        return io.print('CAMPAGNE TERMINEE. Tape  reset  pour rejouer.', 'ok');
      }
      const m = engine.currentMission();
      if (!m) return io.print('aucune mission active.', 'dim');
      io.print(`MISSION ${engine.missionIndex + 1}/${engine.missions.length} -- ${m.codename} : ${m.title}`, 'bright');
      m.objectives.forEach((o) => {
        io.print(`  [${o.done ? 'x' : ' '}] ${o.text}`, o.done ? 'ok' : '');
      });
      const t = engine.trace;
      if (t.armed) io.print(`  traçage : ${t.enabled ? t.level + '/' + t.max : 'OFF'}`, 'dim');
    },
  });

  registry.register({
    name: 'reset', category: 'meta', noTrace: true,
    summary: 'Réinitialise toute la progression et recommence la campagne.',
    run(ctx) {
      ctx.engine.reset();
      ctx.io.print('progression reinitialisee. Nouvelle partie.', 'sys');
    },
  });

  registry.register({
    name: 'banner', aliases: ['about', 'motd'], category: 'meta', noTrace: true,
    summary: 'Réaffiche la bannière d\'accueil.',
    run(ctx) { ctx.io.print(ctx.engine._bannerText ? ctx.engine._bannerText() : 'HACKER TERMINAL', 'bright'); },
  });

  return registry;
}

const api = { registerCommands };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
