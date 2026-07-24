'use strict';

const { encodePNG } = require('./png.js');
const { CHAR_HEIGHT, normalizeForFont, textWidth, drawText } = require('./font5x7.js');

const WIDTH = 600;
const HEIGHT = 900;
const MARGIN = 50;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function hslToRgb(h, s, l) {
  const hue = h / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hue * 12) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(c * 255);
  };
  return [f(0), f(8), f(4)];
}

function fillRect(pixels, width, height, x0, y0, x1, y1, color) {
  const xs = Math.max(0, x0);
  const xe = Math.min(width, x1);
  const ys = Math.max(0, y0);
  const ye = Math.min(height, y1);
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const idx = (y * width + x) * 3;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
    }
  }
}

/** Greedily wraps already-normalized text to a max character count per line. */
function wrapText(text, maxCharsPerLine) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCenteredLines(pixels, lines, scale, startY, lineGap, color) {
  let y = startY;
  const lineHeight = CHAR_HEIGHT * scale + lineGap;
  for (const line of lines) {
    const w = textWidth(line, scale);
    drawText(pixels, WIDTH, HEIGHT, line, Math.round((WIDTH - w) / 2), y, scale, color);
    y += lineHeight;
  }
  return y;
}

/** Generates a placeholder cover PNG when a book has no stored cover image. */
function generatePlaceholderCover(title, authors) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
  const safeTitle = title || 'Sans titre';
  const hue = hashString(safeTitle) % 360;
  const bg = hslToRgb(hue, 0.42, 0.30);
  const frame = hslToRgb(hue, 0.42, 0.20);
  const white = [255, 255, 255];

  fillRect(pixels, WIDTH, HEIGHT, 0, 0, WIDTH, HEIGHT, bg);
  const border = 16;
  fillRect(pixels, WIDTH, HEIGHT, 0, 0, WIDTH, border, frame);
  fillRect(pixels, WIDTH, HEIGHT, 0, HEIGHT - border, WIDTH, HEIGHT, frame);
  fillRect(pixels, WIDTH, HEIGHT, 0, 0, border, HEIGHT, frame);
  fillRect(pixels, WIDTH, HEIGHT, WIDTH - border, 0, WIDTH, HEIGHT, frame);

  const titleScale = 6;
  const titleMaxChars = Math.floor((WIDTH - MARGIN * 2) / (6 * titleScale));
  const titleLines = wrapText(normalizeForFont(safeTitle), titleMaxChars).slice(0, 6);
  const titleLineHeight = CHAR_HEIGHT * titleScale + 10;
  const titleBlockHeight = titleLines.length * titleLineHeight;

  const authorText = normalizeForFont(Array.isArray(authors) ? authors.join(', ') : (authors || ''));
  const authorScale = 3;
  const authorMaxChars = Math.floor((WIDTH - MARGIN * 2) / (6 * authorScale));
  const authorLines = authorText ? wrapText(authorText, authorMaxChars).slice(0, 3) : [];
  const authorLineHeight = CHAR_HEIGHT * authorScale + 8;
  const authorBlockHeight = authorLines.length ? authorLines.length * authorLineHeight + 30 : 0;

  const totalHeight = titleBlockHeight + authorBlockHeight;
  const titleStartY = Math.round((HEIGHT - totalHeight) / 2);

  const afterTitleY = drawCenteredLines(pixels, titleLines, titleScale, titleStartY, 10, white);
  if (authorLines.length) {
    drawCenteredLines(pixels, authorLines, authorScale, afterTitleY + 20, 8, white);
  }

  return encodePNG(WIDTH, HEIGHT, pixels);
}

module.exports = { generatePlaceholderCover, WIDTH, HEIGHT };
