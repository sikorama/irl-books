'use strict';

/*
 * Minimal parser for the flat YAML dumps produced by Ruby's Alexandria
 * (`--- !ruby/object:Alexandria::Book`). Not a general YAML parser: it only
 * understands the shapes this app ever emits -- a single flat mapping,
 * scalar values (plain or double-quoted), and block sequences (`- item`)
 * for the `authors:`/`tags:` keys.
 *
 * Non-ASCII bytes are always written as literal `\xHH` escapes inside
 * double-quoted scalars, so quoted scalars are decoded byte-by-byte into a
 * Buffer and turned into a UTF-8 string at the end -- this sidesteps any
 * guessing about mojibake.
 */

function isDigitByte(b) {
  return b >= 0x30 && b <= 0x39;
}

function coerceScalar(raw) {
  if (raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

function parseBookYaml(buf) {
  const len = buf.length;
  let i = 0;

  function lineEnd(from) {
    let j = from;
    while (j < len && buf[j] !== 0x0a) j++;
    return j;
  }

  function trimTrailingCR(s) {
    return s.replace(/\r$/, '');
  }

  // Decode a double-quoted scalar starting at `pos` (index of the opening
  // quote). Returns { str, end } where `end` is the index right after the
  // closing quote.
  function parseQuoted(pos) {
    let i = pos + 1;
    const bytes = [];
    while (i < len) {
      const c = buf[i];
      if (c === 0x22) { // closing "
        i++;
        break;
      }
      if (c === 0x5c) { // backslash
        const n = buf[i + 1];
        if (n === 0x0a) { // escaped line break
          i += 2;
          while (buf[i] === 0x20 || buf[i] === 0x09) i++;
          continue;
        }
        if (n === 0x0d && buf[i + 2] === 0x0a) {
          i += 3;
          while (buf[i] === 0x20 || buf[i] === 0x09) i++;
          continue;
        }
        if (n === 0x6e) { bytes.push(0x0a); i += 2; continue; } // \n
        if (n === 0x74) { bytes.push(0x09); i += 2; continue; } // \t
        if (n === 0x22) { bytes.push(0x22); i += 2; continue; } // \"
        if (n === 0x5c) { bytes.push(0x5c); i += 2; continue; } // \\
        if (n === 0x30) { bytes.push(0x00); i += 2; continue; } // \0
        if (n === 0x65) { bytes.push(0x1b); i += 2; continue; } // \e
        if (n === 0x78) { // \xHH
          const hex = buf.slice(i + 2, i + 4).toString('ascii');
          bytes.push(parseInt(hex, 16) & 0xff);
          i += 4;
          continue;
        }
        // Unknown escape: keep the escaped character literally.
        bytes.push(n);
        i += 2;
        continue;
      }
      if (c === 0x0a) { // raw newline inside quotes: fold to a space
        bytes.push(0x20);
        i++;
        while (buf[i] === 0x20 || buf[i] === 0x09) i++;
        continue;
      }
      if (c === 0x0d) { i++; continue; }
      bytes.push(c);
      i++;
    }
    return { str: Buffer.from(bytes).toString('utf8'), end: i };
  }

  function parseValueAt(pos) {
    if (buf[pos] === 0x22) {
      const r = parseQuoted(pos);
      let end = lineEnd(r.end);
      if (buf[end] === 0x0a) end++;
      return { value: r.str, next: end };
    }
    const end = lineEnd(pos);
    const raw = trimTrailingCR(buf.slice(pos, end).toString('utf8')).trimEnd();
    let next = end;
    if (buf[next] === 0x0a) next++;
    return { value: coerceScalar(raw), next };
  }

  const result = {};
  let lastListKey = null;

  // Skip the `--- !ruby/object:...` header line.
  i = lineEnd(0);
  if (buf[i] === 0x0a) i++;

  while (i < len) {
    if (buf[i] === 0x0a) { i++; continue; } // blank line

    if (buf[i] === 0x2d && (buf[i + 1] === 0x20 || buf[i + 1] === 0x0a)) {
      // Block sequence item: "- value"
      let j = i + 1;
      while (buf[j] === 0x20) j++;
      const { value, next } = parseValueAt(j);
      if (!Array.isArray(result[lastListKey])) result[lastListKey] = [];
      result[lastListKey].push(value);
      i = next;
      continue;
    }

    let j = i;
    while (j < len && buf[j] !== 0x3a && buf[j] !== 0x0a) j++;
    if (buf[j] !== 0x3a) { // no "key:" on this line -- skip it defensively
      i = lineEnd(i);
      if (buf[i] === 0x0a) i++;
      continue;
    }
    const key = buf.slice(i, j).toString('ascii').trim();
    let k = j + 1;
    if (buf[k] === 0x20) k++;

    if (buf[k] === 0x0a || k >= len) {
      result[key] = null;
      lastListKey = key;
      i = k;
      if (buf[i] === 0x0a) i++;
      continue;
    }

    if (buf[k] === 0x5b && buf[k + 1] === 0x5d) { // "[]"
      result[key] = [];
      let end = lineEnd(k + 2);
      if (buf[end] === 0x0a) end++;
      i = end;
      lastListKey = null;
      continue;
    }

    const { value, next } = parseValueAt(k);
    result[key] = value;
    i = next;
    lastListKey = null;
  }

  return result;
}

module.exports = { parseBookYaml };
