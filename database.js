const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'mochi.db'));

// WAL modu — eş zamanlı okuma/yazma için daha hızlı
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ══════════════════════════════════════════
//  TABLOLAR
// ══════════════════════════════════════════
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL COLLATE NOCASE,
    tag        TEXT NOT NULL,
    avatar     TEXT NOT NULL DEFAULT '🐱',
    color      TEXT NOT NULL DEFAULT '#a8a8ff',
    bio        TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS casino (
    user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance   INTEGER NOT NULL DEFAULT 17500,
    played    INTEGER NOT NULL DEFAULT 0,
    won       INTEGER NOT NULL DEFAULT 0,
    net       INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(from_id, to_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    conv_key   TEXT NOT NULL,
    from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS unread (
    owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_id, from_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conv_key, created_at);
  CREATE INDEX IF NOT EXISTS idx_freq_from ON friend_requests(to_id);
`);

// ══════════════════════════════════════════
//  KULLANICI
// ══════════════════════════════════════════
const userCreate = db.prepare(`
  INSERT INTO users (id, username, tag, avatar, color, bio)
  VALUES (@id, @username, @tag, @avatar, @color, @bio)
`);
const userGetByUsername = db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`);
const userGetById       = db.prepare(`SELECT * FROM users WHERE id = ?`);
const userUpdate        = db.prepare(`
  UPDATE users SET avatar=@avatar, color=@color, bio=@bio WHERE id=@id
`);
const userDelete        = db.prepare(`DELETE FROM users WHERE id = ?`);

// ══════════════════════════════════════════
//  CASINO
// ══════════════════════════════════════════
const casinoGet    = db.prepare(`SELECT * FROM casino WHERE user_id = ?`);
const casinoUpsert = db.prepare(`
  INSERT INTO casino (user_id, balance, played, won, net, updated_at)
  VALUES (@user_id, @balance, @played, @won, @net, unixepoch())
  ON CONFLICT(user_id) DO UPDATE SET
    balance=@balance, played=@played, won=@won, net=@net, updated_at=unixepoch()
`);
const casinoInit = db.prepare(`
  INSERT OR IGNORE INTO casino (user_id, balance) VALUES (?, 17500)
`);

// ══════════════════════════════════════════
//  ARKADAŞ
// ══════════════════════════════════════════
const friendAdd    = db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?,?)`);
const friendRemove = db.prepare(`DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`);
const friendList   = db.prepare(`
  SELECT u.id, u.username, u.tag, u.avatar, u.color, u.bio
  FROM friends f JOIN users u ON u.id = f.friend_id
  WHERE f.user_id = ?
  ORDER BY u.username
`);
const friendCheck  = db.prepare(`SELECT 1 FROM friends WHERE user_id=? AND friend_id=?`);

// İstekler
const reqSend   = db.prepare(`INSERT OR IGNORE INTO friend_requests (from_id, to_id) VALUES (?,?)`);
const reqList   = db.prepare(`
  SELECT r.id, r.from_id, u.username, u.avatar, u.color, u.tag, r.created_at
  FROM friend_requests r JOIN users u ON u.id = r.from_id
  WHERE r.to_id = ?
  ORDER BY r.created_at DESC
`);
const reqDelete = db.prepare(`DELETE FROM friend_requests WHERE from_id=? AND to_id=?`);
const reqDeleteById = db.prepare(`DELETE FROM friend_requests WHERE id=?`);
const reqExists = db.prepare(`SELECT 1 FROM friend_requests WHERE from_id=? AND to_id=?`);

// Arkadaş kabul — transaction
const acceptFriendTx = db.transaction((fromId, toId) => {
  friendAdd.run(toId, fromId);
  friendAdd.run(fromId, toId);
  reqDelete.run(fromId, toId);
});

// ══════════════════════════════════════════
//  MESAJLAR
// ══════════════════════════════════════════
function convKey(uid1, uid2){ return [uid1, uid2].sort().join(':'); }

const msgInsert = db.prepare(`INSERT INTO messages (conv_key, from_id, text) VALUES (?,?,?)`);
const msgList   = db.prepare(`
  SELECT id, from_id, text, created_at FROM messages
  WHERE conv_key = ?
  ORDER BY created_at ASC
  LIMIT 200
`);
const unreadGet    = db.prepare(`SELECT count FROM unread WHERE owner_id=? AND from_id=?`);
const unreadSet    = db.prepare(`
  INSERT INTO unread (owner_id, from_id, count) VALUES (?,?,1)
  ON CONFLICT(owner_id, from_id) DO UPDATE SET count = count + 1
`);
const unreadClear  = db.prepare(`DELETE FROM unread WHERE owner_id=? AND from_id=?`);
const unreadSumFor = db.prepare(`SELECT COALESCE(SUM(count),0) as total FROM unread WHERE owner_id=?`);

// ══════════════════════════════════════════
//  DIŞA AKTAR
// ══════════════════════════════════════════
module.exports = {
  // users
  userCreate, userGetByUsername, userGetById, userUpdate, userDelete,
  // casino
  casinoGet, casinoUpsert, casinoInit,
  // friends
  friendAdd, friendRemove, friendList, friendCheck,
  reqSend, reqList, reqDelete, reqDeleteById, reqExists, acceptFriendTx,
  // messages
  convKey, msgInsert, msgList,
  unreadGet, unreadSet, unreadClear, unreadSumFor,
};
