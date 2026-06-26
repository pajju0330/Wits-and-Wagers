import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const questions = JSON.parse(await readFile(join(__dirname, "data", "questions.json"), "utf8"));

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const clients = new Map();

const STATE = {
  LOBBY: "LOBBY",
  QUESTION: "QUESTION",
  GUESSING: "GUESSING",
  BETTING: "BETTING",
  REVEAL: "REVEAL",
  SCORE: "SCORE",
  GAME_OVER: "GAME_OVER"
};

const defaultSettings = {
  totalRounds: 7,
  guessingTimerSeconds: 30,
  bettingTimerSeconds: 30,
  fastForward: false,
  allowLateJoins: true
};

const MAT_TEMPLATE = [
  { index: 0, odds: 6, label: "All Guesses Too High", kind: "allHigh" },
  { index: 1, odds: 5, label: "5:1", kind: "guess" },
  { index: 2, odds: 4, label: "4:1", kind: "guess" },
  { index: 3, odds: 3, label: "3:1", kind: "guess" },
  { index: 4, odds: 2, label: "2:1", kind: "guess" },
  { index: 5, odds: 3, label: "3:1", kind: "guess" },
  { index: 6, odds: 4, label: "4:1", kind: "guess" },
  { index: 7, odds: 5, label: "5:1", kind: "guess" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function createId() {
  return crypto.randomUUID();
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function publicPlayer(player, viewerId) {
  return {
    id: player.id,
    name: player.name,
    wagerChips: player.wagerChips,
    pokerChips: player.pokerChips,
    isHost: player.id === player.room.hostId,
    isConnected: player.isConnected,
    hasGuessed: player.currentGuess !== null,
    hasBet: player.currentBets.length > 0,
    currentGuess: [STATE.BETTING, STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(player.room.state) ? player.currentGuess : null,
    currentBets: [STATE.BETTING, STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(player.room.state) ? player.currentBets : [],
    isYou: player.id === viewerId
  };
}

function publicRoom(room, viewerId) {
  const currentRound = room.rounds[room.currentRoundIndex] || null;
  return {
    roomCode: room.roomCode,
    state: room.state,
    settings: room.settings,
    players: room.players.map((player) => publicPlayer(player, viewerId)),
    hostId: room.hostId,
    youId: viewerId,
    roundNumber: room.currentRoundIndex + 1,
    totalRounds: room.settings.totalRounds,
    timerEndsAt: room.timerEndsAt,
    currentQuestion: currentRound ? {
      id: currentRound.question.id,
      text: currentRound.question.text,
      unit: currentRound.question.unit,
      category: currentRound.question.category,
      difficulty: currentRound.question.difficulty,
      answer: [STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(room.state) ? currentRound.question.answer : null
    } : null,
    matSlots: currentRound?.matSlots || [],
    bets: [STATE.BETTING, STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(room.state) ? currentRound?.bets || [] : [],
    winningSlotIndex: [STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(room.state) ? currentRound?.winningSlotIndex ?? null : null,
    chipChanges: [STATE.REVEAL, STATE.SCORE, STATE.GAME_OVER].includes(room.state) ? currentRound?.chipChanges || [] : [],
    leaderboard: [...room.players]
      .sort((a, b) => b.pokerChips - a.pokerChips)
      .map((player, index) => ({
        rank: index + 1,
        id: player.id,
        name: player.name,
        wagerChips: player.wagerChips,
        pokerChips: player.pokerChips,
        total: player.pokerChips,
        isYou: player.id === viewerId
      }))
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function requirePlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  if (!player) {
    const error = new Error("Player not found in room");
    error.status = 404;
    throw error;
  }
  return player;
}

function requireHost(room, playerId) {
  if (room.hostId !== playerId) {
    const error = new Error("Only the host can do that");
    error.status = 403;
    throw error;
  }
}

function broadcast(room) {
  const roomClients = clients.get(room.roomCode);
  if (!roomClients) return;
  for (const [playerId, response] of roomClients.entries()) {
    response.write(`event: state\ndata: ${JSON.stringify(publicRoom(room, playerId))}\n\n`);
  }
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.timerEndsAt = null;
}

function schedule(room, seconds, callback) {
  clearRoomTimer(room);
  room.timerEndsAt = Date.now() + seconds * 1000;
  room.timer = setTimeout(() => {
    room.timer = null;
    room.timerEndsAt = null;
    callback();
  }, seconds * 1000);
}

function shuffledQuestions() {
  return [...questions].sort(() => Math.random() - 0.5);
}

function createPlayer(name, room) {
  return {
    id: createId(),
    room,
    name,
    wagerChips: 2,
    pokerChips: 0,
    isConnected: true,
    currentGuess: null,
    currentBets: []
  };
}

function createRoom(hostName, settings = {}) {
  const roomCode = createRoomCode();
  const room = {
    roomCode,
    hostId: null,
    state: STATE.LOBBY,
    settings: { ...defaultSettings, ...settings },
    players: [],
    rounds: [],
    currentRoundIndex: -1,
    questionPool: shuffledQuestions(),
    createdAt: Date.now(),
    timer: null,
    timerEndsAt: null
  };
  const host = createPlayer(hostName, room);
  room.hostId = host.id;
  room.players.push(host);
  rooms.set(roomCode, room);
  return { room, host };
}

function startNextRound(room) {
  clearRoomTimer(room);
  if (room.currentRoundIndex + 1 >= room.settings.totalRounds) {
    room.state = STATE.GAME_OVER;
    broadcast(room);
    return;
  }

  const question = room.questionPool.shift() || shuffledQuestions()[0];
  room.currentRoundIndex += 1;
  room.state = STATE.QUESTION;
  for (const player of room.players) {
    player.currentGuess = null;
    player.currentBets = [];
  }
  room.rounds[room.currentRoundIndex] = {
    roundNumber: room.currentRoundIndex + 1,
    question,
    guesses: [],
    matSlots: createEmptyMat(),
    bets: [],
    winningSlotIndex: null,
    chipChanges: []
  };
  broadcast(room);
  schedule(room, 2, () => beginGuessing(room));
}

function beginGuessing(room) {
  if (room.state !== STATE.QUESTION) return;
  room.state = STATE.GUESSING;
  schedule(room, room.settings.guessingTimerSeconds, () => endGuessing(room));
  broadcast(room);
}

function endGuessing(room) {
  if (room.state !== STATE.GUESSING) return;
  const round = room.rounds[room.currentRoundIndex];
  for (const player of room.players) {
    if (player.currentGuess === null) player.currentGuess = 0;
  }
  round.guesses = room.players.map((player) => ({ playerId: player.id, value: player.currentGuess }));
  round.matSlots = mapGuessesToMat(round.guesses);
  room.state = STATE.BETTING;
  schedule(room, room.settings.bettingTimerSeconds, () => endBetting(room));
  broadcast(room);
}

function endBetting(room) {
  if (room.state !== STATE.BETTING) return;
  clearRoomTimer(room);
  const round = room.rounds[room.currentRoundIndex];
  for (const player of room.players) {
    if (player.currentBets.length === 0) {
      const fallbackSlotIndex = lowestAvailableBetSlot(round.matSlots);
      player.currentBets = [
        { slotIndex: fallbackSlotIndex, pokerChipsStacked: 0 },
        { slotIndex: fallbackSlotIndex, pokerChipsStacked: 0 }
      ];
    }
  }
  round.bets = room.players.flatMap((player) =>
    player.currentBets.map((bet, wagerChipIndex) => publicBet(player, bet, wagerChipIndex))
  );
  settleRound(room, round);
  room.state = STATE.REVEAL;
  broadcast(room);
}

function publicBet(player, bet, wagerChipIndex) {
  return {
    playerId: player.id,
    playerName: player.name,
    wagerChipIndex,
    slotIndex: bet.slotIndex,
    pokerChipsStacked: bet.pokerChipsStacked
  };
}

function updateRoundBets(room) {
  const round = room.rounds[room.currentRoundIndex];
  if (!round) return;
  round.bets = room.players.flatMap((player) =>
    player.currentBets.map((bet, wagerChipIndex) => publicBet(player, bet, wagerChipIndex))
  );
}

function settleRound(room, round) {
  const answer = round.question.answer;
  const guessSlots = round.matSlots.filter((slot) => typeof slot.guessValue === "number");
  const notOver = guessSlots.filter((slot) => slot.guessValue <= answer);
  const allHigh = guessSlots.length > 0 && guessSlots.every((slot) => slot.guessValue > answer);
  const winningSlot = allHigh ? round.matSlots[0] : notOver.sort((a, b) => b.guessValue - a.guessValue)[0];
  round.winningSlotIndex = winningSlot?.index ?? 0;

  const changes = new Map(room.players.map((player) => [player.id, 0]));
  for (const player of room.players) {
    for (const bet of player.currentBets) {
      const slot = round.matSlots.find((matSlot) => matSlot.index === bet.slotIndex);
      const pokerChipsStacked = Math.min(player.pokerChips, Math.max(0, Number(bet.pokerChipsStacked) || 0));
      const totalBetUnits = 1 + pokerChipsStacked;
      const wins = slot?.index === round.winningSlotIndex;
      player.pokerChips -= pokerChipsStacked;
      if (wins) {
        const payoutPokerChips = totalBetUnits * slot.odds - 1;
        player.pokerChips += payoutPokerChips;
        changes.set(player.id, changes.get(player.id) + payoutPokerChips - pokerChipsStacked);
      } else {
        changes.set(player.id, changes.get(player.id) - pokerChipsStacked);
      }
    }
  }

  if (!allHigh && winningSlot?.playerIds?.length) {
    for (const playerId of winningSlot.playerIds) {
      const player = getPlayer(room, playerId);
      if (player) {
        player.pokerChips += 3;
        changes.set(player.id, changes.get(player.id) + 3);
      }
    }
  }

  for (const player of room.players) {
    player.pokerChips = Math.max(0, player.pokerChips);
  }
  round.chipChanges = [...changes.entries()].map(([playerId, delta]) => ({ playerId, delta }));
}

function createEmptyMat() {
  return MAT_TEMPLATE.map((slot) => ({
    index: slot.index,
    odds: slot.odds,
    label: slot.label,
    guessValue: slot.kind === "allHigh" ? "ALL_GUESSES_TOO_HIGH" : null,
    playerIds: []
  }));
}

function mapGuessesToMat(guesses) {
  const matSlots = createEmptyMat();
  const uniqueValues = [...new Set(guesses.map((guess) => guess.value))].sort((a, b) => a - b);
  const slotOrder = uniqueValues.length % 2 === 1
    ? [4, 5, 3, 6, 2, 7, 1]
    : [3, 5, 2, 6, 1, 7];
  const center = Math.floor(uniqueValues.length / 2);
  const valuesByConsensus = [];
  if (uniqueValues.length % 2 === 1) valuesByConsensus.push(uniqueValues[center]);
  for (let distance = 1; valuesByConsensus.length < uniqueValues.length; distance += 1) {
    const left = uniqueValues[center - distance];
    const right = uniqueValues[uniqueValues.length % 2 === 1 ? center + distance : center + distance - 1];
    if (left !== undefined) valuesByConsensus.push(left);
    if (right !== undefined) valuesByConsensus.push(right);
  }

  valuesByConsensus.forEach((value, position) => {
    const slotIndex = slotOrder[Math.min(position, slotOrder.length - 1)];
    const slot = matSlots.find((matSlot) => matSlot.index === slotIndex);
    if (slot.guessValue === null) {
      slot.guessValue = value;
    }
    slot.playerIds.push(...guesses.filter((guess) => guess.value === value).map((guess) => guess.playerId));
  });

  return matSlots;
}

function lowestAvailableBetSlot(matSlots) {
  return matSlots.find((slot) => typeof slot.guessValue === "number")?.index ?? 0;
}

function showScore(room) {
  if (room.state !== STATE.REVEAL) return;
  room.state = STATE.SCORE;
  broadcast(room);
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.?0+$/, "");
}

function validateSettings(settings = {}) {
  return {
    totalRounds: clampInt(settings.totalRounds, defaultSettings.totalRounds, 1, questions.length),
    guessingTimerSeconds: clampInt(settings.guessingTimerSeconds, defaultSettings.guessingTimerSeconds, 10, 180),
    bettingTimerSeconds: clampInt(settings.bettingTimerSeconds, defaultSettings.bettingTimerSeconds, 10, 180),
    fastForward: settings.fastForward === true,
    allowLateJoins: settings.allowLateJoins !== false
  };
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function handleApi(request, response, path) {
  try {
    const body = request.method === "GET" ? {} : await parseBody(request);
    if (path === "/api/create-room" && request.method === "POST") {
      const hostName = normalizeName(body.name);
      if (!hostName) return sendJson(response, 400, { error: "Display name is required" });
      const { room, host } = createRoom(hostName, validateSettings(body.settings));
      return sendJson(response, 201, { roomCode: room.roomCode, playerId: host.id, state: publicRoom(room, host.id) });
    }

    if (path === "/api/join-room" && request.method === "POST") {
      const roomCode = String(body.roomCode || "").trim().toUpperCase();
      const name = normalizeName(body.name);
      const room = rooms.get(roomCode);
      if (!room) return sendJson(response, 404, { error: "Room not found" });
      if (!name) return sendJson(response, 400, { error: "Display name is required" });
      if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
        return sendJson(response, 409, { error: "That name is already taken in this room" });
      }
      if (room.players.length >= 7) return sendJson(response, 409, { error: "Room is full" });
      if (room.state !== STATE.LOBBY && !room.settings.allowLateJoins) {
        return sendJson(response, 409, { error: "This game already started" });
      }
      const player = createPlayer(name, room);
      room.players.push(player);
      broadcast(room);
      return sendJson(response, 200, { roomCode, playerId: player.id, state: publicRoom(room, player.id) });
    }

    const roomCode = String(body.roomCode || "").trim().toUpperCase();
    const playerId = String(body.playerId || "");
    const room = rooms.get(roomCode);
    if (!room) return sendJson(response, 404, { error: "Room not found" });
    const player = requirePlayer(room, playerId);

    if (path === "/api/start-game" && request.method === "POST") {
      requireHost(room, playerId);
      if (room.state !== STATE.LOBBY) return sendJson(response, 409, { error: "Game already started" });
      if (room.players.length < 3) return sendJson(response, 409, { error: "Need at least 3 players" });
      startNextRound(room);
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/submit-guess" && request.method === "POST") {
      if (room.state !== STATE.GUESSING) return sendJson(response, 409, { error: "Guessing is not active" });
      const guess = Number(body.guess);
      if (!Number.isFinite(guess) || guess < 0) return sendJson(response, 400, { error: "Guess must be a positive number" });
      player.currentGuess = Number(guess.toFixed(4));
      if (room.settings.fastForward && room.players.every((roomPlayer) => roomPlayer.currentGuess !== null)) {
        endGuessing(room);
      } else {
        broadcast(room);
      }
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/place-bets" && request.method === "POST") {
      if (room.state !== STATE.BETTING) return sendJson(response, 409, { error: "Betting is not active" });
      const round = room.rounds[room.currentRoundIndex];
      const allowedSlots = new Set(round.matSlots.filter((slot) => slot.guessValue !== null).map((slot) => slot.index));
      const incomingBets = Array.isArray(body.bets) ? body.bets.slice(0, 2) : [];
      if (incomingBets.length !== 2) return sendJson(response, 400, { error: "Place both Wager Chips" });
      let stackedTotal = 0;
      player.currentBets = incomingBets.map((bet) => {
        const slotIndex = clampInt(bet.slotIndex, -1, 0, 7);
        if (!allowedSlots.has(slotIndex)) {
          const error = new Error("Bet on a guess slot or All Guesses Too High");
          error.status = 400;
          throw error;
        }
        const pokerChipsStacked = clampInt(bet.pokerChipsStacked, 0, 0, player.pokerChips);
        stackedTotal += pokerChipsStacked;
        return { slotIndex, pokerChipsStacked };
      });
      if (stackedTotal > player.pokerChips) return sendJson(response, 400, { error: "Not enough Poker Chips" });
      if (room.settings.fastForward && room.players.every((roomPlayer) => roomPlayer.currentBets.length > 0)) {
        endBetting(room);
      } else {
        updateRoundBets(room);
        broadcast(room);
      }
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/skip-timer" && request.method === "POST") {
      requireHost(room, playerId);
      if (room.state === STATE.QUESTION) beginGuessing(room);
      else if (room.state === STATE.GUESSING) endGuessing(room);
      else if (room.state === STATE.BETTING) endBetting(room);
      else return sendJson(response, 409, { error: "No active timer to skip" });
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/show-score" && request.method === "POST") {
      requireHost(room, playerId);
      showScore(room);
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/next-round" && request.method === "POST") {
      requireHost(room, playerId);
      if (room.state !== STATE.SCORE) return sendJson(response, 409, { error: "Scoreboard is not active" });
      startNextRound(room);
      return sendJson(response, 200, { ok: true });
    }

    if (path === "/api/end-game" && request.method === "POST") {
      requireHost(room, playerId);
      clearRoomTimer(room);
      room.state = STATE.GAME_OVER;
      broadcast(room);
      return sendJson(response, 200, { ok: true });
    }

    return sendJson(response, 404, { error: "Unknown API route" });
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message || "Request failed" });
  }
}

function handleEvents(request, response, url) {
  const roomCode = String(url.searchParams.get("roomCode") || "").trim().toUpperCase();
  const playerId = String(url.searchParams.get("playerId") || "");
  const room = rooms.get(roomCode);
  if (!room || !getPlayer(room, playerId)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  response.write(`event: state\ndata: ${JSON.stringify(publicRoom(room, playerId))}\n\n`);
  if (!clients.has(roomCode)) clients.set(roomCode, new Map());
  clients.get(roomCode).set(playerId, response);
  const player = getPlayer(room, playerId);
  player.isConnected = true;
  broadcast(room);
  request.on("close", () => {
    clients.get(roomCode)?.delete(playerId);
    const currentPlayer = getPlayer(room, playerId);
    if (currentPlayer) {
      currentPlayer.isConnected = false;
      broadcast(room);
    }
  });
}

async function serveStatic(response, pathname) {
  const hasExt = extname(pathname);
  const normalized = normalize(pathname === "/" || !hasExt ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalized);
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    if (hasExt) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(join(publicDir, "index.html")));
    }
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/events") return handleEvents(request, response, url);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url.pathname);
  return serveStatic(response, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Wits & Wagers running at http://localhost:${PORT}`);
});
