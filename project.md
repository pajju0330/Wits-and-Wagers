# Wits & Wagers — Game Design Document

## Overview

Wits & Wagers is a multiplayer trivia-betting game for 3–7 players (or teams up to 20 people). Unlike traditional trivia, players don't need to know the correct answer — they can bet on someone else's guess. Every question has a **numerical answer**, players write down their best guess, all guesses are revealed and arranged on a betting mat, and then everyone bets on which guess they think is closest to the real answer without going over. After 7 questions, the player or team with the most chips wins.

---

## Design Goal (Important)

This project should faithfully recreate the **actual Wits & Wagers board game** in digital form. The UI, game flow, betting board, chip placement, and overall experience should closely resemble the physical board game wherever practical.

The betting mat should be visually recognizable as the real Wits & Wagers betting board, including:

* The leftmost **"All Guesses Too High"** betting space.
* The centered payout layout (2:1, 3:1, 4:1, 5:1) exactly as in the board game.
* Guess cards arranged on the betting mat exactly like the physical game.
* Wager chips and poker chips represented visually like real chips.
* Animations and interactions that make players feel like they are playing the tabletop version rather than a generic trivia web app.

When implementing the frontend, prioritize reproducing the look and feel of the real board game over inventing a new UI. If a rule or layout detail exists in the original game, prefer following the original game's presentation.


## Core Concepts

### Answer Logic

- Every question answer is a **positive number** (integer or decimal).
- The winning guess is the **closest to the correct answer without going over** — i.e., "The Price is Right" rule.
- Example: correct answer is 1991, guesses are 1989 and 1992 → **1989 wins**.
- Example: correct answer is 380, all guesses are above 380 → **"All Guesses Too High"** slot wins.
- Duplicate guesses are stacked in the same payout slot.

### Players & Teams

- Supports **3–7 individual players**, or teams of 1–3 players each (up to 7 teams = up to 21 players total).
- Each player/team has:
  - A **display name**
  - **2 Wager Chips** (permanent — returned every round, never lost)
  - A pool of **earned Poker Chips** (won through betting; spent chips are lost)
  - A **guess** per round
  - Up to **2 bets** per round (one per Wager Chip)

---

## Room System

### Create Room

1. Host enters a **display name**.
2. System generates a unique **6-character Room Code** (e.g., `WZ49KQ`).
3. Host configures game settings (optional):
   - Number of rounds (default: 7)
   - Question set (default, custom, or category-filtered)
   - Allow late joins (yes/no, default: yes)
4. Room enters **LOBBY** state. Host shares the Room Code with friends.

### Join Room

1. Player enters **Room Code** + their **display name**.
2. Server validates:
   - Room exists
   - Room is in LOBBY state (or late-join is enabled if in-game)
   - Name is not already taken in that room
3. Player is added to the room's player list with 2 Wager Chips and 0 Poker Chips.
4. All players in the lobby see the updated player list in real time.

### Lobby State

- Host sees a **Start Game** button (enabled when ≥ 3 players have joined).
- Host can **kick** players from the lobby.
- Room Code is displayed prominently for sharing.

---

## Game Structure

### States

```
LOBBY → QUESTION → GUESSING → BETTING → REVEAL → SCORE → [next round or GAME_OVER]
```

Each round cycles through these states. After the final round (round 7 by default), the game moves to GAME_OVER.

---

## Round Flow

### State 1: QUESTION

- A question is drawn from the question pool and displayed to all players.
- Example: *"How many home runs did Babe Ruth hit in his career?"*
- A **guess timer** starts (default: 30 seconds).
- Players cannot see each other's guesses during this phase.

### State 2: GUESSING

- Each player submits a **numerical guess** via their input field.
- Guesses are hidden until all players have submitted or the timer expires.
- Players who don't submit get a **default guess of 0**.
- Once all players submit, or the timer expires, the phase ends automatically.

**Guess Validation Rules:**
- Must be a non-negative number (≥ 0).
- Decimals allowed (e.g., `3.5`).
- No negative numbers.
- Empty submission = treated as 0.

### State 3: BETTING

All guesses are revealed and arranged on the **Betting Mat** — a fixed number line with pre-set payout slots. Guesses are placed into slots starting from the center (lowest odds) and spreading outward (higher odds). There is always one extra slot on the far left called **"All Guesses Too High"** at 6:1.

#### How Guesses Map to the Betting Mat

The mat has a fixed set of payout slots. The mapping depends on whether the number of unique guesses is **odd or even**:

**Odd number of unique guesses** → the middle guess goes in the **2:1 center slot**, others spread outward:

```
[ 6:1 ] [ 5:1 ] [ 4:1 ] [ 3:1 ] [ 2:1 ] [ 3:1 ] [ 4:1 ] [ 5:1 ]
  ALL    guess1  guess2  guess3  guess4  guess5  guess6  guess7
  <all    low  ←————————————————————————————————————→  high
```

**Even number of unique guesses** → the **2:1 center slot is left empty**, two middle guesses go into the adjacent 3:1 slots:

```
[ 6:1 ] [ 5:1 ] [ 4:1 ] [ 3:1 ] [     ] [ 3:1 ] [ 4:1 ] [ 5:1 ]
  ALL    guess1  guess2  guess3  (empty) guess4  guess5  guess6
```

The key rule: **the further a guess is from the center, the higher the payout odds**, because it's a less likely answer. The center (or near-center) guess is considered the "consensus" best answer and has the lowest odds.

#### Payout Odds Reference

| Slot position from center | Payout |
|---|---|
| Center (odd count) | 2:1 |
| 1 step from center | 3:1 |
| 2 steps from center | 4:1 |
| 3 steps from center | 5:1 |
| "All Guesses Too High" | 6:1 |

> 2:1 means: bet 1 chip → win 2 chips back (your 1 original + 1 profit).
> 3:1 means: bet 1 chip → win 3 chips back (your 1 original + 2 profit).

#### Placing Bets

- Each player has **2 Wager Chips** to place as bets.
- Options:
  - Place **both Wager Chips on the same slot** (double down).
  - Place **one Wager Chip on each of two different slots** (hedge).
- Players **can** bet on their own guess.
- Players can **only** bet on slots that contain a guess (except "All Guesses Too High" which is always open).
- Players can **move their bets** during the 30-second betting timer, but cannot change them after time runs out.
- Players can **also stack earned Poker Chips** underneath their Wager Chip to increase their bet size:
  - Poker Chips stacked under a winning Wager Chip pay out at the same slot odds.
  - Poker Chips stacked under a losing Wager Chip are **lost permanently** and returned to the bank.
  - Players are **not obligated** to bet Poker Chips — stacking is optional.
  - There is no limit on how many Poker Chips can be stacked (from Round 2 onward).
- Betting timer: default 30 seconds.

### State 4: REVEAL

- The **correct answer** is displayed.
- The **winning slot** is highlighted:
  - Normally: the slot containing the guess closest to the correct answer without going over.
  - If all guesses exceeded the correct answer: the **"All Guesses Too High"** slot wins.
- **Wager Chips** are always returned to all players regardless of win or loss (they are never lost).
- **Poker Chips** on the **losing slots** are collected by the bank (permanently lost).
- **Poker Chips** on the **winning slot** are paid out at the slot's odds multiplier.
- **Bonus**: any player whose guess was in the winning slot earns **+3 red Poker Chips** as a bonus (regardless of where they bet).

**Winnings Calculation:**

```
For each Poker Chip on a winning slot:
  payout = chip_value × slot_odds
  player receives: original chip back + profit chips from bank

For each Wager Chip on a winning slot (Wager Chips have value 1):
  player receives: Wager Chip back (always) + profit chips from bank

For each Wager Chip on a losing slot:
  player receives: Wager Chip back (always), no profit

For each Poker Chip on a losing slot:
  chip is lost to bank

Correct guess bonus:
  player whose guess is in the winning slot receives +3 red Poker Chips
```

**Example:**
- Player bets 1 Wager Chip + 4 Poker Chips on a 3:1 slot.
- That slot wins.
- Total bet = 5 units → payout = 5 × 3 = 15 chips back.
- Player gets: Wager Chip back + 14 Poker Chips (4 original + 10 profit) from bank.

### State 5: SCORE

- Updated **leaderboard** is shown with chip counts for all players.
- Brief pause (5–10 seconds) or a "Continue" button for the host.
- If this was the final round → go to GAME_OVER.
- Otherwise → next round begins (back to QUESTION state).

---

## Game Over

- Final scores (total chip value) are displayed for all players.
- Ranked leaderboard: **most chips = winner**.
- Tiebreaker: the player/team with the youngest member wins (or can be settled by coin flip).
- Options presented:
  - **Play Again** (same players, same settings, reset chips)
  - **New Game** (return to lobby)
  - **Leave**

---

## Chip Economy

### Chip Types

| Type | Value | Description |
|---|---|---|
| Wager Chip | 1 unit | The 2 permanent betting tokens every player has. Never lost — always returned after each round. Used to place bets on slots. Can have Poker Chips stacked underneath to increase the bet. |
| Red Poker Chip | 1 point | Earned through winning bets or correct-guess bonus. Can be stacked under Wager Chips. Lost if bet on a losing slot. |
| Blue Poker Chip | 5 points | Same rules as red, just higher denomination. |
| Green Poker Chip | 25 points | Same rules as red, just higher denomination. |

### Starting State

- Every player starts with **2 Wager Chips** and **0 Poker Chips**.
- Poker Chips are earned during play; there is no starting bank of them per player.
- The bank holds all Poker Chips and pays out winnings from it.

### Running Out of Chips

- A player can always bet using just their 2 Wager Chips even with 0 Poker Chips.
- There is no elimination — every player can participate in every round regardless of chip count.

---

## Question System

### Question Format

```json
{
  "id": "q_001",
  "text": "How many home runs did Babe Ruth hit in his career?",
  "answer": 714,
  "unit": "home runs",
  "category": "Sports",
  "difficulty": "medium"
}
```

### Question Pool

- Default game is **7 rounds**, one question per round.
- Questions are drawn **without replacement** per game session.
- Optionally, hosts can filter by **category** or **difficulty**.

### Custom Questions

- Host can add custom questions before starting.
- Format: question text + numerical answer (+ optional unit label).
- Custom questions are mixed into the draw pool.

---

## Betting Mat Logic (Implementation Detail)

The mat has a **fixed set of 8 slots** (7 guess slots + 1 "All Guesses Too High" slot). The payout of each slot is determined by its **distance from the center**, not by which guess occupies it. The algorithm for placing guesses into slots:

```
1. Collect all unique guesses, sort ascending.
2. Determine number of unique guesses N.
3. If N is odd:
     center_index = floor(N / 2)
     center guess → 2:1 slot
     guesses to the right of center → 3:1, 4:1, 5:1 (ascending)
     guesses to the left of center  → 3:1, 4:1, 5:1 (descending)
4. If N is even:
     2:1 slot is left empty
     two middle guesses → 3:1 slots (left and right of center)
     remaining guesses spread outward → 4:1, 5:1
5. "All Guesses Too High" slot is always available at 6:1, on the far left.
6. If N > 7 (more unique guesses than slots): overflow guesses share the outermost slots.
   Duplicate guesses in same slot: stack them visually; if slot wins, ALL players with that
   guess get the +3 bonus.
```

---

## Real-Time Synchronization (Technical Requirements)

All players must see the same game state simultaneously. The recommended approach is **WebSockets** (e.g., Socket.io) or a real-time database (e.g., Firebase Realtime DB / Supabase).

### Events the Server Must Broadcast

| Event | Trigger | Payload |
|---|---|---|
| `player_joined` | New player joins room | Player name, updated player list |
| `player_left` | Player disconnects | Player name, updated player list |
| `game_started` | Host starts game | Game settings, round count |
| `round_started` | New round begins | Round number, question text |
| `guess_submitted` | A player submits | Player name only (value hidden) |
| `guessing_ended` | All guessed or timer expired | All guesses revealed, sorted, mapped to slots |
| `bet_moved` | A player places/moves a bet | Player name, slot (visible to all during betting) |
| `betting_ended` | Timer expired | All bets locked in |
| `answer_revealed` | Server reveals answer | Correct answer, winning slot, chip deltas |
| `scores_updated` | After reveal | All player chip counts |
| `game_over` | Final round ends | Final rankings |

### Client-Side State Machine

Each client tracks:
- Current game state (LOBBY / QUESTION / GUESSING / BETTING / REVEAL / SCORE / GAME_OVER)
- My player data (name, wager chips, poker chips, current guess, current bets)
- All players' data (name, chip count, guess submitted status, bet placement)
- Current question
- Current round number / total rounds
- Betting mat layout (slot assignments + odds)
- Timer countdown (synced from server)

---

## Timer System

Timers are **server-authoritative** — the server controls the clock and broadcasts countdowns.

| Phase | Default Duration | Configurable? |
|---|---|---|
| Guessing | 30 seconds | Yes |
| Betting | 30 seconds | Yes |
| Reveal pause | 5 seconds | No |
| Score pause | 8 seconds | Yes |

- Server sends `timer_start` with a duration and clients count down locally.
- When the timer hits 0, the server advances the game state automatically.
- If all players submit/bet before the timer expires, the server may **fast-forward** (configurable).
- Teams may need +10–20 extra seconds to discuss — configurable per-session.

---

## Host Powers

| Control | When Available | Action |
|---|---|---|
| Kick player | LOBBY | Removes player from room |
| Start game | LOBBY | Begins the game (min 3 players) |
| Skip timer | GUESSING / BETTING | Ends phase early |
| Pause game | Any in-game state | Pauses all timers |
| Resume game | Paused | Resumes from where it stopped |
| Skip question | QUESTION / GUESSING | Discards question, draws new one |
| End game | Any in-game state | Goes directly to GAME_OVER |

---

## Edge Cases & Rules to Handle

### Disconnected Players
- Disconnects during GUESSING: guess auto-submitted as 0.
- Disconnects during BETTING: Wager Chips placed on the lowest available slot automatically.
- Reconnects within same round: resumes from current state.
- Disconnects permanently: becomes a **ghost** — frozen chips, greyed out on leaderboard, no auto-actions.

### All Guesses Are Too High
- The **"All Guesses Too High"** slot wins and pays 6:1.
- No correct-guess bonus is awarded that round (no guess was correct).
- Players who bet on "All Guesses Too High" are paid out normally.

### Duplicate Guesses
- Stacked in the same slot on the mat.
- If that slot wins, **all** players who wrote that guess receive the +3 bonus chips.
- Betting payout is based on chips placed on the slot (not split — each bettor is paid individually by the bank).

### No One Bets the Winning Slot
- Wager Chips are still returned to all players.
- Poker Chips on losing slots are still lost.
- No one earns a payout that round (except the +3 bonus for the correct guesser).

### Only One Player Remains
- Remaining player wins immediately (game ends with current scores).

---

## Suggested Data Models

### Room
```
{
  roomCode: string,
  hostId: string,
  state: "LOBBY" | "QUESTION" | "GUESSING" | "BETTING" | "REVEAL" | "SCORE" | "GAME_OVER",
  settings: {
    totalRounds: number,          // default 7
    guessingTimerSeconds: number, // default 30
    bettingTimerSeconds: number,  // default 30
    fastForward: boolean
  },
  players: Player[],
  rounds: Round[],
  currentRoundIndex: number,
  questionPool: Question[],
  createdAt: timestamp
}
```

### Player
```
{
  id: string,
  name: string,
  wagerChips: 2,           // always 2, always returned — never changes
  pokerChips: number,      // earned chips; starts at 0
  isConnected: boolean,
  isHost: boolean,
  currentGuess: number | null,
  currentBets: [
    // max 2 entries (one per Wager Chip)
    {
      slotIndex: number,       // index on the betting mat
      pokerChipsStacked: number // extra chips stacked under this Wager Chip
    }
  ]
}
```

### Round
```
{
  roundNumber: number,
  question: Question,
  guesses: { playerId: string, value: number }[],
  matSlots: {
    index: number,
    odds: number,           // e.g. 2, 3, 4, 5, 6
    guessValue: number | "ALL_GUESSES_TOO_HIGH" | null,
    playerIds: string[]     // players whose guess is in this slot
  }[],
  bets: {
    playerId: string,
    slotIndex: number,
    pokerChipsStacked: number
  }[],
  winningSlotIndex: number | null,
  chipChanges: { playerId: string, delta: number }[]
}
```

### Question
```
{
  id: string,
  text: string,
  answer: number,
  unit: string,
  category: string,
  difficulty: "easy" | "medium" | "hard"
}
```

---

## UI Screens Summary

| Screen | Shown To | Key Elements |
|---|---|---|
| Home | Everyone | Create Room / Join Room |
| Lobby | Everyone | Room code, player list, settings (host only), Start button (host only) |
| Question | Everyone | Question text, round number, timer |
| Guessing | Everyone | Number input, submit button, "X/N submitted" counter |
| Betting Mat | Everyone | Sorted guess slots with odds, Wager Chip placement, optional Poker Chip stacking, timer |
| Reveal | Everyone | Correct answer, winning slot highlight, chip change animations, +3 bonus display |
| Scoreboard | Everyone | Leaderboard with chip totals, "Next Round" / host continues |
| Game Over | Everyone | Final rankings, winner display, play again / new game |

---

## Implementation Notes

- **No account system required** — players are session-based, identified by a random UUID on connection.
- **Room codes** expire after 24 hours of inactivity or when the host closes the room.
- **Mobile-first UI** is strongly recommended — players will use phones while sitting around a table.
- During BETTING, players should be able to **drag Wager Chips** to slots on desktop, or **tap** on mobile. Chips should be visually moveable until the timer runs out.
- The Betting Mat must show both the **guess values** and the **payout odds** for each slot clearly.
- Poker Chip stacking UI: a small "+chips" button under each placed Wager Chip lets players add or remove Poker Chips from that bet.
- Timer countdowns should be **visually prominent** (progress ring or countdown bar).
- During REVEAL, animate: winning slot lights up → losing chips disappear → winning chips multiply → +3 bonus floats to correct guesser.
- Sound effects are optional but strongly improve the experience: tick for timer, fanfare for reveal, sad trombone if "All Guesses Too High" wins.
