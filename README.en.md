# Lowsper (English summary)

[![CI](https://github.com/PercyaDJ/Lowsper/actions/workflows/ci.yml/badge.svg)](https://github.com/PercyaDJ/Lowsper/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**100% local meeting transcription, in the browser, with nothing to install.**

Lowsper captures your microphone and the meeting audio (Teams, Zoom, Meet...), transcribes live with
Whisper, tells speakers apart, and gives you a timestamped Markdown transcript at the end, ready to
hand to an AI for meeting minutes. Neither audio nor text ever leaves the computer.

The interface is in English or French, following the browser language (it can be changed in
Settings, « Transcription » tab, « App language »). The full documentation is in French: see
[README.md](README.md).

![Lowsper during a fictional meeting: timer, status check of the microphone, sound and text, live transcript](docs/images/enregistrement.png)

## Why it exists

- **No installation.** Lowsper is a single HTML file opened from disk (`file://`) in Edge or
  Chrome: no executable, no admin rights, no local server. It works on locked-down corporate
  laptops where installing software is not allowed.
- **Private by design.** Everything runs on the machine (Whisper through transformers.js and ONNX
  Runtime Web, in WebAssembly or WebGPU). The page's Content Security Policy blocks every network
  connection except the one-time model download from Hugging Face, and an automated test checks it
  on every pull request. Audio is never written to disk.
- **Built for meetings, not dictation.** Two sources (you and the other participants), speaker
  separation, custom glossary and domain vocabularies, a small always-on-top window, back-to-back
  meetings, and a safety net that never silently drops speech.
- **Straight into your notes.** Each place (« Personnel », « Travail »...) is a folder and a note
  format. By default, notes go to `Notes/<place>` inside the Lowsper folder; a place can also
  write into a folder of your choice, such as an Obsidian vault. « For note apps » adds YAML front
  matter, a note template and `[[Name]]` links for the speakers you name. The note is updated as
  you fix it.
- **Clear settings.** Three tabs (Transcription, Notes and summary, Advanced), grouped lists and
  sub-screens. « Words to recognize » are given to Whisper before transcribing; « Automatic
  fixes » replace a misheard word after transcribing. Settings save automatically; « Export
  settings to a file » and « Import settings from a file » only move them to another PC (voice
  prints are never exported).
- **Recordings too.** Drop a WAV, MP3, M4A/AAC, OGG/Opus or WebM file (even several hours long)
  and it goes through the same engine. Files are read in small pieces with bounded memory and are
  never copied or uploaded.

## Quick start

1. Download `Lowsper-X.Y.Z.zip` from the [latest release](https://github.com/PercyaDJ/Lowsper/releases/latest)
   and unzip it.
2. Open `Lowsper.html` in Edge or Chrome.
3. First launch only: the welcome screen shows what Lowsper found on your PC (processors, memory,
   graphics card) and ticks the model « Best for this PC ». Click « Download and install » and
   select the Lowsper folder shown on screen. The model (80 to 330 MB) is downloaded once and
   stored next to the page.
4. On the home screen, name the meeting (optional), choose where to « Save note to », and click
   « Start ». The « Before you start » window recalls the three steps: tell the other people,
   share your screen **with audio**, allow the microphone.
   Lowsper shrinks to a small window (time, microphone and meeting sound levels, pause, stop). The
   full window shows a plain-language status check: « Hearing you », « Coming through » (or
   « Nothing is coming through » with « How to fix »), and whether the text is up to date.
5. Click « Stop »: the `.md` transcript lands in `Notes/<place>` inside the Lowsper folder (or the
   folder you chose for the place; your Downloads folder if the browser has no folder access).
   The end screen shows the readable text on the left: click « Speaker 2 » to type the real
   name, and it changes everywhere. On the right, « What next? »: « Get a summary » copies
   instructions written like a system prompt (role, context, task, rules, then the transcript),
   to paste into the AI assistant of your choice; « See what is copied » shows the exact text.
   Instructions you have edited are never replaced.

Recognition is tuned for French (with an English and an automatic French/English mode). The note
follows the app language when the meeting starts: in English, its header and labels are
translated (« Speaker 1 », « You »...) and the file is named `meeting_...md`. Note template
variables and front matter keys keep the same names in both languages. The built-in domain
vocabularies are French lists for now.

## Learn more

- [docs/architecture.md](docs/architecture.md): how audio flows from the microphone to Markdown.
- [docs/deploiement.md](docs/deploiement.md): deployment guide for IT and security teams.
- [SECURITY.md](SECURITY.md): threat model and private vulnerability reporting.
- [decision.md](decision.md): every technical decision, with the options considered and measurements.
- [CONTRIBUTING.md](CONTRIBUTING.md): issues and pull requests are welcome, in French or English.

License: MIT. Third-party licenses: `app/engine/THIRD_PARTY_LICENSES.txt`.
