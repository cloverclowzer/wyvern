const state = {
  user: null,
  channels: [],
  activeChannel: 'general',
  messages: [],
  users: []
};

const authPanel = document.getElementById('auth-panel');
const channelPanel = document.getElementById('channel-panel');
const channelList = document.getElementById('channel-list');
const channelTitle = document.getElementById('channel-title');
const channelSubtitle = document.getElementById('channel-subtitle');
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const userBubble = document.getElementById('user-bubble');
const adminPanel = document.getElementById('admin-panel');
const channelForm = document.getElementById('channel-form');
const refreshChannelsButton = document.getElementById('refresh-channels');

function getToken() {
  return localStorage.getItem('wyvern-token');
}

function setToken(token) {
  if (token) localStorage.setItem('wyvern-token', token);
  else localStorage.removeItem('wyvern-token');
}

function renderBadges(user) {
  const badges = user?.badges || [];
  const parts = [];
  if (badges.includes('blue')) parts.push('<span class="badge blue">✔ Blue</span>');
  if (badges.includes('gold')) parts.push('<span class="badge gold">★ Gold</span>');
  return parts.join('');
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) headers['x-auth-token'] = token;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function renderAuth() {
  if (state.user) {
    authPanel.innerHTML = `
      <div class="auth-form">
        <h2>Signed in</h2>
        <p>Hello, <strong>${state.user.username}</strong></p>
        <p class="badges">${renderBadges(state.user)}</p>
        <button id="logout-btn" class="secondary">Logout</button>
      </div>
    `;
    channelPanel.classList.remove('hidden');
    messageForm.classList.remove('hidden');
    userBubble.innerHTML = `
      <div>
        <strong>${state.user.username}</strong>
        <div class="badges">${renderBadges(state.user)}</div>
      </div>
      <button id="logout-btn-inline" class="secondary">Logout</button>
    `;
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('logout-btn-inline')?.addEventListener('click', logout);
    return;
  }

  authPanel.innerHTML = `
    <div class="auth-form">
      <div class="auth-switch">
        <button id="show-login" class="active">Login</button>
        <button id="show-register">Register</button>
      </div>
      <form id="login-form">
        <input id="login-username" placeholder="Username" required />
        <input id="login-password" type="password" placeholder="Password" required />
        <button type="submit">Login</button>
      </form>
      <form id="register-form" class="hidden">
        <input id="register-username" placeholder="Username" required />
        <input id="register-password" type="password" placeholder="Password" required />
        <button type="submit">Register</button>
      </form>
    </div>
  `;

  channelPanel.classList.add('hidden');
  messageForm.classList.add('hidden');
  userBubble.innerHTML = '<span>Not signed in</span>';

  document.getElementById('show-login').addEventListener('click', () => {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('show-login').classList.add('active');
    document.getElementById('show-register').classList.remove('active');
  });

  document.getElementById('show-register').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('show-register').classList.add('active');
    document.getElementById('show-login').classList.remove('active');
  });

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      setToken(data.token);
      state.user = data.user;
      renderAuth();
      loadChannels();
      loadMessages();
      loadUsers();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('register-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    try {
      const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password }) });
      setToken(data.token);
      state.user = data.user;
      renderAuth();
      loadChannels();
      loadMessages();
      loadUsers();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function bootstrap() {
  const token = getToken();
  if (token) {
    try {
      const data = await api('/api/me');
      state.user = data.user;
    } catch (error) {
      setToken(null);
      state.user = null;
    }
  }

  renderAuth();
  loadChannels();
  loadMessages();
  if (state.user) loadUsers();
  setInterval(() => {
    if (state.user) {
      loadMessages();
      loadUsers();
    }
  }, 4000);
}

async function loadChannels() {
  try {
    const data = await api('/api/channels');
    state.channels = data.channels;
    renderChannels();
  } catch (error) {
    console.error(error);
  }
}

function renderChannels() {
  channelList.innerHTML = '';
  state.channels.forEach((channel) => {
    const btn = document.createElement('button');
    btn.className = `channel-pill ${channel.id === state.activeChannel ? 'active' : ''}`;
    btn.innerHTML = `<strong># ${channel.name}</strong><small>${channel.description}</small>`;
    btn.addEventListener('click', () => {
      state.activeChannel = channel.id;
      channelTitle.textContent = `# ${channel.name}`;
      channelSubtitle.textContent = channel.description;
      renderChannels();
      loadMessages();
    });
    channelList.appendChild(btn);
  });

  const activeChannel = state.channels.find((channel) => channel.id === state.activeChannel) || state.channels[0];
  if (activeChannel) {
    state.activeChannel = activeChannel.id;
    channelTitle.textContent = `# ${activeChannel.name}`;
    channelSubtitle.textContent = activeChannel.description;
  }
}

async function loadMessages() {
  if (!state.activeChannel) return;
  try {
    const data = await api(`/api/messages?channelId=${encodeURIComponent(state.activeChannel)}`);
    state.messages = data.messages;
    renderMessages();
  } catch (error) {
    console.error(error);
  }
}

function renderMessages() {
  messageList.innerHTML = '';
  if (!state.messages.length) {
    messageList.innerHTML = '<div class="message-card"><p>No messages yet. Start the conversation.</p></div>';
    return;
  }

  state.messages.forEach((message) => {
    const user = state.users.find((entry) => entry.username === message.username) || { username: message.username, badges: [] };
    const card = document.createElement('article');
    card.className = 'message-card';
    card.innerHTML = `
      <div class="message-meta">
        <div>
          <span class="message-name">${message.username}</span>
          <span class="badges">${renderBadges(user)}</span>
        </div>
        <div>${new Date(message.timestamp).toLocaleString()}</div>
      </div>
      <div>${message.content}</div>
      ${state.user?.role === 'admin' ? `<button class="danger" data-delete-id="${message.id}">Delete</button>` : ''}
    `;
    if (state.user?.role === 'admin') {
      card.querySelector('[data-delete-id]')?.addEventListener('click', () => deleteMessage(message.id));
    }
    messageList.appendChild(card);
  });
}

async function deleteMessage(messageId) {
  try {
    await api(`/api/messages/${messageId}/delete`, { method: 'POST' });
    loadMessages();
  } catch (error) {
    alert(error.message);
  }
}

async function loadUsers() {
  if (!state.user || state.user.role !== 'admin') {
    adminPanel.classList.add('hidden');
    return;
  }

  try {
    const data = await api('/api/users');
    state.users = data.users;
    renderAdminPanel();
  } catch (error) {
    console.error(error);
  }
}

function renderAdminPanel() {
  adminPanel.classList.remove('hidden');
  adminPanel.innerHTML = `
    <div class="panel-heading">
      <h2>Admin tools</h2>
    </div>
    <div>${state.users.map((user) => `
      <div class="admin-user-row">
        <div>
          <strong>${user.username}</strong>
          <div class="badges">${renderBadges(user)}</div>
        </div>
        <div class="admin-actions">
          <button class="secondary" data-ban-user="${user.username}" data-ban-value="${user.banned ? 'false' : 'true'}">${user.banned ? 'Unban' : 'Ban'}</button>
          <button class="secondary" data-badge-user="${user.username}" data-badge="blue" data-badge-enabled="${(user.badges || []).includes('blue') ? 'false' : 'true'}">${(user.badges || []).includes('blue') ? 'Remove blue' : 'Add blue'}</button>
          <button class="secondary" data-badge-user="${user.username}" data-badge="gold" data-badge-enabled="${(user.badges || []).includes('gold') ? 'false' : 'true'}">${(user.badges || []).includes('gold') ? 'Remove gold' : 'Add gold'}</button>
        </div>
      </div>
    `).join('')}</div>
  `;

  adminPanel.querySelectorAll('[data-ban-user]').forEach((button) => {
    button.addEventListener('click', () => toggleBan(button.dataset.banUser, button.dataset.banValue === 'true'));
  });

  adminPanel.querySelectorAll('[data-badge-user]').forEach((button) => {
    button.addEventListener('click', () => toggleBadge(button.dataset.badgeUser, button.dataset.badge, button.dataset.badgeEnabled === 'true'));
  });
}

async function toggleBan(username, value) {
  try {
    await api(`/api/users/${encodeURIComponent(username)}/ban`, { method: 'POST', body: JSON.stringify({ value }) });
    loadUsers();
  } catch (error) {
    alert(error.message);
  }
}

async function toggleBadge(username, badge, enabled) {
  try {
    await api(`/api/users/${encodeURIComponent(username)}/badge`, { method: 'POST', body: JSON.stringify({ badge, enabled }) });
    loadUsers();
    if (state.user && state.user.username === username) {
      const data = await api('/api/me');
      state.user = data.user;
      renderAuth();
    }
  } catch (error) {
    alert(error.message);
  }
}

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content) return;
  try {
    await api('/api/messages', { method: 'POST', body: JSON.stringify({ channelId: state.activeChannel, content }) });
    messageInput.value = '';
    loadMessages();
  } catch (error) {
    alert(error.message);
  }
});

channelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('channel-name').value.trim();
  const description = document.getElementById('channel-description').value.trim();
  try {
    const data = await api('/api/channels', { method: 'POST', body: JSON.stringify({ name, description }) });
    document.getElementById('channel-name').value = '';
    document.getElementById('channel-description').value = '';
    state.activeChannel = data.channel.id;
    loadChannels();
    loadMessages();
  } catch (error) {
    alert(error.message);
  }
});

refreshChannelsButton.addEventListener('click', loadChannels);

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (error) {
    console.error(error);
  }
  setToken(null);
  state.user = null;
  state.users = [];
  renderAuth();
  loadMessages();
}

bootstrap();
