'use strict';

const { buildZip } = require('./zip.js');
const { generatePlaceholderCover } = require('./cover-gen.js');

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function coverExtension(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function buildContentOpf(book, coverItem) {
  const authors = book.authors.length ? book.authors : ['Unknown author'];
  const creators = authors
    .map((a) => `    <dc:creator opf:role="aut">${escapeXml(a)}</dc:creator>`)
    .join('\n');
  const tags = (book.tags || [])
    .map((t) => `    <dc:subject>${escapeXml(t)}</dc:subject>`)
    .join('\n');

  const identifiers = [`    <dc:identifier id="pub-id">irl-books-${book.id}</dc:identifier>`];
  if (book.isbn) {
    identifiers.push(`    <dc:identifier opf:scheme="ISBN">${escapeXml(book.isbn)}</dc:identifier>`);
  }

  const descriptionParts = [];
  if (book.notes) descriptionParts.push(book.notes);
  if (book.edition) descriptionParts.push(`Edition: ${book.edition}`);
  if (book.library) descriptionParts.push(`Room: ${book.library}`);
  const description = descriptionParts.join('\n\n');

  const optionalLines = [
    book.publisher ? `    <dc:publisher>${escapeXml(book.publisher)}</dc:publisher>` : '',
    book.publishing_year ? `    <dc:date>${escapeXml(book.publishing_year)}</dc:date>` : '',
    description ? `    <dc:description>${escapeXml(description)}</dc:description>` : '',
    tags,
  ].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(book.title)}</dc:title>
${creators}
${identifiers.join('\n')}
    <dc:language>fr</dc:language>
${optionalLines ? `${optionalLines}\n` : ''}    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="${coverItem.filename}" media-type="${coverItem.mime}"/>
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover-page"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
  </guide>
</package>
`;
}

function buildTocNcx(book) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="irl-books-${book.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel><text>Cover</text></navLabel>
      <content src="cover.xhtml"/>
    </navPoint>
  </navMap>
</ncx>
`;
}

function buildCoverXhtml(book, coverItem) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(book.title)}</title>
  <style>html,body{margin:0;padding:0;text-align:center;background:#000;}img{max-width:100%;max-height:100vh;}</style>
</head>
<body><div><img src="${coverItem.filename}" alt="Cover"/></div></body>
</html>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

/**
 * Builds a minimal but valid EPUB2 for a book, embedding its full metadata
 * (title, authors, ISBN, publisher, year, edition, notes, tags) so Calibre
 * picks it all up on import. Uses the real cover if present, otherwise a
 * generated placeholder with the title and author(s).
 */
function buildEpub(book) {
  let coverBuf;
  let coverMime;
  if (book.cover) {
    coverBuf = book.cover;
    coverMime = book.cover_mime || 'image/jpeg';
  } else {
    coverBuf = generatePlaceholderCover(book.title, book.authors);
    coverMime = 'image/png';
  }
  const coverItem = { filename: `cover.${coverExtension(coverMime)}`, mime: coverMime };

  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii') },
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER_XML, 'utf8') },
    { name: 'OEBPS/content.opf', data: Buffer.from(buildContentOpf(book, coverItem), 'utf8') },
    { name: 'OEBPS/toc.ncx', data: Buffer.from(buildTocNcx(book), 'utf8') },
    { name: 'OEBPS/cover.xhtml', data: Buffer.from(buildCoverXhtml(book, coverItem), 'utf8') },
    { name: `OEBPS/${coverItem.filename}`, data: coverBuf },
  ];

  return buildZip(entries);
}

module.exports = { buildEpub };
