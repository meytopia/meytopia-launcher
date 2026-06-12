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
  document.body.dataset.page = id;
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
$("#btn-max").addEventListener("click", () => api.window.maximizeToggle());
$("#titlebar").addEventListener("dblclick", (event) => {
  if (event.target.closest("button")) return;
  api.window.maximizeToggle();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "F11") { event.preventDefault(); api.window.fullscreenToggle(); }
});
api.window.onState(({ maximized, fullscreen }) => {
  $("#ico-max").hidden = maximized;
  $("#ico-restore").hidden = !maximized;
  $("#btn-max").title = maximized ? "Restaurer" : "Agrandir";
  document.body.classList.toggle("fullscreen", fullscreen);
});

/* ── Thème sombre / clair / système (C1) ───────────────────── */
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");
let themePref = "dark";
function applyTheme(pref) {
  themePref = pref;
  const resolved = pref === "system" ? (systemThemeQuery.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = resolved;
  $$(".theme-opt").forEach((b) => b.classList.toggle("active", b.dataset.themeVal === pref));
}
systemThemeQuery.addEventListener("change", () => { if (themePref === "system") applyTheme("system"); });
$$(".theme-opt").forEach((btn) =>
  btn.addEventListener("click", () => {
    applyTheme(btn.dataset.themeVal);
    api.settings.set({ theme: btn.dataset.themeVal });
  })
);

/* ── Confettis (D6) ────────────────────────────────────────── */
function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#8B5CF6", "#D946EF", "#10B981", "#F59E0B", "#3B82F6", "#FFFFFF"];
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${(Math.random() * 100).toFixed(1)}vw`;
    piece.style.background = colors[i % colors.length];
    document.body.appendChild(piece);
    const fall = piece.animate(
      [
        { transform: "translateY(0) rotate(0deg)", opacity: 1 },
        { transform: `translateY(${72 + Math.random() * 26}vh) rotate(${380 + Math.random() * 520}deg)`, opacity: 0 },
      ],
      { duration: 1400 + Math.random() * 1200, easing: "cubic-bezier(.2,.7,.3,1)", delay: Math.random() * 260 },
    );
    fall.onfinish = () => piece.remove();
  }
}

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
  } else if (minVersionBlocked()) {
    set("Mise à jour requise", `Version minimale : v${ui.remoteConfig.minLauncherVersion}`, false);
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
  renderUpdateLine();
  renderUpdatePopup();
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

  renderEventBanner(config);
  loadPackInfo();
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

  // Accent global pilotable depuis meytopia-data (evenements, saisons) — D5
  const remoteAccent = config?.theme?.accent;
  if (typeof remoteAccent === "string" && /^#[0-9a-fA-F]{6}$/.test(remoteAccent)) {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--accent", remoteAccent);
    rootStyle.setProperty("--accent-hover", `color-mix(in srgb, ${remoteAccent} 82%, white)`);
    rootStyle.setProperty("--accent-deep", `color-mix(in srgb, ${remoteAccent} 78%, black)`);
    rootStyle.setProperty("--accent-soft", `color-mix(in srgb, ${remoteAccent} 14%, transparent)`);
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
  const playersEl = $("#st-players");
  const playersText = status.online ? `${status.playersOnline}\u2009/\u2009${status.playersMax}` : "—\u2009/\u2009—";
  if (status.online && playersEl.textContent !== playersText && playersEl.textContent.trim() !== "") {
    playersEl.classList.remove("stat-pop");
    void playersEl.offsetWidth; // relance l'animation
    playersEl.classList.add("stat-pop");
  }
  playersEl.textContent = playersText;
  $("#st-version").textContent = status.online ? status.version ?? "—" : "—";
  const pingEl = $("#st-ping");
  pingEl.textContent = status.online ? `${status.ms} ms` : "—";
  pingEl.classList.remove("ping-good", "ping-mid", "ping-bad");
  if (status.online) {
    pingEl.classList.add(status.ms < 60 ? "ping-good" : status.ms < 120 ? "ping-mid" : "ping-bad");
  }

  const toggle = $("#players-toggle");
  const list = $("#players-list");
  if (status.online && Array.isArray(status.players)) {
    toggle.disabled = false;
    toggle.textContent = playersVisible ? "Masquer les joueurs" : "Voir les joueurs connectés";
    list.hidden = !playersVisible;
    renderPlayerChips(list, status.players);
  } else {
    toggle.disabled = true;
    toggle.textContent = status.online ? "Liste des joueurs indisponible (query désactivé)" : "Voir les joueurs connectés";
    list.hidden = true;
    playersVisible = false;
  }

  // Pastilles « Amis » : recalculées seulement quand la liste en ligne change
  const next = status.online && Array.isArray(status.players)
    ? [...new Set(status.players.map((p) => String(p).toLowerCase()))]
    : [];
  const key = next.sort().join(",");
  if (key !== renderStatus._friendsKey) {
    renderStatus._friendsKey = key;
    onlineNames = new Set(next);
    renderFriends();
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

  let stagger = 0;
  for (const item of sorted) {
    const card = document.createElement("article");
    card.className = `news-card${read.has(item.id) ? "" : " unread"}`;
    card.dataset.id = item.id;
    card.style.animationDelay = `${Math.min(stagger++ * 55, 440)}ms`;
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
$("#btn-drawer").addEventListener("click", () => {
  clearTimeout(drawerCloseTimer);
  drawer.classList.toggle("open");
});
$("#drawer-close").addEventListener("click", () => drawer.classList.remove("open"));
$("#dl-pause").addEventListener("click", () => api.downloads.pause());
$("#dl-resume").addEventListener("click", () => api.downloads.resume());
$("#dl-retry").addEventListener("click", async () => {
  drawer.classList.add("open");
  await api.downloads.retry();
});

let drawerAutoOpened = false;
let drawerCloseTimer = null;
let drawerWasActive = false;
api.downloads.onUpdate((snapshot) => {
  ui.downloads = snapshot;
  // Fermeture automatique : 4 s apres la fin d'une file (sauf interruption)
  if (snapshot.active || snapshot.interrupted) {
    clearTimeout(drawerCloseTimer);
    drawerCloseTimer = null;
  } else if (drawerWasActive && drawer.classList.contains("open")) {
    clearTimeout(drawerCloseTimer);
    drawerCloseTimer = setTimeout(() => drawer.classList.remove("open"), 4000);
  }
  drawerWasActive = snapshot.active;
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

/** Avatar Minecraft : la tête du joueur par-dessus l'initiale (repli automatique hors ligne). */
function setMcAvatar(el, account) {
  el.textContent = account ? avatarLetter(account.name) : "";
  if (!account?.uuid && !account?.name) return;
  const img = document.createElement("img");
  img.className = "avatar-img";
  img.alt = "";
  img.src = account.uuid
    ? `https://crafatar.com/avatars/${encodeURIComponent(account.uuid)}?size=64&overlay`
    : `https://mc-heads.net/avatar/${encodeURIComponent(account.name)}/64`;
  img.addEventListener("error", () => img.remove());
  el.appendChild(img);
}

/** Joueurs connectés : chips avec leur tête Minecraft. */
function renderPlayerChips(container, players) {
  container.textContent = "";
  if (!players.length) {
    container.textContent = "Personne en ligne pour le moment — sois le premier !";
    return;
  }
  for (const name of players) {
    const chip = document.createElement("span");
    chip.className = "player-chip";
    const img = document.createElement("img");
    img.alt = "";
    img.src = `https://mc-heads.net/avatar/${encodeURIComponent(name)}/24`;
    img.addEventListener("error", () => img.remove());
    const label = document.createElement("span");
    label.textContent = name;
    chip.append(img, label);
    container.appendChild(chip);
  }
}

/** Salutation personnalisée de l'Accueil. */
function updateGreeting() {
  const el = $("#hero-greeting");
  if (!el) return;
  const active = ui.accounts.find((a) => a.active);
  const h = new Date().getHours();
  const hello = h < 6 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  el.textContent = active
    ? `${hello} ${active.name}, prêt pour l'aventure ?`
    : `${hello} ! Connecte un compte pour rejoindre l'aventure.`;
}

/** Étincelles pixel discrètes sur l'Accueil (clin d'œil au fond du logo). */
function injectSparks() {
  const hero = document.querySelector(".hero");
  if (!hero || hero.querySelector(".spark")) return;
  for (let i = 0; i < 12; i++) {
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.left = `${(Math.random() * 96 + 2).toFixed(1)}%`;
    spark.style.top = `${(Math.random() * 92 + 4).toFixed(1)}%`;
    spark.style.animationDelay = `${(Math.random() * 6).toFixed(2)}s`;
    hero.appendChild(spark);
  }
}

function renderAccounts(list) {
  ui.accounts = list;
  const activeAny = list.find((a) => a.active) || null;

  $("#account-name").textContent = activeAny ? activeAny.name : "Non connecté";
  $("#account-hint").textContent = activeAny
    ? (activeAny.needsRelogin ? "Reconnexion requise" : "Compte actif")
    : (list.length ? "Aucun compte actif" : "Aucun compte");
  setMcAvatar($("#account-avatar"), activeAny);

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
    setMcAvatar(avatar, account);
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
  updateGreeting();
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

const autoJoinToggle = $("#autojoin-toggle");
autoJoinToggle.addEventListener("change", () => api.settings.set({ autoJoin: autoJoinToggle.checked }));

const minimizeToggle = $("#minimize-toggle");
minimizeToggle.addEventListener("change", () => api.settings.set({ minimizeOnPlay: minimizeToggle.checked }));

const notifyToggle = $("#notify-toggle");
notifyToggle.addEventListener("change", () => api.settings.set({ notifyServerBack: notifyToggle.checked }));

const betaToggle = $("#beta-toggle");
const betaCodeRow = $("#beta-code-row");
let betaUnlockedHash = null; // empreinte du code déjà validé (settings.betaUnlocked)

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Empreinte attendue, publiée dans launcher.json (betaCodeHash). Vide = canal libre. */
function betaGate() {
  return String(ui.remoteConfig?.betaCodeHash || "").toLowerCase();
}
betaToggle.addEventListener("change", () => {
  const gate = betaGate();
  if (betaToggle.checked && gate && betaUnlockedHash !== gate) {
    betaToggle.checked = false;
    betaCodeRow.hidden = false;
    $("#beta-code-input").focus();
    return;
  }
  betaCodeRow.hidden = true;
  api.settings.set({ betaChannel: betaToggle.checked });
  toast(betaToggle.checked
    ? "Canal bêta activé — pris en compte à la prochaine vérification (≤ 1 min)."
    : "Retour au canal stable.");
});
async function unlockBeta() {
  const input = $("#beta-code-input");
  const value = input.value.trim();
  if (!value) return;
  const hash = await sha256Hex(value);
  if (hash === betaGate()) {
    betaUnlockedHash = hash;
    api.settings.set({ betaUnlocked: hash, betaChannel: true });
    betaToggle.checked = true;
    betaCodeRow.hidden = true;
    input.value = "";
    toast("Code accepté — canal bêta déverrouillé. Bienvenue chez les aventuriers !");
  } else {
    toast("Code incorrect.");
  }
}
$("#beta-code-btn").addEventListener("click", unlockBeta);
$("#beta-code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") unlockBeta(); });

/* ── Amis à suivre (J4) ────────────────────────────────────── */
let friendsList = [];
let onlineNames = new Set(); // joueurs actuellement en ligne (alimenté par le statut serveur)
function renderFriends() {
  const wrap = $("#friends-list");
  wrap.textContent = "";
  for (const name of friendsList) {
    const chip = document.createElement("span");
    chip.className = "friend-chip";
    const dot = document.createElement("span");
    const isOn = onlineNames.has(name.toLowerCase());
    dot.className = "friend-dot" + (isOn ? " online" : "");
    dot.title = isOn ? "En ligne sur le serveur" : "Hors ligne";
    const label = document.createElement("span");
    label.textContent = name;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Ne plus suivre";
    del.addEventListener("click", () => {
      friendsList = friendsList.filter((f) => f !== name);
      api.settings.set({ friends: friendsList });
      renderFriends();
    });
    chip.append(dot, label, del);
    wrap.appendChild(chip);
  }
}
function addFriend() {
  const input = $("#friend-input");
  const name = input.value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { toast("Pseudo Minecraft invalide."); return; }
  if (!friendsList.some((f) => f.toLowerCase() === name.toLowerCase())) {
    friendsList = [...friendsList, name];
    api.settings.set({ friends: friendsList });
    renderFriends();
  }
  input.value = "";
}
$("#friend-add-btn").addEventListener("click", addFriend);
$("#friend-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addFriend(); });

/* ── Easter egg : le troupeau (L3) ─────────────────────────── */
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
let konamiStep = 0;
window.addEventListener("keydown", (e) => {
  konamiStep = e.key === KONAMI[konamiStep] ? konamiStep + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (konamiStep === KONAMI.length) { konamiStep = 0; sheepRain(); }
});
function sheepRain() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 26; i++) {
    const sheep = document.createElement("span");
    sheep.className = "sheep-piece";
    sheep.textContent = "🐑";
    sheep.style.left = `${(Math.random() * 96).toFixed(1)}vw`;
    sheep.style.fontSize = `${Math.round(20 + Math.random() * 18)}px`;
    document.body.appendChild(sheep);
    const fall = sheep.animate(
      [
        { transform: "translateY(0) rotate(-12deg)" },
        { transform: `translateY(105vh) rotate(${Math.round(Math.random() * 60 - 30)}deg)` },
      ],
      { duration: 2400 + Math.random() * 1800, easing: "ease-in", delay: Math.random() * 700 },
    );
    fall.onfinish = () => sheep.remove();
  }
  toast("Bêêê ! 🐑");
}

api.window.onTrayPlay(() => onPlayClick());

$("#btn-fullcheck").addEventListener("click", async () => {
  drawer.classList.add("open");
  toast("Vérification complète des fichiers…");
  const result = await api.syncOps.fullCheck();
  if (result.reason === "disk") {
    toast(`Espace disque insuffisant : ${result.freeGb} Go libres, ~${result.neededGb} Go nécessaires.`, 8000);
  } else {
    toast(result.ok ? "Tous les fichiers sont vérifiés." : "Vérification incomplète — voir le volet.");
  }
  if (result.ok && result.downloaded === 0) {
    drawerCloseTimer = setTimeout(() => drawer.classList.remove("open"), 2500);
  }
});

$("#btn-migrate").addEventListener("click", async () => {
  toast("Choisis le nouveau dossier — la copie peut prendre du temps…", 6000);
  const result = await api.settings.migrate();
  if (!result.ok && result.reason !== "cancelled") toast(`Migration impossible : ${result.reason}`, 6000);
});

let appVersion = "";

/** Ligne d'état des mises à jour (À propos) : à jour / en cours / hors ligne… */
function renderUpdateLine() {
  const dot = $("#update-dot");
  const text = $("#update-text");
  const btn = $("#btn-check-update");
  if (!dot || !text) return;
  const u = ui.updater ?? {};
  let cls = "idle";
  let msg = "En attente de vérification…";
  let disabled = false;
  if (!navigator.onLine) {
    msg = "Hors ligne — vérification impossible";
    disabled = true;
  } else if (u.state === "dev") {
    msg = "Indisponible en mode développement";
    disabled = true;
  } else if (u.state === "checking") {
    cls = "warn"; msg = "Vérification en cours…"; disabled = true;
  } else if (u.state === "available" || u.state === "downloading") {
    cls = "warn"; msg = `Mise à jour ${u.newVersion ? `v${u.newVersion} ` : ""}trouvée — téléchargement ${u.percent ?? 0} %`;
  } else if (u.state === "ready") {
    cls = "accent"; msg = `Mise à jour ${u.newVersion ? `v${u.newVersion} ` : ""}prête — redémarre pour l'installer`;
  } else if (u.state === "error") {
    cls = "err"; msg = "Erreur de téléchargement — nouvel essai au prochain démarrage";
  } else if (u.checkError) {
    cls = "err"; msg = "Vérification impossible — GitHub injoignable";
  } else if (u.checkedAt) {
    cls = "ok"; msg = `Vous êtes sur la dernière version${appVersion ? ` (v${appVersion})` : ""}`;
  }
  dot.className = `update-dot ${cls}`;
  text.textContent = msg;
  void disabled;
  btn.disabled = true; // vérification automatique chaque minute : le bouton devient un témoin
  btn.textContent = u.state === "dev" ? "Indisponible (dev)" : "Automatique — 1 min";
}

/** Le launcher est-il sous la version minimale exigée à distance ? (I8) */
function minVersionBlocked() {
  const min = ui.remoteConfig?.minLauncherVersion;
  if (!min || !appVersion) return false;
  const pa = appVersion.split(".").map(Number);
  const pb = String(min).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); }
  return false;
}

/** Compte à rebours lisible : « 2 j 4 h », « 3 h 05 min », « 12 min ». */
function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${Math.max(1, m)} min`;
}

/** Bannière Événement pilotée par launcher.json (I3) + compte à rebours (J3). */
function renderEventBanner(config) {
  const banner = $("#event-banner");
  const ev = config?.event;
  if (!ev || (!ev.title && !ev.message)) { banner.hidden = true; return; }
  const now = Date.now();
  const start = ev.startsAt ? Date.parse(ev.startsAt) : null;
  const end = ev.endsAt ? Date.parse(ev.endsAt) : null;
  let phase = null;
  if (start && now < start) phase = "pre";
  else if ((!start || now >= start) && (!end || now <= end)) phase = "live";
  if (!phase) { banner.hidden = true; return; }
  const key = `${ev.id ?? `${ev.title ?? ""}|${ev.startsAt ?? ""}`}#${phase}`;
  if (key === ui.dismissedEventKey) { banner.hidden = true; return; }
  $("#event-title").textContent = ev.title ?? "Événement";
  const extra = phase === "pre"
    ? ` — commence dans ${fmtCountdown(start - now)}`
    : (end ? ` — se termine dans ${fmtCountdown(end - now)}` : "");
  $("#event-msg").textContent = `${ev.message ?? ""}${extra}`;
  if (typeof ev.color === "string" && /^#[0-9a-fA-F]{6}$/.test(ev.color)) {
    banner.style.setProperty("--event-color", ev.color);
  } else {
    banner.style.removeProperty("--event-color");
  }
  const link = $("#event-link");
  link.hidden = !ev.url;
  link.onclick = ev.url ? () => api.app.openExternal(ev.url) : null;
  $("#event-close").onclick = () => {
    ui.dismissedEventKey = key;
    api.settings.set({ dismissedEventKey: key });
    banner.hidden = true;
  };
  banner.hidden = false;
}
setInterval(() => { if (ui.remoteConfig) renderEventBanner(ui.remoteConfig); }, 30000);

/* ── Popup de mise à jour : l'anneau Meytopia ──────────────── */
const RING_CIRC = 289.03; // 2πr, r = 46
function renderUpdatePopup() {
  const pop = $("#update-popup");
  if (!pop) return;
  const u = ui.updater ?? {};
  const visible = ["available", "downloading", "ready"].includes(u.state);
  pop.hidden = !visible;
  if (!visible) { pop.classList.remove("done"); return; }
  const pct = u.state === "ready" ? 100 : Math.max(0, Math.min(100, u.percent ?? 0));
  $("#ring-bar").style.strokeDashoffset = String(RING_CIRC * (1 - pct / 100));
  $("#ring-tip-rot").style.transform = `rotate(${(pct * 3.6).toFixed(1)}deg)`;
  $("#up-percent").textContent = String(pct);
  const label = u.newVersion ? `v${u.newVersion}` : "du launcher";
  if (u.state === "ready") {
    pop.classList.add("done");
    $("#up-step").textContent = `Mise à jour ${label} prête !`;
    $("#up-meta").textContent = "Un clic, deux secondes, et c'est tout neuf.";
  } else {
    pop.classList.remove("done");
    $("#up-step").textContent = u.state === "available"
      ? `Préparation de la mise à jour ${label}…`
      : `Téléchargement de la mise à jour ${label}…`;
    const hasSpeed = (u.bytesPerSecond ?? 0) > 0;
    const eta = hasSpeed && u.total > u.transferred
      ? fmtDuration(Math.round((u.total - u.transferred) / u.bytesPerSecond))
      : null;
    $("#up-meta").textContent = hasSpeed
      ? `${fmtSpeed(u.bytesPerSecond)}${eta ? ` · ~${eta} restantes` : ""}`
      : "Connexion au serveur de mises à jour…";
  }
  $("#up-restart").hidden = u.state !== "ready";
}
$("#up-restart").addEventListener("click", () => api.updater.install());

/** En-tête de la page Contenus : version, fichiers, taille du pack (J5). */
async function loadPackInfo() {
  const el = $("#pack-info");
  if (!el) return;
  const info = await api.app.packInfo();
  if (!info) { el.hidden = true; return; }
  el.textContent = `Modpack ${info.version} · ${info.count} fichiers · ${fmtBytes(info.totalBytes)}`;
  el.hidden = false;
}

window.addEventListener("online", () => {
  renderUpdateLine();
  api.updater.check();
  if (ui.downloads?.interrupted) {
    drawer.classList.add("open");
    toast("Connexion rétablie — clique sur Reprendre pour relancer le téléchargement.", 6000);
  }
});
window.addEventListener("offline", renderUpdateLine);

$("#btn-debug-info").addEventListener("click", async () => {
  const d = await api.app.debugInfo();
  const text = [
    `Meytopia Launcher v${d.launcher}`,
    `Modpack ${d.pack} — Minecraft ${d.mc} (${d.loader})`,
    `Windows ${d.windows} — RAM ${d.ramGb} Go allouée / ${d.ramTotalGb} Go au total`,
    `Thème ${d.theme} — Connexion auto au serveur : ${d.autoJoin ? "oui" : "non"}`,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Infos copiées — colle-les sur le Discord pour obtenir de l'aide.");
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
    if (result.reason === "disk") {
      toast(`Espace disque insuffisant : ${result.freeGb} Go libres, ~${result.neededGb} Go nécessaires.`, 8000);
    } else {
      toast(result.ok ? "Fichiers du modpack prêts !" : "Synchronisation incomplète — voir le volet.");
    }
    if (result.ok) launchConfetti();
  });
}

/** « Quoi de neuf » : patchnotes de la version fraîchement installée (I13). */
async function showWhatsNew(version) {
  try {
    const res = await api.changelog.list();
    const entries = res?.data?.entries ?? res?.entries ?? [];
    const entry = entries.find((e) => e.target === "launcher" && e.version === version);
    if (!entry?.changes?.length) return;
    $("#whatsnew-title").textContent = `Quoi de neuf — v${version}`;
    const list = $("#whatsnew-list");
    list.textContent = "";
    for (const change of entry.changes) {
      const li = document.createElement("li");
      li.textContent = change;
      list.appendChild(li);
    }
    $("#whatsnew-modal").hidden = false;
  } catch { /* non bloquant */ }
}
$("#whatsnew-close").addEventListener("click", () => { $("#whatsnew-modal").hidden = true; });

/* ── Initialisation ────────────────────────────────────────── */
(async function init() {
  const [settings, info, accountList] = await Promise.all([
    api.settings.get(),
    api.app.systemInfo(),
    api.accounts.list(),
  ]);

  applyTheme(settings.theme ?? "dark");
  api.updater.status().then((s) => { ui.updater = s; renderUpdateLine(); renderUpdatePopup(); refreshPlayButton(); });

  api.app.version().then((v) => {
    appVersion = v;
    $("#app-version").textContent = `v${v}`;
    renderUpdateLine();
    if (settings.lastVersion && settings.lastVersion !== v) {
      launchConfetti();
      toast(`Launcher mis à jour en v${v} !`, 5000);
      showWhatsNew(v);
    }
    if (settings.lastVersion !== v) api.settings.set({ lastVersion: v });
  });

  applyRamBounds(ramSlider, info.totalRamGb);
  const recommended = Math.min(12, Math.max(4, Math.floor(info.totalRamGb / 2)));
  const ram = Number(settings.ramGb) || recommended;
  ramSlider.value = ram;
  ramValue.textContent = `${ram} Go`;
  autoJoinToggle.checked = settings.autoJoin !== false;
  minimizeToggle.checked = settings.minimizeOnPlay === true;
  notifyToggle.checked = settings.notifyServerBack === true;
  betaToggle.checked = settings.betaChannel === true;
  betaUnlockedHash = typeof settings.betaUnlocked === "string" ? settings.betaUnlocked.toLowerCase() : null;
  friendsList = Array.isArray(settings.friends) ? settings.friends : [];
  renderFriends();
  ui.dismissedEventKey = settings.dismissedEventKey ?? null;
  $("#ram-hint").textContent = `Recommandé : ${recommended} Go`;
  $("#data-dir-path").textContent = info.dataDir;

  renderAccounts(accountList);
  injectSparks();
  await loadRemoteConfig();
  {
    const gate = betaGate();
    if (gate && betaToggle.checked && betaUnlockedHash !== gate) {
      betaToggle.checked = false;
      api.settings.set({ betaChannel: false });
      toast("Le code du canal bêta a changé — entre le nouveau code pour le réactiver.");
    }
  }
  refreshStatus();
  refreshNewsBadge();
  maybeOnboard(settings, info);
  refreshPlayButton();
})();
