'use strict';

// Inspection d'images au niveau des octets, sans dépendance externe.
//
// Le type MIME annoncé par les catalogues n'est pas fiable (Google sert du PNG
// sur des URL en `.jpg`) et une couverture absente arrive parfois sous forme de
// page d'erreur HTML avec un code 200 : on se fie donc uniquement au contenu.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// `node:sqlite` rend les BLOB en Uint8Array, alors que les téléchargements
// arrivent en Buffer. On unifie sur Buffer (vue sans copie) pour disposer des
// accesseurs readUInt*.
function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function sniffImageMime(data) {
  const buf = asBuffer(data);
  if (!buf) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length >= 12
    && buf.subarray(0, 4).toString('latin1') === 'RIFF'
    && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Parcourt les segments JPEG jusqu'au marqueur SOF, qui porte les dimensions.
function jpegSize(buf) {
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    // Marqueurs isolés, sans segment de longueur.
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // SOF0..SOF15, hors DHT (0xc4), JPG (0xc8) et DAC (0xcc).
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf) {
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// Renvoie { width, height } ou null si le format est inconnu ou l'en-tête
// tronqué.
function imageSize(data) {
  const buf = asBuffer(data);
  if (!buf || !buf.length) return null;
  switch (sniffImageMime(buf)) {
    case 'image/jpeg':
      return jpegSize(buf);
    case 'image/png':
      return buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
    case 'image/gif':
      return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null;
    case 'image/webp':
      return webpSize(buf);
    default:
      return null;
  }
}

// Garde-fou volontairement large : il ne s'agit pas de deviner ce qu'est une
// « belle » couverture, seulement d'écarter les bandeaux que certains
// catalogues servent en 200 à la place d'une image (« aperçu indisponible »
// chez Google fait 575×92, soit un rapport de 6,25). Les albums à l'italienne
// restent acceptés.
function looksLikeCover(size) {
  if (!size || !size.width || !size.height) return false;
  if (size.width < 20 || size.height < 20) return false;
  const ratio = size.width / size.height;
  return ratio >= 0.25 && ratio <= 2.5;
}

module.exports = { sniffImageMime, imageSize, looksLikeCover };
