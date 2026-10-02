from pathlib import Path

md = r"""# Promptable Ableton Live — Codex Implementation Plan

## 1. Goal

Build a local system that lets a user control and edit Ableton Live using natural-language prompts.

Example prompts:

- "Create a 16-bar melodic techno loop at 124 BPM."
- "Add a rolling bassline in F minor."
- "Make the bass more syncopated."
- "Create an 8-bar build-up into scene 5."
- "Open the filter gradually over the last 4 bars."
- "Turn this 8-bar idea into a 32-bar arrangement."
- "Make the drums less busy."
- "Add variation every fourth bar."
- "Read the selected MIDI clip and improve the groove."

The system should not automate the Ableton GUI with mouse/keyboard actions as its primary mechanism.

Instead, use:

1. Ableton Live
2. Max for Live
3. Live API / Live Object Model
4. A local bridge/server
5. A structured command protocol
6. Codex as the reasoning/composition layer

The initial product should focus on MIDI composition, clip manipulation, arrangement structure, mixer/device parameter changes, and automation.

---

# 2. High-Level Architecture

```text
Natural-language prompt
        |
        v
Codex / agent
        |
        v
Structured Ableton command(s)
        |
        v
Local Ableton bridge
        |
        v
Max for Live device
        |
        v
Live API / Live Object Model
        |
        v
Ableton Live Set
```

The important design principle is:

**Codex must reason about music and intent, while the bridge performs deterministic operations in Ableton.**

Do not make the LLM directly generate arbitrary Max patches or execute unvalidated commands against Live.

---

# 3. Project Structure

Suggested repository layout:

```text
ableton-agent/
    README.md
    AGENTS.md

    bridge/
        src/
            server.ts
            protocol.ts
            validation.ts
            session.ts
            transport.ts
            errors.ts

            commands/
                tracks.ts
                clips.ts
                notes.ts
                scenes.ts
                mixer.ts
                devices.ts
                automation.ts
                transport.ts
                arrangement.ts

        tests/

    max-device/
        AbletonAgent.amxd
        src/
            router.js
            live-api.js
            transport.js
            serialization.js
            errors.js

    agent/
        prompts/
            system.md
            music-editing.md

        tools/
            live-tools.json

        src/
            planner.ts
            executor.ts
            state.ts
            music-theory.ts

    schemas/
        command.schema.json
        response.schema.json
        project-state.schema.json

    examples/
        melodic-techno.json
        basic-drum-pattern.json
        arrangement-build.json
```

Use TypeScript for the local bridge unless there is a strong reason not to.

The Max for Live side can use JavaScript inside Max where practical.

---

# 4. Scope

## Phase 1 scope

Support:

- reading tracks
- reading scenes
- reading clip slots
- reading MIDI clips
- reading notes
- creating MIDI clips
- inserting notes
- deleting notes
- replacing notes
- editing note velocity
- editing note duration
- changing clip loop length
- changing tempo
- launching clips
- launching scenes
- stopping clips
- stopping playback
- setting track volume
- setting track pan
- setting send levels
- reading devices on a track
- reading exposed device parameters
- changing device parameters
- basic automation/envelope editing where Live exposes it reliably
- selecting/querying currently selected track/clip where possible

## Later phases

Add:

- arrangement-view editing
- more advanced automation
- audio clip manipulation
- warping
- groove manipulation
- device loading
- preset loading
- rack/macros
- return-track creation
- routing
- sidechain setup
- track grouping
- project-wide arrangement generation
- audio analysis
- stem analysis
- melody/harmony analysis
- sample search
- plugin metadata
- undo/redo integration
- generated previews
- agent memory for musical intent

---

# 5. Non-Goals for Version 1

Do not initially attempt:

- arbitrary mouse automation
- screen scraping
- computer vision control of Ableton
- controlling every third-party plugin UI
- automatically mastering finished tracks
- real-time audio generation inside the LLM
- replacing Ableton's audio engine
- hidden/internal unsupported Ableton APIs

Third-party plugins should initially be controllable only through parameters that Ableton exposes.

---

# 6. Communication Model

The local bridge and Max for Live device need a simple bidirectional protocol.

Preferred options:

1. WebSocket
2. TCP socket
3. UDP for simple messages plus another reliable channel

Prefer WebSocket or TCP unless Max limitations make another approach substantially easier.

Messages should be JSON.

Example:

```json
{
  "id": "cmd-1028",
  "command": "clip.get_notes",
  "args": {
    "track_id": 4,
    "clip_slot": 1
  }
}
```

Response:

```json
{
  "id": "cmd-1028",
  "ok": true,
  "result": {
    "clip_id": 98,
    "length_beats": 16,
    "notes": [
      {
        "pitch": 41,
        "start": 0.0,
        "duration": 0.25,
        "velocity": 105,
        "mute": false
      }
    ]
  }
}
```

Error:

```json
{
  "id": "cmd-1028",
  "ok": false,
  "error": {
    "code": "CLIP_NOT_FOUND",
    "message": "Track 4 clip slot 1 does not contain a MIDI clip."
  }
}
```

---

# 7. Stable Object References

Do not let the agent rely only on track names.

Names are mutable and non-unique.

Return stable IDs or bridge-generated handles whenever possible.

Example:

```json
{
  "track_id": 17,
  "name": "Bass",
  "type": "midi"
}
```

Commands should preferably operate on IDs.

Allow names only as a convenience lookup layer.

---

# 8. Core Tool API

Expose a deliberately small, composable tool set to Codex.

## Project

```text
live.get_project_state()
live.get_tempo()
live.set_tempo(bpm)
live.get_transport()
live.play()
live.stop()
```

## Tracks

```text
live.get_tracks()
live.get_track(track_id)
live.create_midi_track(name?)
live.rename_track(track_id, name)
live.set_track_volume(track_id, value)
live.set_track_pan(track_id, value)
live.set_track_send(track_id, send_index, value)
```

## Scenes

```text
live.get_scenes()
live.fire_scene(scene_id)
live.create_scene()
live.rename_scene(scene_id, name)
```

## Clips

```text
live.get_clip_slots(track_id)
live.get_clip(track_id, clip_slot)
live.create_midi_clip(track_id, clip_slot, length_beats)
live.delete_clip(track_id, clip_slot)
live.set_clip_loop(track_id, clip_slot, start, length)
live.fire_clip(track_id, clip_slot)
live.stop_clip(track_id)
```

## MIDI notes

```text
live.get_notes(track_id, clip_slot)
live.add_notes(track_id, clip_slot, notes[])
live.replace_notes(track_id, clip_slot, notes[])
live.remove_notes(track_id, clip_slot, filter)
live.update_notes(track_id, clip_slot, updates[])
```

Note representation:

```json
{
  "pitch": 41,
  "start": 0.0,
  "duration": 0.25,
  "velocity": 105,
  "mute": false
}
```

Time values should use beats rather than seconds wherever possible.

---

# 9. Device API

Expose devices as structured data.

```text
live.get_devices(track_id)
live.get_device(track_id, device_id)
live.get_device_parameters(track_id, device_id)
live.set_device_parameter(track_id, device_id, parameter_id, value)
```

Example result:

```json
{
  "device_id": 22,
  "name": "Auto Filter",
  "class_name": "AutoFilter",
  "parameters": [
    {
      "parameter_id": 3,
      "name": "Frequency",
      "value": 0.48,
      "min": 0.0,
      "max": 1.0,
      "display_value": "1.20 kHz"
    }
  ]
}
```

The agent must not assume parameter ranges.

It must inspect parameter metadata before changing a parameter unless the bridge already has a known mapping.

---

# 10. Parameter Normalization

Different Ableton/device parameters have different native ranges.

Create a common representation.

The bridge should return:

```json
{
  "value": 0.55,
  "normalized": 0.72,
  "min": 20,
  "max": 20000,
  "display_value": "1.3 kHz"
}
```

Allow commands to specify either:

```json
{
  "normalized": 0.7
}
```

or:

```json
{
  "value": 1300
}
```

The bridge must validate limits.

---

# 11. Automation API

Implement automation conservatively.

Possible API:

```text
live.get_automation(...)
live.set_automation(...)
live.clear_automation(...)
```

Use points:

```json
[
  {
    "beat": 32,
    "value": 0.2
  },
  {
    "beat": 48,
    "value": 0.8
  }
]
```

Example intent:

```text
"Open the filter during bars 9-16."
```

Agent translation:

```json
{
  "command": "automation.set",
  "args": {
    "track_id": 4,
    "device_id": 22,
    "parameter_id": 3,
    "points": [
      {
        "beat": 32,
        "normalized": 0.2
      },
      {
        "beat": 64,
        "normalized": 0.8
      }
    ]
  }
}
```

If Live's API does not provide reliable automation editing for a particular target, return a capability error rather than attempting UI automation.

---

# 12. Project-State Query

The most important tool should be:

```text
live.get_project_state()
```

It should provide a compact overview:

```json
{
  "tempo": 124,
  "time_signature": [4, 4],
  "playing": false,

  "tracks": [
    {
      "id": 1,
      "name": "Kick",
      "type": "midi",
      "clips": [
        {
          "slot": 0,
          "name": "Main Kick",
          "length_beats": 16
        }
      ],
      "devices": []
    },
    {
      "id": 2,
      "name": "Bass",
      "type": "midi",
      "clips": [
        {
          "slot": 0,
          "name": "Bass Main",
          "length_beats": 16
        }
      ]
    }
  ]
}
```

Do not automatically include every note in every clip.

Detailed data should be requested separately.

This prevents huge context payloads.

---

# 13. Musical Context Layer

Create helper functions that translate musical concepts into deterministic values.

Examples:

```text
note_name_to_midi("F1") -> 29
scale_notes("F", "minor")
bar_to_beat(bar, time_signature)
beat_to_bar()
quantize_time()
humanize_velocity()
humanize_timing()
```

Support at minimum:

- major
- natural minor
- harmonic minor
- melodic minor
- Dorian
- Phrygian

Do not bury musical interpretation inside the Max device.

The Max side should remain mechanical.

---

# 14. Agent Behaviour

The agent should follow this sequence:

```text
1. Understand requested musical change.
2. Query only the relevant Live state.
3. Identify affected tracks/clips/devices.
4. Produce an edit plan.
5. Execute deterministic commands.
6. Read the affected state back.
7. Verify the edit.
8. Report what changed.
```

Example:

User:

```text
Make the bass more syncopated.
```

Agent:

```text
get selected clip
get notes

analyse rhythm

replace/update selected notes

read notes again

summarise result
```

---

# 15. Read Before Write

The agent should normally inspect the target before making changes.

Bad:

```text
User: Make the bass more syncopated.

Agent:
replace_notes(...)
```

Good:

```text
get_selected_track()
get_selected_clip()
get_notes(...)
update_notes(...)
get_notes(...)
```

This allows prompts to be contextual.

---

# 16. Preserve Existing Material

Unless explicitly asked to regenerate something, edits should preserve as much existing material as possible.

Examples:

"Make it more syncopated"

should alter rhythm rather than generate a completely unrelated bassline.

"Give it more movement"

might change:

- note timing
- velocity
- octave movement
- note length
- filter automation

but should retain recognizable musical identity.

---

# 17. Composition Operations

Implement higher-level agent functions on top of primitive Live tools.

These do not need to be exposed directly by Max.

Examples:

```text
create_four_on_floor_kick()
create_offbeat_hat()
create_rolling_bass()
create_arpeggio()
create_chord_progression()
create_build_up()
create_breakdown()
create_drop_variation()
humanize_pattern()
add_fill()
add_call_and_response()
make_more_syncopated()
reduce_density()
increase_tension()
```

These functions should generate ordinary primitive commands.

---

# 18. Pattern Representation

Internally represent rhythmic patterns using beats.

Example:

```json
{
  "length_beats": 4,
  "events": [
    {
      "beat": 0,
      "pitch": 36,
      "duration": 0.25,
      "velocity": 120
    },
    {
      "beat": 1,
      "pitch": 36,
      "duration": 0.25,
      "velocity": 118
    },
    {
      "beat": 2,
      "pitch": 36,
      "duration": 0.25,
      "velocity": 121
    },
    {
      "beat": 3,
      "pitch": 36,
      "duration": 0.25,
      "velocity": 119
    }
  ]
}
```

Make pattern generation independent from Ableton.

Then translate the result to Live note commands.

---

# 19. Bars and Beats

Internally use zero-based beats.

For 4/4:

```text
bar 1 = beats 0-4
bar 2 = beats 4-8
bar 9 = beats 32-36
```

Provide helper functions so the agent does not manually calculate these repeatedly.

---

# 20. Editing Safety

Before destructive actions, the bridge should support snapshots.

At minimum:

```text
live.snapshot_clip(track_id, clip_slot)
live.restore_clip(snapshot_id)
```

A simple implementation can store:

- clip length
- loop settings
- notes
- clip metadata

in bridge memory.

Later add persistent snapshots.

---

# 21. Transactions

Support grouped edits.

Example:

```json
{
  "command": "transaction",
  "args": {
    "commands": [
      {},
      {},
      {}
    ]
  }
}
```

If possible, all edits should appear as a coherent operation.

If one command fails, return which command failed.

Do not silently leave partially applied edits without reporting them.

---

# 22. Undo

Where possible integrate with Ableton's undo behavior.

Also maintain bridge-level snapshots for important destructive operations.

Expose:

```text
live.undo()
live.redo()
```

only if reliable.

---

# 23. Capability Discovery

Implement:

```text
live.get_capabilities()
```

Example:

```json
{
  "midi_notes": true,
  "clip_creation": true,
  "device_parameters": true,
  "arrangement_editing": false,
  "automation_editing": true,
  "audio_warping": false
}
```

The agent must use this instead of assuming every API is available.

---

# 24. Selected Object Helpers

Convenience tools:

```text
live.get_selected_track()
live.get_selected_scene()
live.get_selected_clip()
live.get_selected_device()
```

This makes prompts natural.

Example:

```text
"Make this clip darker."
```

The agent can resolve "this clip" from Ableton's selection.

---

# 25. Example Workflow — Create Bassline

User:

```text
Create a rolling melodic-techno bassline in F minor for this 16-bar clip.
```

Agent actions:

```text
get_selected_track()
get_selected_clip()
get_clip()
get_tempo()

generate F minor rhythmic/melodic pattern

replace_notes(...)

get_notes(...)

report result
```

---

# 26. Example Workflow — Modify Existing Bassline

User:

```text
Make the bass more syncopated but keep the melody.
```

Agent:

1. read existing notes
2. group notes by phrase
3. retain pitch sequence
4. adjust note onset positions
5. shorten selected notes
6. optionally vary velocities
7. write updates
8. read result
9. verify note count and pitches remain substantially unchanged

---

# 27. Example Workflow — Build-Up

User:

```text
Make bars 25-32 build into the drop.
```

Agent should:

1. inspect tracks active during bars 25-32
2. identify likely drum, bass and lead tracks
3. determine available devices
4. create a conservative build

Possible edits:

- increase percussion density
- add snare roll
- shorten bass pattern
- open filter
- increase reverb send
- automate selected macro
- remove kick for final half-bar
- create one-beat silence before the drop

Do not assume all these operations are always appropriate.

Use existing project structure.

---

# 28. Musical Style Prompts

The user may request genre characteristics.

Examples:

```text
"Make it melodic techno."
"Make the drums more progressive-house."
"Give it a darker warehouse feel."
```

Translate these into musical characteristics rather than copying specific copyrighted recordings.

Style handling should affect:

- tempo range
- rhythmic density
- note lengths
- harmonic language
- syncopation
- register
- velocity
- automation
- arrangement structure
- sound-design parameter choices

---

# 29. Editing Third-Party Plugins

For VST/AU plugins:

1. inspect parameters exposed to Ableton
2. expose those parameters through the bridge
3. allow the agent to alter them

Do not attempt to understand arbitrary plugin GUIs in Version 1.

Example:

```text
get_device_parameters()
```

may reveal:

```text
Cutoff
Resonance
Drive
Env Amount
```

The agent can manipulate these.

---

# 30. Device Knowledge

Create an optional knowledge registry for common Ableton devices.

Example:

```text
devices/
    operator.json
    wavetable.json
    drift.json
    auto-filter.json
    echo.json
    reverb.json
```

Each file can contain semantic mappings:

```json
{
  "device": "Auto Filter",
  "roles": {
    "brightness": "Frequency",
    "resonance": "Resonance"
  }
}
```

This allows:

```text
"make it darker"
```

to map intelligently to a lower filter cutoff.

The agent must still inspect the actual device before writing parameters.

---

# 31. Natural-Language Command Layer

The agent should interpret relative musical language.

Examples:

```text
"more"
"less"
"darker"
"brighter"
"busier"
"sparser"
"more syncopated"
"more aggressive"
"more spacious"
"more tension"
"more groove"
```

These should result in incremental changes rather than complete regeneration.

---

# 32. Validation

Every command must be validated before being sent to Ableton.

Validate:

- track exists
- clip exists
- pitch range 0-127
- valid beat positions
- positive durations
- velocity range
- valid device
- valid parameter
- parameter range
- valid scene index
- valid clip slot
- valid tempo

Never trust LLM-generated JSON directly.

Use JSON Schema or equivalent runtime validation.

---

# 33. Logging

Log all commands.

Example:

```text
2026-10-02T20:30:11
COMMAND clip.get_notes
track=4 clip=0

2026-10-02T20:30:12
COMMAND notes.update
track=4 clip=0
notes_changed=7

2026-10-02T20:30:12
RESULT OK
```

Provide a verbose/debug mode.

Never log excessive full-project state by default.

---

# 34. Error Handling

Errors must be useful to an agent.

Bad:

```text
error
```

Good:

```json
{
  "code": "PARAMETER_NOT_FOUND",
  "message": "Device 'Auto Filter' does not expose a parameter named 'Cutoff'.",
  "available_parameters": [
    "Frequency",
    "Resonance",
    "Drive"
  ]
}
```

This allows the agent to recover automatically.

---

# 35. Latency

The system does not need sample-accurate control.

Target:

```text
normal command < 100 ms
complex edit < 500 ms
```

The emphasis is interactive editing, not realtime performance.

Do not put the LLM in the audio thread.

---

# 36. Max for Live Responsibilities

The Max device should be deliberately simple.

Responsibilities:

- connect to local bridge
- receive command
- resolve Live objects
- execute Live API call
- serialize result
- send response

It should NOT:

- reason about music
- call an LLM
- generate arrangements
- make subjective decisions
- hold large project state

---

# 37. Bridge Responsibilities

The bridge should:

- host the local server
- validate requests
- manage request IDs
- serialize/deserialize messages
- maintain Live connection
- expose stable tools
- normalize values
- manage snapshots
- manage transactions
- provide useful errors
- provide compact state summaries

---

# 38. Agent Responsibilities

The agent should:

- understand natural language
- reason about musical intent
- inspect relevant Live state
- plan edits
- generate note patterns
- understand scales/chords/rhythm
- translate intent into primitive commands
- verify results

---

# 39. Security

The server should bind to:

```text
127.0.0.1
```

by default.

Do not expose it to the LAN.

If remote access is later added:

- authentication required
- explicit opt-in
- TLS where appropriate
- strict command validation

---

# 40. First Prototype

Build the smallest possible end-to-end test.

## Max device

Support only:

```text
get_tempo
set_tempo
get_tracks
```

## Bridge

Expose:

```text
GET /state
POST /command
```

## Test

From shell:

```bash
curl http://127.0.0.1:8765/state
```

Expected:

```json
{
  "connected": true,
  "tempo": 124,
  "tracks": [
    "Kick",
    "Bass",
    "Lead"
  ]
}
```

Then:

```bash
curl \
  -X POST \
  http://127.0.0.1:8765/command \
  -H "content-type: application/json" \
  -d '{
    "command": "set_tempo",
    "args": {
      "bpm": 126
    }
  }'
```

Ableton should change to 126 BPM.

Do not proceed until this round trip is reliable.

---

# 41. Milestone 1 — Connectivity

Deliver:

- Max device loads in Ableton
- bridge connects
- heartbeat
- request IDs
- timeout handling
- get tempo
- set tempo
- get tracks
- structured errors

Acceptance:

```text
1000 sequential commands without losing connection.
```

---

# 42. Milestone 2 — MIDI Clip Reading

Implement:

```text
get clip
get notes
get clip length
get loop region
```

Acceptance:

Given an existing clip, bridge returns all expected notes with correct:

- pitch
- start
- duration
- velocity

---

# 43. Milestone 3 — MIDI Editing

Implement:

```text
create clip
add notes
replace notes
update notes
remove notes
```

Acceptance test:

Generate a 1-bar four-on-the-floor kick pattern.

Expected positions:

```text
0
1
2
3
```

Loop and confirm visually/audibly in Ableton.

---

# 44. Milestone 4 — Natural Language Prototype

Connect Codex tools.

User:

```text
Create a four-on-the-floor kick pattern in the selected 4-bar clip.
```

Expected sequence:

```text
get_selected_track
get_selected_clip
get_clip
replace/add notes
get_notes
```

The resulting clip should contain correct kick notes.

---

# 45. Milestone 5 — Musical Editing

Support prompts:

```text
make it more syncopated
make it busier
make it sparser
humanize the velocities
add a fill on bar 4
transpose up an octave
transpose to F minor
```

Each operation should modify existing material instead of replacing it unnecessarily.

---

# 46. Milestone 6 — Devices

Implement:

```text
get devices
get parameters
set parameter
```

Test:

```text
"Lower the cutoff on the selected track."
```

Agent must:

1. inspect devices
2. identify a suitable filter parameter
3. inspect range
4. reduce current value
5. verify result

---

# 47. Milestone 7 — Arrangement Intelligence

Implement helpers capable of turning a short loop into a larger structure.

Example:

```text
Turn these 8 bars into a 32-bar arrangement.
```

Possible structure:

```text
1-8    intro
9-16   groove develops
17-24  breakdown/build
25-32  drop/variation
```

Reuse existing musical material.

Do not simply create unrelated clips.

---

# 48. Milestone 8 — Automation

Support prompts:

```text
open the filter over the final 8 bars
increase the reverb into the breakdown
pull the bass out before the drop
```

Verify automation after writing.

---

# 49. Testing Strategy

## Unit tests

Test:

- note conversion
- beat/bar conversion
- schema validation
- parameter normalization
- scale generation
- quantization
- pattern transforms

## Integration tests

With Ableton running:

- read/write tempo
- enumerate tracks
- read clip
- write clip
- update note
- set parameter
- recover after invalid command
- recover after deleted track
- reconnect after device reload

## Golden musical tests

Store known input/output examples.

Example:

```text
input:
straight eighth-note bassline

operation:
make more syncopated

requirements:
same pitch sequence
same note count +/- 20%
at least two off-grid/16th shifted notes
no overlapping invalid notes
```

Do not demand exact note sequences where musical variation is expected.

---

# 50. Agent Tool Design

Codex should receive tools with narrow descriptions.

Example:

```json
{
  "name": "get_clip_notes",
  "description": "Returns MIDI notes from an existing Ableton MIDI clip. Use this before modifying an existing musical pattern.",
  "parameters": {
    "track_id": {
      "type": "integer"
    },
    "clip_slot": {
      "type": "integer"
    }
  }
}
```

Do not expose one universal:

```text
execute_ableton_code()
```

tool.

The agent should interact through explicit capabilities.

---

# 51. Agent System Prompt

Create `agent/prompts/system.md`.

Core rules:

```text
You are controlling an Ableton Live project.

Inspect relevant project state before making edits.

Preserve existing musical material unless the user explicitly asks for replacement.

Prefer small reversible edits.

Never invent track, clip, device or parameter IDs.

Query them first.

Use beats for musical time.

Verify important changes after writing them.

Do not modify unrelated tracks.

Do not delete material unless necessary or explicitly requested.

When a request is ambiguous, infer the smallest reasonable change from the current selection and project context.
```

---

# 52. Context Size Management

Large Ableton projects can produce enormous state.

Never dump the full project automatically.

Use progressive inspection:

```text
project summary
    ->
track summary
    ->
clip
    ->
notes
```

For example:

```text
get_project_state()
get_track(4)
get_clip(4, 0)
get_notes(4, 0)
```

---

# 53. Selection-Aware Workflow

Selection should act as default context.

Examples:

```text
"Make this darker."
```

Target:

selected track/device.

```text
"Add variation."
```

Target:

selected clip.

```text
"Build this into a full track."
```

Target:

currently selected clips/scenes where appropriate.

Explicit names override selection.

---

# 54. Natural Language Result

After an edit, report concise changes.

Example:

```text
Changed the selected bass clip:

- kept the original pitch sequence
- shifted four notes onto 16th-note syncopations
- shortened three notes
- varied velocity from 88-110
- left the first and final bars intact
```

Do not flood the user with raw JSON unless requested.

---

# 55. Optional Dry-Run Mode

Implement:

```text
dry_run = true
```

The bridge returns the proposed operations without applying them.

Example:

```json
{
  "operations": [
    {
      "type": "move_note",
      "note_id": 8,
      "from": 2.0,
      "to": 2.25
    }
  ]
}
```

This will be useful during development and debugging.

---

# 56. Command Batching

Avoid hundreds of single-note network calls.

Prefer:

```text
update_notes([...])
```

rather than:

```text
update_note()
update_note()
update_note()
...
```

Aim for one network request per logical edit where practical.

---

# 57. Future: Arrangement Representation

Create an abstract representation:

```json
{
  "sections": [
    {
      "name": "Intro",
      "start_bar": 1,
      "length_bars": 16,
      "energy": 0.25
    },
    {
      "name": "Build",
      "start_bar": 17,
      "length_bars": 8,
      "energy": 0.65
    },
    {
      "name": "Drop",
      "start_bar": 25,
      "length_bars": 16,
      "energy": 1.0
    }
  ]
}
```

This will allow the LLM to reason about arrangement separately from Live's low-level API.

---

# 58. Future: Project Semantic Map

Eventually create a semantic view:

```json
{
  "tracks": [
    {
      "id": 1,
      "role": "kick"
    },
    {
      "id": 2,
      "role": "bass"
    },
    {
      "id": 3,
      "role": "lead"
    },
    {
      "id": 4,
      "role": "atmosphere"
    }
  ]
}
```

Roles can be inferred from:

- names
- MIDI note ranges
- device names
- clip patterns
- user confirmation

Never permanently assign a role from a weak inference without retaining the ability to correct it.

---

# 59. Future: Audio Analysis

Later add a separate audio-analysis subsystem capable of measuring:

- RMS
- LUFS
- spectrum
- transient density
- onset locations
- pitch
- key estimate
- tempo
- stereo width

Do not put DSP analysis into the Max control bridge unless necessary.

A Python or native analysis worker would be preferable.

---

# 60. Future: Prompt Examples

The eventual experience should support requests such as:

```text
Create a new 124 BPM project with a basic melodic techno groove.
```

```text
Use the selected bass clip and make a variation for the second drop.
```

```text
The build isn't creating enough tension. Improve bars 49-64.
```

```text
Make the kick and bass less crowded.
```

```text
Add a subtle fill every eight bars.
```

```text
Create an intro a DJ can mix into easily.
```

```text
Reduce the energy of the breakdown without changing the chords.
```

```text
Make the drop hit harder but don't just make it louder.
```

```text
Read the current project and explain its arrangement.
```

---

# 61. Development Order

Implement in this exact order:

```text
1. Max device skeleton
2. local transport
3. request/response protocol
4. get/set tempo
5. track enumeration
6. selected track
7. clip enumeration
8. MIDI clip reading
9. MIDI clip writing
10. note update/delete
11. selected clip
12. schema validation
13. bridge snapshots
14. Codex tool definitions
15. natural-language note editing
16. device enumeration
17. parameter editing
18. automation
19. scenes
20. arrangement features
```

Do not start with genre-generation logic.

First make Live control reliable.

---

# 62. Definition of MVP

The MVP is complete when the following interaction works reliably:

```text
User:
Look at the selected bass clip.

Agent:
[reads clip]

User:
Make it more syncopated while keeping the melody.

Agent:
[reads notes]
[modifies timings]
[updates clip]
[reads clip again]

Agent:
Done. I kept the pitch sequence but shifted four notes onto 16th-note syncopations and shortened the notes before beats 2 and 4.
```

Then:

```text
User:
Open the filter through the final four bars.

Agent:
[reads devices]
[finds filter]
[reads parameter]
[writes automation]
[verifies result]
```

At that point the core concept is proven.

---

# 63. Coding Rules for Codex

When implementing this project:

1. Keep the bridge deterministic.
2. Keep music reasoning outside Max for Live.
3. Validate all external data.
4. Never rely on mutable track names as unique IDs.
5. Batch note edits.
6. Read state before modifying existing material.
7. Verify writes.
8. Return useful structured errors.
9. Prefer documented Live API functionality.
10. Do not add GUI automation unless explicitly moved into a separate experimental subsystem.
11. Do not silently substitute unsupported behavior.
12. Add tests for every new command.
13. Keep protocol backwards-compatible once the MVP is working.
14. Maintain a capability table documenting which Live operations are supported.
15. Add debug logging but keep it disabled by default.

---

# 64. First Codex Task

Start with only this task:

```text
Create the repository skeleton and implement an end-to-end Ableton connection.

Requirements:

- Max for Live device acts as the Live API endpoint.
- Local TypeScript bridge communicates with the Max device.
- JSON request/response protocol with request IDs.
- Implement:
    - get_tempo
    - set_tempo
    - get_tracks
    - get_selected_track
- Validate all commands.
- Return structured errors.
- Add connection heartbeat.
- Add reconnect handling.
- Add a CLI test client.
- Add automated tests for protocol parsing and validation.
- Document how to install the Max for Live device and run the bridge.

Do not implement MIDI generation yet.

The acceptance test is:

1. Start Ableton Live.
2. Add the AbletonAgent Max for Live device to a track.
3. Start the bridge.
4. Run the CLI.
5. CLI reports the current tempo and tracks.
6. Run:

   ableton-agent tempo 126

7. Ableton changes to 126 BPM.
8. Run:

   ableton-agent tracks

9. CLI prints the Live Set's tracks.

Do not proceed to MIDI editing until this is reliable.
```

---

# 65. End Goal

The finished system should make Ableton feel like an environment the agent can inspect and edit, rather than a DAW being driven by macros.

The desired interaction is:

```text
User:
The drop is weak.

Agent:
[inspects the relevant section]
[reads clips and devices]
[identifies likely musical causes]
[makes a small set of coherent edits]
[verifies those edits]

Agent:
I strengthened the drop by restoring the full bass pattern, opening the lead filter, reducing the pre-drop reverb tail, and adding a one-beat drum fill into the downbeat.
```

The agent should operate on the actual musical structure of the Live Set while leaving Ableton Live responsible for playback, timing, instruments, effects, mixing, and audio rendering.
"""

path = Path("/mnt/data/ABLETON_CODEX_PLAN.md")
path.write_text(md, encoding="utf-8")
print(f"Created {path} ({len(md):,} characters)")

