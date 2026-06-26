# Wits & Wagers

A dependency-free local MVP of the multiplayer trivia-betting game described in `project.md`.

## Run

```bash
npm start
```

Open `http://localhost:3000` in multiple browser tabs or phones on the same network.

The home page at `/` is always the create/join screen. Active games are hosted at `/room/{CODE}`, for example `/room/WZ49KQ`.

## Current Scope

- Create and join 6-character rooms.
- Room-specific game URLs with `/` reserved for create/join.
- Host-controlled lobby and game start.
- Server-authoritative game state with live updates through server-sent events.
- Hidden numerical guessing.
- Merged betting slots with a Lower slot.
- Closest-without-going-over winner logic.
- Regular and Big Money chip betting.
- Reveal, chip settlement, scoreboard, and game over.
- Mobile-first browser UI.

## Not Yet Implemented

- Persistent room storage and 24-hour cleanup.
- Host kick, pause, resume, skip question, and custom questions.
- Reconnect identity recovery beyond local browser storage.
- Drag-and-drop chip placement.
- Sound effects and animation polish.
