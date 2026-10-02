# Capability table

What this bridge supports, and what it refuses. `live.get_capabilities`
returns the machine-readable version at runtime, detected against the Live
that is actually running — consult it rather than this file in code.

The rule throughout: when Live cannot do something reliably, the bridge
returns an `UNSUPPORTED` error. It never substitutes GUI automation and never
reports a success it did not achieve.

## Supported

| Area        | Operations                                                        |
| ----------- | ----------------------------------------------------------------- |
| Transport   | play, stop, continue, stop all clips, metronome, song position     |
| Tempo       | read, write, time signature                                        |
| Tracks      | enumerate, read, create MIDI track, rename, mute/solo/arm          |
| Mixer       | volume, pan, sends — native or normalized values, bounds-checked   |
| Scenes      | enumerate, read, create, rename, fire                              |
| Clip slots  | enumerate, read                                                    |
| Clips       | create MIDI, delete, rename, set loop region, fire, stop           |
| MIDI notes  | read, add, replace, remove (by id or window), update in place      |
| Devices     | enumerate, read, read parameters with ranges and display values    |
| Parameters  | write by id or name, native or normalized, validated against range |
| Automation  | clip envelopes: read (sampled), write from breakpoints, clear      |
| Selection   | read and set selected track, scene, clip slot and device           |
| Undo        | Live undo/redo, plus bridge-side clip snapshots                    |
| Batching    | transactions, optionally atomic with rollback                      |
| Dry run     | validate and report any command without applying it                |
| MCP         | 25 tools, 5 prompts and the knowledge files over stdio (`mcp/server.ts`) |
| Faders in dB | set volume, pan and sends by their displayed value (`mixer` target) |
| Arrangement | lay Session clips onto the Arrangement at a beat; list and clear Arrangement clips |
| Returns     | create return tracks (Live 12)                                     |
| Effects     | build 31 codex effects from native devices, automation and generated MIDI |
| Identify    | classify an audio excerpt's effect from onset spacing, pitch and brightness |
| Mastering   | Master-chain roles with safe ranges, display-unit writes, decision log, checkpoints |
| QC          | offline loudness, true peak, spectrum, stereo and integrity of exported files |
| Meters      | Live's display meters per track (a clipping probe, not loudness)  |

## Not supported

| Area                   | Why                                                      |
| ---------------------- | -------------------------------------------------------- |
| Arrangement editing    | Session clips can be laid onto the Arrangement (`live.place_clip_in_arrangement`); free-form editing of Arrangement clips is not offered. |
| Tape stop              | No varispeed device in Live; plugins can't be inserted via the API. |
| Reverse reverb/cymbal  | Needs rendering and reversing audio; not available through the API. |
| Kick-keyed sidechain   | A device's sidechain input is chosen in Live's UI only; the codex offers a volume-shaping approximation. |
| Audio clip editing     | Out of scope for version 1.                               |
| Warping                | Out of scope for version 1.                               |
| Device loading         | Live 11 has no API for it. **Live 12.3+**: native devices via `live.insert_device` / `master build`, detected automatically. |
| Export / render        | No API in any Live version. `master.capture` records the Master output through a Resampling track instead (real time); a final delivery export is still manual. |
| Live loudness metering | Live exposes display meters only. Loudness comes from QC on the export. |
| Preset loading         | Same.                                                     |
| Return track creation  | Not exposed. Returns can be read and their sends written. |
| Routing, sidechain     | Not exposed.                                              |
| Track grouping         | Not exposed.                                              |
| Groove pool            | Not exposed.                                              |
| Plugin GUI control     | Only parameters Live itself exposes are reachable.        |
| Audio analysis         | Belongs in a separate worker, not the control bridge.     |
| GUI/mouse automation   | Explicitly out of scope, at any phase.                    |

## Edition and version constraints

**Live 11 Intro** caps a Set at 16 tracks. `live.create_midi_track` returns a
`LIVE_ERROR` naming that limit when Live refuses.

**Max for Live** is unavailable in Intro, which is why the Live-side endpoint
is a Remote Script. Nothing in the command surface depends on Max.

**Limiter True Peak mode** is not present in Live 11's Limiter.
`master.inspect_chain` reports `limiter_true_peak: unavailable`, and QC enforces
the true-peak ceiling by measuring the exported file. Live 12's Limiter is
detected and reported as `on` or `off`.

**Note ids** need Live 11 or newer (`get_notes_extended`). Without them,
`live.update_notes` returns `UNSUPPORTED` and directs the caller to read,
modify and `live.replace_notes` instead. `live.get_capabilities` reports this
as `note_ids`.

**Clip automation** requires `Clip.automation_envelope`. Where a specific
parameter cannot be automated inside a clip, `live.set_automation` returns
`UNSUPPORTED` naming the parameter.

## Latency

Live calls the Remote Script roughly every 100 ms on its own thread, which is
the only thread the Live API may be touched from. A command therefore waits up
to one tick: ~50 ms on average, ~100 ms worst case, plus the work itself.
Large reads such as `live.get_project_state` on a big Set cost more.

This meets the plan's targets — simple commands under 100 ms, complex edits
under 500 ms — for interactive editing. It is not realtime control, and
nothing here belongs in the audio thread.

## Error codes

Every error carries a stable `code`, a message, and often the alternatives
that would have worked.

| Code                 | Meaning                                              |
| -------------------- | ---------------------------------------------------- |
| `VALIDATION_FAILED`  | Arguments rejected by the bridge; nothing was sent    |
| `BAD_REQUEST`        | Malformed envelope                                   |
| `UNKNOWN_COMMAND`    | No such command; lists the real ones                 |
| `INVALID_ARGUMENT`   | Argument rejected by the Live side                   |
| `TRACK_NOT_FOUND`    | Lists the tracks that do exist                       |
| `SCENE_NOT_FOUND`    | Lists the scenes that do exist                       |
| `CLIP_SLOT_NOT_FOUND`| Slot index out of range; gives the slot count        |
| `CLIP_NOT_FOUND`     | Slot is empty; lists the occupied slots              |
| `NOT_A_MIDI_CLIP`    | Note editing needs a MIDI clip                       |
| `NOT_A_MIDI_TRACK`   | Audio tracks cannot hold MIDI clips                  |
| `DEVICE_NOT_FOUND`   | Lists the devices on that track                      |
| `PARAMETER_NOT_FOUND`| Lists the parameters the device exposes              |
| `NOTE_NOT_FOUND`     | Lists the note ids the clip holds                    |
| `NOTHING_SELECTED`   | The prompt relied on a selection Live does not have  |
| `UNSUPPORTED`        | Live cannot do this; no substitute was attempted     |
| `LIVE_ERROR`         | Live refused the operation                           |
| `NOT_CONNECTED`      | Live is not running, or the script is not selected   |
| `TIMEOUT`            | Live did not answer in time                          |
| `SNAPSHOT_NOT_FOUND` | No snapshot with that id                             |
| `TRANSACTION_FAILED` | Says which step failed and how much was applied      |
