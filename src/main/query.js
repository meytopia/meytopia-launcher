// ============================================================
// Meytopia Launcher — Protocole Query (UDP, CDC F8)
// Implémentation du « full stat » GameSpy4 utilisé par
// enable-query : c'est lui qui fournit la LISTE des pseudos.
// ============================================================
const dgram = require('dgram');

const MAGIC = Buffer.from([0xfe, 0xfd]);
const SESSION = Buffer.from([0x00, 0x00, 0x00, 0x01]);

/**
 * Interroge le serveur en UDP et renvoie la liste complète des joueurs.
 * @returns {Promise<{players: string[]}>} rejette si le query est inaccessible.
 */
function queryFullStat(host, port, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let finished = false;

    const done = (err, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      err ? reject(err) : resolve(value);
    };

    const timer = setTimeout(() => done(new Error('query timeout')), timeoutMs);
    socket.on('error', (err) => done(err));

    // 1) Handshake : on demande un jeton de défi
    const handshake = Buffer.concat([MAGIC, Buffer.from([0x09]), SESSION]);

    socket.on('message', (msg) => {
      if (msg[0] === 0x09) {
        // Réponse au handshake : jeton en ASCII terminé par \0
        const token = parseInt(msg.toString('ascii', 5, msg.length - 1), 10);
        const tokenBuf = Buffer.alloc(4);
        tokenBuf.writeInt32BE(token);
        // 2) Full stat : type 0x00 + session + jeton + padding 4 octets
        const fullStat = Buffer.concat([
          MAGIC, Buffer.from([0x00]), SESSION, tokenBuf, Buffer.alloc(4),
        ]);
        socket.send(fullStat, port, host);
      } else if (msg[0] === 0x00) {
        // Réponse full stat : ... \x00\x01player_\x00\x00 <noms\0...> \0\0
        const marker = Buffer.from('\x00\x01player_\x00\x00', 'binary');
        const idx = msg.indexOf(marker);
        if (idx === -1) return done(null, { players: [] });
        const names = msg
          .toString('utf8', idx + marker.length)
          .split('\u0000')
          .filter((n) => n.length > 0);
        done(null, { players: names });
      }
    });

    socket.send(handshake, port, host, (err) => {
      if (err) done(err);
    });
  });
}

module.exports = { queryFullStat };
