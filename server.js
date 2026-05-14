const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const db         = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ⚠️  Bunu değiştir — rastgele uzun bir string yaz
const JWT_SECRET = process.env.JWT_SECRET || 'mochi_super_secret_degistir_bunu_2026';

// ══════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // index.html buradan servis edilir

// Rate limit — brute force engellemek için
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use('/api/', limiter);

// JWT doğrulama middleware
function auth(req, res, next){
  const header = req.headers['authorization'];
  if(!header) return res.status(401).json({ error: 'Token gerekli' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ error: 'Geçersiz token' });
  }
}

// ══════════════════════════════════════════
//  YARDIMCI
// ══════════════════════════════════════════
function uid(){ return 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }
function tag() { return '#' + String(Math.floor(Math.random()*90000+10000)); }
function safeUser(u){ return u ? { id:u.id, username:u.username, tag:u.tag, avatar:u.avatar, color:u.color, bio:u.bio } : null; }

// ══════════════════════════════════════════
//  AUTH — Kayıt / Giriş (şifresiz — kullanıcı adı yeterli)
// ══════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { username, avatar, color } = req.body;
  if(!username || username.length < 2 || username.length > 18)
    return res.status(400).json({ error: 'Kullanıcı adı 2-18 karakter olmalı' });
  if(!/^[a-zA-Z0-9_çğışöüÇĞİŞÖÜ]+$/.test(username))
    return res.status(400).json({ error: 'Geçersiz karakter' });

  const existing = db.userGetByUsername.get(username);
  if(existing) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });

  const id = uid();
  db.userCreate.run({ id, username, tag: tag(), avatar: avatar || '🐱', color: color || '#a8a8ff', bio: '' });
  db.casinoInit.run(id);

  const user = db.userGetById.get(id);
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: safeUser(user) });
});

// POST /api/auth/login  (sadece kullanıcı adıyla — şifre yok)
app.post('/api/auth/login', (req, res) => {
  const { username } = req.body;
  if(!username) return res.status(400).json({ error: 'Kullanıcı adı gerekli' });

  const user = db.userGetByUsername.get(username);
  if(!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });
  res.json({ token, user: safeUser(user) });
});

// GET /api/auth/me — token'dan profil al
app.get('/api/auth/me', auth, (req, res) => {
  const user = db.userGetById.get(req.user.id);
  if(!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json({ user: safeUser(user) });
});

// ══════════════════════════════════════════
//  KULLANICI
// ══════════════════════════════════════════

// GET /api/users/search?q=kullaniciadi
app.get('/api/users/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if(q.length < 2) return res.json({ user: null });
  const user = db.userGetByUsername.get(q);
  if(!user) return res.json({ user: null });
  res.json({ user: safeUser(user) });
});

// PATCH /api/users/me — profil güncelle
app.patch('/api/users/me', auth, (req, res) => {
  const { avatar, color, bio } = req.body;
  db.userUpdate.run({ id: req.user.id, avatar: avatar||'🐱', color: color||'#a8a8ff', bio: (bio||'').slice(0,120) });
  const user = db.userGetById.get(req.user.id);
  res.json({ user: safeUser(user) });
});

// DELETE /api/users/me — profil sil
app.delete('/api/users/me', auth, (req, res) => {
  db.userDelete.run(req.user.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  CASINO
// ══════════════════════════════════════════

// GET /api/casino
app.get('/api/casino', auth, (req, res) => {
  db.casinoInit.run(req.user.id);
  const row = db.casinoGet.get(req.user.id);
  res.json(row);
});

// POST /api/casino — bakiye güncelle
app.post('/api/casino', auth, (req, res) => {
  const { balance, played, won, net } = req.body;
  if(typeof balance !== 'number') return res.status(400).json({ error: 'Geçersiz veri' });
  db.casinoUpsert.run({ user_id: req.user.id, balance, played: played||0, won: won||0, net: net||0 });
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  ARKADAŞLAR
// ══════════════════════════════════════════

// GET /api/friends
app.get('/api/friends', auth, (req, res) => {
  const friends = db.friendList.all(req.user.id);
  res.json({ friends });
});

// POST /api/friends/request/:toId — istek gönder
app.post('/api/friends/request/:toId', auth, (req, res) => {
  const { toId } = req.params;
  if(toId === req.user.id) return res.status(400).json({ error: 'Kendine istek gönderemezsin' });
  const target = db.userGetById.get(toId);
  if(!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  if(db.friendCheck.get(req.user.id, toId)) return res.status(409).json({ error: 'Zaten arkadaşsınız' });
  if(db.reqExists.get(req.user.id, toId)) return res.status(409).json({ error: 'İstek zaten gönderildi' });
  db.reqSend.run(req.user.id, toId);
  res.json({ ok: true });
});

// GET /api/friends/requests — gelen istekler
app.get('/api/friends/requests', auth, (req, res) => {
  const requests = db.reqList.all(req.user.id);
  res.json({ requests });
});

// POST /api/friends/accept/:fromId
app.post('/api/friends/accept/:fromId', auth, (req, res) => {
  const { fromId } = req.params;
  db.acceptFriendTx(fromId, req.user.id);
  res.json({ ok: true });
});

// POST /api/friends/reject/:fromId
app.post('/api/friends/reject/:fromId', auth, (req, res) => {
  db.reqDelete.run(req.params.fromId, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/friends/:friendId
app.delete('/api/friends/:friendId', auth, (req, res) => {
  const { friendId } = req.params;
  db.friendRemove.run(req.user.id, friendId, friendId, req.user.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════
//  MESAJLAR
// ══════════════════════════════════════════

// GET /api/messages/:withId
app.get('/api/messages/:withId', auth, (req, res) => {
  const key = db.convKey(req.user.id, req.params.withId);
  const msgs = db.msgList.all(key);
  // okundu işaretle
  db.unreadClear.run(req.user.id, req.params.withId);
  res.json({ messages: msgs });
});

// POST /api/messages/:toId
app.post('/api/messages/:toId', auth, (req, res) => {
  const { text } = req.body;
  if(!text || !text.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });
  const key = db.convKey(req.user.id, req.params.toId);
  db.msgInsert.run(key, req.user.id, text.trim().slice(0, 2000));
  db.unreadSet.run(req.params.toId, req.user.id);
  res.json({ ok: true });
});

// GET /api/messages/:withId/unread — unread sayısı
app.get('/api/messages/:withId/unread', auth, (req, res) => {
  const row = db.unreadGet.get(req.user.id, req.params.withId);
  res.json({ count: row ? row.count : 0 });
});

// GET /api/notifications — toplam unread + istek sayısı
app.get('/api/notifications', auth, (req, res) => {
  const { total } = db.unreadSumFor.get(req.user.id);
  const requests  = db.reqList.all(req.user.id).length;
  res.json({ unread: total, requests });
});

// ══════════════════════════════════════════
//  Catch-all → index.html
// ══════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🎰  Mochi Server çalışıyor → http://localhost:${PORT}\n`);
});