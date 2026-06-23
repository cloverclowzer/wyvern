const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const dbPath = path.join(__dirname, 'database.json');

function getDefaultDb() {
  return {
    users: [],
    channels: [],
    messages: [],
    settings: { defaultChannel: 'general' },
    sessions: []
  };
}

function loadDb() {
  if (!fs.existsSync(dbPath)) {
    const seed = getDefaultDb();
    seed.users = [
      {
        username: 'Admin',
        password: 'whatthesigma',
        role: 'admin',
        verified: true,
        badges: ['blue', 'gold'],
        banned: false,
        createdAt: new Date().toISOString()
      }
    ];
    seed.channels = [
      {
        id: 'general',
        name: 'general',
        description: 'Main room for everyone',
        createdBy: 'Admin'
      }
    ];
    seed.messages = [
      {
        id: crypto.randomUUID(),
        channelId: 'general',
        username: 'Admin',
        content: 'Welcome to Wyvern Chat. The Admin can manage users, messages, and badges.',
        timestamp: new Date().toISOString(),
        deleted: false
      }
    ];
    saveDb(seed);
    return seed;
  }

  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(raw);
    ensureDefaults(db);
    saveDb(db);
    return db;
  } catch (error) {
    console.error('Database load failed, reinitializing.', error);
    const seed = getDefaultDb();
    saveDb(seed);
    return seed;
  }
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function ensureDefaults(db) {
  if (!db.users) db.users = [];
  if (!db.channels) db.channels = [];
  if (!db.messages) db.messages = [];
  if (!db.settings) db.settings = { defaultChannel: 'general' };
  if (!db.sessions) db.sessions = [];

  if (!db.users.some((u) => u.username === 'Admin')) {
    db.users.unshift({
      username: 'Admin',
      password: 'whatthesigma',
      role: 'admin',
      verified: true,
      badges: ['blue', 'gold'],
      banned: false,
      createdAt: new Date().toISOString()
    });
  }

  if (!db.channels.some((c) => c.id === 'general')) {
    db.channels.unshift({
      id: 'general',
      name: 'general',
      description: 'Main room for everyone',
      createdBy: 'Admin'
    });
  }

  if (!db.settings.defaultChannel) {
    db.settings.defaultChannel = 'general';
  }

  if (!db.messages.some((m) => m.username === 'Admin' && m.content.includes('Welcome to Wyvern Chat'))) {
    db.messages.unshift({
      id: crypto.randomUUID(),
      channelId: 'general',
      username: 'Admin',
      content: 'Welcome to Wyvern Chat. The Admin can manage users, messages, and badges.',
      timestamp: new Date().toISOString(),
      deleted: false
    });
  }
}

function findUser(db, username) {
  return db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

function createSession(db, username) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions = db.sessions.filter((session) => session.username !== username);
  db.sessions.push({ token, username, createdAt: new Date().toISOString() });
  return token;
}

function getAuthenticatedUser(req, db) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (!token) return null;
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session) return null;
  return findUser(db, session.username);
}

function requireAuth(req, res, db) {
  const user = getAuthenticatedUser(req, db);
  if (!user) {
    res.status(401).json({ error: 'Login required' });
    return null;
  }
  return user;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', (req, res) => {
  const db = loadDb();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (findUser(db, username)) {
    return res.status(409).json({ error: 'That username already exists.' });
  }

  const user = {
    username: username.trim(),
    password,
    role: 'user',
    verified: false,
    badges: [],
    banned: false,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  const token = createSession(db, user.username);
  saveDb(db);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/login', (req, res) => {
  const db = loadDb();
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = findUser(db, username);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.password !== password) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'You are banned from this chatroom.' });
  }

  const token = createSession(db, user.username);
  saveDb(db);
  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/logout', (req, res) => {
  const db = loadDb();
  const token = req.headers['x-auth-token'];
  if (token) {
    db.sessions = db.sessions.filter((session) => session.token !== token);
    saveDb(db);
  }
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  const db = loadDb();
  const user = getAuthenticatedUser(req, db);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  res.json({ user: sanitizeUser(user) });
});

app.get('/api/channels', (req, res) => {
  const db = loadDb();
  res.json({ channels: db.channels });
});

app.post('/api/channels', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;

  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'A channel name is required.' });

  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (!id) return res.status(400).json({ error: 'Channel name must contain letters or numbers.' });
  if (db.channels.some((channel) => channel.id === id)) {
    return res.status(409).json({ error: 'That channel already exists.' });
  }

  db.channels.push({
    id,
    name: name.trim(),
    description: description || 'New channel',
    createdBy: user.username
  });
  saveDb(db);
  res.json({ channel: db.channels[db.channels.length - 1] });
});

app.get('/api/messages', (req, res) => {
  const db = loadDb();
  const channelId = req.query.channelId || db.settings.defaultChannel || 'general';
  const messages = db.messages
    .filter((message) => message.channelId === channelId && !message.deleted)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json({ messages });
});

app.post('/api/messages', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;
  if (user.banned) return res.status(403).json({ error: 'You are banned from this chatroom.' });

  const { channelId, content } = req.body;
  if (!channelId || !content || !content.trim()) {
    return res.status(400).json({ error: 'A message and channel are required.' });
  }

  const message = {
    id: crypto.randomUUID(),
    channelId,
    username: user.username,
    content: content.trim(),
    timestamp: new Date().toISOString(),
    deleted: false
  };

  db.messages.push(message);
  saveDb(db);
  res.json({ message });
});

app.post('/api/messages/:id/delete', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete messages.' });

  const message = db.messages.find((entry) => entry.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  message.deleted = true;
  saveDb(db);
  res.json({ success: true });
});

app.get('/api/users', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

  res.json({ users: db.users.map((entry) => ({ ...entry, password: undefined })) });
});

app.post('/api/users/:username/ban', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

  const target = findUser(db, req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const { value } = req.body;
  target.banned = value === true;
  saveDb(db);
  res.json({ user: sanitizeUser(target) });
});

app.post('/api/users/:username/badge', (req, res) => {
  const db = loadDb();
  const user = requireAuth(req, res, db);
  if (!user) return;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });

  const target = findUser(db, req.params.username);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const { badge, enabled } = req.body;
  if (!['blue', 'gold'].includes(badge)) {
    return res.status(400).json({ error: 'Badge must be blue or gold.' });
  }

  const badges = new Set(target.badges || []);
  if (enabled) {
    badges.add(badge);
  } else {
    badges.delete(badge);
  }
  target.badges = [...badges];
  saveDb(db);
  res.json({ user: sanitizeUser(target) });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(3000, () => console.log('Wyvern chatroom running on http://localhost:3000'));
