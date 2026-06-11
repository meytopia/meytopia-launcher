// ============================================================
// Meytopia Launcher — Interface (renderer)
// Navigation, état du bouton JOUER, statut serveur, news,
// contenus, patchnotes, paramètres, volet téléchargements.
// ============================================================
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const api = window.meytopia;

/* ── Utilitaires ───────────────────────────────────────────── */
const fmtBytes = (b) => {
  if (!b || b <= 0) return "0 Mo";
  const mo = b / (1024 * 1024);
  return mo >= 1024 ? `${(mo / 1024).toFixed(2)} Go` : `${mo.toFixed(1)} Mo`;
};
const fmtSpeed = (bps) => `${((bps || 0) / (1024 * 1024)).toFixed(2)} Mo/s`;
const fmtDuration = (s) => {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${Math.round(s % 60)} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Mini-rendu Markdown : gras, italique, liens https, paragraphes (CDC F9). */
function renderMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return html.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
}

function toast(message, duration = 3600) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// Liens https → navigateur externe
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='https://']");
  if (link) {
    event.preventDefault();
    api.app.openExternal(link.href);
  }
});

/* ── État global de l'interface ────────────────────────────── */
const ui = {
  page: "home",
  accounts: [],
  remoteConfig: null,
  remoteOffline: false,
  offlinePlay: false,
  game: { state: "idle", text: "" },
  updater: { state: "none", percent: 0 },
  downloads: null,
};

/* ── Navigation ────────────────────────────────────────────── */
function showPage(id) {
  ui.page = id;
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${id}`));
  $$(".nav-item[data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  $("#content").scrollTop = 0;
  if (id === "home") refreshStatus();
  if (id === "news") loadNews();
  if (id === "content") loadContent();
  if (id === "patchnotes") loadChangelog();
}
$$(".nav-item[data-page]").forEach((btn) => btn.addEventListener("click", () => showPage(btn.dataset.page)));

/* ── Fenêtre ───────────────────────────────────────────────── */
$("#btn-min").addEventListener("click", () => api.window.minimize());
$("#btn-close").addEventListener("click", () => api.window.close());

/* ── Bouton JOUER : machine à états (CDC F3, F7, F14, F16) ── */
function refreshPlayButton() {
  const label = $("#play-label");
  const state = $("#play-state");
  const btn = $("#btn-play");
  const set = (l, s, enabled) => {
    label.textContent = l;
    state.textContent = s;
    btn.classList.toggle("disabled", !enabled);
    btn.dataset.action = "";
  };

  const maint = ui.remoteConfig?.maintenance;
  const activeAccount = ui.accounts.find((a) => a.active && !a.needsRelogin);

  if (ui.updater.state === "ready") {
    set("Redémarrer", "Mise à jour prête — clique pour installer", true);
    btn.dataset.action = "update-install";
  } else if (ui.updater.state === "available" || ui.updater.state === "downloading") {
    set("Mise à jour requise", `Téléchargement… ${ui.updater.percent} %`, false);
  } else if (maint?.active && maint?.blockPlay !== false) {
    set("Maintenance", maint.message || "Le serveur est en maintenance", false);
  } else if (ui.remoteOffline && !ui.remoteConfig) {
    set("Hors ligne", "Impossible de joindre la configuration", false);
  } else if (!activeAccount) {
    set("Jouer", "Connectez un compte", true);
    btn.dataset.action = "go-settings";
  } else if (["checking", "syncing", "launching"].includes(ui.game.state)) {
    set("…", ui.game.text || "Préparation…", false);
  } else if (ui.game.state === "ingame") {
    set("En jeu", "Bon jeu !", false);
  } else {
    set("Jouer", ui.offlinePlay ? "Hors ligne — fichiers non vérifiés" : "Prêt", true);
    btn.dataset.action = "play";
  }
}

async function onPlayClick() {
  const action = $("#btn-play").dataset.action;
  if (action === "update-install") return api.updater.install();
  if (action === "go-settings") {
    showPage("settings");
    toast("Ajoute d'abord un compte Microsoft.");
    return;
  }
  if (action !== "play") return;

  const result = await api.game.play();
  if (result.ok) return;
  const reasons = {
    "no-account": "Aucun compte actif — direction Paramètres.",
    maintenance: "Le serveur est en maintenance.",
    "offline-no-cache": "Hors ligne et aucune installation vérifiée : impossible de lancer.",
    "download-interrupted": "Téléchargement interrompu — bouton Relancer dans le volet.",
    blocked: "Des fichiers interdits bloquent le lancement.",
    "launch-error": "Le lancement a échoué.",
    "already-running": "Le jeu tourne déjà.",
  };
  if (result.reason === "no-account") showPage("settings");
  if (reasons[result.reason]) toast(reasons[result.reason]);
  refreshPlayButton();
}
$("#btn-play").addEventListener("click", onPlayClick);

api.game.onState((payload) => {
  ui.game = payload;
  if (payload.state === "error" && payload.text) toast(`Erreur : ${payload.text}`, 6000);
  if (payload.state === "closed") toast("Minecraft est fermé.");
  refreshPlayButton();
});

api.updater.onStatus((status) => {
  ui.updater = status;
  if (status.state === "ready") toast("Mise à jour du launcher prête — clique sur Redémarrer.");
  refreshPlayButton();
});

api.remote.onOfflinePlay(() => {
  ui.offlinePlay = true;
  $("#offline-banner").hidden = false;
  refreshPlayButton();
});

/* ── Config distante : maintenance, Discord, sous-titre ────── */
async function loadRemoteConfig() {
  const { config, offline } = await api.remote.config();
  ui.remoteConfig = config;
  ui.remoteOffline = offline;

  const banner = $("#maintenance-banner");
  if (config?.maintenance?.active) {
    banner.hidden = false;
    const when = config.maintenance.scheduledAt
      ? ` (prévue : ${new Date(config.maintenance.scheduledAt).toLocaleString("fr-FR")})`
      : "";
    $("#maintenance-text").textContent = ` ${config.maintenance.message || ""}${when}`;
  } else {
    banner.hidden = true;
  }

  if (config?.modpack) {
    const loader = config.modpack.loader?.type ?? "";
    $("#hero-sub").textContent =
      `${loader.charAt(0).toUpperCase()}${loader.slice(1)} ${config.modpack.mcVersion ?? ""} · modpack ${config.modpack.version ?? ""}`.trim();
  }
  updateStatusLabel();
  refreshPlayButton();
}

$("#btn-discord").addEventListener("click", () => {
  const invite = ui.remoteConfig?.discordInvite;
  if (invite) api.app.openExternal(invite);
  else toast("Le lien Discord n'est pas encore configuré.");
});

/* ── Statut serveur (CDC F8) : 10 s, page Accueil visible ──── */
let playersVisible = false;

function renderStatus(status) {
  const dot = $("#st-dot");
  dot.classList.toggle("online", Boolean(status.online));
  dot.classList.toggle("offline", !status.online);
  $("#st-state").textContent = status.online ? "En ligne" : "Hors ligne";
  $("#st-players").textContent = status.online ? `${status.playersOnline}\u2009/\u2009${status.playersMax}` : "—\u2009/\u2009—";
  $("#st-version").textContent = status.online ? status.version ?? "—" : "—";
  $("#st-ping").textContent = status.online ? `${status.ms} ms` : "—";

  const toggle = $("#players-toggle");
  const list = $("#players-list");
  if (status.online && Array.isArray(status.players)) {
    toggle.disabled = false;
    toggle.textContent = playersVisible ? "Masquer les joueurs" : "Voir les joueurs connectés";
    list.hidden = !playersVisible;
    list.textContent = status.players.length ? status.players.join(", ") : "Personne en ligne pour le moment.";
  } else {
    toggle.disabled = true;
    toggle.textContent = status.online ? "Liste des joueurs indisponible (query désactivé)" : "Voir les joueurs connectés";
    list.hidden = true;
    playersVisible = false;
  }
}

$("#players-toggle").addEventListener("click", () => {
  playersVisible = !playersVisible;
  refreshStatus();
});

let statusBusy = false;
let statusBusySince = 0;
async function refreshStatus() {
  // Verrou anti-chevauchement, auto-libéré après 10 s en cas d'appel coincé
  if (statusBusy && Date.now() - statusBusySince < 10000) return;
  statusBusy = true;
  statusBusySince = Date.now();
  try {
    renderStatus(await api.server.status());
  } catch (err) {
    console.warn("[statut]", err);
  } finally {
    statusBusy = false;
  }
}
// Rafraîchissement uniquement quand la page Accueil est affichée et la
// fenêtre visible. Intervalle : 1 s par défaut, réglable à distance via
// launcher.json → server.statusIntervalS (CDC F8 amendé).
function statusIntervalMs() {
  const s = Number(ui.remoteConfig?.server?.statusIntervalS);
  return (Number.isFinite(s) && s >= 1 ? s : 1) * 1000;
}
function updateStatusLabel() {
  const sec = statusIntervalMs() / 1000;
  $("#status-refresh").textContent = sec <= 1 ? "Actualisation chaque seconde" : `Actualisation toutes les ${sec} s`;
}
(function statusLoop() {
  setTimeout(() => {
    // Pas de await ici : la replanification ne dépend jamais de la réponse,
    // la boucle ne peut donc pas mourir sur un appel suspendu.
    if (ui.page === "home" && !document.hidden) refreshStatus();
    statusLoop();
  }, statusIntervalMs());
})();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ui.page === "home") refreshStatus();
});

/* ── News (CDC F9) ─────────────────────────────────────────── */
let readObserver = null;

async function loadNews() {
  const { news, readIds } = await api.news.list();
  const read = new Set(readIds);
  const sorted = [...news].sort((a, b) => {
    if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
    return new Date(b.date) - new Date(a.date);
  });

  const wrap = $("#news-list");
  wrap.textContent = "";
  if (!sorted.length) {
    wrap.innerHTML = `<div class="empty"><p>Aucune annonce pour l'instant.</p></div>`;
    updateNewsBadge(0);
    return;
  }

  readObserver?.disconnect();
  // Une news devient « lue » lorsqu'elle est réellement affichée à l'écran (CDC F9)
  readObserver = new IntersectionObserver((entries) => {
    const seen = entries.filter((e) => e.isIntersecting).map((e) => e.target.dataset.id);
    if (seen.length) {
      api.news.markRead(seen);
      seen.forEach((id) => read.add(id));
      entries.forEach((e) => e.isIntersecting && e.target.classList.remove("unread"));
      updateNewsBadge(sorted.filter((n) => !read.has(n.id)).length);
    }
  }, { threshold: 0.4 });

  for (const item of sorted) {
    const card = document.createElement("article");
    card.className = `news-card${read.has(item.id) ? "" : " unread"}`;
    card.dataset.id = item.id;
    if (item.accent) card.style.setProperty("--card-accent", item.accent);
    const dateText = new Date(item.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    card.innerHTML = `
      ${item.pinned ? '<span class="news-pin">Épinglé</span>' : ""}
      <h3>${escapeHtml(item.title)}</h3>
      <p class="news-meta">${escapeHtml(dateText)}${item.author ? " · " + escapeHtml(item.author) : ""}</p>
      ${item.image ? `<img class="news-image" src="${encodeURI(item.image)}" alt="" />` : ""}
      <div class="news-body">${renderMarkdown(item.body ?? "")}</div>
      ${item.link?.url ? `<a class="news-link" href="${encodeURI(item.link.url)}">${escapeHtml(item.link.label ?? "En savoir plus")}</a>` : ""}
    `;
    wrap.appendChild(card);
    readObserver.observe(card);
  }
  updateNewsBadge(sorted.filter((n) => !read.has(n.id)).length);
}

function updateNewsBadge(count) {
  const badge = $("#news-badge");
  badge.hidden = count <= 0;
  badge.textContent = count;
}

async function refreshNewsBadge() {
  try {
    const { news, readIds } = await api.news.list();
    const read = new Set(readIds);
    updateNewsBadge(news.filter((n) => !read.has(n.id)).length);
  } catch { /* silencieux */ }
}

/* ── Patchnotes (CDC F12) ──────────────────────────────────── */
let changelogFilter = "all";
let changelogEntries = [];

function renderChangelog() {
  const wrap = $("#changelog-list");
  wrap.textContent = "";
  const entries = changelogEntries
    .filter((e) => changelogFilter === "all" || e.target === changelogFilter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!entries.length) {
    wrap.innerHTML = `<div class="empty"><p>Aucun patchnote publié.</p></div>`;
    return;
  }
  for (const entry of entries) {
    const card = document.createElement("div");
    card.className = "log-card";
    const changes = (entry.changes ?? []).map((c) => `<li>${escapeHtml(c)}</li>`).join("");
    card.innerHTML = `
      <div class="log-head">
        <span class="log-target ${entry.target === "launcher" ? "launcher" : "modpack"}">${entry.target === "launcher" ? "Launcher" : "Modpack"}</span>
        <strong class="num">${escapeHtml(entry.version ?? "")}</strong>
        <span class="log-date">${escapeHtml(new Date(entry.date).toLocaleDateString("fr-FR"))}</span>
      </div>
      ${entry.title ? `<p class="log-title">${escapeHtml(entry.title)}</p>` : ""}
      <ul>${changes}</ul>`;
    wrap.appendChild(card);
  }
}

async function loadChangelog() {
  changelogEntries = await api.changelog.list();
  renderChangelog();
}

$$(".chip[data-filter]").forEach((chip) =>
  chip.addEventListener("click", () => {
    changelogFilter = chip.dataset.filter;
    $$(".chip[data-filter]").forEach((c) => c.classList.toggle("active", c === chip));
    renderChangelog();
  })
);

/* ── Contenus (CDC F11) ────────────────────────────────────── */
$$(".folder-btn[data-dir]").forEach((btn) =>
  btn.addEventListener("click", () => api.content.openFolder(btn.dataset.dir))
);

const SOURCE_LABELS = { user: "perso", detected: "détecté" };
const TYPE_LABELS = { mod: "mod", resourcepack: "resourcepack", shaderpack: "shaderpack", config: "config" };

async function loadContent() {
  // Catalogue approuvé
  const { items, installed } = await api.optional.list();
  const optWrap = $("#optional-list");
  optWrap.textContent = "";
  if (!items.length) {
    optWrap.innerHTML = `<div class="empty small"><p>Aucun contenu approuvé pour le moment.</p></div>`;
  } else {
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "list-row";
      row.innerHTML = `
        <div class="row-main">
          <span class="row-name">${escapeHtml(item.name)}</span>
          <span class="row-sub">${escapeHtml(item.description ?? "")}</span>
        </div>
        <span class="row-badge">${escapeHtml(TYPE_LABELS[item.type] ?? item.type)}</span>`;
      const btn = document.createElement("button");
      btn.className = `ghost-btn small${installed[item.id] ? " danger" : ""}`;
      btn.textContent = installed[item.id] ? "Désinstaller" : "Installer";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        if (installed[item.id]) await api.optional.uninstall(item.id);
        else {
          const ok = await api.optional.install(item.id);
          if (!ok) toast(`Échec du téléchargement de ${item.name}.`);
        }
        loadContent();
      });
      row.appendChild(btn);
      optWrap.appendChild(row);
    }
  }

  // Mes ajouts
  const rows = await api.content.list();
  const localWrap = $("#local-list");
  localWrap.textContent = "";
  if (!rows.length) {
    localWrap.innerHTML = `<div class="empty small"><p>Aucun ajout pour l'instant — tout vient du modpack.</p></div>`;
    return;
  }
  for (const row of rows) {
    const el = document.createElement("div");
    el.className = `list-row${row.blocked ? " blocked" : ""}`;
    const sourceLabel = row.source.startsWith("optional:") ? "catalogue" : SOURCE_LABELS[row.source] ?? row.source;
    el.innerHTML = `
      <div class="row-main">
        <span class="row-name">${escapeHtml(row.name)}</span>
        <span class="row-sub">${escapeHtml(TYPE_LABELS[row.type] ?? row.type)} · ${escapeHtml(sourceLabel)}${row.blocked ? ` · <strong>bloqué : ${escapeHtml(row.reason ?? "")}</strong>` : ""}</span>
      </div>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost-btn small danger";
    removeBtn.textContent = "Supprimer";
    removeBtn.addEventListener("click", async () => {
      await api.content.remove(row.path);
      loadContent();
    });
    el.appendChild(removeBtn);
    localWrap.appendChild(el);
  }
}

api.content.onUnknown((paths) => {
  toast(`${paths.length} fichier(s) hors modpack détecté(s) — voir la page Contenus.`, 5000);
  if (ui.page === "content") loadContent();
});

// Ajout de fichiers : .jar → mods ; .zip → choix resourcepack/shaderpack
$("#btn-add-files").addEventListener("click", async () => {
  const picked = await api.content.pick();
  if (!picked.length) return;
  const jars = picked.filter((p) => p.ext === ".jar").map((p) => ({ src: p.src, type: "mod" }));
  const zips = picked.filter((p) => p.ext === ".zip");

  const finish = async (zipType) => {
    const items = [...jars, ...zips.map((z) => ({ src: z.src, type: zipType }))];
    const done = await api.content.import(zipType ? items : jars);
    toast(`${done.length} fichier(s) ajouté(s).`);
    loadContent();
  };

  if (!zips.length) return finish(null);
  $("#zip-desc").textContent = zips.map((z) => z.name).join(", ");
  $("#zip-modal").hidden = false;
  $("#zip-rp").onclick = () => { $("#zip-modal").hidden = true; finish("resourcepack"); };
  $("#zip-sp").onclick = () => { $("#zip-modal").hidden = true; finish("shaderpack"); };
  $("#zip-cancel").onclick = () => { $("#zip-modal").hidden = true; if (jars.length) finish(null); };
});

/* ── Blocklist (CDC F6) ────────────────────────────────────── */
let blockedPaths = [];
api.content.onBlocklistHit((matches) => {
  blockedPaths = matches.map((m) => m.path);
  const list = $("#block-list");
  list.innerHTML = matches
    .map((m) => `<div class="modal-row"><strong>${escapeHtml(m.name)}</strong><span>${escapeHtml(m.reason)}</span></div>`)
    .join("");
  $("#block-modal").hidden = false;
});
$("#block-cancel").addEventListener("click", () => { $("#block-modal").hidden = true; });
$("#block-delete").addEventListener("click", async () => {
  await api.content.deleteBlocked(blockedPaths);
  $("#block-modal").hidden = true;
  toast("Fichiers supprimés — nouveau lancement…");
  onPlayClickForce();
});
function onPlayClickForce() {
  $("#btn-play").dataset.action = "play";
  onPlayClick();
}

/* ── Volet Téléchargements (CDC F10) ───────────────────────── */
const drawer = $("#drawer");
$("#btn-drawer").addEventListener("click", () => drawer.classList.toggle("open"));
$("#drawer-close").addEventListener("click", () => drawer.classList.remove("open"));
$("#dl-pause").addEventListener("click", () => api.downloads.pause());
$("#dl-resume").addEventListener("click", () => api.downloads.resume());
$("#dl-retry").addEventListener("click", async () => {
  drawer.classList.add("open");
  await api.downloads.retry();
});

let drawerAutoOpened = false;
api.downloads.onUpdate((snapshot) => {
  ui.downloads = snapshot;
  const active = snapshot.active || snapshot.interrupted;
  $("#drawer-dot").hidden = !snapshot.active;
  $("#dl-empty").hidden = active || snapshot.files.length > 0;
  $("#dl-active").hidden = !(active || snapshot.files.length > 0);

  if (snapshot.active && !drawerAutoOpened) {
    drawer.classList.add("open"); // ouverture automatique (CDC F10)
    drawerAutoOpened = true;
  }
  if (!snapshot.active && !snapshot.interrupted) drawerAutoOpened = false;

  $("#dl-label").textContent = snapshot.label || "Téléchargements";
  $("#dl-bar-fill").style.width = `${snapshot.global.percent}%`;
  $("#dl-percent").textContent = `${snapshot.global.percent} %`;
  $("#dl-size").textContent = `${fmtBytes(snapshot.global.doneBytes)} / ${fmtBytes(snapshot.global.totalBytes)}`;
  $("#dl-speed").textContent = fmtSpeed(snapshot.global.speedBps);
  $("#dl-elapsed").textContent = fmtDuration(snapshot.global.elapsedS);
  $("#dl-eta").textContent = snapshot.paused ? "en pause" : fmtDuration(snapshot.global.etaS);

  $("#dl-pause").hidden = !snapshot.active || snapshot.paused;
  $("#dl-resume").hidden = !snapshot.paused;
  $("#dl-retry").hidden = !snapshot.interrupted;
  $("#dl-interrupted").hidden = !snapshot.interrupted;

  const files = $("#dl-files");
  files.textContent = "";
  for (const file of snapshot.files) {
    const pct = file.size ? Math.floor((file.done / file.size) * 100) : (file.state === "terminé" ? 100 : 0);
    const row = document.createElement("div");
    row.className = `dl-file ${file.state === "erreur" ? "error" : ""}`;
    row.innerHTML = `
      <span class="dl-file-name">${escapeHtml(file.name)}</span>
      <span class="dl-file-state num">${file.state === "en cours" ? pct + " %" : escapeHtml(file.state)}</span>`;
    files.appendChild(row);
  }
});

/* ── Comptes Microsoft (CDC F2) ────────────────────────────── */
const avatarLetter = (name) => (name || "?").charAt(0).toUpperCase();

function renderAccounts(list) {
  ui.accounts = list;
  const activeAny = list.find((a) => a.active) || null;

  $("#account-name").textContent = activeAny ? activeAny.name : "Non connecté";
  $("#account-hint").textContent = activeAny
    ? (activeAny.needsRelogin ? "Reconnexion requise" : "Compte actif")
    : (list.length ? "Aucun compte actif" : "Aucun compte");
  $("#account-avatar").textContent = activeAny ? avatarLetter(activeAny.name) : "";

  const wrap = $("#accounts-list");
  wrap.textContent = "";
  if (!list.length) {
    wrap.innerHTML = `<div class="empty small"><p>Aucun compte pour l'instant.</p></div>`;
  }
  list.forEach((account) => {
    const row = document.createElement("div");
    row.className = "account-row";
    const avatar = document.createElement("div");
    avatar.className = "row-avatar";
    avatar.textContent = avatarLetter(account.name);
    const meta = document.createElement("div");
    meta.className = "row-meta";
    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = account.name;
    meta.appendChild(name);
    if (account.needsRelogin) {
      const badge = document.createElement("span");
      badge.className = "row-badge warn";
      badge.textContent = "Reconnexion requise";
      meta.appendChild(badge);
    } else if (account.active) {
      const badge = document.createElement("span");
      badge.className = "row-badge ok";
      badge.textContent = "Actif";
      meta.appendChild(badge);
    }
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (!account.active) {
      const useBtn = document.createElement("button");
      useBtn.className = "ghost-btn small";
      useBtn.textContent = "Utiliser";
      useBtn.addEventListener("click", () => api.accounts.select(account.uuid));
      actions.appendChild(useBtn);
    }
    const removeBtn = document.createElement("button");
    removeBtn.className = "ghost-btn small danger";
    removeBtn.textContent = "Retirer";
    removeBtn.addEventListener("click", () => api.accounts.remove(account.uuid));
    actions.appendChild(removeBtn);
    row.append(avatar, meta, actions);
    wrap.appendChild(row);
  });
  refreshPlayButton();
}

async function addAccount(button) {
  const btn = button ?? $("#btn-add-account");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Fenêtre Microsoft ouverte…";
  try {
    const result = await api.accounts.add();
    if (result.ok) toast(`Bienvenue, ${result.name} !`);
    else if (result.reason === "cancelled") toast("Connexion annulée.");
    else toast(`Connexion impossible : ${result.reason}`, 6000);
    return result;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
$("#btn-add-account").addEventListener("click", () => addAccount());
api.accounts.onChanged(renderAccounts);

/* ── Paramètres (CDC F13) ──────────────────────────────────── */
const ramSlider = $("#ram-slider");
const ramValue = $("#ram-value");

function applyRamBounds(slider, totalRamGb) {
  slider.min = 4;
  slider.max = Math.max(6, totalRamGb - 4); // bornes : 4 Go → RAM − 4 (CDC F13)
}
ramSlider.addEventListener("input", () => { ramValue.textContent = `${ramSlider.value} Go`; });
ramSlider.addEventListener("change", () => api.settings.set({ ramGb: Number(ramSlider.value) }));

$("#btn-fullcheck").addEventListener("click", async () => {
  drawer.classList.add("open");
  toast("Vérification complète des fichiers…");
  const result = await api.syncOps.fullCheck();
  toast(result.ok ? "Tous les fichiers sont vérifiés." : "Vérification incomplète — voir le volet.");
});

$("#btn-migrate").addEventListener("click", async () => {
  toast("Choisis le nouveau dossier — la copie peut prendre du temps…", 6000);
  const result = await api.settings.migrate();
  if (!result.ok && result.reason !== "cancelled") toast(`Migration impossible : ${result.reason}`, 6000);
});

$("#btn-check-update").addEventListener("click", async () => {
  await api.updater.check();
  toast("Recherche de mise à jour lancée.");
});

/* ── Désinstallation complète (Zone dangereuse) ────────────── */
$("#btn-uninstall").addEventListener("click", () => { $("#uninstall-modal").hidden = false; });
$("#uninstall-cancel").addEventListener("click", () => { $("#uninstall-modal").hidden = true; });
$("#uninstall-confirm").addEventListener("click", async () => {
  const btn = $("#uninstall-confirm");
  btn.disabled = true;
  btn.textContent = "Suppression en cours…";
  const result = await api.app.uninstall();
  if (!result.ok) {
    btn.disabled = false;
    btn.textContent = "Tout supprimer";
    $("#uninstall-modal").hidden = true;
    if (result.reason === "game-running") toast("Ferme d'abord Minecraft avant de désinstaller.", 6000);
  }
  // Si ok : le processus principal ferme le launcher (et lance le désinstalleur en version installée)
});

/* ── Premier lancement (CDC F1) ────────────────────────────── */
function showObStep(step) {
  $$(".ob-step").forEach((el) => { el.hidden = el.dataset.step !== String(step); });
}

async function maybeOnboard(settings, info) {
  if (settings.onboarded) return;
  const overlay = $("#onboarding");
  overlay.hidden = false;
  showObStep(1);
  $("#ob-dir").textContent = info.dataDir;
  const obSlider = $("#ob-ram-slider");
  applyRamBounds(obSlider, info.totalRamGb);
  const recommended = Math.min(12, Math.max(4, Math.floor(info.totalRamGb / 2)));
  obSlider.value = recommended;
  $("#ob-ram-value").textContent = `${recommended} Go`;
  obSlider.addEventListener("input", () => { $("#ob-ram-value").textContent = `${obSlider.value} Go`; });

  let step = 1;
  $$(".ob-next").forEach((btn) =>
    btn.addEventListener("click", () => { step += 1; if (step === 4) buildRecap(); showObStep(step); })
  );
  $("#ob-add-account").addEventListener("click", async () => {
    const result = await addAccount($("#ob-add-account"));
    if (result?.ok) { step = 3; showObStep(3); }
  });
  function buildRecap() {
    const account = ui.accounts.find((a) => a.active);
    $("#ob-recap").textContent =
      `Compte : ${account ? account.name : "à connecter plus tard"} · Mémoire : ${obSlider.value} Go. ` +
      "Le launcher va maintenant vérifier les fichiers du modpack.";
  }
  $("#ob-finish").addEventListener("click", async () => {
    await api.settings.set({ onboarded: true, ramGb: Number(obSlider.value) });
    ramSlider.value = obSlider.value;
    ramValue.textContent = `${obSlider.value} Go`;
    overlay.hidden = true;
    drawer.classList.add("open");
    const result = await api.syncOps.fullCheck(); // première synchro (CDC F1)
    toast(result.ok ? "Fichiers du modpack prêts !" : "Synchronisation incomplète — voir le volet.");
  });
}

/* ── Initialisation ────────────────────────────────────────── */
(async function init() {
  api.app.version().then((v) => { $("#app-version").textContent = `v${v}`; });

  const [settings, info, accountList] = await Promise.all([
    api.settings.get(),
    api.app.systemInfo(),
    api.accounts.list(),
  ]);

  applyRamBounds(ramSlider, info.totalRamGb);
  const recommended = Math.min(12, Math.max(4, Math.floor(info.totalRamGb / 2)));
  const ram = Number(settings.ramGb) || recommended;
  ramSlider.value = ram;
  ramValue.textContent = `${ram} Go`;
  $("#ram-hint").textContent = `Recommandé : ${recommended} Go`;
  $("#data-dir-path").textContent = info.dataDir;

  renderAccounts(accountList);
  await loadRemoteConfig();
  refreshStatus();
  refreshNewsBadge();
  maybeOnboard(settings, info);
  refreshPlayButton();
})();
