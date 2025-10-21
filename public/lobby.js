// ================================
// 🏯 DYNASTY JACKPOT LOBBY CLIENT
// ================================

// Initialize Socket.io connection - AUTO-DETECT URL
const socket = io(
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://dynastyjackpot.asia",
  {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  }
);

// DOM elements
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const usernameInput = document.getElementById("usernameInput");
const sendBtn = document.getElementById("sendBtn");
const playersList = document.getElementById("playersList");
const playerCount = document.getElementById("playerCount");
const connectionStatus = document.getElementById("connectionStatus");

// Store username in memory
let username = "";
let isConnected = false;
let hasJoinedLobby = false;

// Load saved username from localStorage
const savedUsername = localStorage.getItem("lobbyUsername");
if (savedUsername) {
  usernameInput.value = savedUsername;
  username = savedUsername;
}

// === CONNECTION HANDLERS ===
socket.on("connect", () => {
  console.log("✅ Connected to Dynasty Lobby - Socket ID:", socket.id);
  isConnected = true;
  hasJoinedLobby = false;
  updateConnectionStatus(true);

  const displayName = username || "Anonymous";
  socket.emit("joinLobby", displayName);
  hasJoinedLobby = true;
});

socket.on("disconnect", (reason) => {
  console.log("🔴 Disconnected from lobby. Reason:", reason);
  isConnected = false;
  hasJoinedLobby = false;
  updateConnectionStatus(false);
});

socket.on("reconnect_attempt", (attempt) => {
  console.log(`♻️ Reconnection attempt ${attempt}`);
  updateConnectionStatus(false);
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection error:", error);
  isConnected = false;
  updateConnectionStatus(false);
});

// === UPDATE CONNECTION STATUS ===
function updateConnectionStatus(connected) {
  if (connected) {
    connectionStatus.textContent = "🟢 Connected to Dynasty Lobby";
    connectionStatus.className = "connection-status status-connected";
  } else {
    connectionStatus.textContent = "🔴 Disconnected — attempting to reconnect...";
    connectionStatus.className = "connection-status status-disconnected";
  }
}

// === SOCKET EVENT LISTENERS ===
socket.on("playersList", (players) => {
  console.log("📋 Updated players list:", players.length);
  updatePlayersList(players);
});

socket.on("chatMessage", (data) => {
  console.log("💬 Message received:", data);
  addMessage(data);
});

socket.on("chatHistoryCleared", () => {
  console.log("💨 Chat cleared by server");
  chatMessages.innerHTML = "";
  addSystemMessage("💨 Chat history refreshed");
});

socket.on("userJoined", (data) => {
  console.log("👋 User joined:", data.username);
  addSystemMessage(`${data.username} joined the lobby`);
});

socket.on("userLeft", (data) => {
  console.log("👋 User left:", data.username);
  addSystemMessage(`${data.username} left the lobby`);
});

// === SEND MESSAGE FUNCTION ===
function sendMessage() {
  const message = chatInput.value.trim();
  const user = usernameInput.value.trim() || "Anonymous";

  if (!isConnected) {
    addSystemMessage("⚠️ Not connected. Please wait...");
    return;
  }

  if (!message) return;

  if (sendBtn.disabled) return;

  if (user !== username) {
    const oldUsername = username;
    username = user;

    if (user !== "Anonymous") {
      localStorage.setItem("lobbyUsername", username);
    }

    if (hasJoinedLobby && oldUsername !== user) {
      socket.emit("updateUsername", user);
      console.log("✏️ Username updated:", user);
    }
  }

  socket.emit("chatMessage", {
    username: user,
    message,
    timestamp: Date.now(),
  });

  chatInput.value = "";
  sendBtn.disabled = true;
  setTimeout(() => (sendBtn.disabled = false), 500);
}

// === EVENT LISTENERS ===
sendBtn.addEventListener("click", sendMessage);
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

usernameInput.addEventListener("blur", () => {
  const newUsername = usernameInput.value.trim();
  if (newUsername && newUsername !== username && hasJoinedLobby) {
    username = newUsername;
    localStorage.setItem("lobbyUsername", username);
    socket.emit("updateUsername", username);
  }
});

usernameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const newUsername = usernameInput.value.trim();
    if (newUsername && newUsername !== username) {
      username = newUsername;
      localStorage.setItem("lobbyUsername", username);
      if (hasJoinedLobby) socket.emit("updateUsername", username);
      chatInput.focus();
    }
  }
});

chatMessages.addEventListener("click", () => chatInput.focus());

// === UI FUNCTIONS ===
function addMessage(data) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "message message-user";

  const timestamp = new Date(data.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-username">${escapeHtml(data.username)}</span>
      <span class="message-time">${timestamp}</span>
    </div>
    <div class="message-content">${escapeHtml(data.message)}</div>
  `;

  chatMessages.appendChild(messageDiv);
  scrollToBottom();

  const messages = chatMessages.querySelectorAll(".message");
  if (messages.length > 100) messages[0].remove();
}

function addSystemMessage(text) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "message message-system";
  messageDiv.textContent = text;
  chatMessages.appendChild(messageDiv);
  scrollToBottom();
}

function updatePlayersList(players) {
  playersList.innerHTML = "";

  if (!players || players.length === 0) {
    playerCount.textContent = "0 players";
    const emptyDiv = document.createElement("div");
    emptyDiv.style.textAlign = "center";
    emptyDiv.style.color = "rgba(247, 244, 234, 0.5)";
    emptyDiv.style.padding = "20px";
    emptyDiv.textContent = "No players online";
    playersList.appendChild(emptyDiv);
    return;
  }

  playerCount.textContent = `${players.length} ${
    players.length === 1 ? "player" : "players"
  }`;

  players.forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-item";
    const initial = player.username ? player.username[0].toUpperCase() : "?";
    playerDiv.innerHTML = `
      <div class="player-avatar">${initial}</div>
      <div class="player-name">${escapeHtml(player.username)}</div>
    `;
    playersList.appendChild(playerDiv);
  });
}

function scrollToBottom() {
  if (!isUserScrolling) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// === AUTO-SCROLL DETECTION ===
let isUserScrolling = false;
let scrollTimeout;

chatMessages.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = chatMessages;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
  isUserScrolling = !isAtBottom;

  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => (isUserScrolling = false), 3000);
});

// === INITIAL WELCOME ===
setTimeout(() => {
  addSystemMessage("🏯 Welcome to Dynasty Jackpot Lobby!");
  addSystemMessage("💬 Set your username and start chatting with other players.");
}, 800);

console.log("🏯 Dynasty Lobby Client Initialized");
console.log("🔗 Connecting to:", socket.io.uri);
