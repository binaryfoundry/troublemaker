# TroubleMaker — promptable Ableton Live

Control and edit an Ableton Live Set from natural language. An agent reasons
about music; a deterministic bridge performs the edits through Live's own API.
No mouse automation, no screen scraping.

```
Natural-language prompt
        |
        v
Agent (music reasoning)
        |
        v
Structured command(s)          JSON over HTTP / WebSocket
        |
        v
Local bridge  (TypeScript)     validation, snapshots, transactions, logging
        |
        v
TroubleMaker Remote Script     JSON lines over loopback TCP
        |
        v
Live API / Live Object Model
        |
        v
Ableton Live Set
```

## A note on Max for Live

The implementation plan specifies a Max for Live device as the Live-side
endpoint. **Max for Live is not available in Live 11 Intro** — it ships with
Suite, or as a paid add-on for Standard. This project therefore uses a **MIDI
Remote Script** instead, which every Live edition loads, including Intro.

Nothing else about the design changes. The Remote Script has exactly the
responsibilities the plan assigns to the Max device — connect, resolve Live
objects, call the Live API, serialize, answer — and holds no musical
reasoning. The protocol, the bridge and the agent layer are unaffected.

Compared with a Max device, the Remote Script is in some ways a better fit: it
has first-class access to the Live Object Model, it loads with the application
rather than with a Set, and it needs no device on a track.

## Requirements

- Ableton Live 11 or 12 (tested on **11 Intro** and **12.4.6 Standard**). Live
  12.3+ is needed for the agent to build the mastering chain itself.
- Node.js 18 or newer
- ffmpeg on PATH, for mastering QC
- No Python install needed — the Remote Script runs on Live's embedded
  Python 3.7

## Install

```bash
npm install
npm run install-remote-script     # copies the script into the User Library
```

Then, in Live:

1. **Restart Live.** It only scans Remote Scripts at startup.
2. Preferences → Link/Tempo/MIDI → **Control Surface**: choose `TroubleMaker`.
   Leave **Input** and **Output** set to `None`.
3. Live status bar shows `TroubleMaker bridge listening on port 9877`.

Start the bridge:

```bash
npm run bridge
```

Check the round trip:

```bash
npm run cli -- selftest
```

To develop against the script without reinstalling after every change, link it
instead of copying — you still need to restart Live to reload it:

```powershell
powershell -ExecutionPolicy Bypass -File remote-script/install.ps1 -Link
```

Uninstall with `-Uninstall`.

## Using it

```bash
npm run cli -- state                 # compact project overview
npm run cli -- tempo                 # read tempo
npm run cli -- tempo 126             # set tempo
npm run cli -- tracks                # tracks with their stable ids
npm run cli -- selected              # selected track / clip / device
npm run cli -- notes 3 0             # notes in track 3, clip slot 0
npm run cli -- devices 3             # devices on track 3
npm run cli -- params 3 1            # that device's parameters
npm run cli -- capabilities          # what this Live install supports
```

Any command, with JSON arguments, and optionally without applying it:

```bash
npm run cli -- raw live.set_tempo '{"bpm":124}'
npm run cli -- raw live.replace_notes '{"track_id":3,"clip_slot":0,"notes":[]}' --dry-run
```

The plan's smoke test works as written:

```bash
curl http://127.0.0.1:8765/state

curl -X POST http://127.0.0.1:8765/command \
  -H 'content-type: application/json' \
  -d '{"command":"live.set_tempo","args":{"bpm":126}}'
```

## MCP server (Claude Code and other agents)

`mcp/server.ts` serves the project to any MCP client over stdio. The
repository's `.mcp.json` registers it, so Claude Code opened in this folder
offers the `troublemaker` server. Approve it once, then ask in plain
language: "make the hats on track 4 more syncopated", "QC the mix against
melodic techno", "build the arrangement".

```bash
npm run mcp          # run it by hand (an MCP client normally starts it)
npm run test:mcp     # read-only smoke test against a running Live
```

If a bridge is already running it shares that one, so the CLI and the agent
see the same snapshots. Otherwise it starts its own bridge on port 8765.

| Tool | Job |
| --- | --- |
| `live_status`, `get_project`, `get_selection`, `read_clip`, `get_devices` | Read the Set; ids for everything else |
| `transform_clip` | Syncopate, straighten, thin, densify, humanize, swing, transpose, conform to key, vary, pre-drop gap. Snapshots first, applies atomically, reads back |
| `write_part`, `write_notes` | Generate kick / hats / kit / bass / chords / build-up / Euclidean / polyrhythm, or a bass copied from a reference track |
| `restore_snapshot` | Undo any edit by its snapshot id |
| `set_mixer`, `set_device_parameter`, `insert_device`, `transport` | Faders in dB, parameters by displayed value or option, native devices, playback |
| `master_chain`, `master_set`, `capture_master`, `qc`, `ab_trial` | MIXING.md mastering: chain build and presets, reasoned changes, capture, QC against references, A/B at matched loudness |
| `references`, `analyze_bass` | Reference sets and bass profiles |
| `effects`, `apply_effect`, `identify_effect` | The EFFECTS.md codex: look up, build, identify by ear |
| `arrangement` | Plan from a style template, lay Session loops onto the Arrangement |
| `bridge_command` | Any validated bridge command or transaction, with dry run |

The agent prompts (`system`, `music-editing`, `composition`, `effects`,
`mastering`) are MCP prompts, and they are also exposed as resources, along
with the effects codex, style templates, reference sets and the command
catalogue.

## Mixing and mastering

The mastering tools follow [MIXING.md](MIXING.md): measurement first,
loudness as a limit rather than a goal, references compared drop to drop at
matched loudness, small changes that are always read back, and a willingness
to conclude "fix it in the mix".

```bash
# Measure an exported master against 3-5 references (no Live needed)
npm run cli -- qc master.wav --ref a.wav --ref b.wav --ref c.wav --profile techno

# Live 12.3+: the agent builds and dials in the chain itself
npm run cli -- master build

# Record 16 bars of the Master output inside Live and measure it - no export
npm run cli -- qc --capture --bars 16 --scene <id> --ref a.wav --ref b.wav --ref c.wav

# References chosen from your own library by artist set and tempo
npm run cli -- qc --capture --bars 16 --scene <id> --refs "melodic techno"

# What a reference's bassline does: rhythm, pitches, kick ducking
npm run cli -- bass "D:/beatport/some track.mp3"

# Try a change; keep it only if it wins at matched loudness, else revert
npm run cli -- ab limiter_gain 4 --reason "under the window" --bars 16 --scene <id>

# Adjust the Master chain by role, within safe ranges, with a logged reason
npm run cli -- master chain
npm run cli -- master checkpoint "before limiter work"
npm run cli -- master set limiter_ceiling -1.5 --reason "true peak 0.4 dB over"
```

`qc` prints a PASS / REVIEW / FAIL report covering loudness against the
reference median, true peak, clipping, tonal balance by band, low-end mono
compatibility and the master-chain rules. See
[docs/mastering.md](docs/mastering.md) for the workflow, the template chain to
put on Master, and what changes when you upgrade to Live 12.

## Composition and effects

`COMPOSITION.md`, `EDM-COMPOSITION.md` and `EFFECTS.md` are integrated as
agent prompts (`agent/prompts/composition.md`, `agent/prompts/effects.md`),
machine-readable knowledge (`agent/knowledge/effects.json`, `styles.json`)
and tools:

```bash
# Arrangement: plan from a style template, then lay Session loops onto the timeline
npm run cli -- arrangement plan melodic_techno --roles kick,bass,chords,hats
npm run cli -- arrangement build melodic_techno --map kick=12,bass=15,chords=18,hats=21

# Effects: 34 families as cue / mechanism / control law / energy function
npm run cli -- fx list --energy accumulate
npm run cli -- fx show "roulette wheel slowing down"
npm run cli -- fx apply noise_riser --track 12 --start 112 --bars 8
npm run cli -- fx identify capture.wav     # which effect an excerpt sounds like
```

The pure tools cover tempo-synced timing, seventh/ninth/sus voicings with
voice-leading, Euclidean rhythms, polyrhythms and polymetric clips, exponential
ratchets and retrigger decelerations, fills, risers and pre-drop silence. Every
buildable recipe has been applied on Live 12.4 Standard; effects Live cannot
build through its API (tape stop, reverse reverb, kick-keyed sidechain) are
refused with the reason, and Suite-only devices are never used.

## HTTP API

| Route            | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `GET /health`    | Is the bridge up, and is Live connected             |
| `GET /status`    | Connection detail, latency, counters                |
| `GET /state`     | Tempo and track names (the plan's smoke test shape) |
| `GET /commands`  | The full command catalogue                          |
| `POST /command`  | Run one command, or a `transaction`                 |
| `WS /ws`         | Same commands, plus connection events pushed        |

Request and response envelopes are in [schemas/](schemas/).

The bridge binds to `127.0.0.1` only. It is not exposed to the LAN, and there
is no authentication because there is no remote surface to authenticate.

## Project layout

```
remote-script/TroubleMaker/   Live-side endpoint (Python 3.7, no music logic)
bridge/src/                   validation, transport, snapshots, transactions, CLI
bridge/src/workflows.ts       multi-step jobs shared by the CLI and MCP server
mcp/                          MCP server (stdio): tools, prompts, resources
bridge/src/mastering/         master-chain roles, safe ranges, decision log
qc/src/                       offline audio QC: ffmpeg loudness + PCM analysis
bridge/tests/                 unit, protocol and golden musical tests
agent/src/                    music theory, pattern generation, transforms
agent/src/mastering/          profiles, reference median, QC policy, reports
agent/prompts/                system, music-editing, composition, effects, mastering
agent/knowledge/              effects codex and style templates (JSON)
agent/tools/                  LLM tool definitions
schemas/                      command, response and project-state JSON Schema
devices/                      semantic hints for common Live devices
examples/                     worked command payloads
docs/capabilities.md          what is supported, and what is not
docs/mastering.md             mastering workflow and Live 12 upgrade notes
```

## Design rules

The bridge is deterministic; all musical judgement lives in the agent. The
Remote Script is mechanical and holds no state beyond object handles.

Every command is validated before it reaches Live — pitch 0–127, velocity
0–127, positive durations, in-range beats, real track/clip/device/parameter
ids. LLM-generated JSON is never trusted, and unknown argument keys are
rejected rather than ignored.

Objects are addressed by stable handles, never by positional index and never
by name. Names are mutable and non-unique; the bridge offers them for lookup
only.

Errors carry a code, a message, and the alternatives that would have worked:

```json
{
  "code": "PARAMETER_NOT_FOUND",
  "message": "Device 'Auto Filter' does not expose a parameter matching 'Cutoff'.",
  "available_parameters": ["Frequency", "Resonance", "Drive"]
}
```

Edits read before they write and verify after. Destructive operations
snapshot the clip first, so a bad generation can be reverted without touching
Live's shared undo stack.

## Testing

```bash
npm run test:all     # 303 TypeScript + 107 Python tests, no Ableton required
npm test             # TypeScript only
npm run test:python  # Live-side handlers only
npm run typecheck
```

The TypeScript suite covers protocol framing and id correlation, reconnect,
validation bounds, snapshot and transaction semantics, note/beat/bar
conversion, scale and chord generation, and golden musical tests that assert
properties — "the pitch sequence survived, note count within ±20%, at least
two notes moved off the grid" — rather than exact note lists, because
variation is the point.

The Python suite runs the real handlers against a fake Live Object Model
(`remote-script/tests/fake_live.py`) that reproduces the behaviour that bites:
deleted objects raising `RuntimeError`, per-device parameter ranges, and the
Live 11 note-id API.

You can also host the real Remote Script against that fake Live and drive the
whole stack over real sockets, with Ableton closed:

```bash
npm run fake-live       # terminal 1: the Remote Script, on port 9877
npm run bridge          # terminal 2
npm run cli -- selftest # terminal 3
```

Against the real thing, `npm run cli -- selftest` is the round-trip check, and
it restores the tempo it probes with.

## Limits

See [docs/capabilities.md](docs/capabilities.md) for the full table. The main
ones: Session view only (no Arrangement editing), MIDI only (no audio clip
editing or warping), no device loading, and Live Intro caps a Set at 16 tracks.

Live polls the Remote Script roughly every 100 ms, so commands return in
~50 ms on average. That suits interactive editing; it is not sample-accurate
control, and it is not meant to be.
