// ============================================================
// Meytopia Launcher — Statut serveur (CDC F8)
// Résolution SRV à la manière de Minecraft, puis ping (lib)
// + Query UDP pour la liste des pseudos.
// ============================================================
const { Status } = require('minecraft-java-core');
const dns = require('dns').promises;
const { queryFullStat } = require('./query');

// Petit cache (60 s) pour ne pas interroger le DNS à chaque tick de 1 s
let srvCache = { host: null, value: null, at: 0 };

/** Garantit qu'une promesse se termine : rejet après `ms` quoi qu'il arrive. */
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai dépassé (${ms} ms)`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Résout l'adresse comme le fait le client Minecraft : l'enregistrement
 * SRV _minecraft._tcp.<domaine> a priorité (c'est lui qui fait marcher
 * « meytopia.fr » sans IP directe) ; sinon, adresse telle quelle.
 */
async function resolveMinecraftHost(host, port) {
  const now = Date.now();
  if (srvCache.host === host && now - srvCache.at < 60000) return srvCache.value;

  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length) {
      const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      srvCache = { host, value: { host: best.name, port: best.port }, at: now };
      return srvCache.value;
    }
  } catch {
    // DNS momentanément KO : on conserve la dernière résolution connue
    if (srvCache.host === host && srvCache.value) {
      srvCache.at = now;
      return srvCache.value;
    }
  }
  srvCache = { host, value: { host, port }, at: now };
  return srvCache.value;
}

/**
 * @param {{host:string, port:number, query?:{enabled:boolean, port:number}}} server
 * @returns {Promise<object>} statut prêt pour l'affichage
 */
async function getServerStatus(server) {
  if (!server?.host) return { online: false };

  const target = await resolveMinecraftHost(server.host, server.port);

  let ping;
  try {
    // Timeout dur : la bibliothèque peut rester suspendue sur un serveur
    // en cours de démarrage (port ouvert, protocole muet) — jamais plus de 5 s.
    ping = await withTimeout(new Status(target.host, target.port).getStatus(), 5000);
  } catch (err) {
    console.warn('[statut]', err?.message ?? err);
    return { online: false };
  }
  if (!ping || ping.error) return { online: false };

  const result = {
    online: true,
    ms: ping.ms,
    version: ping.version,
    playersOnline: ping.playersConnect,
    playersMax: ping.playersMax,
    players: null, // null = liste indisponible (query désactivé/filtré)
  };

  // Liste complète des pseudos via Query, sur l'hôte résolu (CDC F8)
  if (server.query?.enabled) {
    try {
      const q = await queryFullStat(target.host, server.query.port ?? target.port);
      result.players = q.players;
    } catch {
      result.players = null; // repli silencieux : compteur seul
    }
  }

  return result;
}

module.exports = { getServerStatus };
