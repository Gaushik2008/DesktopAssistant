# 👑 Sir Pixel — Desktop Assistant

A voice-controlled **voxel-king desktop companion** for **Windows**, **Linux** and **Android**.
Sir Pixel sits on a grass block in the corner of your screen, listens when you tap the mic
(or press a hotkey), and does things for you: open websites, launch apps, search the web,
play a song on Spotify or YouTube, tell the time or a joke.

> One shared web UI + core logic, wrapped by **Electron** (desktop) and **Capacitor** (Android).

---

## Table of contents
1. [Features](#features)
2. [Voice commands](#voice-commands)
3. [Architecture](#architecture)
4. [Project structure](#project-structure)
5. [Getting started](#getting-started)
6. [Running on each platform](#running-on-each-platform)
7. [Building installers / APK](#building-installers--apk)
8. [Speech recognition](#speech-recognition)
9. [Security model](#security-model)
10. [Customising](#customising)
11. [Testing](#testing)
12. [CI](#ci)
13. [Platform notes & known limitations](#platform-notes--known-limitations)
14. [Roadmap](#roadmap)
15. [Contributing & license](#contributing--license)

---

## Features
- **Always-on-top mascot** – frameless, transparent overlay window (desktop), parked bottom-right.
- **Speech bubble** that echoes what it heard and what it did, e.g. *"Open YouTube." Opened YouTube in your browser.*
- **Mic button + listening state** – *"Listening… (Esc to cancel)"*.
- **Idle quips** – Sir Pixel occasionally says something to stay alive.
- **Typed-command fallback** – when speech is unavailable or denied, a text box appears (`Ctrl+Alt+T`).
- **System tray** (desktop) and **global hotkeys**.
- **Click-through** transparent areas on Windows/macOS so the overlay never blocks your work.
- **Draggable** – move the pet anywhere on the desktop.
- **Offline-friendly** – the mascot is inline SVG; no remote assets.
- **Safe by design** – spoken text is never passed to a shell (see [Security model](#security-model)).

## Voice commands
You can optionally prefix commands with a wake phrase such as *"Hey Sir Pixel, …"*, and polite filler like *"please"* or *"can you"* is ignored.

| Say | What happens |
|---|---|
| "Open YouTube" / "go to GitHub" | Opens the site in your default browser |
| "Open calculator / notepad / terminal / file explorer / settings" | Launches the native app (desktop) |
| "Open spotify" | Opens Spotify via its URI scheme |
| "Play *Graffitia* by Green Day" | Opens Spotify search for the song |
| "Play *lofi beats* on YouTube" | Opens YouTube search results |
| "Search for pasta recipes" | Google search |
| "Search *rust lifetimes* on GitHub / YouTube / Wikipedia / Reddit" | Site-specific search |
| "Open example.com" | Opens any valid domain over https |
| "What time is it?" / "What's the date?" | Answers in the bubble |
| "Set a timer for 5 minutes" / "set a 10 minute timer" | Timer with sound + notification when it ends |
| "Remind me to stretch in 20 minutes" | Reminder bubble (and notification if allowed) |
| "Take a note buy milk" / "read my notes" / "clear my notes" | Notes saved locally on the device (up to 50) |
| "What is 12 times 7?" / "calculate (3 + 4) * 2" | Safe calculator (no `eval`) |
| "Flip a coin" / "roll a dice" / "roll a d20" | Random results |
| "Open frobnicator" → "yes" | Unknown app? Say "yes" and it searches Google for it |
| "Tell me a joke", "Hello", "Thanks", "Help" | Chit-chat |
| "Cancel" / "Never mind" | Stops |

Known sites: YouTube, Google, Gmail, GitHub, Maps, Netflix, Reddit, X, WhatsApp Web, Wikipedia, Claude, ChatGPT, Amazon, Discord.
Add more in [`src/web/core/catalog.js`](src/web/core/catalog.js).

## AI chat (talk about anything)
Commands stay instant and offline. When a sentence matches **no** command, Sir Pixel sends it to an AI and shows the answer in the bubble (short conversation memory, last 12 messages). The AI's reply is only ever **displayed**, never executed as a command.

Click the **⚙ gear** next to the mic to set it up. Works with any OpenAI-compatible `/chat/completions` endpoint:

| Provider | Base URL | Model (editable) | Key |
|---|---|---|---|
| **NVIDIA API** | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.1-8b-instruct` (use any model on build.nvidia.com) | `nvapi-...` from build.nvidia.com |
| **Local – Ollama (Qwen)** | `http://localhost:11434/v1` | `qwen3:4b` – run `ollama list` for your exact tag | none |
| **Local – LM Studio** | `http://localhost:1234/v1` | the model id shown in LM Studio | none |
| Custom | any `https://` URL (plain `http://` only for localhost / LAN) | – | optional |

Local Qwen quick start: `ollama pull qwen3:4b`, make sure Ollama is running, then choose **Local – Ollama** in the gear panel and press **Save & test**.

- **Desktop:** requests are made by the Electron main process; the API key is stored **encrypted** (Electron `safeStorage`) in the app's user-data folder and is **never exposed to the UI**. Changing the Base URL without entering a new key discards the saved key, so it can't be redirected to another server.
- **Android:** requests use the native HTTP plugin (no CORS). Settings, including the key, are kept in the app's private storage. `localhost` on a phone is the phone itself – to use a local model, run Ollama on your PC with `OLLAMA_HOST=0.0.0.0` and enter `http://<pc-lan-ip>:11434/v1`.
- Qwen3 "thinking" output is stripped automatically (`<think>…</think>`).
- Not available in the plain browser preview (`npm run web`).

## Architecture

```
┌──────────────────────────── src/web (shared) ────────────────────────────┐
│  index.html · styles.css · app.js (UI state machine)                      │
│  pet.js (SVG mascot) · speech.js (STT providers) · platform.js (bridge)   │
│  local-actions.js (timers, notes)                                         │
│  core/  intents.js (parser) · utils.js (duration, math) · catalog.js ·    │
│         llm.js (AI chat helpers) · personality.js                        │
└───────────────┬───────────────────────────────────────┬───────────────────┘
                │                                       │
     ┌──────────▼──────────┐                 ┌──────────▼──────────┐
     │ Electron shell      │                 │ Capacitor shell     │
     │ electron/main.js    │                 │ android/            │
     │ preload.js          │                 │ AppLauncher plugin  │
     │ launcher.js         │                 │ SpeechRecognition   │
     │ Windows + Linux     │                 │ Android             │
     └─────────────────────┘                 └─────────────────────┘
```

Data flow: **speech → transcript → `parse()` → `{intent, reply, action}` → `platform.execute(action)`**.

- `core/` is pure, dependency-free ES modules → unit-tested with Node's built-in runner.
- `platform.js` picks one of three bridges (`desktop`, `android`, `web`) and exposes the same small interface.
- Actions are plain data (`open-url`, `open-app`), so the parser never touches the OS directly.

## Project structure
```
.
├── android/                # Capacitor-generated Android project (committed)
├── assets/icon.png         # App / tray icon (generated by scripts/make_icons.py)
├── electron/
│   ├── main.js             # Window, tray, hotkeys, IPC
│   ├── preload.js          # contextBridge → window.assistant
│   └── launcher.js         # Safe app launcher (no shell, allow-listed)
├── src/web/                # Shared UI + core (also the Capacitor webDir)
├── scripts/                # serve-web.js (browser preview), make_icons.py
├── test/                   # node --test suites
├── capacitor.config.json
├── package.json            # scripts + electron-builder config
├── progress.md             # Living progress log
└── docs/ci-workflow.yml    # CI workflow (copy to .github/workflows/ci.yml to enable)
```

## Getting started
**Prerequisites:** Node.js 20+, npm. For Android: JDK 21 and the Android SDK (Android Studio).

```bash
git clone https://github.com/Gaushik2008/DesktopAssistant.git
cd DesktopAssistant
npm install
npm test
```

## Running on each platform

### Windows / Linux (Electron)
```bash
npm start          # normal
npm run dev        # with DevTools
```
| Action | Shortcut |
|---|---|
| Talk | `Ctrl+Alt+Space` (or tray → Talk, or click the mic) |
| Type a command | `Ctrl+Alt+T` |
| Cancel listening | `Esc` |
| Show / hide | Tray icon click |

Linux needs a compositing window manager for transparency.

### Android (Capacitor)
```bash
npm run android:sync    # copy src/web into the Android project
npm run android:open    # open in Android Studio, then Run ▶
# or from the command line:
npm run android:apk     # → android/app/build/outputs/apk/debug/app-debug.apk
```
The app asks for the microphone permission on first use.

### Browser preview (no native shell)
```bash
npm run web      # serves src/web locally; links open in new tabs
```

## Building installers / APK
| Target | Command | Output |
|---|---|---|
| Windows (NSIS + portable) | `npm run dist:win` | `dist/*.exe` |
| Linux (AppImage + deb) | `npm run dist:linux` | `dist/*.AppImage`, `dist/*.deb` |
| Android debug APK | `npm run android:apk` | `android/app/build/outputs/apk/debug/` |

Build each desktop installer on its own OS (or use the CI workflow).

## Speech recognition
`src/web/speech.js` tries providers in order:

1. **Android native recogniser** via `@capacitor-community/speech-recognition`.
2. **Web Speech API** (Chromium).
3. **Typed fallback** if neither works.

> ⚠️ Stock Electron ships the Web Speech API **without Google API keys**, so on desktop it commonly fails with a network error and Sir Pixel falls back to the typed box. A local engine (Vosk / whisper.cpp) is the planned fix — see the [Roadmap](#roadmap).

## Security model
- Speech is **never** executed as a shell command; `spawn()` is always called with `shell: false` and an args array.
- Only **catalog entries** can launch apps; unknown names are refused.
- URLs must use an **allow-listed scheme** (`https`, `http`, `spotify`, `mailto`, `discord`).
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, navigation and new windows denied, only the `media` permission is granted.
- The renderer has a strict Content-Security-Policy (`script-src 'self'`).
- The Android manifest declares only `INTERNET`, `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS`, plus `<queries>` for package visibility.

## Customising
- **Personality / quips:** `src/web/core/personality.js`
- **New websites or apps:** `src/web/core/catalog.js` (and mirror desktop commands in `electron/launcher.js` — a test checks they stay in sync)
- **New voice commands:** add a rule to `parse()` in `src/web/core/intents.js` and a test in `test/intents.test.mjs`
- **Look & feel:** `src/web/styles.css`, `src/web/pet.js`

## Testing
```bash
npm test
```
Runs, with Node's built-in test runner:
- **Unit tests** – intent parser, utils (duration/maths), local actions, launcher.
- **LLM tests** – request building, response cleaning, error mapping, timeouts, encrypted key store.
- **UI integration tests** (`test/ui.test.mjs`) – also covers the AI chat flow and settings panel; loads the real `index.html` + `app.js` in **jsdom** with a stubbed desktop bridge and drives it through the typed-command box (open site, Spotify, maths/notes, "yes" follow-up, timer firing, mic fallback, Esc, dismiss).

**Electron smoke test** (Linux, needs `xvfb` + `ffmpeg`): `npm run smoke` launches the real app on a virtual display, saves a screenshot and fails on JS errors.

jsdom does not render pixels or run Electron/Android; real-browser end-to-end tests are on the roadmap.

## CI
To enable it, copy the file to `.github/workflows/ci.yml` (pushing workflow files needs a token with the `workflow` scope or the GitHub web UI).

`docs/ci-workflow.yml` runs the tests, builds Linux and Windows desktop packages, and assembles an Android debug APK, uploading each as a workflow artifact.

## Platform notes & known limitations
- **Android has no "desktop overlay".** The mascot lives inside the app; a system-wide floating overlay needs a native service with the "draw over other apps" permission (planned).
- Opening installed Android apps by package name relies on the AppLauncher plugin and has not been verified on a physical device yet.
- Electron click-through is disabled on Linux (`forward` unsupported there); the window stays interactive.
- Global hotkeys may be unavailable under some Wayland compositors.
- macOS works best-effort but is not an official target.

## Roadmap
- [x] jsdom UI integration tests
- [ ] Real-browser (Playwright) end-to-end tests in CI
- [ ] Offline speech recognition on desktop (Vosk / whisper.cpp)
- [ ] Android floating overlay service
- [ ] Wake-word ("Hey Sir Pixel") detection
- [ ] Settings panel (voice language, hotkeys, start on login)
- [x] Timers, reminders, notes, calculator, dice/coin
- [ ] More commands: volume control, weather
- [x] LLM fallback for unrecognised requests (NVIDIA API, Ollama/Qwen, LM Studio)
- [ ] Voice replies (text-to-speech) and streaming answers
- [ ] Model auto-detect in the settings panel
- [ ] Code signing and auto-update

## Contributing & license
Issues and PRs welcome. Please run `npm test` first. Licensed under the **MIT** license (see `package.json`).
Sir Pixel is an original character; he is not affiliated with any game or franchise.
