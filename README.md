# 👑 DO.IT — Desktop Assistant

A voice-controlled **voxel-king desktop companion** for **Windows**, **Linux** and **Android**.
DO.IT sits on a grass block in the corner of your screen, listens when you tap the mic
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
8. [Speech recognition](#speech-recognition-voice-via-gemini) · [Wake word & always listening](#wake-word--always-listening)
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
- **Always listening, wake word "DO.IT"** – say *"DO.IT, open YouTube"* with no button press. Click the 👂 button (or say *"DO.IT, stop listening"*) to turn it off. See [Wake word](#wake-word--always-listening).
- **Idle quips** – DO.IT occasionally says something to stay alive.
- **Typed-command fallback** – when speech is unavailable or denied, a text box appears (`Ctrl+Alt+T`).
- **System tray** (desktop) and **global hotkeys**.
- **Click-through** transparent areas on Windows/macOS so the overlay never blocks your work.
- **Spoken replies (optional)** – click the 🔊 button or say *"turn on the voice"*; DO.IT reads his replies aloud using the system's built-in text-to-speech (no keys, works offline with local voices). Say *"stop"* / *"be quiet"* to interrupt, *"mute"* / *"voice off"* to turn it off. Off by default; the choice is remembered. The mic stops speech so he never hears himself.
- **Draggable** – move the pet anywhere on the desktop.
- **Offline-friendly** – the mascot is inline SVG; no remote assets.
- **Safe by design** – spoken text is never passed to a shell (see [Security model](#security-model)).

## Voice commands
You can optionally prefix commands with a wake phrase such as *"Hey DO.IT, …"*, and polite filler like *"please"* or *"can you"* is ignored.

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
| "Turn on the voice" / "speak out loud" / "unmute" | Reads replies aloud |
| "Mute" / "voice off" | Silences replies |
| "Stop" / "be quiet" | Interrupts current speech |
| "Tell me a joke", "Hello", "Thanks", "Help" | Chit-chat |
| "Cancel" / "Never mind" | Stops |

Known sites: YouTube, Google, Gmail, GitHub, Maps, Netflix, Reddit, X, WhatsApp Web, Wikipedia, Claude, ChatGPT, Amazon, Discord.
Add more in [`src/web/core/catalog.js`](src/web/core/catalog.js).

## AI chat (talk about anything)
Commands stay instant and offline. When a sentence matches **no** command, DO.IT sends it to an AI and shows the answer in the bubble (short conversation memory, last 12 messages). The AI's reply is only ever **displayed**, never executed as a command.

Click the **⚙ gear** next to the mic to set it up. Works with any OpenAI-compatible `/chat/completions` endpoint:

| Provider | Base URL | Model (editable) | Key |
|---|---|---|---|
| **Google Gemini** *(default; also powers voice)* | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-flash-latest` (any current Gemini model) | key from <https://aistudio.google.com/apikey> |
| **NVIDIA API** (chat only) | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.1-8b-instruct` (use any model on build.nvidia.com) | `nvapi-...` from build.nvidia.com |
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
│  tts.js (spoken replies) · local-actions.js (timers, notes)                                         │
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

## Speech recognition (voice via Gemini)
Voice works by **recording your voice and sending the short clip to Google Gemini**, because Electron — unlike Chrome — has no built-in speech service (its Web Speech API needs Google's private keys; this caused the old *"Voice recognition is unavailable here"* error).

**Setup (30 seconds):** create a key at <https://aistudio.google.com/apikey> → click the **⚙ gear** (or tray → *Settings*) → provider **Google Gemini** (default) → paste the key → **Save & test**. First launch opens this panel for you. The same key powers [AI chat](#ai-chat-talk-about-anything).

Pipeline (`src/web/recorder.js` → `speech.js` → main process → Gemini `generateContent`):
1. `getUserMedia` mic capture, voice-activity detection with a rolling noise floor (`createVad`, auto-stops ~1.2 s after you stop talking, tolerates pauses between words; 7 s with no speech; 15 s max). Tap the mic again to finish early, `Esc` to cancel. The mic button pulses with your voice level.
2. Resample to 16 kHz mono 16-bit **WAV** (works in Electron *and* Android WebView, no codec differences).
3. **Desktop:** the clip goes to the Electron main process, which calls Gemini — the API key never reaches the UI. **Android:** native HTTP plugin.
4. The transcript goes through the normal command parser → action, or → Gemini chat if no command matches.

**STT engine choice (offline/private options):** In the settings panel (⚙ gear), under **Speech-to-text**, you can choose the engine:
| Engine | Description |
|---|---|
| **Google Gemini** (default) | Cloud, requires API key; best accuracy |
| **Web Speech API** | Browser-built-in (Chrome/Edge), no key; does NOT work in Electron |
| **Android native** | On-device recognizer (Capacitor plugin), offline capable |
| **Local (Whisper.cpp)** | Coming soon — Tauri sidecar for fully offline transcription |

The choice is persisted in `localStorage` (`sirpixel.stt`) and works across all platforms.

Fallback order in `speech.js`: selected engine → (if Gemini fails on phone) Android native → Web Speech → typed box (`Ctrl+Alt+T`). Errors are specific: missing/invalid key and wrong model reopen the settings panel; quota, network, mic-denied and no-mic show a clear bubble and the typed box.

**Wrong model name (HTTP 404)?** Gemini model names change often. If Google rejects the saved model, DO.IT asks Google which models your key can use (`ListModels`), picks the newest plain *Flash*, saves it and retries automatically — the settings panel then shows *Connected (using …)*. This runs for both chat and voice on desktop; on Android, enter a model name manually.

Privacy/cost: audio is sent only while the red *Listening* state is shown, nothing is saved to disk; each command is one short Gemini request (plus one chat request when no command matches). Model is editable; default `gemini-flash-latest`.

## Wake word & always listening
The assistant is called **DO.IT**. In hands-free mode the mic stays armed and DO.IT acts **only** on speech that *starts* with its name:

| You say | What happens |
|---|---|
| "DO.IT, open YouTube" | Runs the command immediately |
| "DO.IT" … (pause) … "play lofi on YouTube" | Replies *"Yes?"*, then listens for one command |
| "Hey DO.IT, what time is it?" | Greetings before the name are fine |
| "DO.IT, stop listening" / "DO.IT, hands free off" | Turns always-listening off (ear button dims) |
| "start listening" (typed, or after tapping the mic) | Turns it back on |
| "We should go shopping tomorrow" | Ignored - no wake word, nothing is acted on or stored |

Speech-to-text spells the name many ways, so *"do it"*, *"DO.IT"*, *"do-it"*, *"doit"*, *"dew it"* and *"due it"* all count (plus the old name *"Sir Pixel"*). The matcher is `src/web/core/wake.js` (pure, unit-tested in `test/wake.test.mjs`).

**How it works:** `app.js` runs a loop: record one utterance with voice-activity detection → transcribe → if it starts with the name, run it, otherwise drop it. It pauses while DO.IT is talking, while settings/typing are open, and while you use the mic manually. The mic button always works too.

**Privacy - please read.**
- With the default **Gemini** engine, *every detected utterance* near the mic is uploaded for transcription so the app can check for the name. Ambient speech therefore leaves the device and counts against your Gemini quota. Turn the 👂 off in shared rooms.
- The mic is open continuously while it's on (your OS shows its recording indicator).
- Nothing without the wake word is executed, kept in history, or sent anywhere else.
- A truly private, offline wake word (nothing uploaded while idle) needs an on-device engine such as Vosk or openWakeWord. That is on the [roadmap](#roadmap).

**Limitations**
- A sentence that merely *starts* with "do it" (*"do it tomorrow"*) will wake it. It then goes to the AI as a question.
- It can mis-hear the name in noisy rooms or with strong accents; saying it clearly followed by a short pause works best.
- **Android:** always-listening works only while the app is open in the foreground (no background service yet). Some phones play a system beep each time the on-device recognizer re-arms.
- Exclusive-fullscreen games, a muted/occupied mic, or no Gemini key disable it automatically with a message; tap the ear to retry.
- Verified in real Chromium with a fake microphone (`npm run e2e:handsfree`) and mocked transcription. **Not yet verified** with a real person, a real mic and the live Gemini API.

## Always on top
DO.IT uses Electron's highest window level (`screen-saver`), is visible on every virtual desktop and over fullscreen apps, and **re-asserts** the topmost flag on blur / show / restore, display changes and every 3 s so other windows can't bury him. Tray → *Always on top* toggles it. On **Linux Wayland** compositors ignore always-on-top for normal windows, so the app runs through **XWayland** by default (`SIRPIXEL_OZONE=wayland` opts out). Windows exclusive-fullscreen games can still cover any overlay.

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
- Voice needs internet + a Gemini key; an offline engine (Vosk / whisper.cpp) is on the roadmap.
- Live Gemini transcription has only been tested against mocked responses, not the real API (no key in the build sandbox).
- macOS works best-effort but is not an official target.

## Roadmap
- [x] jsdom UI integration tests
- [ ] Real-browser (Playwright) end-to-end tests in CI
- [ ] Offline speech recognition on desktop (Vosk / whisper.cpp)
- [ ] Android floating overlay service
- [x] Wake word **"DO.IT"** with always-listening mode (cloud transcription; see [Wake word](#wake-word--always-listening))
- [ ] Offline wake-word engine (no audio leaves the device while idle)
- [ ] Settings panel (voice language, hotkeys, start on login)
- [x] Timers, reminders, notes, calculator, dice/coin
- [x] Spoken replies (text-to-speech) with toggle
- [ ] More commands: volume control, weather
- [x] LLM fallback for unrecognised requests (NVIDIA API, Ollama/Qwen, LM Studio)
- [ ] Voice replies (text-to-speech) and streaming answers
- [ ] Model auto-detect in the settings panel
- [ ] Code signing and auto-update

## Contributing & license
Issues and PRs welcome. Please run `npm test` first. Licensed under the **MIT** license (see `package.json`).
DO.IT is an original character; he is not affiliated with any game or franchise.
