// ============================================================
// Meytopia Launcher — Serveur multijoueur (servers.dat + adresse)
// Enregistre le serveur dans la liste multijoueur de Minecraft
// (format NBT) et fournit l'adresse de connexion directe.
// ============================================================
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const nbt = require('prismarine-nbt');
const { getGameDir } = require('./paths');

/**
 * Adresse à donner à Minecraft. Règle d'or : ajouter « :port » DÉSACTIVE la résolution SRV côté
 * Minecraft (il va droit sur l'IP directe A/AAAA du domaine). Pour un domaine SRV-only comme
 * meytopia.fr (aucune IP directe), « host:port » ne pointe vers RIEN → connexion impossible.
 * On n'impose donc « host:port » que si le domaine a réellement une IP directe ; sinon on donne le
 * NOM SEUL et on laisse Minecraft résoudre le SRV lui-même (le seul chemin qui marche).
 */
async function joinAddress(server) {
  const host = server?.host ?? '';
  if (!host) return '';
  const port = server?.port;
  const direct = (port && port !== 25565) ? `${host}:${port}` : host;

  // IP brute : pas de SRV possible → connexion directe.
  if (net.isIP(host)) return direct;

  // SRV Minecraft présent → nom seul (Minecraft le résout ; le port du SRV prime).
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length) return host;
  } catch { /* SRV absent OU DNS injoignable : on ne peut pas conclure ici */ }

  // Pas de port utile : le nom seul suffit (Minecraft résout SRV puis A).
  if (!port || port === 25565) return host;

  // Port explicite : ne forcer « host:port » (qui coupe le SRV) QUE si une IP directe existe.
  // Sinon (domaine SRV-only), garder le nom seul — Minecraft retentera le SRV de son côté.
  try { if ((await dns.resolve4(host)).length) return direct; } catch { /* pas d'IPv4 */ }
  try { if ((await dns.resolve6(host)).length) return direct; } catch { /* pas d'IPv6 */ }
  return host;
}

/**
 * Ajoute le serveur en tête de la liste multijoueur s'il n'y est pas déjà.
 * Préserve les autres serveurs du joueur. Non bloquant en cas d'échec.
 * @returns {Promise<boolean>} true si une entrée a été ajoutée.
 */
async function ensureServerEntry(address, name) {
  const file = path.join(getGameDir(), 'servers.dat');

  let root = { type: 'compound', name: '', value: {} };
  if (fs.existsSync(file)) {
    try {
      root = (await nbt.parse(fs.readFileSync(file))).parsed;
    } catch {
      // Fichier présent mais illisible : NE PAS le réécrire — on écraserait les AUTRES serveurs du
      // joueur. On renonce à pré-ajouter Meytopia cette fois (non bloquant : la connexion directe
      // « Quick Play » fonctionne de toute façon ; le joueur peut l'ajouter à la main).
      return false;
    }
  }

  if (!root.value || typeof root.value !== 'object') root.value = {};
  if (!root.value.servers?.value?.value) {
    root.value.servers = { type: 'list', value: { type: 'compound', value: [] } };
  }

  const entries = root.value.servers.value.value;
  const target = String(address).toLowerCase();
  const existing = entries.find((entry) => String(entry?.ip?.value ?? '').toLowerCase() === target);
  if (existing) {
    if (String(existing.name?.value ?? '') === name) return false;
    existing.name = { type: 'string', value: name }; // renommage piloté par launcher.json (I7)
    fs.writeFileSync(file, nbt.writeUncompressed(root));
    return false;
  }

  entries.unshift({
    name: { type: 'string', value: name },
    ip: { type: 'string', value: address },
  });

  fs.mkdirSync(getGameDir(), { recursive: true });
  fs.writeFileSync(file, nbt.writeUncompressed(root));
  return true;
}

module.exports = { joinAddress, ensureServerEntry };
