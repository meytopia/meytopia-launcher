// ============================================================
// Meytopia Launcher — Comptes Microsoft (P2, CDC F2)
// Multi-comptes avec sessions chiffrées via safeStorage.
// Les jetons ne quittent JAMAIS le processus principal :
// le renderer ne reçoit que { uuid, name, active, needsRelogin }.
// ============================================================
const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Microsoft } = require('minecraft-java-core');
const { getLauncherDir } = require('./paths');
const settings = require('./settings');

const accountsFile = () => path.join(getLauncherDir(), 'accounts.enc');

/** @type {{ profile: object, needsRelogin: boolean }[]} */
let accounts = [];

/* ── Persistance chiffrée ──────────────────────────────────── */

/** Charge les comptes depuis le disque (appelé une fois au démarrage). */
function load() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const raw = safeStorage.decryptString(fs.readFileSync(accountsFile()));
    accounts = JSON.parse(raw);
  } catch {
    accounts = []; // premier lancement ou fichier illisible
  }
}

/** Écrit les comptes sur le disque — jamais en clair (CDC F2). */
function persist() {
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.mkdirSync(getLauncherDir(), { recursive: true });
  fs.writeFileSync(accountsFile(), safeStorage.encryptString(JSON.stringify(accounts)));
}

/* ── Vue « sûre » envoyée au renderer ──────────────────────── */

function summary() {
  const activeUuid = settings.read().activeAccount ?? null;
  return accounts.map((a) => ({
    uuid: a.profile.uuid,
    name: a.profile.name,
    active: a.profile.uuid === activeUuid,
    needsRelogin: Boolean(a.needsRelogin),
  }));
}

/* ── Opérations ────────────────────────────────────────────── */

/**
 * Ouvre la fenêtre de connexion Microsoft officielle et ajoute le compte.
 * Reconnecter un compte déjà présent le remplace (utile après expiration).
 */
async function add() {
  const res = await new Microsoft().getAuth('electron');
  if (res === false) return { ok: false, reason: 'cancelled' };
  if (res.error) return { ok: false, reason: String(res.error) };

  accounts = accounts.filter((a) => a.profile.uuid !== res.uuid);
  accounts.push({ profile: res, needsRelogin: false });
  if (!settings.read().activeAccount) settings.write({ activeAccount: res.uuid });
  persist();
  return { ok: true, name: res.name };
}

/** Retire un compte ; bascule le compte actif sur le suivant s'il y en a un. */
function remove(uuid) {
  accounts = accounts.filter((a) => a.profile.uuid !== uuid);
  if (settings.read().activeAccount === uuid) {
    settings.write({ activeAccount: accounts[0]?.profile.uuid ?? null });
  }
  persist();
}

/** Définit le compte actif. */
function select(uuid) {
  if (accounts.some((a) => a.profile.uuid === uuid)) {
    settings.write({ activeAccount: uuid });
  }
}

/**
 * Rafraîchit silencieusement toutes les sessions au démarrage (CDC F2).
 * - Jeton refusé par Microsoft → « reconnexion requise », sans bloquer le launcher.
 * - Erreur réseau → la session locale est conservée telle quelle (mode dégradé, CDC F16).
 */
async function refreshAll() {
  for (const account of accounts) {
    try {
      const res = await new Microsoft().refresh(account.profile);
      if (res && !res.error) {
        account.profile = res;
        account.needsRelogin = false;
      } else {
        account.needsRelogin = true;
      }
    } catch {
      // Réseau indisponible : on ne touche à rien.
    }
  }
  persist();
}

/** Profil complet du compte actif (réservé au processus principal — P3). */
function getActiveProfile() {
  const activeUuid = settings.read().activeAccount ?? null;
  const account = accounts.find((a) => a.profile.uuid === activeUuid);
  return account && !account.needsRelogin ? account.profile : null;
}

module.exports = { load, summary, add, remove, select, refreshAll, getActiveProfile };
