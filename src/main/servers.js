// ============================================================
// Meytopia Launcher — Serveur multijoueur (servers.dat + adresse)
// Enregistre le serveur dans la liste multijoueur de Minecraft
// (format NBT) et fournit l'adresse de connexion directe.
// ============================================================
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const nbt = require('prismarine-nbt');
const { getGameDir } = require('./paths');

/**
 * Adresse que les joueurs « tapent » : si le domaine a un enregistrement
 * SRV Minecraft (cas de meytopia.fr), le domaine seul suffit — et c'est
 * même obligatoire, car il n'a pas d'IP directe. Sinon : host[:port].
 */
async function joinAddress(server) {
  const host = server?.host ?? '';
  const port = server?.port;
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (records.length) return host;
  } catch { /* pas de SRV : adresse directe */ }
  return port && port !== 25565 ? `${host}:${port}` : host;
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
    } catch { /* fichier illisible : on repart sur une liste propre */ }
  }

  if (!root.value || typeof root.value !== 'object') root.value = {};
  if (!root.value.servers?.value?.value) {
    root.value.servers = { type: 'list', value: { type: 'compound', value: [] } };
  }

  const entries = root.value.servers.value.value;
  const target = String(address).toLowerCase();
  const already = entries.some((entry) => String(entry?.ip?.value ?? '').toLowerCase() === target);
  if (already) return false;

  entries.unshift({
    name: { type: 'string', value: name },
    ip: { type: 'string', value: address },
  });

  fs.mkdirSync(getGameDir(), { recursive: true });
  fs.writeFileSync(file, nbt.writeUncompressed(root));
  return true;
}

module.exports = { joinAddress, ensureServerEntry };
