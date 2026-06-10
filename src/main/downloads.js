// ============================================================
// Meytopia Launcher — Moteur de téléchargements (CDC F10, §7)
// File à 3 connexions parallèles, pause/reprise manuelle,
// écriture atomique (.part), vérification SHA-1, retentatives.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { PARALLEL_DOWNLOADS, DOWNLOAD_RETRIES } = require('./config');

let emitToRenderer = () => {};
/** Branche l'émission d'événements vers l'interface (appelé par main.js). */
function bindEmitter(fn) { emitToRenderer = fn; }

const state = {
  label: '',
  files: [],          // { name, size, done, state, url, dest, sha1, tries }
  paused: false,
  interrupted: false,
  running: false,
  startedAt: 0,
  doneBytes: 0,
  totalBytes: 0,
  lastTick: { time: 0, bytes: 0, speed: 0 },
  controllers: new Set(),
};

let waiters = []; // résolution de pause()

function snapshot() {
  const now = Date.now();
  // Vitesse lissée, recalculée toutes les ~700 ms
  if (now - state.lastTick.time > 700) {
    const deltaB = state.doneBytes - state.lastTick.bytes;
    const deltaT = (now - state.lastTick.time) / 1000;
    state.lastTick = { time: now, bytes: state.doneBytes, speed: deltaT > 0 ? deltaB / deltaT : 0 };
  }
  const remaining = state.totalBytes - state.doneBytes;
  return {
    active: state.running,
    paused: state.paused,
    interrupted: state.interrupted,
    label: state.label,
    global: {
      doneBytes: state.doneBytes,
      totalBytes: state.totalBytes,
      percent: state.totalBytes ? Math.floor((state.doneBytes / state.totalBytes) * 100) : 0,
      speedBps: state.paused ? 0 : state.lastTick.speed,
      etaS: state.lastTick.speed > 0 ? Math.round(remaining / state.lastTick.speed) : null,
      elapsedS: state.startedAt ? Math.round((now - state.startedAt) / 1000) : 0,
    },
    files: state.files.map((f) => ({ name: f.name, size: f.size, done: f.done, state: f.state })),
  };
}

let notifyTimer = null;
function notify(immediate = false) {
  if (immediate) {
    clearTimeout(notifyTimer); notifyTimer = null;
    emitToRenderer('downloads:update', snapshot());
    return;
  }
  if (notifyTimer) return; // limitation à ~4 mises à jour/seconde
  notifyTimer = setTimeout(() => { notifyTimer = null; emitToRenderer('downloads:update', snapshot()); }, 250);
}

const sha1File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha1');
  fs.createReadStream(file)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolve(hash.digest('hex')))
    .on('error', reject);
});

async function waitIfPaused() {
  while (state.paused) await new Promise((resolve) => waiters.push(resolve));
}

async function downloadOne(job) {
  job.state = 'en cours';
  notify();
  const partPath = `${job.dest}.part`;
  fs.mkdirSync(path.dirname(job.dest), { recursive: true });

  const controller = new AbortController();
  state.controllers.add(controller);
  try {
    const res = await fetch(job.url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const out = fs.createWriteStream(partPath);
    const counter = new (require('stream').Transform)({
      transform(chunk, _enc, cb) {
        job.done += chunk.length;
        state.doneBytes += chunk.length;
        notify();
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, out);

    // Intégrité : SHA-1 vérifié après chaque téléchargement (CDC §7)
    if (job.sha1) {
      const hash = await sha1File(partPath);
      if (hash.toLowerCase() !== job.sha1.toLowerCase()) throw new Error('SHA-1 invalide');
    }
    fs.renameSync(partPath, job.dest); // écriture atomique
    job.state = 'terminé';
    notify();
  } finally {
    state.controllers.delete(controller);
    fs.rmSync(partPath, { force: true });
  }
}

/**
 * Exécute une file de téléchargements. Résout true si tout est terminé,
 * false si la file a été interrompue (coupure réseau → reprise manuelle, CDC F10).
 * @param {string} label  Titre affiché dans le volet (ex. « Modpack 1.0.0 »)
 * @param {Array<{name,url,dest,size,sha1?}>} jobs
 */
async function run(label, jobs) {
  state.label = label;
  state.files = jobs.map((j) => ({ ...j, done: 0, state: 'en attente', tries: 0 }));
  state.paused = false;
  state.interrupted = false;
  state.running = true;
  state.startedAt = Date.now();
  state.doneBytes = 0;
  state.totalBytes = jobs.reduce((sum, j) => sum + (j.size || 0), 0);
  state.lastTick = { time: Date.now(), bytes: 0, speed: 0 };
  notify(true);

  let failed = false;
  const queue = [...state.files];

  async function worker() {
    while (queue.length && !state.interrupted) {
      await waitIfPaused();
      const job = queue.shift();
      if (!job) return;
      try {
        await downloadOne(job);
      } catch {
        state.doneBytes -= job.done; // on retire les octets partiels du compteur global
        job.done = 0;
        if (job.tries < DOWNLOAD_RETRIES) {
          job.tries += 1;
          job.state = 'en attente';
          queue.push(job); // retentative (CDC §7)
        } else {
          job.state = 'erreur';
          failed = true;
          state.interrupted = true; // coupure probable → reprise manuelle
        }
      }
    }
  }

  await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
  state.running = false;
  // Recalcule les octets terminés réels (les jobs en erreur sont à 0)
  state.doneBytes = state.files.reduce((sum, f) => sum + (f.state === 'terminé' ? f.size || f.done : 0), 0);
  notify(true);
  return !failed && !state.interrupted;
}

function pause() { state.paused = true; notify(true); }
function resume() {
  state.paused = false;
  waiters.forEach((resolve) => resolve());
  waiters = [];
  notify(true);
}

module.exports = { bindEmitter, run, pause, resume, snapshot };
