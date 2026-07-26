'use strict';

// Extraction du texte et des propriétés d'un PDF, via poppler-utils.
//
// C'est la seule dépendance externe du projet, et elle est assumée : deviner un
// titre depuis la page 1 en JavaScript pur demanderait un décodeur FlateDecode,
// un tokenizer de content stream et une heuristique de taille de police, pour un
// résultat très inférieur. `pdftotext` fait ça depuis vingt ans.
//
// Tout ici est best-effort : sur 1501 PDF il y en aura toujours quelques-uns de
// tronqués, chiffrés ou malformés. Un échec renvoie un objet qui le dit, jamais
// une exception qui arrêterait l'indexation de toute la bibliothèque.

const { spawn, spawnSync } = require('child_process');

// Un PDF corrompu peut faire tourner pdftotext indéfiniment. Le tuer au bout
// d'un délai est ce qui permet de lancer les 1501 fichiers sans surveillance.
const TIMEOUT_MS = 120_000;

// Le plus gros document de la bibliothèque pèse 680 Mo. Son texte intégral ne
// servirait à rien pour la recherche et ferait exploser l'index : au-delà de
// cette limite on garde le début, ce qui suffit largement à retrouver un
// document, et on le signale.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// Bornée séparément : la page 1 sert à devinier titre et auteurs (phase 4), pas
// à la recherche.
const MAX_FIRST_PAGE_BYTES = 16 * 1024;

// Asynchrone, et non `spawnSync`, pour une raison qui n'est pas cosmétique :
// l'indexation des 1501 PDF peut être lancée depuis l'interface, et une boucle
// synchrone bloquerait entièrement le serveur — pas quelques millisecondes par
// document, mais les quarante minutes du travail complet. Avec `spawn`, poppler
// tourne dans un autre processus et la boucle d'évènements reste libre de servir
// les pages pendant ce temps.
function runPoppler(bin, args, maxBytes) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: `${bin}: ${e.message}` });
      return;
    }

    const chunks = [];
    let size = 0;
    let truncated = false;
    let settled = false;
    const errChunks = [];

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // Un PDF corrompu peut faire tourner poppler indéfiniment. Le tuer au bout du
    // délai est ce qui permet de lancer les 1501 fichiers sans surveillance.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, error: `${bin} interrompu après ${TIMEOUT_MS / 1000}s` });
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      if (truncated) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Plus gros que la limite : ce n'est pas une erreur mais le cas prévu du
        // document énorme. On garde le début et on coupe court.
        truncated = true;
        chunks.push(chunk);
        child.kill('SIGTERM');
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (errChunks.length < 8) errChunks.push(chunk);
    });

    child.on('error', (err) => {
      // ENOENT = poppler absent de l'image. À distinguer d'un PDF illisible :
      // l'un est un problème de déploiement, l'autre une donnée abîmée.
      if (err.code === 'ENOENT') {
        finish({ ok: false, missingTool: true, error: `${bin} introuvable (poppler-utils non installé)` });
        return;
      }
      finish({ ok: false, error: `${bin}: ${err.message}` });
    });

    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks);
      if (truncated) {
        finish({ ok: true, stdout, truncated: true });
        return;
      }
      // pdftotext renvoie un code non nul sur PDF chiffré ou endommagé, mais
      // écrit souvent quand même une partie du texte : on la garde.
      if (code !== 0 && stdout.length === 0) {
        const stderr = Buffer.concat(errChunks).toString('utf8').trim().split('\n')[0];
        finish({ ok: false, error: stderr || `${bin} a échoué (code ${code})` });
        return;
      }
      finish({ ok: true, stdout, truncated: false });
    });
  });
}

// Les PDF issus de scans sortent quelques caractères de bruit par page au lieu
// de rien du tout. Ce nettoyage évite d'indexer des kilo-octets d'espaces et de
// ligatures cassées, et rend le compte de caractères significatif.
//
// Les caractères de contrôle C0 sont retirés au passage. Ce n'est pas cosmétique :
// le surlignage des extraits de recherche encadre les correspondances avec deux
// d'entre eux avant d'échapper le reste, donc un document qui en contiendrait
// pourrait se surligner lui-même. Les supprimer ici est le seul endroit où la
// garantie tient vraiment.
function normalizeText(buf) {
  return buf.toString('utf8')
    .replace(/\f/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractFullText(absPath) {
  const res = await runPoppler('pdftotext', ['-q', '-enc', 'UTF-8', absPath, '-'], MAX_TEXT_BYTES);
  if (!res.ok) return res;
  const text = normalizeText(res.stdout);
  const truncated = res.truncated || Buffer.byteLength(text, 'utf8') >= MAX_TEXT_BYTES;
  return { ok: true, text, truncated };
}

async function extractFirstPage(absPath) {
  const res = await runPoppler('pdftotext', ['-q', '-f', '1', '-l', '1', '-enc', 'UTF-8', absPath, '-'], MAX_FIRST_PAGE_BYTES);
  if (!res.ok) return res;
  return { ok: true, text: normalizeText(res.stdout).slice(0, MAX_FIRST_PAGE_BYTES) };
}

// `pdfinfo` donne le nombre de pages et le dictionnaire /Info. Le titre qu'on y
// trouve est très souvent inutilisable (« Microsoft Word - doc1.doc »), d'où son
// exploitation prudente en phase 4 ; le nombre de pages, lui, est fiable.
async function extractInfo(absPath) {
  const res = await runPoppler('pdfinfo', ['-enc', 'UTF-8', absPath], 256 * 1024);
  if (!res.ok) return res;
  const info = {};
  for (const line of res.stdout.toString('utf8').split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    info[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  const pages = Number(info.pages);
  return {
    ok: true,
    pages: Number.isInteger(pages) && pages > 0 ? pages : null,
    info_title: info.title || null,
    info_author: info.author || null,
    info_subject: info.subject || null,
    info_keywords: info.keywords || null,
    encrypted: /^yes/i.test(info.encrypted || ''),
  };
}

function popplerAvailable() {
  const res = spawnSync('pdftotext', ['-v'], { timeout: 5000, windowsHide: true });
  return !res.error;
}

module.exports = {
  extractFullText, extractFirstPage, extractInfo, popplerAvailable,
  MAX_TEXT_BYTES, MAX_FIRST_PAGE_BYTES,
};
