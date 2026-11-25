# Progress

_Last updated: 2026-11-25_

## Status legend
- [x] done and verified  - [~] written, not yet verified on a real device  - [ ] not started

## Phase 0 - Analysis
- [x] Studied the reference screencast: transparent always-on-top voxel-king mascot, speech bubble, mic button, "Listening... (Esc to cancel)", idle quips, voice commands (open YouTube, play song on Spotify)
- [x] Chose architecture: one shared web UI + core, Electron shell (Windows/Linux), Capacitor shell (Android)

## Phase 1 - Core (platform independent)
- [x] Intent parser (`src/web/core/intents.js`)
- [x] Site/app catalog with URL safety allow-list (`catalog.js`)
- [x] Personality / idle quips (`personality.js`)
- [x] Unit tests (`test/intents.test.mjs`)

## Phase 2 - Shared UI
- [~] Voxel king SVG + animations (`pet.js`, `styles.css`)
- [~] Speech bubble, mic button, listening state (`app.js`)
- [~] Speech provider with typed-command fallback (`speech.js`)
- [~] Platform bridge (`platform.js`)

## Phase 3 - Desktop (Windows + Linux)
- [~] Electron transparent overlay, tray, global hotkey (`electron/main.js`)
- [x] Safe app launcher + tests (`electron/launcher.js`)

## Phase 4 - Android
- [x] Capacitor project generated (`android/`), `npx cap sync` succeeds
- [x] RECORD_AUDIO permission + `<queries>` in manifest
- [~] APK build not run here (no Android SDK in this environment)
- [ ] Floating overlay service (planned)

## Phase 5 - Docs & CI
- [x] README
- [~] GitHub Actions workflow written at `docs/ci-workflow.yml` (not yet enabled/run; copy to `.github/workflows/ci.yml`)

## Log
- 2026-11-25: repo was empty; core + tests scaffolded.
- 2026-11-25: added Capacitor Android project, manifest permissions, CI workflow, full README. 17/17 unit tests pass. Electron UI/Android APK not run on real hardware here. pushed to GitHub; workflow file kept in docs/ because the token lacked `workflow` scope.

## Next up
- Run on real Windows/Linux/Android and fix what breaks
- Offline speech engine on desktop
- Android floating overlay
- 2026-11-25 (session 2): new commands - timers, reminders, notes, safe calculator, coin/dice, "yes" follow-up after unknown app. New files: `src/web/core/utils.js`, `src/web/local-actions.js`, `test/local-actions.test.mjs`. 25/25 tests pass. UI wiring in `app.js` syntax-checked but not exercised in a real browser/Electron window.
- 2026-11-25 (session 2): added jsdom UI integration tests (`test/ui.test.mjs`, 8 tests) driving the real index.html/app.js; mutation-checked (breaking the greeting text fails the suite). Total 33/33 pass. Still no real-browser/Electron/Android run.
