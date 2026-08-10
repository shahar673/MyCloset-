// Very small file-based "database". Good enough for a single-user / small-scale
// personal app. Everything lives in one JSON file on disk.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // corrupted file safety net - back it up and start fresh rather than crash
    fs.writeFileSync(DB_PATH + '.corrupt-' + Date.now(), raw);
    const fresh = { users: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function findUserByEmail(db, email) {
  const e = (email || '').trim().toLowerCase();
  return db.users.find(u => u.email.toLowerCase() === e);
}

function findUserById(db, id) {
  return db.users.find(u => u.id === id);
}

module.exports = { readDb, writeDb, findUserByEmail, findUserById, DB_PATH };
