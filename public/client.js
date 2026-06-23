const currentPage = document.body.dataset.page || 'chat';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message) {
  const area = document.getElementById('toastArea');
  if (!area) return;

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  area.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2400);
}

function createAvatar(username) {
  const initials = (username || 'U')
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const palette = ['#5865f2', '#57f287', '#f7b731', '#ff6b6b', '#3fa7ff', '#a78bfa'];
  const color = palette[(username || 'U').length % palette.length];

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
      <rect width="96" height="96" fill="${color}" rx="24" />
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="36" font-family="Arial, sans-serif">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function renderBadges(user) {
  if (!user || (!user.verified?.blue && !user.verified?.gold)) {
    return '';
  }

  const badges = [];
  if (user.verified?.blue) badges.push('<span class="badge blue">Blue</span>');
  if (user.verified?.gold) badges.push('<span class="badge gold">Gold</span>');
  return `<div class="user-badges">${badges.join('')}</div>`;
}

function initAuth(mode) {
  const form = mode === 'login'
    ? document.getElementById('loginForm')
    : document.getElementById('registerForm');

  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      username: document.getElementById(mode === 'login' ? 'loginUsername' : 'registerUsername').value.trim(),
      password: document.getElementById(mode === 'login' ? 'loginPassword' : 'registerPassword').value
    };

    const res = await fetch(mode === 'login' ? '/api/login' : '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok) {
      showToast(result.error || 'Request failed.');
      return;
    }

    window.location.href = '/';
  });
}

function initChat() {
  const state = {
    currentUser: null,
    currentChannel: 'general',
    channels: [],
    users: [],
    messages: [],
    typingUsers: new Map(),
    selectedUserId: null,
    selectedMessageId: null,
    socket: null
  };

  const channelListEl = document.getElementById('channelList');
  const userListEl = document.getElementById('userList');
  const messagesEl = document.getElementById('messages');
  const typingIndicatorEl = document.getElementById('typingIndicator');
  const channelTitleEl = document.getElementById('channelTitle');
  const channelSubtitleEl = document.getElementById('channelSubtitle');
  const messageInputEl = document.getElementById('messageInput');
  const messageFormEl = document.getElementById('messageForm');
  const adminPanelEl = document.getElementById('adminPanel');
  const adminUserDetailsEl = document.getElementById('adminUserDetails');
  const adminActionsEl = document.getElementById('adminActions');
  const currentUserNameEl = document.getElementById('currentUserName');
  const logoutBtn = document.getElementById('logoutBtn');
  const mobileAdminToggle = document.getElementById('mobileAdminToggle');

  async function loadCurrentUser() {
    const res = await fetch('/api/me');
    if (!res.ok) {
      window.location.href = '/login.html';
      return;
    }
    state.currentUser = await res.json();
    currentUserNameEl.textContent = state.currentUser.username;
    if (state.currentUser.role === 'Admin') {
      adminPanelEl.classList.remove('hidden');
    } else {
      adminPanelEl.classList.add('hidden');
    }
  }

  async function loadChannels() {
    const res = await fetch('/api/channels');
    const channels = await res.json();
    state.channels = channels;
    renderChannels();
  }

  async function loadUsers() {
    const res = await fetch('/api/users');
    state.users = await res.json();
    renderUsers();
    renderAdminPanel();
  }

  async function loadMessages(channelName) {
    const res = await fetch(`/api/messages/${encodeURIComponent(channelName)}`);
    const data = await res.json();
    state.messages = data.messages || [];
    renderMessages();
  }

  function renderChannels() {
    channelListEl.innerHTML = '';
    state.channels.forEach((channel) => {
      const btn = document.createElement('button');
      btn.className = `channel-btn ${channel.name === state.currentChannel ? 'active' : ''}`;
      btn.innerHTML = `
        <div>
          <div class="channel-name">${escapeHtml(channel.displayName || `#${channel.name}`)}</div>
          <div class="channel-meta">${escapeHtml(channel.name)}</div>
        </div>
      `;
      btn.addEventListener('click', () => switchChannel(channel.name));
      channelListEl.appendChild(btn);
    });
  }

  function renderUsers() {
    userListEl.innerHTML = '';

    state.users.forEach((user) => {
      const item = document.createElement('button');
      item.className = 'user-item';

      const avatar = createAvatar(user.username);

      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <img class="message-avatar" src="${avatar}" alt="${escapeHtml(user.username)}" />
          <div>
            <div class="user-name">${escapeHtml(user.username)}</div>
            <div class="user-meta">${escapeHtml(user.role)}</div>
            ${renderBadges(user)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          ${user.online ? '<span class="status-dot online"></span>' : '<span class="status-dot offline"></span>'}
        </div>
      `;

      item.addEventListener('click', () => {
        state.selectedUserId = user.id;
        renderAdminPanel();
      });

      userListEl.appendChild(item);
    });
  }

  function renderMessages() {
    messagesEl.innerHTML = '';

    if (!state.messages.length) {
      messagesEl.innerHTML = '<div class="empty-state">No messages in this channel yet.</div>';
      return;
    }

    state.messages.forEach((message) => {
      const wrapper = document.createElement('div');
      wrapper.className = `message ${state.selectedMessageId === message.id ? 'selected' : ''}`;
      const avatar = createAvatar(message.username);

      const badges = [];
      if (message.verified && message.verified.blue) badges.push('<span class="badge blue">Blue</span>');
      if (message.verified && message.verified.gold) badges.push('<span class="badge gold">Gold</span>');

      wrapper.innerHTML = `
        <img class="message-avatar" src="${avatar}" alt="${escapeHtml(message.username)}" />
        <div class="message-content">
          <div class="message-head">
            <span class="message-username">${escapeHtml(message.username)}</span>
            ${badges.join('')}
            <span class="message-time">${escapeHtml(formatTimestamp(message.createdAt))}</span>
          </div>
          <div class="message-body">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
          <div class="message-id">ID: ${escapeHtml(message.id)}</div>
        </div>
      `;

      if (state.currentUser && state.currentUser.role === 'Admin') {
        wrapper.addEventListener('click', () => {
          state.selectedMessageId = message.id;
          renderMessages();
          renderAdminPanel();
        });
      }

      messagesEl.appendChild(wrapper);
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderTypingIndicator() {
    const names = Array.from(state.typingUsers.values());
    if (!names.length) {
      typingIndicatorEl.textContent = '';
      return;
    }

    const label = names.length > 1 ? 'are typing...' : 'is typing...';
    typingIndicatorEl.textContent = `${names.join(', ')} ${label}`;
  }

  function renderAdminPanel() {
    if (!state.currentUser || state.currentUser.role !== 'Admin') {
      adminPanelEl.classList.add('hidden');
      return;
    }

    adminPanelEl.classList.remove('hidden');

    const selectedUser = state.users.find((user) => user.id === state.selectedUserId);
    const selectedMessage = state.messages.find((message) => message.id === state.selectedMessageId);

    adminUserDetailsEl.innerHTML = '';

    if (!selectedUser) {
      adminUserDetailsEl.innerHTML = `
        <div class="admin-card">
          <strong>Select a user</strong>
          <p>Choose someone from the users list to manage their account.</p>
        </div>
      `;
    } else {
      adminUserDetailsEl.innerHTML = `
        <div class="admin-card">
          <strong>${escapeHtml(selectedUser.username)}</strong>
          <p>Role: ${escapeHtml(selectedUser.role)}</p>
          <p>Online: ${selectedUser.online ? 'Yes' : 'No'}</p>
          <p>Badges: ${selectedUser.verified?.blue || selectedUser.verified?.gold ? renderBadges(selectedUser).replace(/<[^>]+>/g, '').trim() || 'None' : 'None'}</p>
          <p>Banned: ${selectedUser.banned ? 'Yes' : 'No'}</p>
        </div>
      `;
    }

    adminActionsEl.innerHTML = '';

    if (!selectedUser) {
      adminActionsEl.innerHTML = '<div class="admin-card">No user selected.</div>';
      return;
    }

    const actions = [];

    actions.push(`
      <button class="admin-btn ${selectedUser.banned ? '' : 'danger'}" data-admin-action="${selectedUser.banned ? 'unban' : 'ban'}">
        ${selectedUser.banned ? 'Unban user' : 'Ban user'}
      </button>
    `);

    actions.push(`
      <button class="admin-btn" data-admin-action="${selectedUser.verified && selectedUser.verified.blue ? 'remove-blue' : 'grant-blue'}">
        ${selectedUser.verified && selectedUser.verified.blue ? 'Remove blue verification' : 'Grant blue verification'}
      </button>
    `);

    actions.push(`
      <button class="admin-btn" data-admin-action="${selectedUser.verified && selectedUser.verified.gold ? 'remove-gold' : 'grant-gold'}">
        ${selectedUser.verified && selectedUser.verified.gold ? 'Remove gold verification' : 'Grant gold verification'}
      </button>
    `);

    actions.push(`
      <button class="admin-btn" data-admin-action="${selectedUser.role === 'Admin' ? 'remove-admin' : 'set-admin'}">
        ${selectedUser.role === 'Admin' ? 'Remove admin' : 'Set user admin'}
      </button>
    `);

    if (selectedMessage) {
      actions.push(`
        <button class="admin-btn danger" data-admin-action="delete-message">
          Delete selected message
        </button>
      `);
    }

    adminActionsEl.innerHTML = actions.join('');
  }

  function switchChannel(channelName) {
    state.currentChannel = channelName;
    channelTitleEl.textContent = `#${channelName}`;
    channelSubtitleEl.textContent = 'Single-channel chat with realtime history';
    messageInputEl.placeholder = `Message #${channelName}`;
    state.selectedMessageId = null;
    renderChannels();
    loadMessages(channelName);
  }

  async function initialize() {
    await loadCurrentUser();
    await loadChannels();
    await loadUsers();
    switchChannel(state.currentChannel);
    renderAdminPanel();

    state.socket = io();

    state.socket.on('connect', () => {
      showToast('Connected to SigmaChat');
    });

    state.socket.on('message', (message) => {
      if (message.channel === state.currentChannel) {
        state.messages.push(message);
        renderMessages();
      }
    });

    state.socket.on('message-deleted', ({ messageId, channel }) => {
      if (channel === state.currentChannel) {
        state.messages = state.messages.filter((message) => message.id !== messageId);
        renderMessages();
      }
    });

    state.socket.on('typing', ({ userId, username, channel, typing }) => {
      if (channel !== state.currentChannel) return;
      if (typing) {
        state.typingUsers.set(userId, username);
      } else {
        state.typingUsers.delete(userId);
      }
      renderTypingIndicator();
    });

    state.socket.on('presence-update', ({ users }) => {
      state.users = users;
      renderUsers();
      renderAdminPanel();
    });

    state.socket.on('channels-update', ({ channels }) => {
      state.channels = channels;
      renderChannels();
      if (!channels.some((channel) => channel.name === state.currentChannel)) {
        switchChannel(channels[0].name);
      }
    });

    state.socket.on('system-message', ({ message }) => {
      showToast(message);
    });

    state.socket.on('admin-action', () => {
      loadUsers();
    });
  }

  messageFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = messageInputEl.value.trim();
    if (!content) return;

    state.socket.emit('message', {
      channel: state.currentChannel,
      content
    });

    messageInputEl.value = '';
  });

  messageInputEl.addEventListener('input', () => {
    const typing = messageInputEl.value.trim().length > 0;
    state.socket.emit('typing', {
      channel: state.currentChannel,
      typing
    });
  });

  adminActionsEl.addEventListener('click', (event) => {
    const action = event.target.dataset.adminAction;
    if (!action) return;

    if (action === 'ban') {
      state.socket.emit('admin:ban-user', { userId: state.selectedUserId });
    } else if (action === 'unban') {
      state.socket.emit('admin:unban-user', { userId: state.selectedUserId });
    } else if (action === 'grant-blue') {
      state.socket.emit('admin:grant-blue-verification', { userId: state.selectedUserId });
    } else if (action === 'remove-blue') {
      state.socket.emit('admin:remove-blue-verification', { userId: state.selectedUserId });
    } else if (action === 'grant-gold') {
      state.socket.emit('admin:grant-gold-verification', { userId: state.selectedUserId });
    } else if (action === 'remove-gold') {
      state.socket.emit('admin:remove-gold-verification', { userId: state.selectedUserId });
    } else if (action === 'set-admin') {
      state.socket.emit('admin:set-user-admin', { userId: state.selectedUserId, isAdmin: true });
    } else if (action === 'remove-admin') {
      state.socket.emit('admin:set-user-admin', { userId: state.selectedUserId, isAdmin: false });
    } else if (action === 'delete-message') {
      state.socket.emit('admin:delete-message', { messageId: state.selectedMessageId });
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  mobileAdminToggle.addEventListener('click', () => {
    adminPanelEl.classList.toggle('visible');
  });

  initialize();
}

if (currentPage === 'login') {
  initAuth('login');
} else if (currentPage === 'register') {
  initAuth('register');
} else {
  initChat();
}
