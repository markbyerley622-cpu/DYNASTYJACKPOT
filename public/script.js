
const menuToggle = document.getElementById('menu-toggle');
const navMenu = document.querySelector('.nav');

if (menuToggle && navMenu) {
  menuToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    menuToggle.classList.toggle('open');
  });
}


// === REVEAL WINNER (triggered only by timer end) ===
async function revealWinner(poolName) {
  try {
    const res = await fetch('/winner.json?_=' + Date.now());
    const winners = await res.json();

    if (!Array.isArray(winners)) {
      console.warn('winner.json not an array:', winners);
      return;
    }

    const winner = winners.find(w => w.tier && w.tier.includes(poolName));
    const box = document.querySelector(`.winner-box[data-pool="${poolName}"]`);
    if (!box) return;

    if (winner) {
      // === Detect network type from wallet prefix ===
      let explorerBase = '';
      if (winner.wallet?.startsWith('0x')) {
        // BNB or other EVM chain
        explorerBase = 'https://bscscan.com/tx/';
      } else {
        // Solana-style address
        explorerBase = 'https://solscan.io/tx/';
      }

      // Show winner box
      box.classList.add('revealed');

      box.querySelector('.wallet').textContent = winner.wallet || '—';
      box.querySelector('.amount').textContent = winner.amount || '—';
      box.querySelector('.tx').innerHTML = winner.txid
        ? `<a href="${explorerBase}${winner.txid}" target="_blank">View TX</a>`
        : '—';
      box.querySelector('.vrf').innerHTML = winner.vrf
        ? `<a href="${winner.vrf}" target="_blank">VRF File</a>`
        : '—';

      // 💾 Push winner to the global server DB
      await handleWinnerUpload(
        poolName,
        winner.wallet,
        winner.amount,
        winner.txid,
        winner.vrf
      );

      // 🏮 Update "Previous Winners" after reveal
      await loadWinners(true);

    } else {
      console.warn(`No winner found for ${poolName}`);
    }
  } catch (err) {
    console.error(`⚠️ Error revealing ${poolName} winner:`, err);
  }
}


// === Countdown System (auto restart after reveal) ===
function startCountdown(id, seconds, tier) {
  const el = document.getElementById(id);
  if (!el) return console.warn(`⚠️ Timer element not found for ${tier}`);

  let remaining = seconds;

  function updateDisplay() {
    const hrs = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    const secs = remaining % 60;
    el.textContent = `${hrs}h ${mins}m ${secs}s`;
  }

  // Initial render
  updateDisplay();

  // Clear any existing interval
  if (el.dataset.timerInterval) clearInterval(el.dataset.timerInterval);

  const interval = setInterval(async () => {
    remaining--;

    if (remaining <= 0) {
      clearInterval(interval);
      el.textContent = "🎉 Draw in progress!";

      // === STEP 1: Reveal winner
      await revealWinner(tier);

      // === STEP 2: Keep winner visible for 30s
      setTimeout(async () => {
        // === STEP 3: Hide / blur again (optional CSS)
        const box = document.querySelector(`.winner-box[data-pool="${tier}"]`);
        if (box) box.classList.remove("revealed");

        // === STEP 4: Reset timer on server
        await fetch("/api/reset-timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier, key: "your" }), // same DEV_KEY as .env
        });

        // === STEP 5: Fetch latest timers & restart countdown
        const res = await fetch("/api/timers");
        const timers = await res.json();
        const { startedAt } = timers[tier];
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const remaining = Math.max(TIMER_DURATIONS[tier] - elapsed, 0);
        startCountdown(id, remaining, tier);

      }, 30000); // <-- 30 seconds before resetting
    } else {
      updateDisplay();
    }
  }, 1000);

  el.dataset.timerInterval = interval;
}


// === GLOBAL TIMER DURATIONS (in seconds) ===
const TIMER_DURATIONS = {
  "Mini Makis": 15 * 60,
  "Lucky Rollers": 25 * 60,
  "High Emperors (Mega 2)": 45 * 60,
  "High Emperors (Mega)": 24 * 60 * 60,
};

// === INIT GLOBAL COUNTDOWNS ===
async function initGlobalTimers() {
  try {
    const res = await fetch("/api/timers");
    const timers = await res.json();

    for (const [tier, { startedAt }] of Object.entries(timers)) {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(TIMER_DURATIONS[tier] - elapsed, 0);

      console.log(`⏳ ${tier}: ${remaining}s remaining`);
      const id = {
        "Mini Makis": "small-timer",
        "Lucky Rollers": "mid-timer",
        "High Emperors (Mega)": "mega-timer",
        "High Emperors (Mega 2)": "mega-timer2",
      }[tier];

      startCountdown(id, remaining, tier);
    }
  } catch (err) {
    console.error("⚠️ Failed to load timers:", err);
  }
}

// Run on page load
document.addEventListener("DOMContentLoaded", initGlobalTimers);


// === When a countdown finishes, auto-pick and upload winner ===
async function handleWinnerUpload(tier, wallet, amount, txid = "", vrf = "") {
  // --- Global safety map ---
  window.winnerUploaded = window.winnerUploaded || {};
  window.winnerCooldown = window.winnerCooldown || {};

  // --- Prevent duplicate uploads (same session) ---
  if (window.winnerUploaded[tier]) {
    console.warn(`⚠️ ${tier} winner already uploaded this cycle.`);
    return;
  }

  // --- Cooldown: if function triggered multiple times in <10s ---
  if (window.winnerCooldown[tier]) {
    console.warn(`⚠️ ${tier} upload in cooldown.`);
    return;
  }

  // mark as running and apply cooldown
  window.winnerUploaded[tier] = true;
  window.winnerCooldown[tier] = true;
  setTimeout(() => (window.winnerCooldown[tier] = false), 10000); // 10s safety window

  try {
    const response = await fetch("/api/update-winner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tier,
        wallet,
        amount,
        txid,
        vrf,
        key: "your", // must match .env
      }),
    });

    const data = await response.json();
    if (response.ok) {
      console.log(`✅ ${tier} winner saved to server`, data);
      updateWinnerBox(tier, data.updated);
    } else {
      console.warn(`⚠️ Failed to save ${tier} winner:`, data.error);
    }
  } catch (err) {
    console.error("❌ Error uploading winner:", err);
  }
}

document.getElementById("follow-x").addEventListener("click", () => {
  window.open("https://x.com/DynastyJackpot", "_blank"); // replace with your real X URL
});

document.getElementById("compatible").addEventListener("click", () => {
  alert("✅ Dynasty Jackpot is fully compatible with all devices — mobile, tablet, and desktop!");
});


// === FLOATING LANTERNS + PETALS BACKGROUND ===
const lanternCanvas = document.createElement("canvas");
lanternCanvas.id = "lanternCanvas";
Object.assign(lanternCanvas.style, {
  position: "fixed",
  inset: "0",
  width: "100%",
  height: "100%",
  zIndex: "0",
  pointerEvents: "none",
});
document.body.prepend(lanternCanvas);

const ctx = lanternCanvas.getContext("2d");
let w, h;
function resizeCanvas() {
  w = lanternCanvas.width = window.innerWidth;
  h = lanternCanvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

const chineseSymbols = ["福", "喜", "龙", "财", "寿", "运", "梦", "金", "光", "安"];

class Lantern {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = Math.random() * w;
    this.y = h + Math.random() * h;
    this.size = 25 + Math.random() * 35;
    this.speed = 0.3 + Math.random() * 0.6;
    this.phase = Math.random() * Math.PI * 2;
    this.opacity = 0.7 + Math.random() * 0.3;
    this.symbol = chineseSymbols[Math.floor(Math.random() * chineseSymbols.length)];
    this.swing = 0;
  }
  update() {
    this.y -= this.speed;
    this.swing += 0.02;
    this.x += Math.sin(this.swing + this.phase) * 0.3;
    if (this.y < -50) this.reset();
  }
  draw(ctx) {
    const grad = ctx.createLinearGradient(this.x, this.y - this.size, this.x, this.y + this.size);
    grad.addColorStop(0, "rgba(255,120,60,0.9)");
    grad.addColorStop(0.5, "rgba(255,60,0,0.8)");
    grad.addColorStop(1, "rgba(120,0,0,0.9)");
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.size * 0.6, this.size, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.shadowBlur = 15;
    ctx.shadowColor = "rgba(255,80,40,0.7)";
    ctx.globalAlpha = this.opacity;
    ctx.fill();
    ctx.save();
    ctx.font = `${this.size * 0.9}px "Noto Serif SC", serif`;
    ctx.fillStyle = "rgba(255,240,180,0.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255,200,80,0.6)";
    ctx.shadowBlur = 8;
    ctx.fillText(this.symbol, this.x, this.y);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(this.x, this.y + this.size);
    ctx.lineTo(this.x, this.y + this.size * 1.3);
    ctx.strokeStyle = "rgba(255,220,150,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

const clouds = Array.from({ length: 6 }).map(() => ({
  x: Math.random() * w,
  y: Math.random() * h * 0.5,
  size: 200 + Math.random() * 200,
  speed: 0.05 + Math.random() * 0.1,
  opacity: 0.05 + Math.random() * 0.07,
}));

function drawClouds() {
  for (const c of clouds) {
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.size);
    grad.addColorStop(0, `rgba(255,230,180,${c.opacity})`);
    grad.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
    ctx.fill();
    c.x += c.speed;
    if (c.x - c.size > w) {
      c.x = -c.size;
      c.y = Math.random() * h * 0.5;
    }
  }
}

class Petal {
  constructor() { this.reset(); }
  reset() {
    this.x = Math.random() * w;
    this.y = Math.random() * -h;
    this.size = 6 + Math.random() * 6;
    this.speedY = 0.5 + Math.random() * 0.5;
    this.speedX = 0.3 - Math.random() * 0.6;
    this.angle = Math.random() * Math.PI * 2;
    this.spin = 0.02 + Math.random() * 0.03;
    this.opacity = 0.4 + Math.random() * 0.4;
  }
  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.angle += this.spin;
    if (this.y > h + 20) this.reset();
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    const grad = ctx.createLinearGradient(0, 0, this.size, this.size);
    grad.addColorStop(0, `rgba(255,182,193,${this.opacity})`);
    grad.addColorStop(1, `rgba(255,105,180,${this.opacity * 0.7})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(this.size * 0.5, -this.size * 0.6, this.size, 0);
    ctx.quadraticCurveTo(this.size * 0.5, this.size * 0.6, 0, 0);
    ctx.fill();
    ctx.restore();
  }
}

const lanterns = Array.from({ length: 25 }, () => new Lantern());
const petals = Array.from({ length: 40 }, () => new Petal());

function animate() {
  ctx.clearRect(0, 0, w, h);
  drawClouds();
  lanterns.forEach(l => { l.update(); l.draw(ctx); });
  petals.forEach(p => { p.update(); p.draw(ctx); });
  requestAnimationFrame(animate);
}
animate();

// === DEV PANEL LOGIC ===
const devPanel = document.getElementById("dev-panel");
const devButtons = document.querySelectorAll("#dev-panel button");
let devUnlocked = false;

// --- Ctrl + D unlock ---
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "d") {
    e.preventDefault();

    if (!devUnlocked) {
      const key = prompt("🔐 Enter Dev Key:");
      fetch("/api/dev-key")
        .then((res) => res.json())
        .then((data) => {
          if (key === data.key) {
            devUnlocked = true;
            devPanel.classList.toggle("hidden");
            alert("✅ Developer Mode Activated");
          } else {
            alert("🚫 Invalid Dev Key");
          }
        })
        .catch(() => alert("⚠️ Server error validating key"));
    } else {
      devPanel.classList.toggle("hidden");
    }
  }
});



// === UI HELPER: Update Winner Box ===
function updateWinnerBox(tier, data) {
  const tierMap = {
    small: "Mini Makis",
    mid: "Lucky Rollers",
    mega: "High Emperors",
  };

  const poolName = tierMap[tier] || tier;
  const box = document.querySelector(`.winner-box[data-pool="${poolName}"]`);
  if (!box) {
    console.warn(`⚠️ No winner box found for tier: ${tier}`);
    return;
  }

  const walletEl = box.querySelector(".wallet");
  const vrfEl = box.querySelector(".vrf");
  const amountEl = box.querySelector(".amount");
  const txEl = box.querySelector(".tx");

  // Safely fill in all fields
  if (walletEl) walletEl.textContent = data.wallet || "—";
  if (amountEl) amountEl.textContent = data.amount || "—";

  // === VRF Link (detect full URLs) ===
  if (vrfEl) {
    if (data.vrf && data.vrf !== "—") {
      const vrfLink = data.vrf.startsWith("http")
        ? data.vrf
        : `${window.location.origin}/VRF/${data.vrf}`;
      vrfEl.innerHTML = `<a href="${vrfLink}" target="_blank" rel="noopener noreferrer">VRF File</a>`;
    } else {
      vrfEl.textContent = "—";
    }
  }

  // === TX Link (detect full URLs) ===
  if (txEl) {
    if (data.txid && data.txid !== "—") {
      const txLink = data.txid.startsWith("http")
        ? data.txid
        : `https://bscscan.com/tx/${data.txid}`;
      txEl.innerHTML = `<a href="${txLink}" target="_blank" rel="noopener noreferrer">View TX</a>`;
    } else {
      txEl.textContent = "—";
    }
  }

  // Highlight update visually
  box.style.transition = "background 0.6s ease";
  box.style.background = "rgba(0, 255, 127, 0.2)";
  setTimeout(() => (box.style.background = "transparent"), 800);
}


// === UPDATE WINNER (Global Update) ===
function updateWinner(tier) {
  const wallet = prompt("🏦 Enter Winner Wallet Address:");
  const amount = prompt("💰 Enter Amount Won (e.g., 0.25 BNB):");
  let vrf = prompt("📜 Enter VRF File Link or name (e.g., VRF1.json):");
  const txid = prompt("🔗 Enter BSC Transaction ID:");
  const key = prompt("🔐 Enter Dev Key:");

  if (!wallet || !amount) {
    alert("⚠️ Wallet and amount required!");
    return;
  }

  // 🧠 If they just type 'VRF1.json', convert it to a full link
  if (vrf && !vrf.startsWith("http")) {
    vrf = `${window.location.origin}/VRF/${vrf}`;
  }

  fetch("/api/update-winner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier, wallet, vrf, amount, txid, key }),
  })
    .then((res) => res.json())
    .then((data) => {
      if (data.success) {
        alert(`✅ ${tier} winner updated globally!`);
        updateWinnerBox(tier, data.updated || { wallet, vrf, amount, txid });
        loadWinners(); // Refresh global winners list
      } else {
        alert("🚫 Failed to update winner");
      }
    })
    .catch((err) => {
      console.error("⚠️ Server error:", err);
      alert("⚠️ Server error — check console");
    });
}


// === AUTO-LOAD WINNERS FOR EVERYONE ===
async function loadWinners(showReveal = false) {
  try {
    const res = await fetch("/api/winners");
    const winners = await res.json();
    if (!winners || !Array.isArray(winners)) return;

    // === Detect which page we are on ===
    const list = document.getElementById("winners-list");
    const table = document.getElementById("winners-table");

// === Index Page: Show 3 Most Recent ===
if (list) {
  list.innerHTML = "";

  // Sort newest first (just in case backend returns oldest first)
  winners.sort((a, b) => new Date(b.date) - new Date(a.date));

  const latestThree = winners.slice(0, 3); // limit to 3
  latestThree.forEach((w) => {
    const li = document.createElement("li");
    const poolName = w.pool || w.tier || "Unknown Pool";
    const date = new Date(w.date).toLocaleDateString();

    li.innerHTML = `
      <span class="pool-label">${poolName}</span> — 
      Wallet: <span class="wallet">${w.wallet}</span> — 
      Amount: <span class="amount">${w.amount}</span> — 
      <a href="${w.txid.startsWith('http') ? w.txid : 'https://bscscan.com/tx/' + w.txid}" target="_blank" class="tx-link">TX</a>
      ${w.vrf ? `<a href="${w.vrf}" target="_blank">VRF</a>` : "—"} — 
      <em>${date}</em>
    `;

    if (showReveal) {
      li.classList.add("new-winner");
      setTimeout(() => li.classList.remove("new-winner"), 4000);
    }

    list.appendChild(li);
  });

  // 🪄 Add “View Full History” link to VRF page
  const viewAll = document.createElement("li");
  viewAll.innerHTML = `<a href="vrf-winners.html" class="view-all">View All Winners →</a>`;
  list.appendChild(viewAll);
}





    // === VRF Page: Show Full History Table ===
    if (table) {
      const tbody = table.querySelector("tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

winners.forEach((w) => {
  const row = document.createElement("tr");
  const poolName = w.pool || w.tier || "Unknown Pool";
  const date = new Date(w.date).toLocaleDateString();

  row.innerHTML = `
    <td>${poolName}</td>
    <td>${w.wallet}</td>
    <td>${w.amount}</td>
    <td><a href="${w.vrf || '#'}" target="_blank" class="vrf-link">View VRF</a></td>
    <td><a href="${w.txid.startsWith('http') ? w.txid : 'https://bscscan.com/tx/' + w.txid}" target="_blank" class="tx-link">Txn Hash</a></td>
    <td>${date}</td>
  `;

  tbody.appendChild(row);
});
    }
  } catch (err) {
    console.warn("⚠️ Could not load winners", err);
  }
}

// === Global Reset All Timers (RT) ===
async function resetAllTimers() {
  const key = prompt("Enter Dev Key to reset ALL timers:");
  if (!key) return;

  try {
    const res = await fetch("/api/reset-all-timers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });

    const data = await res.json();
    if (data.success) {
      alert("✅ All timers have been reset globally!");
      location.reload(); // optional - to refresh countdowns
    } else {
      alert(`⚠️ Failed: ${data.error}`);
    }
  } catch (err) {
    console.error("❌ Error resetting all timers:", err);
    alert("Server error while resetting timers");
  }
}

// Attach RT button to function
document.getElementById("dev-rt")?.addEventListener("click", resetAllTimers);

document.getElementById("dev-ca")?.addEventListener("click", async () => {
  const address = prompt("Enter new token contract address (0x...):");
  if (!address) return;

  const key = prompt("Enter Dev Key:");
  const res = await fetch("/api/update-contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, key }),
  });

  const data = await res.json();
  if (data.success) {
    alert(`✅ Contract address updated:\n${address}`);
await loadContractAddress(); // 🔄 refresh the displayed contract instantly
  } else {
    alert(`⚠️ Failed: ${data.error}`);
  }
});


// === Display Global Contract Address in Header ===
async function loadContractAddress() {
  try {
    const res = await fetch("/api/contract");
    const data = await res.json();
    const el = document.getElementById("contract-address");

    if (!el) return;

    if (data?.address && data.address.startsWith("0x")) {
      el.innerHTML = `
        Contract Address: 
        <span id="ca-text" style="cursor:pointer; color:#FFD700; text-decoration:underline;">
          ${data.address}
        </span>
      `;

      // 💡 Click-to-copy feature
      document.getElementById("ca-text").addEventListener("click", () => {
        navigator.clipboard.writeText(data.address);
        el.innerHTML = `✅ Copied: ${data.address}`;
        setTimeout(() => loadContractAddress(), 2000);
      });
    } else {
      el.textContent = "Contract Address: Not Set";
    }
  } catch (err) {
    console.warn("⚠️ Could not load contract address:", err);
    const el = document.getElementById("contract-address");
    if (el) el.textContent = "Contract Address: Error loading";
  }
}

document.addEventListener("DOMContentLoaded", loadContractAddress);


// === PREVIOUS WINNERS PAGE SUPPORT ===
async function loadPreviousWinners() {
  const list = document.getElementById("winners-list");
  if (!list) return; // not on that page

  try {
    const res = await fetch("/api/winners");
    if (!res.ok) throw new Error("Failed to fetch winners");

    const winners = await res.json();
    list.innerHTML = ""; // clear "Loading..." message

    if (!Array.isArray(winners) || winners.length === 0) {
      list.innerHTML = "<li>No previous winners yet.</li>";
      return;
    }

    // Sort newest first
    winners.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Build list items dynamically
    for (const w of winners) {
      const item = document.createElement("li");
      item.innerHTML = `
        <strong>${w.tier}</strong> — 
        Wallet: <span class="wallet">${w.wallet}</span> |
        Amount: <span class="amount">${w.amount}</span> |
        VRF: ${
          w.vrf && w.vrf !== "—"
            ? `<a href="${w.vrf}" target="_blank">VRF</a>`
            : "—"
        } |
        TX: ${
          w.txid && w.txid !== "—"
            ? `<a href="${
                w.txid.startsWith("http")
                  ? w.txid
                  : "https://bscscan.com/tx/" + w.txid
              }" target="_blank">TX</a>`
            : "—"
        } |
        <em>${new Date(w.date).toLocaleString()}</em>
      `;

      // ✅ Append to the list
      list.appendChild(item);
    }

    console.log(`✅ Loaded ${winners.length} previous winners`);
  } catch (err) {
    console.error("❌ Failed to load previous winners:", err);
    list.innerHTML = "<li>⚠️ Error loading winners.</li>";
  }
}



// Auto-run on page load
document.addEventListener("DOMContentLoaded", loadPreviousWinners);


// === INITIAL BLUR STATE ===
document.querySelectorAll(".winner-box").forEach((box) => {
  box.classList.remove("revealed");
});



// === DEV BUTTON BINDINGS ===
document.getElementById("dev-w1")?.addEventListener("click", () => updateWinner("Mini Makis"));
document.getElementById("dev-w2")?.addEventListener("click", () => updateWinner("Lucky Rollers"));
document.getElementById("dev-w3")?.addEventListener("click", () => updateWinner("High Emperors"));


// === BNB POOL TRACKER (updated for Etherscan API v2) ===
const WALLET_ADDRESS = "0x7b9a5F2500850059A2AFc8C053Ff660c5AdD483C";
const ETHERSCAN_API_KEY = "NES6DXJJ6FPDYHA15R97B7V7KVZJKZWXGX"; // Works for BSC too
const bnbPoolDisplay = document.getElementById("bnbPool");

async function fetchBNBBalance() {
  try {
    const res = await fetch(
      `https://api.etherscan.io/v2/api?chainid=56&module=account&action=balance&address=${WALLET_ADDRESS}&apikey=${ETHERSCAN_API_KEY}`

    );
    const data = await res.json();

    if (data.status === "1" || data.message === "OK") {
      const balanceWei = BigInt(data.result);
      const balanceBNB = Number(balanceWei) / 1e18;
      const jackpotBNB = balanceBNB * 0.9;
      bnbPoolDisplay.textContent = jackpotBNB.toFixed(4);
    } else {
      bnbPoolDisplay.textContent = "Error fetching";
      console.warn("Etherscan v2 Error:", data);
    }
  } catch (err) {
    console.error("BNB Fetch Error:", err);
    if (bnbPoolDisplay) bnbPoolDisplay.textContent = "Unavailable";
  }
}

fetchBNBBalance();
setInterval(fetchBNBBalance, 20000);

// === AUTO REFRESH WINNERS EVERY 10 SECONDS ===
setInterval(() => {
  loadWinners();
}, 10000);
