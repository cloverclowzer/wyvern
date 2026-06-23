const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const DB_PATH = path.join(__dirname, 'database.json');
const DEFAULT_CHANNELS = ['general'];
const SESSION_SECRET = process.env.SESSION_SECRET || 'sigma-chat-secret';
const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = 'whatthesigma';

let db = loadDatabase();
initializeDatabase();

const onlineUsers = new Map();

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.use((socket, next) => {
  const req = socket.request;
  const res = req.res || {
    setHeader: () => {},
    getHeader: () => {},
    removeHeader: () => {},
    end: () => {}
  };
  sessionMiddleware(req, res, next);
});

function loadDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [],
      channels: [],
      messages: [],
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      meta: parsed.meta || {}
    };
  } catch (error) {
    const fallback = {
      users: [],
      channels: [],
      messages: [],
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveDatabase() {
  db.meta = db.meta || {};
  db.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function sanitizeUser(user) {
  const copy = { ...user };
  delete copy.passwordHash;
  return copy;
}

function getUserById(id) {
  return db.users.find((user) => user.id === id);
}

function getUserByUsername(username) {
  return db.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
}

function getChannelByName(name) {
  return db.channels.find((channel) => channel.name === name);
}

function sanitizeChannelName(rawName) {
  return (rawName || 'general')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'general';
}

function buildChannel(name) {
  return {
    id: randomUUID(),
    name: sanitizeChannelName(name),
    displayName: `#${sanitizeChannelName(name)}`,
    createdAt: new Date().toISOString()
  };
}

function ensureDefaultChannels() {
  if (!db.channels.length) {
    db.channels = [buildChannel(DEFAULT_CHANNELS[0])];
    return;
  }

  const first = db.channels[0] || {};
  db.channels = [
    {
      id: first.id || randomUUID(),
      name: sanitizeChannelName(first.name || DEFAULT_CHANNELS[0]),
      displayName: first.displayName || `#${sanitizeChannelName(first.name || DEFAULT_CHANNELS[0])}`,
      createdAt: first.createdAt || new Date().toISOString()
    }
  ];
}

function ensureAdminAccount() {
  const admin = db.users.find((user) => user.username.toLowerCase() === ADMIN_USERNAME.toLowerCase());
  if (!admin) {
    db.users.push({
      id: randomUUID(),
      username: ADMIN_USERNAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'Admin',
      verified: {
        blue: false,
        gold: false
      },
      banned: false,
      createdAt: new Date().toISOString()
    });
  }
}

function initializeDatabase() {
  ensureDefaultChannels();
  ensureAdminAccount();

  db.users = db.users.map((user) => ({
    ...user,
    role: user.role || 'User',
    verified: user.verified || { blue: false, gold: false },
    banned: Boolean(user.banned)
  }));

  db.messages = (db.messages || []).map((message) => ({
    ...message,
    deleted: Boolean(message.deleted)
  }));

  saveDatabase();
}

function isAdmin(user) {
  return user && user.role === 'Admin';
}

function getPresenceUsers() {
  return db.users.map((user) => ({
    ...sanitizeUser(user),
    online: onlineUsers.has(user.id)
  }));
}

function removeOnlineUser(userId) {
  if (onlineUsers.has(userId)) {
    onlineUsers.delete(userId);
  }
}

app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

app.get('/index.html', (req, res) => {
  if (req.session.userId) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

app.get('/login.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register.html', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const user = getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  res.json(sanitizeUser(user));
});

app.get('/api/channels', (req, res) => {
  res.json(db.channels);
});

app.get('/api/users', (req, res) => {
  res.json(getPresenceUsers());
});

app.get('/api/messages/:channelName', (req, res) => {
  const channel = getChannelByName(req.params.channelName);
  if (!channel) {
    return res.status(404).json({ success: false, error: 'Channel not found' });
  }

  const messages = db.messages
    .filter((message) => message.channel === channel.name && !message.deleted)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.json({
    success: true,
    channel: channel.name,
    messages
  });
});

app.post('/api/register', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.' });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ success: false, error: 'Username must be between 3 and 20 characters.' });
  }

  const existing = getUserByUsername(username);
  if (existing) {
    return res.status(409).json({ success: false, error: 'Username already exists.' });
  }

  const user = {
    id: randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'User',
    verified: {
      blue: false,
      gold: false
    },
    banned: false,
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  saveDatabase();

  req.session.userId = user.id;
  res.json(sanitizeUser(user));
});

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const user = getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }

  if (user.banned) {
    return res.status(403).json({ success: false, error: 'This account is banned.' });
  }

  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
  }

  req.session.userId = user.id;
  res.json(sanitizeUser(user));
});

app.post('/api/logout', (req, res) => {
  const userId = req.session.userId;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Could not log out.' });
    }
    if (userId) {
      removeOnlineUser(userId);
      io.emit('presence-update', { users: getPresenceUsers() });
    }
    res.json({ success: true });
  });
});

app.post('/api/messages', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const user = getUserById(req.session.userId);
  if (!user || user.banned) {
    return res.status(403).json({ success: false, error: 'You cannot send messages while banned.' });
  }

  const channel = getChannelByName(req.body.channel);
  const content = (req.body.content || '').trim();

  if (!channel) {
    return res.status(404).json({ success: false, error: 'Channel not found.' });
  }

  if (!content) {
    return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
  }

  const message = {
    id: randomUUID(),
    channel: channel.name,
    userId: user.id,
    username: user.username,
    role: user.role,
    verified: user.verified,
    content,
    createdAt: new Date().toISOString(),
    deleted: false
  };

  db.messages.push(message);
  saveDatabase();

  io.to(channel.name).emit('message', message);
  res.json(message);
});

io.on('connection', (socket) => {
  const session = socket.request.session;
  if (!session || !session.userId) {
    socket.disconnect();
    return;
  }

  const user = getUserById(session.userId);
  if (!user || user.banned) {
    socket.disconnect();
    return;
  }

  socket.data.userId = user.id;
  socket.data.username = user.username;

  onlineUsers.set(user.id, {
    userId: user.id,
    username: user.username,
    role: user.role,
    verified: user.verified,
    socketId: socket.id
  });

  db.channels.forEach((channel) => {
    socket.join(channel.name);
  });

  io.emit('presence-update', { users: getPresenceUsers() });
  io.emit('system-message', {
    type: 'join',
    message: `${user.username} joined the server.`
  });

  socket.on('disconnect', () => {
    removeOnlineUser(user.id);
    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('system-message', {
      type: 'leave',
      message: `${user.username} left the server.`
    });
  });

  socket.on('typing', (payload) => {
    if (!payload || !payload.channel) {
      return;
    }

    const channel = getChannelByName(payload.channel);
    if (!channel) {
      return;
    }

    socket.to(channel.name).emit('typing', {
      userId: user.id,
      username: user.username,
      channel: channel.name,
      typing: Boolean(payload.typing)
    });
  });

  socket.on('message', (payload) => {
    if (!payload || !payload.channel || !payload.content) {
      return;
    }

    const channel = getChannelByName(payload.channel);
    if (!channel) {
      return;
    }

    const content = (payload.content || '').trim();
    if (!content) {
      return;
    }

    const message = {
      id: randomUUID(),
      channel: channel.name,
      userId: user.id,
      username: user.username,
      role: user.role,
      verified: user.verified,
      content,
      createdAt: new Date().toISOString(),
      deleted: false
    };

    db.messages.push(message);
    saveDatabase();

    io.to(channel.name).emit('message', message);
  });

  socket.on('admin:create-channel', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    if (db.channels.length >= 1) {
      socket.emit('system-message', { message: 'Only one channel is allowed.' });
      return;
    }

    const name = sanitizeChannelName(payload && payload.name);
    if (!name || name.length > 20) {
      socket.emit('system-message', { message: 'Channel name is invalid.' });
      return;
    }

    if (db.channels.some((channel) => channel.name === name)) {
      socket.emit('system-message', { message: `#${name} already exists.` });
      return;
    }

    const channel = buildChannel(name);
    db.channels.push(channel);
    saveDatabase();

    socket.join(channel.name);
    io.emit('channels-update', { channels: db.channels });
    io.emit('system-message', { type: 'admin', message: `${user.username} created #${name}.` });
  });

  socket.on('admin:ban-user', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target || isAdmin(target)) {
      return;
    }

    target.banned = true;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'ban-user',
      userId: target.id,
      username: target.username
    });
    io.emit('system-message', {
      type: 'admin',
      message: `${user.username} banned ${target.username}.`
    });
  });

  socket.on('admin:unban-user', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target) {
      return;
    }

    target.banned = false;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'unban-user',
      userId: target.id,
      username: target.username
    });
    io.emit('system-message', {
      type: 'admin',
      message: `${user.username} unbanned ${target.username}.`
    });
  });

  socket.on('admin:delete-message', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const message = db.messages.find((entry) => entry.id === payload.messageId);
    if (!message) {
      return;
    }

    message.deleted = true;
    saveDatabase();

    io.to(message.channel).emit('message-deleted', {
      messageId: message.id,
      channel: message.channel
    });
    io.emit('admin-action', {
      action: 'delete-message',
      messageId: message.id
    });
  });

  socket.on('admin:grant-blue-verification', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target) {
      return;
    }

    target.verified = target.verified || {};
    target.verified.blue = true;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'grant-blue-verification',
      userId: target.id,
      username: target.username
    });
  });

  socket.on('admin:remove-blue-verification', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target) {
      return;
    }

    target.verified = target.verified || {};
    target.verified.blue = false;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'remove-blue-verification',
      userId: target.id,
      username: target.username
    });
  });

  socket.on('admin:grant-gold-verification', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target) {
      return;
    }

    target.verified = target.verified || {};
    target.verified.gold = true;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'grant-gold-verification',
      userId: target.id,
      username: target.username
    });
  });

  socket.on('admin:remove-gold-verification', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target) {
      return;
    }

    target.verified = target.verified || {};
    target.verified.gold = false;
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: 'remove-gold-verification',
      userId: target.id,
      username: target.username
    });
  });

  socket.on('admin:set-user-admin', (payload) => {
    if (!isAdmin(user)) {
      return;
    }

    const target = getUserById(payload.userId);
    if (!target || target.id === user.id) {
      return;
    }

    target.role = payload.isAdmin ? 'Admin' : 'User';
    saveDatabase();

    io.emit('presence-update', { users: getPresenceUsers() });
    io.emit('admin-action', {
      action: payload.isAdmin ? 'set-user-admin' : 'remove-user-admin',
      userId: target.id,
      username: target.username
    });
    io.emit('system-message', {
      type: 'admin',
      message: `${user.username} ${payload.isAdmin ? 'promoted' : 'demoted'} ${target.username}.`
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SigmaChat running on http://localhost:${PORT}`);
});
