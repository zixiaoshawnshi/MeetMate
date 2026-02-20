# MeetR �?Design Document

**Version:** 0.1
**Date:** 2026-02-18
**Status:** Pre-development

---

## 1. Purpose

MeetR is a desktop meeting assistant designed to support structured, in-person interview and consultation sessions. Its primary use case is **smart home design interviews with disability families** conducted by occupational therapists or assistive technology specialists, but the tool is intentionally generalized for any in-person meeting that benefits from live transcription, structured notes, and AI-assisted agenda management.

The core goal is not just to record what happened �?it is to **keep the meeting on track** and produce a **structured, usable output** at the end.

---

## 2. Core Features

### 2.1 Live Transcription
- Captures audio from the system microphone in real time.
- Transcribes speech with speaker diarization (auto-labeled as Speaker 1, Speaker 2, etc.).
- Speakers can be renamed to real names at any point during the session.
- Transcription segments are timestamped and attributed to a speaker.

### 2.2 Manual Notes
- A free-text area for attendees or the facilitator to type notes during the meeting.
- Persisted continuously to the local database �?no manual save needed.
- Included as context when the AI generates a summary.

### 2.3 Agenda
- Displayed as a markdown-formatted nested list (checkboxes, bullet points, sub-items).
- Editable by the user at any time during the session.
- Updated by the AI assistant on demand: items can be ticked, annotated with additional detail, expanded with sub-items, or reordered to reflect the actual flow of the meeting.
- Example format:
  ```markdown
  - [ ] Introductions
  - [ ] Home layout walkthrough
    - [ ] Bedroom accessibility needs
    - [ ] Bathroom grab bars
  - [x] Voice control priorities (covered)
    - Smart speaker placement confirmed: kitchen + bedroom
  - [ ] Budget discussion
  ```

### 2.5 Audio Recording
- The session audio is recorded to a local file simultaneously with transcription �?no extra mic capture needed, same stream.
- Recording starts and stops with the session (tied to the Record/Stop button).
- Stored as a WAV file (lossless, no encoding overhead during capture). At 16kHz mono 16-bit, a 1-hour session is ~115MB �?acceptable for local storage.
- File path is stored in the session record; the file itself lives in a per-session folder alongside exports.
- Intended use: **QA review of initial assessments** �?the facilitator or supervisor can replay the meeting audio after the fact.
- **Consent notice:** Because this use case involves disability families, the UI must display a visible recording indicator (red dot + "Recording" label in the toolbar) for the full duration of the session. A brief consent acknowledgement prompt should appear before recording begins.
- **Synchronized playback (future):** Because transcript segments have `start_ms` timestamps, a future version could allow clicking a transcript line to seek to that position in the audio. This is not in scope for v1 but the data model supports it.

### 2.4 AI Assistant
- Triggered manually via a button (no auto-refresh).
- Receives as input: full transcript so far, current manual notes, current agenda markdown.
- Produces two outputs:
  1. **Free-form summary:** key points discussed, decisions made, open questions.
  2. **Updated agenda:** revised markdown reflecting progress, with items ticked, annotated, or expanded based on what was discussed.
- Powered by Claude (`claude-sonnet-4-6` via the Anthropic SDK).
- Each AI invocation is stored in the database with a timestamp and the model used.

---

## 3. UI Layout

Four panels arranged as three columns on top and a full-width panel on the bottom:

```
┌─────────────────────────────────────────────────────────────�?
�? MeetR  [Session Title]    [�?Recording]  [�?Stop]  [�?AI Update]�?
├─────────────────┬───────────────────┬───────────────────────�?
�?    AGENDA      �?  TRANSCRIPTION   �?   MANUAL NOTES       �?
�?                �?                  �?                      �?
�?- [ ] Item 1   �?00:01 [Spk 1]     �? (free text)          �?
�?  - [ ] Sub    �?Hello, today...   �?                      �?
�?- [x] Item 2   �?00:34 [Spk 2]     �?                      �?
�?                �?We need to...     �?                      �?
�?[+ Add item]   �?                  �?                      �?
�?[Edit]         �?                  �?                      �?
├─────────────────┴───────────────────┴───────────────────────�?
�? AI SUMMARY                              Last updated: 02:34 �?
�? Key points: ...   Decisions: ...   Open questions: ...      �?
�? [�?Collapse]                                                �?
└─────────────────────────────────────────────────────────────�?
```

- **Agenda panel:** Renders markdown. Has Edit mode (raw markdown textarea) and View mode (rendered checklist). AI updates apply to the markdown source directly.
- **Transcription panel:** Scrollable, auto-scrolls to bottom. Each segment shows timestamp, speaker label (clickable to rename), and text. Read-only.
- **Manual Notes panel:** Plain textarea, auto-saved on change (debounced).
- **Summary panel:** Collapsible. Displays the most recent AI-generated summary. Shows timestamp of last update.
- **Toolbar:** Session title (editable), Record/Stop button (starts both transcription and audio recording), AI Update button, and a Session menu (New, Open, Export). When recording is active, a persistent red dot and "Recording" label are shown. A consent acknowledgement dialog appears before the first recording begins.

---

## 4. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop shell | Electron | Cross-platform, good Node.js integration, familiar web stack |
| UI framework | React + TypeScript | Component model fits the four-panel layout |
| Styling | Tailwind CSS | Utility-first, fast to iterate |
| Main process | Node.js (Electron) | IPC, SQLite, spawns Python service, Claude API |
| Database | SQLite via `better-sqlite3` | Local, zero-config, fast synchronous API |
| Local transcription | Python (FastAPI + RealtimeSTT + pyannote) | Best real-time STT + diarization combo for local use |
| Remote transcription | Deepgram API | Fallback when local service not available or slow |
| AI assistant | Anthropic SDK (`@anthropic-ai/sdk`) | Claude for summarization and agenda updates |
| Markdown rendering | `react-markdown` + `remark-gfm` | Renders agenda and summary panels |
| Export | Node.js `fs` | Write markdown files per section |

---

## 5. Architecture

### 5.1 Process Model

```
┌────────────────────────────────────────────�?
�?              Electron App                  �?
�?                                           �?
�? ┌─────────────────────────────────────�? �?
�? �?    React UI (renderer process)     �? �?
�? �? Agenda | Transcript | Notes | AI   �? �?
�? └──────────────┬──────────────────────�? �?
�?                �?contextBridge IPC        �?
�? ┌──────────────▼──────────────────────�? �?
�? �?    Node.js (main process)          �? �?
�? �? - Session management               �? �?
�? �? - SQLite read/write                �? �?
�? �? - Claude API calls                 �? �?
�? �? - Markdown export                  �? �?
�? �? - Manages Python service process   �? �?
�? └──────────────┬──────────────────────�? �?
└─────────────────│──────────────────────────�?
                  �?WebSocket (localhost:8765)
┌─────────────────▼──────────────────────────�?
�?    Python Service (separate process)       �?
�?    FastAPI + WebSocket                     �?
�? - Audio capture (sounddevice / pyaudio)    �?
�? - Simultaneous WAV file write              �?
�? - VAD (silero-vad or webrtcvad)            �?
�? - Transcription (faster-whisper)           �?
�? - Speaker diarization (pyannote.audio)     �?
�? - Returns: {speaker, text, start, end}     �?
└────────────────────────────────────────────�?
```

### 5.2 Transcription Pipeline

1. Python service opens microphone stream using `sounddevice`.
2. Raw audio is simultaneously written to a WAV file on disk (continuous, uninterrupted).
3. Voice Activity Detection (VAD) detects speech segments and silences.
4. On silence boundary, the speech chunk is passed to `faster-whisper` for transcription.
5. `pyannote.audio` diarizes the chunk to assign a speaker label.
6. Result `{speaker_id, text, start_ms, end_ms}` is emitted over WebSocket to Electron main process.
7. Main process writes segment to SQLite and forwards to renderer via IPC.
8. Renderer appends segment to the Transcription panel.

Typical latency: **1�? seconds** after the speaker finishes a sentence.

### 5.3 Remote Transcription Fallback (Deepgram)

When the Python service is unavailable or the user selects remote mode in Settings:
- Audio is captured in Electron's main process using the Web Audio API.
- Streamed to Deepgram's WebSocket API with `diarize: true`.
- Response format is normalized to the same `{speaker_id, text, start_ms, end_ms}` shape.
- No changes required to the renderer or database layer.

### 5.4 AI Update Flow

1. User clicks **AI Update**.
2. Renderer sends IPC event to main process.
3. Main process queries SQLite for: all transcript segments, current notes content, current agenda markdown.
4. Constructs prompt (see Section 7) and calls Claude API.
5. Streams response back to renderer.
6. On completion, main process parses the response into `summary` and `agenda` sections and writes both to SQLite.
7. Renderer updates Summary panel and Agenda panel.

---

## 6. Data Model (SQLite)

```sql
CREATE TABLE sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL DEFAULT 'Untitled Meeting',
  audio_file_path TEXT,        -- absolute path to WAV file, null if recording not enabled
  created_at      TEXT NOT NULL,  -- ISO 8601
  updated_at      TEXT NOT NULL
);

CREATE TABLE transcript_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES sessions(id),
  speaker_id    TEXT NOT NULL,   -- 'SPEAKER_00', 'SPEAKER_01', etc.
  speaker_name  TEXT,            -- user-assigned display name, nullable
  text          TEXT NOT NULL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

CREATE TABLE agendas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  content     TEXT NOT NULL DEFAULT '',  -- markdown source
  updated_at  TEXT NOT NULL
);

CREATE TABLE summaries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  content     TEXT NOT NULL,   -- free-form markdown summary
  model_used  TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
```

**Speaker name resolution:** The renderer resolves `speaker_name` from `transcript_segments`. When a user renames "Speaker 1" to "Alice", all segments with that `speaker_id` are updated in SQLite, and the rendered transcript updates in place.

---

## 7. AI Prompt Design

### System Prompt

```
You are a meeting assistant. You help keep meetings on track and produce
structured, useful outputs. You will be given:
- A meeting transcript with speaker labels
- Manual notes taken by the facilitator
- The current meeting agenda in markdown format

Your job is to:
1. Write a concise free-form summary of the meeting so far.
   Include: key points discussed, decisions made, open questions.
2. Return an updated version of the agenda in the same markdown format.
   You may: tick completed items [x], add sub-items with detail from
   the discussion, annotate items with brief notes, reorder items to
   reflect the actual flow, or add new items that emerged in discussion.
   Do not remove items �?mark them skipped with [~] if needed.

Return your response in this exact format:
<summary>
...free-form summary here...
</summary>
<agenda>
...updated markdown agenda here...
</agenda>
```

### User Message (constructed at runtime)

```
## Transcript
{speaker_name}: {text} [{timestamp}]
...

## Manual Notes
{notes_content}

## Current Agenda
{agenda_markdown}
```

---

## 8. Export

Each section can be exported independently to a markdown file. A full session export combines all sections.

### Export file naming
```
meetr_{session_title}_{date}/
├── transcript.md
├── notes.md
├── agenda.md
├── summary.md
└── recording.wav        �?copied from internal storage on export
```

### Transcript export format
```markdown
# Transcript �?[Session Title]
**Date:** 2026-02-18
**Duration:** 47 minutes

---

**[00:01] Alice:** Hello, thanks for having us today...
**[00:34] Bob:** Of course, let's start with the bedroom layout...
```

---

## 9. Development Phases

### Phase 1 �?Skeleton
- [x] Scaffold Electron + React + TypeScript project
- [x] Four-panel UI layout with placeholder content
- [x] SQLite setup with schema
- [x] Session create/open/list

### Phase 2 �?Transcription and Recording
- [x] Python service: FastAPI + WebSocket server
- [x] RealtimeSTT + faster-whisper integration
- [x] pyannote speaker diarization
- [x] Simultaneous WAV file recording (same audio stream, written to per-session folder)
- [x] Consent acknowledgement dialog before first recording
- [x] Electron: WebSocket client, IPC to renderer
- [x] Transcript panel: live updates, speaker labels, renaming UI
- [x] Recording indicator in toolbar (red dot + "Recording" label)

### Phase 3 �?Notes and Agenda
- [x] Manual notes auto-save
- [x] Agenda panel: view mode (rendered markdown) and edit mode (textarea)
- [x] Agenda persisted to SQLite

### Phase 4 �?AI Assistant
- [x] LLM Provider settings, Ollama (local), Anthropic, OpenAI, OpenRouter
- [x] Claude API integration in main process
- [x] Prompt construction from SQLite data
- [x] Response parsing (summary + agenda)
- [x] Summary panel with streaming display
- [x] Agenda panel auto-update from AI response

### Phase 5 �?Export and Polish
- [ ] Markdown export per section
- [ ] Full session export
- [ ] Speaker renaming persisted and reflected in transcript
- [ ] Settings: transcription mode (local vs remote), model selection, HuggingFace token

### Phase 6 �?Packaging
- [ ] Electron auto-launch of Python service on startup
- [ ] electron-builder packaging for Windows/macOS
- [ ] First-run setup wizard (Python deps, HuggingFace token, API keys)

### Immediate TODOs
- [ ] Validate Deepgram diarization independently using saved session WAV files and compare with local mode outputs (speaker separation + latency + transcript quality).
- [ ] Prototype separate transcription and diarization services (decouple speaker assignment from chunked transcription and merge by timestamps).

---

## 10. Open Questions / Deferred Decisions

| # | Question | Notes |
|---|---|---|
| 1 | GPU acceleration for faster-whisper? | Depends on user hardware; default to CPU, detect CUDA/Metal at runtime |
| 2 | Multi-microphone / room audio? | Out of scope for v1; single mic input |
| 3 | Real-time agenda editing conflict with AI update | If user is editing when AI update arrives, merge or prompt? |
| 4 | Maximum session length | No hard limit; SQLite handles large transcripts fine |
| 5 | Authentication / multi-user | Out of scope for v1; single-user local tool |
| 6 | Accessibility of the MeetR UI itself | Should support keyboard navigation and screen reader given the user base |
| 7 | Audio file compression after session ends | WAV during recording (no encoding overhead); optionally compress to MP3/OGG on stop to save space |
| 8 | Audio retention policy | Should old recordings be auto-deleted after N days? Or left to the user? |
| 9 | Synchronized transcript/audio playback | Not in v1 scope, but `start_ms` timestamps on segments make this straightforward to add later |
| 10 | Consent dialog scope | One-time per install, or per session? Per-session is safer given rotating participants |

---

## 11. Key External Dependencies

| Dependency | Purpose | Requires |
|---|---|---|
| `faster-whisper` | Local STT | Python 3.10+, ~1GB model download |
| `pyannote.audio` | Speaker diarization | HuggingFace token, model download |
| `RealtimeSTT` | Streaming VAD + transcription | Wraps faster-whisper |
| `sounddevice` | Microphone capture in Python | PortAudio system library |
| `@anthropic-ai/sdk` | Claude API | `ANTHROPIC_API_KEY` env variable |
| `better-sqlite3` | SQLite in Node.js | Native module, compiled with Electron |
| `react-markdown` | Markdown rendering | �?|
| Deepgram SDK | Remote transcription fallback | `DEEPGRAM_API_KEY` env variable |

