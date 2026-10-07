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
| Tracks      | enumerate, read, create MIDI and audio tracks, rename, mute/solo/arm, monitoring, input routing by name (e.g. Resampling) |
| Recording   | record into a Session slot, alone or with a scene on the same bar (`live.record_with_scene`); capture the Master to a WAV (`master.capture`) |
| Mixer       | volume, pan, sends — native or normalized values, bounds-checked   |
| Scenes      | enumerate, read, create, rename, fire                              |
| Clip slots  | enumerate, read                                                    |
| Clips       | create MIDI, delete, rename, set loop region, fire, stop           |
| MIDI notes  | read, add, replace, remove (by id or window), update in place; read and update Arrangement clips in place (`arrangement_index`) |
| Devices     | enumerate, read, read parameters with ranges and display values; enable/bypass; delete (`live.delete_device`); insert native devices by name on Live 12.3+ (`live.insert_device`, detected) |
| Parameters  | write by id or name, native or normalized, validated against range |
| Automation  | clip envelopes: read (sampled), write from breakpoints, clear; re-enable overridden automation |
| Selection   | read and set selected track, scene, clip slot and device           |
| Undo        | Live undo/redo, plus bridge-side clip snapshots                    |
| Batching    | transactions, optionally atomic with rollback                      |
| Dry run     | validate and report any command without applying it                |
| MCP         | 29 tools, 18 prompts and the knowledge files over stdio (`mcp/server.ts`) |
| Track audit | read-only: every measurable step of AGENTS.md's audit over the Arrangement's notes (`audit` in the CLI and MCP) |
| Browser     | search drums, sounds, instruments, samples, packs, User Library and user folders; load kits, presets and samples onto a track; list Drum Rack pads |
| Faders in dB | set volume, pan and sends by their displayed value (`mixer` target) |
| Arrangement | lay Session clips onto the Arrangement at a beat; list and clear Arrangement clips; read and edit their notes in place, with the markers that place them on the timeline |
| Returns     | create return tracks (Live 12)                                     |
| Effects     | build 31 codex effects from native devices, automation and generated MIDI |
| Identify    | classify an audio excerpt's effect from onset spacing, pitch and brightness |
| Drums       | DRUMS.md genre grooves (909 house/techno, 808 hip-hop/trap/electro), A/A'/B/F variation, fills, energy layers, role-based swing/humanise/chance, pattern checks |
| Mastering   | Master-chain roles with safe ranges, display-unit writes, decision log, checkpoints |
| QC          | offline loudness, true peak, spectrum, stereo and integrity of exported files |
| Meters      | Live's display meters per track (a clipping probe, not loudness)  |

## Not supported

| Area                   | Why                                                      |
| ---------------------- | -------------------------------------------------------- |
| Arrangement editing    | Session clips can be laid onto the Arrangement (`live.place_clip_in_arrangement`), and an Arrangement clip's notes read and updated in place; moving, resizing or adding notes to Arrangement clips is not offered. |
| Arrangement automation | Live's API returns no envelope for an Arrangement clip even where one plays, and cannot create one; `arrangement_index` on the automation commands returns `UNSUPPORTED`. Placing a Session clip carries its envelopes; edit them in the Session clip and place it again. |
| Tape stop              | No varispeed device in Live; plugins can't be inserted via the API. |
| Reverse reverb/cymbal  | Needs rendering and reversing audio; not available through the API. |
| Kick-keyed sidechain   | A device's sidechain input is chosen in Live's UI only; the codex offers a volume-shaping approximation. |
| Audio clip editing     | Out of scope for version 1.                               |
| Warping                | Out of scope for version 1.                               |
| Device insertion by name on Live 11 | Live 11's API has none; load from the browser instead (`live.load_browser_item`). Live 12.3+ inserts native devices by name (Supported, above). |
| Plugin insertion       | Plugins load through the browser only, once Live has scanned them; the API cannot insert one by name. |
| Export / render        | No API in any Live version. `master.capture` records the Master output through a Resampling track instead (real time); a final delivery export is still manual. |
| Live loudness metering | Live exposes display meters only. Loudness comes from QC on the export. |
| Preset saving          | No API. Presets and kits load through the browser (Supported, above). |
| Return devices         | Return tracks can be created (Live 12) and read, and their sends written; the bridge does not insert devices on them. |
| Output routing, sidechain | Not exposed. Input routing is (Tracks, above).         |
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

## Command list

Every command the bridge accepts, generated from `bridge/src/commands/registry.ts`
(`npm run cli -- commands --update-docs`). `bridge/tests/validation.test.ts` fails if
this table and the registry disagree, so regenerate it when a command is added.

<!-- commands:start -->
| Command | What it does | Changes the Set | Bridge-side |
| --- | --- | --- | --- |
| `bridge.get_commands` | This catalogue. |  | yes |
| `bridge.status` | Bridge connection status and counters. |  | yes |
| `live.add_notes` | Add notes, leaving existing notes alone. | yes |  |
| `live.back_to_arrangement` | Press Back to Arrangement, so tracks that played Session clips follow the Arrangement again. | yes |  |
| `live.browse` | List or search Live's browser: drums, instruments, sounds, samples, user folders. |  |  |
| `live.clear_arrangement` | Delete every Arrangement clip on a track. Destructive. | yes |  |
| `live.clear_automation` | Clear a clip automation envelope. | yes |  |
| `live.continue_playing` | Resume playback from the current position. | yes |  |
| `live.create_audio_track` | Create an audio track. | yes |  |
| `live.create_midi_clip` | Create an empty MIDI clip in a slot. | yes |  |
| `live.create_midi_track` | Create a MIDI track. | yes |  |
| `live.create_return_track` | Create a return track (where Live supports it). | yes |  |
| `live.create_scene` | Create a scene. | yes |  |
| `live.delete_clip` | Delete the clip in a slot. | yes |  |
| `live.delete_device` | Delete one device from a track's chain. Destructive. Used to replace a plugin, since loading the same plugin onto its own track does nothing. | yes |  |
| `live.duplicate_clip` | Copy a MIDI clip into another slot, optionally on another track. | yes | yes |
| `live.fire_clip` | Launch a clip. | yes |  |
| `live.fire_scene` | Launch a scene. | yes |  |
| `live.get_arrangement_clips` | A track's Arrangement clips with start and end beats. |  |  |
| `live.get_arrangement_notes` | Every Arrangement clip on a track in one read: markers, and a MIDI clip's notes or an audio clip's file, warping, transposition and warp markers. |  |  |
| `live.get_automation` | Sample a Session clip automation envelope on a beat grid. Arrangement clips are UNSUPPORTED: Live reports no envelope there even where one plays. |  |  |
| `live.get_capabilities` | What this Live install supports. Consult before assuming an API exists. |  |  |
| `live.get_clip` | One clip: length, loop region, note count. |  |  |
| `live.get_clip_slot_status` | Whether a slot is recording or playing, and an audio clip file path. |  |  |
| `live.get_clip_slots` | Every clip slot on a track and what occupies it. |  |  |
| `live.get_device` | One device with all of its parameters. |  |  |
| `live.get_device_parameters` | Parameters with name, value, normalized value, range and display value. |  |  |
| `live.get_devices` | Devices on a track, in chain order. |  |  |
| `live.get_drum_pads` | A Drum Rack's filled pads with their MIDI notes. |  |  |
| `live.get_input_routing` | A track's input routing and the available alternatives. |  |  |
| `live.get_meters` | A track's output display meters (not loudness). |  |  |
| `live.get_notes` | Read MIDI notes from a Session clip (clip_slot) or an Arrangement clip (arrangement_index). Call this before changing an existing pattern. |  |  |
| `live.get_performance` | Live's CPU meter, average and peak - dropouts start near 100%. |  |  |
| `live.get_project_state` | Compact overview of tempo, tracks, clips, devices and scenes. Excludes notes and parameter values so the payload stays small. |  |  |
| `live.get_record_settings` | Tempo, signature, launch quantization, sample rate. |  |  |
| `live.get_scene` | One scene. |  |  |
| `live.get_scenes` | All scenes with stable scene_ids. |  |  |
| `live.get_selected_clip` | The highlighted clip - resolves "this clip". |  |  |
| `live.get_selected_device` | The device the user has selected. |  |  |
| `live.get_selected_scene` | The scene the user has selected in Live. |  |  |
| `live.get_selected_track` | The track the user has selected in Live. |  |  |
| `live.get_tempo` | Current tempo in BPM. |  |  |
| `live.get_time_signature` | Song time signature. |  |  |
| `live.get_track` | One track with its clips and devices. |  |  |
| `live.get_tracks` | All tracks with stable track_ids. |  |  |
| `live.get_transport` | Play state, song position, metronome and loop. |  |  |
| `live.insert_device` | Insert a native device (Live 12.3+ only; UNSUPPORTED on earlier versions). | yes |  |
| `live.list_snapshots` | Snapshots held in bridge memory. |  | yes |
| `live.load_browser_item` | Load a browser item (kit, preset, device, sample) onto a track. | yes |  |
| `live.place_clip_in_arrangement` | Copy a Session clip onto the Arrangement timeline at a beat (Live 11+). | yes |  |
| `live.play` | Start playback from the start marker. | yes |  |
| `live.re_enable_automation` | Re-Enable Automation: discard parameter overrides so every envelope plays again. Needed after any write to an automated parameter; live.back_to_arrangement does not undo one. | yes |  |
| `live.record_clip` | Record a fixed length into an empty slot of an armed track. | yes |  |
| `live.record_with_scene` | Launch a scene and start a fixed-length recording on the same bar. | yes |  |
| `live.redo` | Redo via Live's own undo stack. | yes |  |
| `live.reload_handlers` | Re-import the Remote Script handlers so handler edits apply without restarting Live. | yes |  |
| `live.remove_notes` | Remove notes by id or by time/pitch window. | yes |  |
| `live.rename_scene` | Rename a scene. | yes |  |
| `live.rename_track` | Rename a track. | yes |  |
| `live.replace_notes` | Delete every note in the clip and write a new set. Destructive. | yes |  |
| `live.restore_clip` | Restore a clip from a snapshot. | yes | yes |
| `live.select_clip_slot` | Move Live's selection to a clip slot. | yes |  |
| `live.select_track` | Move Live's selection to a track. | yes |  |
| `live.set_automation` | Write a clip automation ramp from breakpoints. | yes |  |
| `live.set_clip_loop` | Set a clip loop region in beats. | yes |  |
| `live.set_clip_name` | Rename a clip. | yes |  |
| `live.set_device_active` | Enable or bypass a device. | yes |  |
| `live.set_device_parameter` | Set one device parameter. Inspect its range first. | yes |  |
| `live.set_device_parameter_display` | Set a parameter by its displayed value (e.g. -1.0 dB, 30 ms, 1.2 kHz), independent of the device's internal scaling. | yes |  |
| `live.set_device_parameter_option` | Set a parameter to a named state, e.g. Limiter Mode 'True Peak' or Saturator Type 'Analog Clip'. | yes |  |
| `live.set_input_routing` | Set a track's input routing by name, e.g. Resampling. | yes |  |
| `live.set_metronome` | Turn the metronome on or off. | yes |  |
| `live.set_monitoring` | Set track monitoring to in, auto or off. | yes |  |
| `live.set_song_time` | Move the song position, in beats. | yes |  |
| `live.set_tempo` | Set the tempo in BPM. | yes |  |
| `live.set_time_signature` | Set the song time signature. | yes |  |
| `live.set_track_arm` | Arm or disarm a track. | yes |  |
| `live.set_track_mute` | Mute or unmute a track. | yes |  |
| `live.set_track_pan` | Set track pan (value or normalized). | yes |  |
| `live.set_track_send` | Set a send level on a track. | yes |  |
| `live.set_track_solo` | Solo or unsolo a track. | yes |  |
| `live.set_track_volume` | Set track volume (value or normalized). | yes |  |
| `live.snapshot_clip` | Store a clip (notes, loop, name) in bridge memory so an edit can be undone. |  | yes |
| `live.stop` | Stop playback. | yes |  |
| `live.stop_all_clips` | Stop every playing Session clip. | yes |  |
| `live.stop_clip` | Stop the playing clip on a track. | yes |  |
| `live.undo` | Undo via Live's own undo stack. | yes |  |
| `live.update_notes` | Change existing notes in place by note_id, in a Session clip or an Arrangement clip (arrangement_index). The right tool for edits that must preserve the musical identity of a part; in the Arrangement it keeps edits that re-placing would overwrite. | yes |  |
| `master.apply_preset` | Apply a named starting preset to the chain ('clean' = MIXING.md's Club Master - Clean). | yes | yes |
| `master.build_chain` | Insert the missing template devices and apply the 'clean' preset (Live 12.3+; explains the manual steps otherwise). | yes | yes |
| `master.capture` | Record the Master output (after the chain) to a WAV via a Resampling track, in real time, and return its path for QC. The agentic stand-in for Export. | yes | yes |
| `master.checkpoint` | Save every Master-chain parameter so the chain can be restored exactly. |  | yes |
| `master.decisions` | The logged history of master changes. |  | yes |
| `master.inspect_chain` | Map the Master chain to mastering roles with current values, safe ranges, missing roles and whether the Limiter has a True Peak mode. |  | yes |
| `master.list_checkpoints` | Checkpoints held this bridge session. |  | yes |
| `master.meters` | Sample Live's Master display meters for a few seconds (not loudness). |  | yes |
| `master.reset_decisions` | Archive the decision log to start a new mastering job. |  | yes |
| `master.restore_checkpoint` | Restore the Master chain from a checkpoint. | yes | yes |
| `master.set` | Set a mastering role in engineering units, within its safe range, with a required reason. Read back, logged, and refused after repeated reversals. | yes | yes |
| `ping` | Liveness probe; returns tempo and play state. |  |  |
<!-- commands:end -->
