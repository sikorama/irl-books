'use strict';

// Generates a self-signed certificate (via openssl, already present on most
// systems) to serve the site over HTTPS. Required by mobile browsers to
// allow camera access (barcode scanning): they refuse it over HTTP unless
// on localhost.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CERTS_DIR = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERTS_DIR, 'cert.pem');
const KEY_FILE = path.join(CERTS_DIR, 'key.pem');

function localIPv4Addresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

fs.mkdirSync(CERTS_DIR, { recursive: true });

const ips = localIPv4Addresses();
const altNames = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');

console.log(`Generating a self-signed certificate for: localhost, 127.0.0.1${ips.length ? ', ' + ips.join(', ') : ''}`);

try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', KEY_FILE, '-out', CERT_FILE,
    '-days', '825',
    '-subj', '/CN=irl-books.local',
    '-addext', `subjectAltName=${altNames}`,
  ], { stdio: 'inherit' });
} catch (e) {
  console.error('\nGeneration failed: openssl must be installed and available in PATH.');
  process.exit(1);
}

console.log(`\nCertificate written to ${CERTS_DIR}/`);
console.log('Restart `node server.js`: the site will be served over HTTPS.');
console.log('\nOn the first connection from a phone, the browser will show a warning');
console.log("(self-signed certificate not recognized): accept the exception to continue — that's expected,");
console.log('this certificate is local and only serves to allow camera access on the home network.');
console.log('\nIf the server\'s IP addresses change (new network, etc.), rerun this script to regenerate the certificate.');
