'use strict';

// One-time cleanup of the historical duplication caused by "FULL" being a
// near-complete mirror of every room-specific library. For each group of
// books sharing the same `ident`:
//   - if every row in the group has the same title, it's the same physical
//     scan duplicated: drop the "FULL" copy/copies and keep the room
//     copy/copies (there can be more than one room copy -- that means two
//     physical copies of the same book kept in different rooms).
//   - if titles differ within a group, the ident/isbn collision is a data
//     quality issue in the source, not a scan duplicate -- leave it alone
//     and report it for manual review via the /api/duplicates endpoint.
//
// Safe to re-run: once no "FULL" row remains in a group, there is nothing
// left to merge.

const { openDb } = require('./lib/db.js');

function normTitle(t) {
  return String(t || '').trim().toLowerCase();
}

function main() {
  const db = openDb();

  const groups = db.prepare(`
    SELECT ident FROM books WHERE ident IS NOT NULL
    GROUP BY ident HAVING COUNT(*) > 1
  `).all();

  const getGroupRows = db.prepare('SELECT * FROM books WHERE ident = ?');
  const deleteStmt = db.prepare('DELETE FROM books WHERE id = ?');
  const setCoverStmt = db.prepare('UPDATE books SET cover = ?, cover_mime = ?, cover_rev = cover_rev + 1 WHERE id = ?');

  let merged = 0;
  let rowsDeleted = 0;
  const conflicts = [];

  const txn = db.exec.bind(db);
  txn('BEGIN');
  try {
    for (const { ident } of groups) {
      const rows = getGroupRows.all(ident);
      const titles = new Set(rows.map((r) => normTitle(r.title)));
      if (titles.size > 1) {
        conflicts.push({ ident, entries: rows.map((r) => ({ id: r.id, library: r.library, title: r.title })) });
        continue;
      }

      const fullRows = rows.filter((r) => r.library === 'FULL');
      const roomRows = rows.filter((r) => r.library !== 'FULL');
      if (fullRows.length === 0 || roomRows.length === 0) continue; // nothing to merge

      // Fill in a missing cover on a room row from a FULL row before deleting it.
      for (const room of roomRows) {
        if (room.cover === null) {
          const withCover = fullRows.find((f) => f.cover !== null);
          if (withCover) {
            setCoverStmt.run(withCover.cover, withCover.cover_mime, room.id);
          }
        }
      }

      for (const full of fullRows) {
        deleteStmt.run(full.id);
        rowsDeleted++;
      }
      merged++;
    }

    // Remaining standalone "FULL" rows (no room duplicate) have no known
    // physical location.
    const orphanUpdate = db.prepare("UPDATE books SET library = NULL WHERE library = 'FULL'").run();

    txn('COMMIT');

    console.log(`Groups merged: ${merged}`);
    console.log(`FULL rows deleted: ${rowsDeleted}`);
    console.log(`Orphaned FULL books moved to unknown room: ${orphanUpdate.changes}`);
    console.log(`Conflicts left for manual review: ${conflicts.length}`);
    for (const c of conflicts) {
      console.log(`  - ident ${c.ident}:`, c.entries.map((e) => `#${e.id} [${e.library}] "${e.title}"`).join(' vs '));
    }
    console.log(`Total books remaining: ${db.prepare('SELECT COUNT(*) c FROM books').get().c}`);
  } catch (e) {
    txn('ROLLBACK');
    throw e;
  }
}

main();
