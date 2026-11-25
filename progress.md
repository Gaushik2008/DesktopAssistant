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
- [ ] Voxel king SVG + animations
- [ ] Speech bubble, mic button, listening state
- [ ] Speech provider with typed-command fallback
- [ ] Platform bridge

## Phase 3 - Desktop (Windows + Linux)
- [ ] Electron transparent overlay, tray, global hotkey
- [ ] Safe app launcher

## Phase 4 - Android
- [ ] Capacitor project + permissions
- [ ] Floating overlay service (planned)

## Phase 5 - Docs & CI
- [ ] README
- [ ] GitHub Actions

## Log
- 2026-11-25: repo was empty; core + tests scaffolded.
