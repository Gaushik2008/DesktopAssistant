# Progress

_Last updated: 2026-11-26_

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
- 2026-11-25 (session 2): AI chat fallback - `src/web/core/llm.js` (pure), `electron/llm.js` (main-process requests, safeStorage key store), settings panel (gear), Android path via CapacitorHttp. Presets: NVIDIA API, Ollama (qwen3:4b), LM Studio, custom. 46/46 tests pass (mutation-checked). NOT verified against the real NVIDIA API / a real Qwen server, nor Android CapacitorHttp; default NVIDIA model name is a guess and editable.
- 2026-11-25 (session 3) CORRECTION: the previous entry claimed 46/46 passing, but the pushed `app.js` had no AI wiring (6 UI tests failed on a fresh clone). Wired `askAI()` + settings panel handlers into `src/web/app.js`; now 46/46 pass on a clean checkout. Mutation-checked: disabling the unknown->AI route fails 5 tests. Still NOT verified against the real NVIDIA API / a real Qwen server / Android CapacitorHttp.
- 2026-11-25 (session 3): upgraded Electron 33 -> 45.5 and electron-builder 25 -> 26.18 (fixes the critical/high `npm audit` findings; production deps: 0 vulnerabilities, only a moderate dev-only `minimatch` remains). Verified the REAL Electron window launches under Xvfb and renders the king + mic + gear (screenshot). Added `npm run smoke`. 46/46 tests pass. Installers (`dist:*`) and Android APK still not built here.
- 2026-11-25 (session 3): spoken replies - `src/web/tts.js` (Web Speech synthesis, off by default, persisted), speaker button (🔊/🔇), voice commands (voice on/off, mute, stop), mic stops speech. Replies are spoken without the quoted command echo; "Thinking..."/idle quips/greeting stay silent. 55/55 tests pass (tts unit + intents + UI), mutation-checked. NOT verified: actual audio output on real Windows/Linux/Android (Electron's speechSynthesis needs system voices, e.g. speech-dispatcher/espeak on Linux).
- 2026-11-25 (session 3): hardened `npm run smoke` - it falsely reported OK once when a stale single-instance lock made Electron quit silently (blank screenshot). Now uses a fresh `--user-data-dir` per run and fails if the pet corner is blank. Real Electron 45 window verified (screenshot): king + mic + gear + speaker button (muted by default), so `speechSynthesis` is available there. Real audio not heard (no sound device in sandbox).

- 2026-11-26 (session 4): **Fixed "voice recognition is unavailable here".** Root cause: Electron has no Google speech backend, so Web Speech always failed. Added Gemini voice: `src/web/recorder.js` (mic -> VAD -> 16 kHz WAV), Gemini STT builders in `core/llm.js`, `transcribe()` in `electron/llm.js` + `stt:transcribe` IPC (key stays in main process), Android path via CapacitorHttp, new `speech.js` (Gemini -> native -> Web Speech -> typed), specific error handling in `app.js`, first-run prompt for the key, mic-level pulse. Gemini is now the default provider (chat via its OpenAI-compatible endpoint). Merged on top of session 2-3 work (chat/TTS/local actions) instead of replacing it. 62/62 tests pass; `npm run smoke` passes (real Electron window, first-run settings panel visible). NOT verified: live transcription against the real Gemini API and a real microphone (no key/mic in sandbox) - only mocked-fetch tests; Android build not compiled.
- 2026-11-26 (session 4): **Always on top of all screens.** `keepOnTop()` re-asserts `screen-saver` level + all-workspaces on blur/show/restore/display change/3 s timer, tray "Always on top" toggle, XWayland forced on Linux (Wayland ignores always-on-top), window height 380 -> 480 so the bubble is no longer clipped when the settings panel is open, `setPermissionCheckHandler` for mic. NOT verified on real Windows; exclusive-fullscreen games can still cover overlays.
- 2026-11-26 (session 4): user hit "Endpoint or model not found" on Save & test. Cause: Gemini model names change and the default `gemini-flash-latest` may not be accepted by the OpenAI-compatible endpoint. Added auto-recovery: on 404/badmodel the main process calls ListModels, picks the newest plain Flash (`chooseGeminiModel`), saves it and retries once (`withModelRecovery`, chat + voice). 67/67 tests pass (new `test/model-recovery.test.mjs`); `npm run smoke` OK. NOT verified against the real API; Android has no auto-recovery yet.
- 2026-11-26 (session 4): **Fixed "only listens to one word".** Cause: the recorder calibrated its noise floor on the first 400 ms - which already contained the first word - so the silence threshold was too high and quieter following words counted as silence (reproduced in simulation: old logic cut at 1.36 s right after word 1). Replaced with a pure, unit-tested `createVad()` (rolling minimum-statistics noise floor, EMA smoothing, 1.2 s silence window, 15 s max). 74/74 tests pass incl. `test/vad.test.mjs` (full sentence with quiet words/gaps, immediate speech, steady fan noise, thinking pauses). NOT verified with a real microphone.
- 2026-11-26 (session 5): **Renamed to DO.IT + wake word + always listening.** New `src/web/core/wake.js` (name matcher: "do it / DO.IT / do-it / doit / dew it / due it / sir pixel"; strict mode for hands-free so "king"/"assistant" never wake it). `app.js` hands-free loop (record -> transcribe -> act only if it starts with the name; pauses while speaking/settings/typing/manual mic; fatal errors switch it off with a message; backoff on transient errors). Ear toggle button (persisted, default ON), voice commands "DO.IT stop listening" / "start listening". Bare "DO.IT" -> "Yes?" then listens; also answers a pending "yes" follow-up. Removed "do it" as a bare *confirm* (it's the name now; "yes/ok/sure/go ahead" still confirm). `speech.js`: passive mode (longer no-speech window) + fixed a race where a cancelled listen cleared the next one's handle; `tts.isSpeaking()`. Renamed UI/tray/product/LLM prompt (localStorage keys kept as `sirpixel.*` so saved data survives). Tests: new `test/wake.test.mjs`; 54/54 pass here (the 8 jsdom `ui.test.mjs` tests could not run: jsdom isn't installed and the sandbox has no npm access). New real-Chromium e2e `npm run e2e:handsfree` (fake mic tone through the real recorder + scripted transcripts): ambient speech ignored, wake+command runs, bare name then command runs, "stop listening" turns it off - all PASS. NOT verified: real human voice/mic, live Gemini transcription of the name, Android, Windows. PRIVACY: with Gemini every detected utterance is uploaded - documented in README.
