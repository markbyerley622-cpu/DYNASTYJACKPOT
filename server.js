// ================================
// 🏯 DYNASTY JACKPOT BACKEND SERVER
// ================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Better connection handling
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// === MIDDLEWARE ===
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.use(express.static("public"));

// === CONSTANTS ===
const TIMER_FILE = path.join(__dirname, "public", "timers.json");
const WINNERS_FILE = path.join(__dirname, "public", "winner.json");
const CONTRACT_FILE = path.join(__dirname, "public", "contract.json");
const DEV_KEY = process.env.DEV_KEY || "your";

// === Ensure timers.json exists ===
if (!fs.existsSync(TIMER_FILE)) {
  const defaultTimers = {
    "Mini Makis": { startedAt: Date.now() },
    "Lucky Rollers": { startedAt: Date.now() },
    "High Emperors (Mega)": { startedAt: Date.now() },
    "High Emperors (Mega 2)": { startedAt: Date.now() },
  };
  fs.writeFileSync(TIMER_FILE, JSON.stringify(defaultTimers, null, 2));
}

// === Ensure winners.json exists ===
if (!fs.existsSync(WINNERS_FILE)) {
  fs.writeFileSync(WINNERS_FILE, JSON.stringify([], null, 2));
  console.log("🆕 Created empty winners.json file");
}

// === Ensure contract.json exists ===
if (!fs.existsSync(CONTRACT_FILE)) {
  fs.writeFileSync(CONTRACT_FILE, JSON.stringify({ address: "" }, null, 2));
}

// ================================
// 🎮 LOBBY SOCKET.IO HANDLERS
// ================================

const connectedPlayers = new Map();
let chatHistory = [];
const MAX_CHAT_HISTORY = 50;
let connectionCount = 0;

io.on('connection', (socket) => {
  connectionCount++;
  console.log(`\n🔌 NEW CONNECTION #${connectionCount}`);
  console.log(`   Socket ID: ${socket.id}`);
  console.log(`   Transport: ${socket.conn.transport.name}`);
  console.log(`   Total Players: ${connectedPlayers.size}\n`);

  // === JOIN LOBBY ===
  socket.on('joinLobby', (username) => {
    try {
      console.log(`👤 JOIN LOBBY REQUEST:`);
      console.log(`   Username: ${username}`);
      console.log(`   Socket: ${socket.id}`);

      const playerData = {
        id: socket.id,
        username: username || 'Anonymous',
        joinedAt: Date.now()
      };

      connectedPlayers.set(socket.id, playerData);
      console.log(`✅ ${playerData.username} added to lobby (Total: ${connectedPlayers.size})`);

      // Send current players list to the new user
      const playersList = Array.from(connectedPlayers.values());
      console.log(`📤 Sending playersList to ${socket.id}:`, playersList.length, 'players');
      socket.emit('playersList', playersList);

      // Send chat history to new user
      if (chatHistory.length > 0) {
        console.log(`📜 Sending ${chatHistory.length} chat messages to ${socket.id}`);
        chatHistory.forEach(msg => socket.emit('chatMessage', msg));
      }

      // Notify all users
      console.log(`📢 Broadcasting playersList to all clients`);
      io.emit('playersList', playersList);
      io.emit('userJoined', { username: playerData.username });
    } catch (err) {
      console.error('❌ Error in joinLobby:', err);
    }
  });

  // === UPDATE USERNAME ===
  socket.on('updateUsername', (newUsername) => {
    try {
      const player = connectedPlayers.get(socket.id);
      if (player && newUsername && newUsername.trim()) {
        const oldUsername = player.username;
        player.username = newUsername.trim();
        connectedPlayers.set(socket.id, player);

        console.log(`✏️ ${oldUsername} → ${player.username}`);
        
        // Update all clients
        io.emit('playersList', Array.from(connectedPlayers.values()));
      }
    } catch (err) {
      console.error('❌ Error in updateUsername:', err);
    }
  });

  // === CHAT MESSAGE ===
  socket.on('chatMessage', (data) => {
    try {
      console.log(`💬 CHAT MESSAGE RECEIVED:`);
      console.log(`   From: ${socket.id}`);
      console.log(`   Data:`, data);

      const player = connectedPlayers.get(socket.id);
      if (!player) {
        console.warn(`⚠️ Message from unknown player: ${socket.id}`);
        console.warn(`   Connected players:`, Array.from(connectedPlayers.keys()));
        return;
      }

      // Validate message
      if (!data.message || data.message.trim().length === 0) {
        console.warn(`⚠️ Empty message from ${player.username}`);
        return;
      }

      // Create message object
      const message = {
        username: data.username || player.username,
        message: data.message.trim().substring(0, 500),
        timestamp: Date.now()
      };

      // Add to history
      chatHistory.push(message);
      if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory.shift();
      }

      console.log(`✅ Broadcasting message: ${message.username}: ${message.message}`);

      // Broadcast to all clients
      io.emit('chatMessage', message);
    } catch (err) {
      console.error('❌ Error in chatMessage:', err);
    }
  });

  // === DISCONNECT ===
  socket.on('disconnect', (reason) => {
    try {
      const player = connectedPlayers.get(socket.id);
      if (player) {
        console.log(`\n👋 DISCONNECT:`);
        console.log(`   User: ${player.username}`);
        console.log(`   Reason: ${reason}`);
        console.log(`   Remaining: ${connectedPlayers.size - 1}\n`);
        
        connectedPlayers.delete(socket.id);
        
        // Notify all users
        io.emit('playersList', Array.from(connectedPlayers.values()));
        io.emit('userLeft', { username: player.username });
      }
    } catch (err) {
      console.error('❌ Error in disconnect:', err);
    }
  });

  // === ERROR HANDLING ===
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

// Debug: Log all socket.io events
io.engine.on("connection_error", (err) => {
  console.error('❌ Socket.io connection error:', err);
});

// ================================
// 📡 REST API ENDPOINTS
// ================================

// === GET current timers ===
app.get("/api/timers", (req, res) => {
  try {
    const timers = JSON.parse(fs.readFileSync(TIMER_FILE, "utf8"));
    res.json(timers);
  } catch (err) {
    console.error("❌ Failed to load timers:", err);
    res.status(500).json({ error: "Failed to load timers" });
  }
});

// === POST: reset/start timer for a tier ===
app.post("/api/reset-timer", (req, res) => {
  const { tier, key } = req.body;
  if (key !== DEV_KEY) return res.status(403).json({ error: "Invalid key" });

  try {
    const timers = JSON.parse(fs.readFileSync(TIMER_FILE, "utf8"));
    timers[tier] = { startedAt: Date.now() };
    fs.writeFileSync(TIMER_FILE, JSON.stringify(timers, null, 2));
    console.log(`⏱️ Reset timer for ${tier}`);
    res.json({ success: true, tier, startedAt: timers[tier].startedAt });
  } catch (err) {
    console.error("❌ Error resetting timer:", err);
    res.status(500).json({ error: "Failed to reset timer" });
  }
});

// === POST: Reset ALL timers ===
app.post("/api/reset-all-timers", (req, res) => {
  const { key } = req.body;
  if (key !== DEV_KEY) return res.status(403).json({ error: "Invalid key" });

  try {
    const now = Date.now();
    const resetTimers = {
      "Mini Makis": { startedAt: now },
      "Lucky Rollers": { startedAt: now },
      "High Emperors (Mega)": { startedAt: now },
      "High Emperors (Mega 2)": { startedAt: now },
    };

    fs.writeFileSync(TIMER_FILE, JSON.stringify(resetTimers, null, 2));
    console.log("♻️ All timers reset globally");
    res.json({ success: true, startedAt: now });
  } catch (err) {
    console.error("❌ Failed to reset all timers:", err);
    res.status(500).json({ error: "Failed to reset all timers" });
  }
});

// === GET all winners ===
app.get("/api/winners", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(WINNERS_FILE, "utf8"));
    res.json(data);
  } catch (err) {
    console.error("❌ Error reading winners.json:", err);
    res.status(500).json({ error: "Failed to load winners" });
  }
});

// === GET recent winners (3 per tier) ===
app.get("/api/recent-winners", (req, res) => {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, "public", "recent-winners.json"), "utf8")
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load recent winners" });
  }
});

// === POST: add a new global winner entry ===
app.post("/api/update-winner", (req, res) => {
  const { tier, wallet, vrf, amount, txid, key } = req.body;

  if (key !== DEV_KEY) {
    console.log("🚫 Invalid Dev Key attempt");
    return res.status(403).json({ success: false, error: "Invalid key" });
  }

  if (!tier || !wallet || !amount) {
    return res.status(400).json({ success: false, error: "Missing data" });
  }

  try {
    let winners = [];
    try {
      winners = JSON.parse(fs.readFileSync(WINNERS_FILE, "utf8"));
      if (!Array.isArray(winners)) winners = [];
    } catch {
      winners = [];
    }

    const duplicate = winners.find(
      w =>
        w.tier === tier &&
        (w.txid === txid || w.wallet.toLowerCase() === wallet.toLowerCase())
    );

    if (duplicate) {
      console.warn(`⚠️ Duplicate winner skipped for ${tier} (${wallet})`);
      return res.json({ success: false, error: "Duplicate winner skipped" });
    }

    const newWinner = {
      tier,
      wallet,
      vrf: vrf || "—",
      amount,
      txid: txid || "—",
      date: new Date().toISOString(),
    };

    winners.push(newWinner);
    winners.sort((a, b) => new Date(b.date) - new Date(a.date));

    fs.writeFileSync(WINNERS_FILE, JSON.stringify(winners, null, 2));

    const recent = {};
    for (const w of winners) {
      const key = w.tier.toLowerCase();
      if (!recent[key]) recent[key] = [];
      if (recent[key].length < 3) recent[key].push(w);
    }

    const recentList = Object.values(recent).flat();
    fs.writeFileSync(
      path.join(__dirname, "public", "recent-winners.json"),
      JSON.stringify(recentList, null, 2)
    );

    console.log(`✅ Added ${tier} winner: ${wallet}`);
    res.json({ success: true, updated: newWinner });
  } catch (err) {
    console.error("❌ Error updating winners.json:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// === POST: sync winner ===
app.post("/api/winners", (req, res) => {
  try {
    const newWinner = req.body;
    const tier = newWinner.tier || newWinner.pool;

    if (!tier) return res.status(400).json({ error: "Missing tier/pool field" });

    let winners = [];
    try {
      winners = JSON.parse(fs.readFileSync(WINNERS_FILE, "utf8"));
      if (!Array.isArray(winners)) winners = [];
    } catch {
      winners = [];
    }

    winners = winners.filter(w => w.tier !== tier && w.pool !== tier);

    winners.unshift({
      ...newWinner,
      date: newWinner.date || new Date().toISOString(),
    });

    fs.writeFileSync(WINNERS_FILE, JSON.stringify(winners, null, 2));
    console.log(`✅ Synced ${tier}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error syncing winner:", err);
    res.status(500).json({ error: "Server error syncing winner" });
  }
});

// === GET contract address ===
app.get("/api/contract", (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(CONTRACT_FILE, "utf8"));
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to load contract address" });
  }
});

// === POST: update contract address ===
app.post("/api/update-contract", (req, res) => {
  const { address, key } = req.body;
  
  if (key !== process.env.DEV_KEY) {
    return res.status(403).json({ success: false, error: "Invalid dev key" });
  }

  if (!address || !address.startsWith("0x") || address.length !== 42) {
    return res.status(400).json({ success: false, error: "Invalid contract address format" });
  }

  fs.writeFileSync(CONTRACT_FILE, JSON.stringify({ address }, null, 2));
  console.log(`🪙 Updated global contract address: ${address}`);

  io.emit("contractUpdated");

  res.json({ success: true });
});

// === DEV endpoint: return current key ===
app.get("/api/dev-key", (req, res) => {
  res.json({ key: DEV_KEY });
});

// ================================
// 🎮 LOBBY ADMIN ENDPOINTS
// ================================

// === ADMIN: Clear chat history ===
app.post('/api/clear-chat', (req, res) => {
  const { key } = req.body;
  
  if (key !== DEV_KEY) {
    return res.status(403).json({ success: false, error: 'Invalid key' });
  }

  chatHistory = [];
  io.emit('chatHistoryCleared');
  
  console.log('🧹 Chat history cleared by admin');
  res.json({ success: true, message: 'Chat cleared' });
});

// === ADMIN: Get lobby stats ===
app.get('/api/lobby-stats', (req, res) => {
  res.json({
    connectedPlayers: connectedPlayers.size,
    chatMessages: chatHistory.length,
    players: Array.from(connectedPlayers.values()).map(p => ({
      username: p.username,
      joinedAt: p.joinedAt
    }))
  });
});

// === ADMIN: Broadcast system message ===
app.post('/api/broadcast-message', (req, res) => {
  const { message, key } = req.body;
  
  if (key !== DEV_KEY) {
    return res.status(403).json({ success: false, error: 'Invalid key' });
  }

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }

  const systemMsg = {
    username: '🏯 System',
    message: message.trim(),
    timestamp: Date.now()
  };

  io.emit('chatMessage', systemMsg);
  console.log(`📢 System broadcast: ${message}`);
  
  res.json({ success: true, message: 'Broadcast sent' });
});

// ================================
// 📄 SERVE HTML PAGES
// ================================

app.get("/:page", (req, res, next) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, "public", `${page}`);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: "Not Found" }));

// ================================
// 🚀 START SERVER
// ================================

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`✅ Dynasty Jackpot Server RUNNING`);
  console.log(`========================================`);
  console.log(`🌐 HTTP Server: http://localhost:${PORT}`);
  console.log(`🏯 Socket.io: ENABLED`);
  console.log(`🔑 Dev Key: ${DEV_KEY.substring(0, 3)}***`);
  console.log(`📁 Static Files: ./public`);
  console.log(`========================================\n`);
});

// ================================
// 🧹 AUTO-CLEANUP
// ================================

setInterval(() => {
  const now = Date.now();
  const TIMEOUT = 30 * 60 * 1000;

  for (const [socketId, player] of connectedPlayers) {
    if (now - player.joinedAt > TIMEOUT) {
      console.log(`⏰ Removing inactive player: ${player.username}`);
      connectedPlayers.delete(socketId);
      io.emit('playersList', Array.from(connectedPlayers.values()));
    }
  }
}, 5 * 60 * 1000);