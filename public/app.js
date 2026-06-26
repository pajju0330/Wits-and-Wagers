const app = document.querySelector("#app");
const notice = document.querySelector("#notice");
const roomPill = document.querySelector("#room-pill");
const homeTemplate = document.querySelector("#home-template");

const session = {
  roomCode: currentRoomCodeFromPath(),
  playerId: currentRoomCodeFromPath() ? localStorage.getItem(`ww.playerId.${currentRoomCodeFromPath()}`) || "" : "",
  events: null,
  state: null,
  bets: [{ slotIndex: null, pokerChipsStacked: 0 }, { slotIndex: null, pokerChipsStacked: 0 }],
  selectedWagerIndex: 0,
  lastBetRound: 0
};

function currentRoomCodeFromPath() {
  return location.pathname.match(/^\/room\/([A-Z0-9]{6})\/?$/i)?.[1].toUpperCase() || "";
}

function setNotice(message) {
  notice.textContent = message || "";
  notice.hidden = !message;
}

async function api(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function persist(roomCode, playerId) {
  session.roomCode = roomCode;
  session.playerId = playerId;
  localStorage.setItem(`ww.playerId.${roomCode}`, playerId);
}

function clearSession() {
  if (session.events) session.events.close();
  if (session.roomCode) localStorage.removeItem(`ww.playerId.${session.roomCode}`);
  session.roomCode = "";
  session.playerId = "";
  session.state = null;
  session.events = null;
}

function connect() {
  if (!session.roomCode || !session.playerId) return renderHome();
  if (session.events) session.events.close();
  session.events = new EventSource(`/events?roomCode=${session.roomCode}&playerId=${session.playerId}`);
  session.events.addEventListener("state", (event) => {
    session.state = JSON.parse(event.data);
    render();
  });
  session.events.onerror = () => {
    clearSession();
    history.replaceState(null, "", "/");
    renderHome("Room unavailable. Create a new room or join an active one.");
  };
}

function renderHome(message = "") {
  roomPill.hidden = true;
  const roomCodeFromPath = currentRoomCodeFromPath();
  if (!roomCodeFromPath && session.events) clearSession();
  app.replaceChildren(homeTemplate.content.cloneNode(true));
  const roomInput = document.querySelector("#join-form [name='roomCode']");
  if (roomCodeFromPath && roomInput) roomInput.value = roomCodeFromPath;
  document.querySelector("#create-form").addEventListener("submit", createRoom);
  document.querySelector("#join-form").addEventListener("submit", joinRoom);
  setNotice(message);
}

async function createRoom(event) {
  event.preventDefault();
  setNotice("");
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/create-room", {
      name: form.get("name"),
      settings: {
        totalRounds: form.get("totalRounds"),
        guessingTimerSeconds: form.get("guessingTimerSeconds"),
        bettingTimerSeconds: form.get("bettingTimerSeconds")
      }
    });
    persist(data.roomCode, data.playerId);
    history.pushState(null, "", `/room/${data.roomCode}`);
    connect();
  } catch (error) {
    setNotice(error.message);
  }
}

async function joinRoom(event) {
  event.preventDefault();
  setNotice("");
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/join-room", {
      roomCode: form.get("roomCode"),
      name: form.get("name")
    });
    persist(data.roomCode, data.playerId);
    history.pushState(null, "", `/room/${data.roomCode}`);
    connect();
  } catch (error) {
    setNotice(error.message);
  }
}

function render() {
  const state = session.state;
  if (!state) return renderHome();
  roomPill.hidden = false;
  roomPill.innerHTML = `Room ${state.roomCode} <button class="link-button" id="go-home" type="button">Home</button>`;
  const you = state.players.find((player) => player.isYou);
  const isHost = state.hostId === state.youId;

  app.innerHTML = `
    <div class="topline">
      <div>
        <p class="eyebrow">${state.state.replace("_", " ")}</p>
        <h2>${state.state === "LOBBY" ? "Lobby" : `Round ${state.roundNumber} of ${state.totalRounds}`}</h2>
      </div>
      ${state.timerEndsAt ? `<div class="timer" data-timer="${state.timerEndsAt}">${timeLeft(state.timerEndsAt)}</div>` : ""}
    </div>
    ${state.state === "LOBBY" ? renderLobby(state, isHost) : renderGame(state, you, isHost)}
  `;
  bindActions(state, you, isHost);
  tickTimer();
}

function renderLobby(state, isHost) {
  return `
    <div class="game-grid">
      <section class="stack">
        <div class="question-card">
          <p class="eyebrow">Share this code</p>
          <h2>${state.roomCode}</h2>
        <p class="muted">${state.players.length}/7 players joined. The host can start once there are at least 3 players.</p>
        </div>
        ${isHost ? `<button id="start-game" ${state.players.length < 3 ? "disabled" : ""}>Start game</button>` : `<p class="muted">Waiting for the host to start.</p>`}
      </section>
      ${renderPlayers(state)}
    </div>
  `;
}

function renderGame(state, you, isHost) {
  const isMatState = ["BETTING", "REVEAL"].includes(state.state);

  if (isMatState) {
    return `
      <div class="game-grid mat-mode">
        <section class="stack">
          ${renderQuestion(state)}
        </section>
        <section class="stack">
          ${renderPlayers(state)}
          ${renderLeaderboard(state)}
          ${isHost && state.state === "BETTING" ? `<button class="secondary" id="skip-timer">Skip timer</button>` : ""}
          ${isHost && state.state !== "GAME_OVER" ? `<button class="danger" id="end-game">End game</button>` : ""}
        </section>
        <div class="mat-span">
          ${state.state === "BETTING" ? renderBetting(state, you) : ""}
          ${state.state === "REVEAL" ? renderReveal(state, isHost) : ""}
        </div>
      </div>
    `;
  }

  return `
    <div class="game-grid">
      <section class="stack">
        ${renderQuestion(state)}
        ${state.state === "QUESTION" ? `<div class="panel"><h3>Get Ready</h3><p class="muted">The question is coming onto the mat.</p></div>` : ""}
        ${state.state === "GUESSING" ? renderGuessForm(you) : ""}
        ${state.state === "SCORE" || state.state === "GAME_OVER" ? renderScoreActions(state, isHost) : ""}
      </section>
      <section class="stack">
        ${renderPlayers(state)}
        ${renderLeaderboard(state)}
        ${isHost && ["QUESTION", "GUESSING"].includes(state.state) ? `<button class="secondary" id="skip-timer">Skip timer</button>` : ""}
        ${isHost && state.state !== "GAME_OVER" ? `<button class="danger" id="end-game">End game</button>` : ""}
      </section>
    </div>
  `;
}

function renderQuestion(state) {
  const question = state.currentQuestion;
  if (!question) return "";
  const showAnswer = question.answer !== null;
  const isReveal = state.state === "REVEAL";
  return `
    <div class="question-card">
      <div class="meta-row">
        <span class="tag">${question.category}</span>
        <span class="tag">${question.difficulty}</span>
      </div>
      <h2>${escapeHtml(question.text)}</h2>
      ${showAnswer ? `
        <div class="${isReveal ? "answer-reveal" : ""}">
          ${isReveal ? "Correct answer" : "Answer"}: <strong>${formatNumber(question.answer)}</strong> ${escapeHtml(question.unit || "")}
        </div>
      ` : `<p class="muted">Answer with a positive number.</p>`}
    </div>
  `;
}

function renderGuessForm(you) {
  return `
    <form id="guess-form" class="panel">
      <h3>Your Guess</h3>
      <label>
        Number
        <input name="guess" type="number" min="0" step="any" required ${you?.hasGuessed ? "disabled" : ""}>
      </label>
      <button type="submit" ${you?.hasGuessed ? "disabled" : ""}>${you?.hasGuessed ? "Guess submitted" : "Submit guess"}</button>
    </form>
  `;
}

function renderBetting(state, you) {
  if (state.roundNumber !== session.lastBetRound) {
    session.bets = [{ slotIndex: null, pokerChipsStacked: 0 }, { slotIndex: null, pokerChipsStacked: 0 }];
    session.selectedWagerIndex = 0;
    session.lastBetRound = state.roundNumber;
  }

  if (you?.currentBets?.length === 2 && you.currentBets.some(b => b.slotIndex !== null)) {
    session.bets = you.currentBets.map(bet => ({
      slotIndex: bet.slotIndex ?? null,
      pokerChipsStacked: bet.pokerChipsStacked ?? 0
    }));
  }

  const placed = session.bets.filter(b => b.slotIndex !== null).length;

  return `
    <form id="bet-form" class="panel">
      <h3>Betting Mat</h3>
      ${renderChipTray()}
      <div class="board mat-board">${state.matSlots.map(slot => renderSlot(slot, state, true)).join("")}</div>
      <p class="muted">Tap Wager 1 or Wager 2 above, then tap a slot. Both chips must be placed.</p>
      <button type="submit" ${placed < 2 ? "disabled" : ""}>${you?.hasBet ? "Move bets" : "Place bets"}</button>
    </form>
  `;
}

function renderSlot(slot, state, interactive) {
  const names = slot.playerIds?.map(id => state.players.find(p => p.id === id)?.name).filter(Boolean) || [];
  const winner = state.winningSlotIndex === slot.index;
  const isAllHigh = slot.guessValue === "ALL_GUESSES_TOO_HIGH";
  const isEmpty = slot.guessValue === null;
  const isCenter = slot.index === 4;
  const myBetIndices = getMyBetIndices(slot.index);

  let classes = "slot";
  if (isAllHigh) classes += " slot-all-high";
  if (isCenter && !isEmpty) classes += " slot-center";
  if (isEmpty) classes += " slot-empty";
  if (myBetIndices.length > 0) classes += " slot-has-bet";
  if (winner) classes += " winner";

  const valueLabel = isAllHigh ? "All<br>Too High" : isEmpty ? "\u2014" : formatNumber(slot.guessValue);
  const metaText = isAllHigh
    ? "Pays when all guesses are too high"
    : isEmpty ? "" : escapeHtml(names.join(", "));

  return `
    <button type="button" class="${classes}" data-slot="${slot.index}" ${isEmpty ? "disabled" : ""}>
      <span class="odds">${slot.odds}:1</span>
      <span class="guess-value">${valueLabel}</span>
      <span class="slot-guessers">${metaText}</span>
      ${interactive && myBetIndices.length > 0 ? `
        <span class="my-bets">${myBetIndices.map(i => `<span class="chip-marker">${i + 1}</span>`).join("")}</span>
      ` : ""}
      ${renderBettors(slot, state, interactive)}
    </button>
  `;
}

function renderChipTray() {
  const state = session.state;
  return `<div class="chip-tray">
    ${[0, 1].map(i => {
      const bet = session.bets[i];
      const placed = bet.slotIndex !== null;
      const slot = placed ? state.matSlots.find(s => s.index === bet.slotIndex) : null;
      return `<div class="chip-selector-group">
        <button type="button" class="chip-selector ${session.selectedWagerIndex === i ? "active" : ""}" data-wager="${i}" draggable="true">
          <span class="chip-icon"></span>
          <span>Wager ${i + 1}</span>
          <span class="chip-location">${placed ? "\u2192 " + slotLabel(slot) : '<span class="muted">slot</span>'}</span>
        </button>
        ${placed ? `
          <div class="poker-stacker">
            <button type="button" class="poker-btn" data-wager="${i}" data-delta="-1">\u2212</button>
            <span class="poker-count">${bet.pokerChipsStacked}</span>
            <button type="button" class="poker-btn" data-wager="${i}" data-delta="1">+</button>
            <span class="poker-label">chips</span>
          </div>
        ` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

function renderBettors(slot, state, interactive) {
  const bets = visibleBetsForSlot(state, slot.index);
  const byPlayer = {};

  for (const bet of bets) {
    const player = state.players.find(p => p.id === bet.playerId);
    const name = player?.name || "Unknown";
    byPlayer[name] = (byPlayer[name] || 0) + (Number(bet.pokerChipsStacked) || 0);
  }

  const me = state.players.find(p => p.isYou);
  if (interactive && me && !me.hasBet) {
    for (const sb of session.bets) {
      if (sb.slotIndex === slot.index) {
        byPlayer[me.name] = (byPlayer[me.name] || 0) + (sb.pokerChipsStacked || 0);
      }
    }
  }

  const entries = Object.entries(byPlayer);
  if (entries.length === 0) return "";
  return `<span class="slot-bettors">${entries
    .map(([name, chips]) => chips > 0 ? `${escapeHtml(name)} \u00b7 ${chips}` : escapeHtml(name))
    .join("<br>")}</span>`;
}

function getMyBetIndices(slotIndex) {
  return session.bets
    .map((bet, i) => ({ bet, i }))
    .filter(({ bet }) => bet.slotIndex === slotIndex)
    .map(({ i }) => i);
}

function renderReveal(state, isHost) {
  return `
    <div class="panel stack">
      <h3>Reveal</h3>
      <div class="board mat-board">${state.matSlots.map((slot) => renderSlot(slot, state, false)).join("")}</div>
      <p>${chipChangesText(state)}</p>
      ${isHost ? `<button id="show-score">Show scoreboard</button>` : `<p class="muted">Waiting for the host.</p>`}
    </div>
  `;
}

function renderScoreActions(state, isHost) {
  if (state.state === "GAME_OVER") {
    return `<div class="panel"><h3>Game Over</h3><p>${escapeHtml(state.leaderboard[0]?.name || "Nobody")} wins with ${state.leaderboard[0]?.total || 0} chips.</p></div>`;
  }
  return `
    <div class="panel">
      <h3>Scoreboard</h3>
      ${isHost ? `<button id="next-round">${state.roundNumber >= state.totalRounds ? "Finish game" : "Next round"}</button>` : `<p class="muted">Waiting for the host.</p>`}
    </div>
  `;
}

function renderPlayers(state) {
  return `
    <section class="panel">
      <h3>Players</h3>
      <div class="lobby-list">
        ${state.players.map((player) => `
          <div class="player-row">
            <span><strong>${escapeHtml(player.name)}</strong>${player.isHost ? " · Host" : ""}${player.isYou ? " · You" : ""}</span>
            <span class="status ${player.hasGuessed || player.hasBet ? "ready" : "waiting"}">${player.isConnected ? playerStatus(state, player) : "Offline"}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderChips(count) {
  const dim = count === 0 ? " style=\"opacity:0.35\"" : "";
  return `<span class="chip-stack-visual"${dim}><span class="chip-piece gold"></span><span class="count">${count}</span></span>`;
}

function renderLeaderboard(state) {
  return `
    <section class="panel">
      <h3>Leaderboard</h3>
      <div class="leaderboard">
        ${state.leaderboard.map((player) => `
          <div class="rank-row">
            <span>${player.rank}. <strong>${escapeHtml(player.name)}</strong>${player.isYou ? " · You" : ""}</span>
            <span class="chip-row">${renderChips(player.pokerChips)}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function playerStatus(state, player) {
  if (state.state === "GUESSING") return player.hasGuessed ? "Guessed" : "Thinking";
  if (state.state === "BETTING") return player.hasBet ? "Bet" : "Betting";
  return `${player.pokerChips} poker`;
}

function bindActions(state, you, isHost) {
  document.querySelector("#go-home")?.addEventListener("click", () => {
    clearSession();
    history.pushState(null, "", "/");
    renderHome();
  });
  document.querySelector("#start-game")?.addEventListener("click", () => postHost("/api/start-game"));
  document.querySelector("#show-score")?.addEventListener("click", () => postHost("/api/show-score"));
  document.querySelector("#next-round")?.addEventListener("click", () => postHost("/api/next-round"));
  document.querySelector("#skip-timer")?.addEventListener("click", () => postHost("/api/skip-timer"));
  document.querySelector("#end-game")?.addEventListener("click", () => postHost("/api/end-game"));
  document.querySelector("#guess-form")?.addEventListener("submit", submitGuess);
  document.querySelector("#bet-form")?.addEventListener("submit", submitBets);

  document.querySelectorAll("[data-wager]").forEach(btn => {
    btn.addEventListener("click", () => {
      session.selectedWagerIndex = Number(btn.dataset.wager);
      render();
    });
  });

  document.querySelectorAll("[data-wager]").forEach(btn => {
    btn.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", btn.dataset.wager);
      e.dataTransfer.effectAllowed = "move";
      btn.classList.add("dragging");
    });
    btn.addEventListener("dragend", () => {
      btn.classList.remove("dragging");
      document.querySelectorAll(".slot.drag-over").forEach(s => s.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll("[data-slot]:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      const slotIndex = Number(btn.dataset.slot);
      const idx = session.selectedWagerIndex;
      session.bets[idx].slotIndex = slotIndex;
      const nextUnplaced = session.bets.findIndex(b => b.slotIndex === null);
      if (nextUnplaced !== -1) session.selectedWagerIndex = nextUnplaced;
      render();
    });
    btn.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      btn.classList.add("drag-over");
    });
    btn.addEventListener("dragleave", () => {
      btn.classList.remove("drag-over");
    });
    btn.addEventListener("drop", e => {
      e.preventDefault();
      btn.classList.remove("drag-over");
      const wagerIndex = Number(e.dataTransfer.getData("text/plain"));
      const slotIndex = Number(btn.dataset.slot);
      session.selectedWagerIndex = wagerIndex;
      session.bets[wagerIndex].slotIndex = slotIndex;
      const nextUnplaced = session.bets.findIndex(b => b.slotIndex === null);
      if (nextUnplaced !== -1) session.selectedWagerIndex = nextUnplaced;
      render();
    });
  });

  document.querySelectorAll(".poker-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wagerIndex = Number(btn.dataset.wager);
      const delta = Number(btn.dataset.delta);
      const bet = session.bets[wagerIndex];
      if (!bet || bet.slotIndex === null) return;
      const you = session.state.players.find(p => p.isYou);
      const pokerMax = you?.pokerChips || 0;
      const totalStacked = session.bets.reduce((sum, b) => sum + (b.pokerChipsStacked || 0), 0);
      const newVal = bet.pokerChipsStacked + delta;
      if (newVal < 0) return;
      if (delta > 0 && totalStacked >= pokerMax) return;
      bet.pokerChipsStacked = newVal;
      render();
    });
  });
}

async function postHost(path) {
  try {
    setNotice("");
    await api(path, { roomCode: session.roomCode, playerId: session.playerId });
  } catch (error) {
    setNotice(error.message);
  }
}

async function submitGuess(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    setNotice("");
    await api("/api/submit-guess", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      guess: form.get("guess")
    });
  } catch (error) {
    setNotice(error.message);
  }
}

async function submitBets(event) {
  event.preventDefault();
  if (session.bets.some(b => b.slotIndex === null)) {
    setNotice("Place both Wager Chips on slots first.");
    return;
  }
  try {
    setNotice("");
    await api("/api/place-bets", {
      roomCode: session.roomCode,
      playerId: session.playerId,
      bets: session.bets.map(bet => ({
        slotIndex: bet.slotIndex,
        pokerChipsStacked: bet.pokerChipsStacked || 0
      }))
    });
  } catch (error) {
    setNotice(error.message);
  }
}

function slotLabel(slot) {
  if (slot.guessValue === "ALL_GUESSES_TOO_HIGH") return `All Guesses Too High (${slot.odds}:1)`;
  return `${formatNumber(slot.guessValue)} (${slot.odds}:1)`;
}

function visibleBetsForSlot(state, slotIndex) {
  const lockedBets = state.bets || [];
  const activeBets = state.players.flatMap((player) =>
    (player.currentBets || []).map((bet) => ({ ...bet, playerId: player.id }))
  );
  return (lockedBets.length ? lockedBets : activeBets).filter((bet) => Number(bet.slotIndex) === slotIndex);
}

function tickTimer() {
  document.querySelectorAll("[data-timer]").forEach((timer) => {
    timer.textContent = timeLeft(Number(timer.dataset.timer));
  });
}

function timeLeft(endsAt) {
  return `${Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))}s`;
}

function chipChangesText(state) {
  const changes = state.chipChanges || [];
  if (!changes.length) return "No chip changes this round.";
  return changes.map((change) => {
    const player = state.players.find((item) => item.id === change.playerId);
    const delta = change.delta > 0 ? `+${change.delta}` : String(change.delta);
    return `${player?.name || "Player"} ${delta}`;
  }).join(" · ");
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

setInterval(tickTimer, 500);
if (currentRoomCodeFromPath()) {
  connect();
} else {
  renderHome();
}
