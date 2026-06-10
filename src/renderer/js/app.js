// ============================================================
// Meytopia Launcher — Interface (P1)
// Navigation, volet téléchargements, contrôles de fenêtre.
// ============================================================
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ── Navigation entre les pages ────────────────────────────── */
function showPage(id) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === `page-${id}`));
  $$(".nav-item[data-page]").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  $("#content").scrollTop = 0;
}

$$(".nav-item[data-page]").forEach((btn) => {
  btn.addEventListener("click", () => showPage(btn.dataset.page));
});

/* ── Volet Téléchargements ─────────────────────────────────── */
const drawer = $("#drawer");
$("#btn-drawer").addEventListener("click", () => drawer.classList.toggle("open"));
$("#drawer-close").addEventListener("click", () => drawer.classList.remove("open"));

/* ── Contrôles de la fenêtre sans bordure ──────────────────── */
$("#btn-min").addEventListener("click", () => window.meytopia?.window.minimize());
$("#btn-close").addEventListener("click", () => window.meytopia?.window.close());

/* ── Slider de RAM (visuel en P1, persisté en P7) ──────────── */
const ramSlider = $("#ram-slider");
const ramValue = $("#ram-value");
ramSlider.addEventListener("input", () => {
  ramValue.textContent = `${ramSlider.value} Go`;
});

/* ── Version de l'application (À propos) ───────────────────── */
window.meytopia?.app.version().then((v) => {
  $("#app-version").textContent = `v${v}`;
});

/* ── Notifications éphémères ───────────────────────────────── */
function toast(message, duration = 3200) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Actions provisoires (branchées dans les phases suivantes) */
$("#btn-play").addEventListener("click", () => {
  toast("Connexion des comptes en phase P2, lancement du jeu en phase P3.");
});

$("#btn-discord").addEventListener("click", () => {
  toast("Le lien Discord sera branché via launcher.json (phase P5).");
});
