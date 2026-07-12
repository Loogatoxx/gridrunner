'use strict';
/**
 * world.js
 * ----------------------------------------------------------------------------
 * LE CONTENU DU JEU. Ici, aucune "mécanique" : uniquement des données.
 *   - la machine du joueur (`deck`),
 *   - le réseau cible d'AEGIS DYNAMICS (passerelle publique → mainframe interne),
 *   - le dictionnaire d'attaque (`wordlist`),
 *   - la campagne narrative (5 missions) sous forme de données + petits handlers
 *     d'évènements.
 *
 * SÉPARATION DES RESPONSABILITÉS :
 *   Le moteur (GameEngine) ne connaît AUCUN de ces textes. Il se contente
 *   d'émettre des évènements ('read', 'scan', 'connect', 'crack'...). Chaque
 *   mission écoute ces évènements et coche ses objectifs. On peut donc réécrire
 *   toute la campagne sans toucher une ligne de moteur.
 *
 * Adresses IP : plages de DOCUMENTATION (RFC 5737 : 198.51.100.0/24,
 * 203.0.113.0/24) et RFC 1918 (10.0.0.0/8). Aucune IP réelle n'est utilisée.
 *
 * (IIFE : scope de module privé — cf. la note dans Network.js.)
 * ----------------------------------------------------------------------------
 */
(function () {

// -- Dépendances (Node require OU navigateur window.HT) ----------------------
const _dep = (typeof module !== 'undefined' && module.exports)
  ? Object.assign({},
      require('./VirtualFileSystem'),
      require('./Network'),
      require('./Crypto'))
  : globalThis.HT;
const { VirtualFileSystem, Network, Host, Port, Crypto } = _dep;

const F = (name, content, opts) => VirtualFileSystem.file(name, content, opts);
const D = (name, opts, children) => VirtualFileSystem.dir(name, opts, children);

// Empreintes de jeu, calculées une fois pour toutes à la construction du monde.
const HASH = {
  dragon: Crypto.hash('dragon'),   // mot de passe root de la passerelle
  guest: Crypto.hash('guest'),
  ncc1701: Crypto.hash('ncc1701'), // mot de passe sysop du mainframe
};

/**
 * Construit un monde neuf. Appelé au démarrage et à chaque `reset`.
 * @returns {{localHost:Host, network:Network, missions:Array, wordlist:string[]}}
 */
function buildWorld() {
  // ==========================================================================
  // 1) LA MACHINE DU JOUEUR — "deck"
  // ==========================================================================
  const localVfs = new VirtualFileSystem({ home: '/home/runner' });
  localVfs.root.addChild(D('home', {}, [
    D('runner', {}, [
      F('readme.txt',
`runner —

Si tu lis ceci, le drop a fonctionne. Bienvenue sur la Grille.

  Regle 1 : je ne me repete pas. Tout ce que je t'envoie atterrit dans ta
            messagerie chiffree. Tape  mail  pour la consulter.
  Regle 2 : apprends ta propre machine avant de toucher aux leurs.
            Tape  help  pour la liste de ce que tu sais faire.
            ls , cat , cd  : c'est ton alphabet. Sers-t'en.

Ta premiere cible dort dans  ~/intel/ . Trouve-la. Lis-la.

  -- NULL`),
      D('intel', {}, [
        F('target.txt',
`== CIBLE 01 : AEGIS DYNAMICS =============================
 passerelle publique : 198.51.100.23   (gate-07.aegis.net)

 Un vieux portail de maintenance. Les identifiants d'usine
 n'ont jamais ete changes :

     utilisateur : guest
     mot de passe : guest

 Marche a suivre :
   1. scanne l'hote        ->  scan 198.51.100.23
   2. ouvre un shell       ->  connect 198.51.100.23 guest guest
   3. fouille ce qui traine.
=========================================================`),
      ]),
      D('loot', {}),  // les fichiers exfiltres via `download` atterrissent ici
      F('notes.txt',
`TODO
- ne jamais reutiliser le meme pseudo deux missions de suite
- payer le loyer du bunker (en retard)
- NULL dit que la Grille se souvient de tout. Effacer. Toujours effacer.`),
      F('.profile', 'export PS1="runner@deck"\n', { hidden: true }),
    ]),
  ]));
  localVfs.root.addChild(D('etc', {}, [
    F('motd', 'deck OS 3.4 "blackout" -- machine personnelle. Reste discret.\n'),
  ]));
  localVfs.root.addChild(D('var', {}, [
    D('log', {}, [ F('system.log', 'boot ok\nnet up\ncrypto module loaded\n') ]),
  ]));

  const localHost = new Host({
    ip: 'localhost',
    hostname: 'deck',
    ports: [],
    users: { runner: { password: '', root: true } },
    vfs: localVfs,
    requiresAuth: false,
    logging: false,
    reachableFrom: ['*'],
  });

  // ==========================================================================
  // 2) LE RESEAU AEGIS
  // ==========================================================================
  const network = new Network();

  // --- 2a) Passerelle publique : gate-07 -----------------------------------
  const gateVfs = new VirtualFileSystem({ home: '/home/guest' });
  gateVfs.root.addChild(D('home', {}, [
    D('guest', {}, [
      F('notes.txt',
`Note interne -- equipe maintenance
 - Le SOC rearme la surveillance la semaine prochaine. Profitez-en tant
   que les alarmes dorment encore.
 - Rappel securite (encore ignore) : /etc/shadow est lisible par tout le
   monde sur cette machine. Un backup traine aussi quelque part.
 - Le coffre root  /root/vault.enc  contient les acces du mainframe interne.
   Personne ne se souvient de la cle. "AEGIS-CORE-quelque-chose".`),
    ]),
  ]));
  gateVfs.root.addChild(D('etc', {}, [
    F('motd', 'AEGIS DYNAMICS // gate-07 // acces reserve au personnel autorise\n'),
    F('shadow',
`root:${HASH.dragon}:20050:0:99999:7:::
guest:${HASH.guest}:20050:0:99999:7:::
daemon:*:20050:0:99999:7:::
sshd:!:20050:0:99999:7:::`),
  ]));
  gateVfs.root.addChild(D('root', { owner: 'root' }, [
    F('keyring.txt', 'Cle du coffre local : AEGIS-CORE-9\n', { owner: 'root', locked: true }),
    F('vault.enc',
`== COFFRE AEGIS -- NIVEAU CORE ===========================
 Mainframe interne : 10.10.10.9   (oracle-core.aegis)
   -> joignable UNIQUEMENT depuis cette passerelle (LAN interne).

 Compte d'exploitation : sysop
   empreinte : ${HASH.ncc1701}

 Casse l'empreinte, pivote depuis ici, recupere blackfile.
=========================================================`,
        { owner: 'root', locked: true, encrypted: true, encKey: 'AEGIS-CORE-9' }),
  ]));
  gateVfs.root.addChild(D('var', {}, [
    D('log', {}, [
      F('auth.log',
`2049-11-01 02:14 sshd[811]: Accepted password for guest from 10.0.4.2
2049-11-01 09:31 cron[204]: session opened for user root
2049-11-02 23:58 sshd[901]: Accepted password for guest from 10.0.4.2\n`),
    ]),
  ]));

  network.add(new Host({
    ip: '198.51.100.23',
    hostname: 'gate-07.aegis',
    ports: [
      new Port(22, 'ssh', { banner: 'OpenSSH 6.6.1p1 (obsolete)' }),
      new Port(80, 'http', { banner: 'nginx 1.4.6 -- portail maintenance' }),
      new Port(443, 'https', { banner: 'nginx 1.4.6' }),
      new Port(3306, 'mysql', { state: 'filtered' }),
    ],
    users: {
      guest: { password: 'guest' },
      root: { password: 'dragon', root: true },
    },
    vfs: gateVfs,
    requiresAuth: true,
    logging: true,
    traceRate: 12,
    reachableFrom: ['*'],
  }));

  // --- 2b) Mainframe interne : oracle-core (pivot depuis gate uniquement) ---
  const mainVfs = new VirtualFileSystem({ home: '/root' });
  mainVfs.root.addChild(D('data', {}, [
    F('blackfile.enc',
`== PROJET ORACLE -- TOP SECRET / AEGIS ===================
 ORACLE n'est pas un pare-feu. C'est un moteur de surveillance
 de masse. Il ecoute 40 millions de foyers en temps reel.

 Ceci est la preuve. Sors-la d'ici. Efface tout derriere toi.

 Tu as bien travaille, runner.
 Moi ? J'ai construit ORACLE. Puis j'ai compris ce que j'avais
 fait. Appelle-moi NULL.
=========================================================`,
        { locked: true, encrypted: true, encKey: 'ORACLE' }),
    F('.k', 'ORACLE\n', { hidden: true, locked: true }),
    F('README', 'noyau ORACLE -- ne pas eteindre. Journalisation permanente active.\n'),
  ]));
  mainVfs.root.addChild(D('etc', {}, [
    F('shadow', `sysop:${HASH.ncc1701}:20090:0:99999:7:::\nroot:*:20090:0:99999:7:::`),
  ]));
  mainVfs.root.addChild(D('var', {}, [
    D('log', {}, [
      F('auth.log', '2049-11-02 00:00 sshd[77]: internal session -- sysop\n'),
    ]),
  ]));

  network.add(new Host({
    ip: '10.10.10.9',
    hostname: 'oracle-core.aegis',
    ports: [ new Port(22, 'ssh', { banner: 'OpenSSH 9.2 (hardened)' }) ],
    users: { sysop: { password: 'ncc1701', root: true } },
    vfs: mainVfs,
    requiresAuth: true,
    logging: true,
    traceRate: 20,                    // le mainframe trace vite : tension maximale
    reachableFrom: ['198.51.100.23'], // pivoting obligatoire
  }));

  // ==========================================================================
  // 3) DICTIONNAIRE D'ATTAQUE (pour `crack`)
  // ==========================================================================
  const wordlist = [
    '123456', 'password', 'admin', 'root', 'toor', 'dragon', 'letmein',
    'qwerty', 'hunter2', 'trustno1', 'shadow', 'master', 'aegis', 'sysop',
    'matrix', 'ncc1701', 'iloveyou', 'welcome', 'monkey', 'superman',
    'starwars', 'passw0rd', 'oracle', 'root1234', 'changeme',
  ];

  // ==========================================================================
  // 4) LA CAMPAGNE (5 missions)
  //    Chaque mission ecoute les evenements du moteur et coche ses objectifs.
  //    Helper `obj(id, text)` => objectif non complete.
  // ==========================================================================
  const obj = (id, text) => ({ id, text, done: false });

  // Petit utilitaire : marque un objectif terminé s'il correspond.
  const done = (mission, id) => {
    const o = mission.objectives.find((x) => x.id === id);
    if (o) o.done = true;
  };

  const missions = [
    // ---- M0 : ORIENTATION ------------------------------------------------
    {
      id: 'm0', codename: 'ORIENTATION',
      title: 'Prise en main',
      mail: {
        from: 'NULL', subject: 'reveille-toi',
        body:
`Premiere lecon : ta machine.
Explore-la. Lis mon message d'accueil (~/readme.txt), puis trouve la cible
que je t'ai laissee dans ~/intel/. Tout est la. Bouge.`,
      },
      objectives: [
        obj('m0_readme', 'Lis ton fichier d\'accueil : cat ~/readme.txt'),
        obj('m0_target', 'Trouve et lis ta premiere cible dans ~/intel/'),
      ],
      onEvent(engine, evt) {
        if (evt.type === 'read' && evt.ip === 'localhost') {
          if (evt.path === '/home/runner/readme.txt') done(this, 'm0_readme');
          if (evt.path === '/home/runner/intel/target.txt') done(this, 'm0_target');
        }
      },
    },

    // ---- M1 : RECONNAISSANCE ---------------------------------------------
    {
      id: 'm1', codename: 'RECON',
      title: 'Reconnaissance',
      mail: {
        from: 'NULL', subject: 'gate-07',
        body:
`Bien. La passerelle 198.51.100.23 est ton entree.
On ne frappe jamais a l'aveugle : scanne d'abord (scan <ip>) pour voir les
ports ouverts, PUIS ouvre un shell (connect <ip> guest guest).
Une fois dedans, lis les notes de l'equipe maintenance. Elles parlent trop.`,
      },
      objectives: [
        obj('m1_scan', 'Scanne la passerelle : scan 198.51.100.23'),
        obj('m1_shell', 'Ouvre un shell : connect 198.51.100.23 guest guest'),
        obj('m1_notes', 'Lis les notes internes : cat /home/guest/notes.txt'),
      ],
      onEvent(engine, evt) {
        if (evt.type === 'scan' && evt.ip === '198.51.100.23') done(this, 'm1_scan');
        if (evt.type === 'connect' && evt.ip === '198.51.100.23') done(this, 'm1_shell');
        if (evt.type === 'read' && evt.ip === '198.51.100.23'
            && evt.path === '/home/guest/notes.txt') done(this, 'm1_notes');
      },
    },

    // ---- M2 : ESCALADE ---------------------------------------------------
    {
      id: 'm2', codename: 'ESCALADE',
      title: 'Elevation de privileges',
      mail: {
        from: 'NULL', subject: 'deviens root',
        body:
`Les notes ne mentaient pas : /etc/shadow est lisible. Recupere l'empreinte
du compte root, casse-la (crack <empreinte>), puis eleve-toi (su root <mdp>).
En root, ouvre le coffre : decrypt /root/vault.enc <cle>. La cle traine dans
/root/keyring.txt une fois que tu es root. Enchaine.`,
      },
      objectives: [
        obj('m2_shadow', 'Recupere l\'empreinte root : cat /etc/shadow'),
        obj('m2_crack', 'Casse l\'empreinte : crack <empreinte>'),
        obj('m2_root', 'Eleve tes privileges : su root <mot-de-passe>'),
        obj('m2_vault', 'Ouvre le coffre : decrypt /root/vault.enc <cle>'),
      ],
      onEvent(engine, evt) {
        if (evt.type === 'read' && evt.ip === '198.51.100.23'
            && evt.path === '/etc/shadow') done(this, 'm2_shadow');
        if (evt.type === 'crack' && evt.plain === 'dragon') done(this, 'm2_crack');
        if (evt.type === 'escalate' && evt.ip === '198.51.100.23'
            && evt.user === 'root') done(this, 'm2_root');
        if (evt.type === 'decrypt' && evt.ip === '198.51.100.23'
            && evt.path === '/root/vault.enc') done(this, 'm2_vault');
      },
    },

    // ---- M3 : NETTOYAGE (le tracage s'arme ici) --------------------------
    {
      id: 'm3', codename: 'NETTOYAGE',
      title: 'Effacer ses traces',
      armsTrace: true,  // <-- le compteur de tracage devient actif
      mail: {
        from: 'NULL', subject: 'ils regardent',
        body:
`Mauvaise nouvelle : le SOC vient de rearmer la surveillance. A partir de
maintenant, chaque commande sur un hote distant fait monter ta TRACE. Si la
barre se remplit, ils te localisent et coupent tout.

Exfiltre le coffre vers ta machine (download /root/vault.enc), consulte le
journal (cat /var/log/auth.log) pour voir ce que tu as laisse, efface-le
(shred /var/log/auth.log) -- ca remet la trace a zero -- puis disparais
(disconnect). Vite.

(Si tu veux t'entrainer sans pression : trace off. Mais un vrai runner
 n'eteint jamais l'alarme, il court plus vite qu'elle.)`,
      },
      objectives: [
        obj('m3_download', 'Exfiltre le coffre : download /root/vault.enc'),
        obj('m3_logs', 'Consulte le journal : cat /var/log/auth.log'),
        obj('m3_wipe', 'Efface tes traces : shred /var/log/auth.log'),
        obj('m3_out', 'Deconnecte-toi proprement : disconnect'),
      ],
      onEvent(engine, evt) {
        if (evt.type === 'download' && evt.path === '/root/vault.enc') done(this, 'm3_download');
        if (evt.type === 'read' && evt.ip === '198.51.100.23'
            && evt.path === '/var/log/auth.log') done(this, 'm3_logs');
        if (evt.type === 'wipe' && evt.ip === '198.51.100.23') done(this, 'm3_wipe');
        // On ne valide la sortie que si les traces ont bien ete effacees avant.
        if (evt.type === 'disconnect' && evt.ip === '198.51.100.23') {
          const wiped = this.objectives.find((o) => o.id === 'm3_wipe').done;
          if (wiped) done(this, 'm3_out');
        }
      },
    },

    // ---- M4 : LE PIVOT (finale) ------------------------------------------
    {
      id: 'm4', codename: 'ORACLE',
      title: 'Le mainframe',
      armsTrace: true,
      mail: {
        from: 'NULL', subject: 'derniere ligne droite',
        body:
`Tout est la, runner. Le coffre t'a donne le mainframe interne : 10.10.10.9.
Il n'est joignable QUE depuis la passerelle -- il faut pivoter.

Le plan :
  1. reconnecte-toi a gate-07 (root, tu connais le mdp).
  2. de la, scanne l'interne (scan 10.10.10.9).
  3. casse l'empreinte sysop (crack ...), pivote (connect 10.10.10.9 sysop ...).
  4. deniche la cle (ls -a /data, puis cat /data/.k), dechiffre et exfiltre
     blackfile.
  5. efface le journal du mainframe (shred ...) et reviens sur la Grille
     (disconnect, disconnect).

Ne laisse rien. C'est notre seul essai.`,
      },
      objectives: [
        obj('m4_scan', 'Depuis la passerelle : scan 10.10.10.9'),
        obj('m4_crack', 'Casse l\'empreinte sysop : crack <empreinte>'),
        obj('m4_pivot', 'Pivote sur le mainframe : connect 10.10.10.9 sysop <mdp>'),
        obj('m4_decrypt', 'Dechiffre : decrypt /data/blackfile.enc <cle>'),
        obj('m4_exfil', 'Exfiltre : download /data/blackfile.enc'),
        obj('m4_wipe', 'Efface le journal du mainframe : shred /var/log/auth.log'),
        obj('m4_escape', 'Reviens sur la Grille : disconnect jusqu\'a deck'),
      ],
      onEvent(engine, evt) {
        if (evt.type === 'scan' && evt.ip === '10.10.10.9') done(this, 'm4_scan');
        if (evt.type === 'crack' && evt.plain === 'ncc1701') done(this, 'm4_crack');
        if (evt.type === 'connect' && evt.ip === '10.10.10.9') done(this, 'm4_pivot');
        if (evt.type === 'decrypt' && evt.ip === '10.10.10.9'
            && evt.path === '/data/blackfile.enc') done(this, 'm4_decrypt');
        if (evt.type === 'download' && evt.path === '/data/blackfile.enc') done(this, 'm4_exfil');
        if (evt.type === 'wipe' && evt.ip === '10.10.10.9') done(this, 'm4_wipe');
        // Sortie complete = retour sur la machine locale (pile de sessions videe).
        if (evt.type === 'disconnect' && evt.ip === 'localhost') {
          const exfil = this.objectives.find((o) => o.id === 'm4_exfil').done;
          if (exfil) done(this, 'm4_escape');
        }
      },
    },
  ];

  return { localHost, network, missions, wordlist };
}

// -- Export universel (Node module.exports OU navigateur window.HT) --------
const api = { buildWorld };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else Object.assign(globalThis.HT || (globalThis.HT = {}), api);

})();
