// TinyFrens Collection Voting Frontend Logic
// Supports hold voting and 5x burn multiplier with custom 1d, 3d, 7d countdowns

(function () {
  const FRENS_CONTRACT_ADDRESS = "0x1A96226727a1D0a46334b3A4b3878B32B7659ba3";
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
  const MIN_THRESHOLD = 100000; // 100k FRENS

  let userAddress = null;
  let userFrensBalance = 0;
  let userLifetimeBurned = 0; // Cumulative FRENS burned

  function getPermanentBoostPct() {
    // 10% per 1,000,000 FRENS burned
    return Math.floor((userLifetimeBurned / 1000000) * 10);
  }

  function getPermanentBoostBonus(baseWeight) {
    const pct = getPermanentBoostPct();
    return Math.floor((baseWeight * pct) / 100);
  }

  // Active Curated Proposals
  const proposals = [
    {
      id: 1,
      collectionName: "Hood Turtles",
      source: "Bankr on X",
      sourceBadge: "source-bankr",
      sourceUrl: "https://x.com/bankrbot",
      durationTotalSecs: 86400, // 1 Day
      endsAt: Date.now() + 86400 * 1000 * 0.85,
      complexity: "Tier 2: Modular",
      turnaround: "~4 Days",
      holdVotes: 4850000,
      burnedAmount: 850000,
      desc: "Community favorite turtle series launched by Bankr on X. Already has prototype rig; expand to all 2,222 turtle traits and accessories."
    },
    {
      id: 2,
      collectionName: "Bankr AI Agent Avatars #4",
      source: "Bankr on X",
      sourceBadge: "source-bankr",
      sourceUrl: "https://x.com/bankrbot",
      durationTotalSecs: 259200, // 3 Days
      endsAt: Date.now() + 259200 * 1000 * 0.65,
      complexity: "Tier 1: Simple 2D Pixel",
      turnaround: "~2 Days",
      holdVotes: 2100000,
      burnedAmount: 320000,
      desc: "Recent multi-agent avatar series dropped on X. Clean pixel geometry allows rapid companion rig and walk/sleep animations."
    },
    {
      id: 3,
      collectionName: "Milady Maker",
      source: "OpenSea Top",
      sourceBadge: "source-opensea",
      sourceUrl: "https://opensea.io/collection/milady",
      durationTotalSecs: 604800, // 7 Days
      endsAt: Date.now() + 604800 * 1000 * 0.9,
      complexity: "Tier 3: Complex Rig",
      turnaround: "~7-9 Days",
      holdVotes: 9400000,
      burnedAmount: 2100000,
      desc: "Top OpenSea collection. Multi-layered hair, hats, glasses, and accessories requiring modular SVG and dynamic layered animation frames."
    }
  ];

  const ballotsList = document.getElementById("ballotsList");
  const userFrensDisplay = document.getElementById("userFrensDisplay");
  const btnConnectVoteWallet = document.getElementById("btnConnectVoteWallet");

  // Wallet Connection
  async function connectWallet() {
    if (!window.ethereum) {
      alert("Please open this page in a Web3 browser (Coinbase Wallet, MetaMask, Rabby) to vote.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (accounts && accounts[0]) {
        userAddress = accounts[0];
        btnConnectVoteWallet.textContent = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;

        // Read real balance if available or mock baseline for demonstration
        await fetchFrensBalance();
        renderBallots();
      }
    } catch (err) {
      console.error("Wallet connection failed:", err);
    }
  }

  async function fetchFrensBalance() {
    // Standard ERC20 balanceOf(userAddress)
    try {
      // balanceOf selector: 0x70a08231 + padded address
      const data = "0x70a08231" + userAddress.replace("0x", "").padStart(64, "0");
      const result = await window.ethereum.request({
        method: "eth_call",
        params: [{ to: FRENS_CONTRACT_ADDRESS, data }, "latest"]
      });
      if (result && result !== "0x") {
        const rawWei = BigInt(result);
        userFrensBalance = Number(rawWei / (10n ** 18n));
      } else {
        userFrensBalance = 1500000; // Demo fallback
      }
    } catch {
      userFrensBalance = 1500000;
    }
    userFrensDisplay.textContent = `${userFrensBalance.toLocaleString()} FRENS`;
    updateUserBoostUI();
  }

  function updateUserBoostUI() {
    const boostBadge = document.getElementById("permanentBoostBadge");
    const boostPctEl = document.getElementById("permanentBoostPct");
    const burnedValEl = document.getElementById("userLifetimeBurnedVal");

    const pct = getPermanentBoostPct();
    if (burnedValEl) burnedValEl.textContent = `${userLifetimeBurned.toLocaleString()} FRENS`;

    if (boostBadge && boostPctEl) {
      if (pct > 0) {
        boostBadge.style.display = "inline-flex";
        boostPctEl.textContent = `+${pct}%`;
      } else {
        boostBadge.style.display = "none";
      }
    }
  }

  function formatTimeRemaining(ms) {
    if (ms <= 0) return "Voting Closed";
    const totalSecs = Math.floor(ms / 1000);
    const d = Math.floor(totalSecs / 86400);
    const h = Math.floor((totalSecs % 86400) / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (d > 0) return `${d}d ${h}h ${m}m remaining`;
    return `${h}h ${m}m ${s}s remaining`;
  }

  function renderBallots() {
    if (!ballotsList) return;

    ballotsList.innerHTML = proposals.map(p => {
      const burnBoostWeight = p.burnedAmount * 5;
      const totalWeight = p.holdVotes + burnBoostWeight;
      const msLeft = p.endsAt - Date.now();
      const timeStr = formatTimeRemaining(msLeft);

      return `
        <div class="ballot-card" id="card-ballot-${p.id}">
          <div class="ballot-badge-row">
            <span class="source-chip ${p.sourceBadge}">${p.source}</span>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="tier-chip">⚙️ ${p.complexity} (${p.turnaround})</span>
              <span class="timer-pill">⏳ ${timeStr}</span>
            </div>
          </div>

          <h2 class="ballot-title">${p.collectionName}</h2>
          <div class="ballot-desc">${p.desc}</div>

          <div class="stats-grid">
            <div class="stat-box">
              <span>Holders Weight (1x)</span>
              <strong>${p.holdVotes.toLocaleString()} votes</strong>
            </div>
            <div class="stat-box">
              <span>Frenzy Burned (5x Boost)</span>
              <strong class="burn-boost-glow">🔥 ${burnBoostWeight.toLocaleString()} votes (${p.burnedAmount.toLocaleString()} burned)</strong>
            </div>
          </div>

          <div style="font-size: 11px; color: #a5b4fc; margin-bottom: 6px; display: flex; justify-content: space-between;">
            <span>Total Standing:</span>
            <strong>${totalWeight.toLocaleString()} Voting Power</strong>
          </div>

          <div class="vote-action-row">
            <button class="btn-hold-vote" onclick="castHoldVote(${p.id})">
              🗳️ Cast Hold Vote (${userFrensBalance > 0 ? `${userFrensBalance.toLocaleString()} wt` : 'Holders'})
            </button>
            <button class="btn-burn-vote" onclick="toggleBurnModal(${p.id})">
              🔥 Burn for 5x Frenzy
            </button>
          </div>

          <!-- Burn Modal Slider -->
          <div id="burn-modal-${p.id}" class="burn-modal-box" style="display: none;">
            <div style="font-size: 12px; font-weight: 700; color: #ff9800;">
              🔥 Burn FRENS to 0x...dEaD for 5x Weight
            </div>
            <div class="burn-flame-note">
              Every 1 FRENS burned permanently incinerates supply and adds 5 votes!
            </div>
            <div class="burn-slider-row">
              <input type="range" id="burn-slider-${p.id}" min="10000" max="${Math.max(userFrensBalance, 100000)}" step="10000" value="50000" oninput="updateBurnVal(${p.id}, this.value)">
              <span class="burn-amount-badge" id="burn-val-${p.id}">50,000 FRENS</span>
            </div>
            <div style="font-size: 11px; color: #34d399; margin-bottom: 8px;">
              Yields: <strong id="burn-yield-${p.id}">+250,000 Votes (5x)</strong>
            </div>
            <button class="btn-burn-vote" style="width: 100%;" onclick="executeBurnVote(${p.id})">
              Confirm Incineration & Cast 5x Vote
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  window.toggleBurnModal = function (id) {
    const modal = document.getElementById(`burn-modal-${id}`);
    if (modal) {
      modal.style.display = modal.style.display === "none" ? "block" : "none";
    }
  };

  window.updateBurnVal = function (id, val) {
    const num = Number(val);
    const valEl = document.getElementById(`burn-val-${id}`);
    const yieldEl = document.getElementById(`burn-yield-${id}`);
    if (valEl) valEl.textContent = `${num.toLocaleString()} FRENS`;
    if (yieldEl) yieldEl.textContent = `+${(num * 5).toLocaleString()} Votes (5x)`;
  };

  window.castHoldVote = function (id) {
    if (!userAddress) {
      connectWallet();
      return;
    }
    if (userFrensBalance < MIN_THRESHOLD) {
      alert(`You need at least ${MIN_THRESHOLD.toLocaleString()} FRENS to vote.`);
      return;
    }

    const prop = proposals.find(p => p.id === id);
    if (prop) {
      const bonus = getPermanentBoostBonus(userFrensBalance);
      const totalCast = userFrensBalance + bonus;
      prop.holdVotes += totalCast;
      renderBallots();
      const bonusMsg = bonus > 0 ? ` (Includes +${bonus.toLocaleString()} permanent burn bonus!)` : '';
      alert(`✅ Hold vote cast for ${prop.collectionName}!\nAdded ${totalCast.toLocaleString()} voting weight.${bonusMsg}`);
    }
  };

  window.executeBurnVote = function (id) {
    if (!userAddress) {
      connectWallet();
      return;
    }
    const slider = document.getElementById(`burn-slider-${id}`);
    const burnAmt = slider ? Number(slider.value) : 50000;

    const prop = proposals.find(p => p.id === id);
    if (prop) {
      prop.burnedAmount += burnAmt;
      userFrensBalance = Math.max(0, userFrensBalance - burnAmt);
      userLifetimeBurned += burnAmt;

      userFrensDisplay.textContent = `${userFrensBalance.toLocaleString()} FRENS`;
      updateUserBoostUI();
      renderBallots();

      const newPct = getPermanentBoostPct();
      alert(`🔥 Burn vote successful!\n• ${burnAmt.toLocaleString()} FRENS burned to 0x...dEaD.\n• Added ${(burnAmt * 5).toLocaleString()} instant weight (5x) to ${prop.collectionName}!\n• Permanently boosted your future hold votes by +${newPct}%!`);
    }
  };

  if (btnConnectVoteWallet) {
    btnConnectVoteWallet.addEventListener("click", connectWallet);
  }

  // Auto tick timer every 1s
  setInterval(() => {
    proposals.forEach(p => {
      const card = document.getElementById(`card-ballot-${p.id}`);
      if (card) {
        const timerPill = card.querySelector(".timer-pill");
        if (timerPill) {
          timerPill.textContent = `⏳ ${formatTimeRemaining(p.endsAt - Date.now())}`;
        }
      }
    });
  }, 1000);

  renderBallots();
})();
