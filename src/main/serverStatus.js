// ============================================================
// Meytopia Launcher — Statut serveur (CDC F8)
// Ping (Server List Ping via la lib) + Query UDP pour les pseudos.
// ============================================================
const { Status } = require('minecraft-java-core');
const { queryFullStat } = require('./query');

/**
 * @param {{host:string, port:number, query?:{enabled:boolean, port:number}}} server
 * @returns {Promise<object>} statut prêt pour l'affichage
 */
async function getServerStatus(server) {
  if (!server?.host) return { online: false };

  let ping;
  try {
    ping = await new Status(server.host, server.port).getStatus();
  } catch {
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

  // Liste complète des pseudos via Query, si activé (CDC F8)
  if (server.query?.enabled) {
    try {
      const q = await queryFullStat(server.host, server.query.port ?? server.port);
      result.players = q.players;
    } catch {
      result.players = null; // repli silencieux : compteur seul
    }
  }

  return result;
}

module.exports = { getServerStatus };
