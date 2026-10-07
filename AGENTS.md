# AGENTS.md

Working notes for anyone — human or agent — changing this codebase.

## The one architectural rule

**The agent reasons about music. The bridge performs deterministic
operations. The Remote Script is mechanical.**

Musical judgement never moves down a layer. If you find yourself adding a
"make it groovier" command to `remote-script/`, it belongs in `agent/src/`
expressed as primitive note edits.

## Layers

| Layer                       | May contain                                     | Must not contain                        |
| --------------------------- | ----------------------------------------------- | --------------------------------------- |
| `remote-script/TroubleMaker` | Live API calls, object resolution, serialization | Music theory, LLM calls, large state     |
| `bridge/src`                | Validation, transport, snapshots, transactions   | Music theory, genre knowledge            |
| `agent/src`                 | Theory, patterns, transforms, composition, mastering policy | Network calls, Live API assumptions      |
| `qc/src`                    | ffmpeg invocation, PCM analysis of exported files | Live calls, mastering judgement          |
| `mcp`                       | MCP tool schemas and wiring to workflows          | Logic the CLI also needs (put it in `bridge/src/workflows.ts`) |
| `analogfoundry/src`         | C++ DSP for our own synthesiser, offline renderer, VST3 wrapper | Live API calls, music theory, anything host-specific in the DSP core |

`agent/src` is pure functions over numbers. It must stay testable with no
Ableton running.

## Live-side constraints

The Live API is **not thread-safe** and may only be touched from Live's own
thread. `update_display()` is called by Live on that thread about every
100 ms, and it is the only pump. Never start a thread in the Remote Script,
and never block inside `poll()`.

The script runs on Live's **embedded Python 3.7**. No f-string `=` specifier,
no walrus operator, no `from __future__ import annotations` gymnastics. Use
`%` formatting, which the rest of the file already does.

An exception escaping `__init__` makes Live disable the script silently, which
is near-impossible to debug. Startup is wrapped in a try/except that logs
loudly. Keep it that way.

Install with `-Link` during development. Handler edits then apply with
`live.reload_handlers` (`npm run cli -- raw live.reload_handlers '{}'`), no
restart. Changes to `dispatch.py`, `errors.py`, `server.py` or
`TroubleMaker.py` still need a **Live restart**.

Log to Live's `Log.txt`:

```
%USERPROFILE%\AppData\Roaming\Ableton\Live 11.x.x\Preferences\Log.txt
```

Grep for `[TroubleMaker]`. Set `TROUBLEMAKER_VERBOSE=1` before launching Live
for per-command logging.

## Coding rules

1. Keep the bridge deterministic.
2. Keep music reasoning out of the Remote Script.
3. Validate all external data. Never trust LLM-generated JSON.
4. Never rely on mutable track names as unique ids. Use handles.
5. Batch note edits — one request per logical edit, not one per note.
6. Read state before modifying existing material.
7. Verify writes.
8. Return structured errors, with the valid alternatives where they help.
9. Prefer documented Live API functionality.
10. No GUI automation. If it is ever added, it goes in a separate,
    explicitly experimental subsystem.
11. Never silently substitute unsupported behaviour — raise `UNSUPPORTED`.
12. Add tests for every new command.
13. Keep the protocol backwards-compatible now that the MVP works.
14. Keep `docs/capabilities.md` and the registry in sync with reality.
15. Debug logging exists but stays off by default.

## Adding a command

It must be added in four places, and the test suite enforces the last one:

1. **Handler** in `remote-script/TroubleMaker/handlers/<area>.py`, registered
   in that module's `COMMANDS` dict.
2. **Schema** in `bridge/src/validation.ts`, under `schemas`. Use `.strict()`
   so unknown keys are rejected.
3. **Catalogue entry** in `bridge/src/commands/registry.ts` with a summary and
   the `mutates` / `bridgeSide` flags.
4. **Tests** in `bridge/tests/`. `validation.test.ts` fails if a command has
   no catalogue entry.

Bridge-side commands (composites, snapshots) skip step 1 and are dispatched in
`Bridge.executeBridgeSide`.

**A running bridge does not know a new command.** It validates against the
schemas it started with, and the MCP server is spawned by the agent session, so
`live.reload_handlers` updates Live but the bridge still answers
`UNKNOWN_COMMAND`. Restart the bridge, or, for one call now, send it straight to
the Remote Script on `127.0.0.1:9877`. That connection takes newline-delimited
JSON `{"id", "command", "args"}` and shares the bridge's handles; it accepts
more than one client.

## Testing

```bash
npm test                      # 495 tests, no Ableton needed
npm run typecheck
npm run cli -- selftest       # round trip, needs Live running
```

The fake Remote Script in `bridge/tests/bridge.test.ts` speaks the real
protocol, so protocol, reconnect, snapshot and transaction behaviour are all
covered without Ableton.

**The fake models Live as measured, never as guessed.** When a Live quirk is
found, reproduce it in Live before modelling it in `fake_live.py`. A fix that
passes against a guessed model can fail in Live: the first fix for the envelope
seeding quirk did, and it was reverted along with its model.

Golden musical tests assert **properties**, not exact note lists: pitch
sequence preserved, note count within a range, some notes moved off-grid. Do
not tighten them into exact-output tests — variation is the point of these
operations.

Transform functions take a `seed` and must be reproducible for a given seed.
A user needs undo-and-retry to converge, which random output prevents.

## MCP server

`mcp/tools.ts` builds the server from an `McpClient` (anything with
`post(command, args, {dryRun})`), so tests drive it in memory against the
real bridge and a `FakeLive` (`bridge/tests/mcp.test.ts`). `mcp/server.ts`
only chooses the client: HTTP to a running bridge, or an in-process one.

- Keep tools few and whole-job. An edit tool snapshots, applies atomically
  and reads back; do not add tools that let an agent skip those steps.
- stdout is the protocol. Never write to it from code the server loads; the
  Logger writes to stderr.
- A multi-step job the CLI also runs belongs in `bridge/src/workflows.ts`,
  not in either front end.
- Mixer faders are not linear in dB. `set_mixer` sets them through
  `live.set_device_parameter_display` with `mixer: volume | pan | send:N`,
  which searches the fader's own display.

## Mastering

Rules from `MIXING.md` live in `agent/src/mastering/policy.ts` as pure checks
over measurements; thresholds are in `profiles.ts`. Master-chain roles and
their safe ranges are in `bridge/src/mastering/roles.ts`.

**Write by display value, not native value.** Live stores many parameters
normalised (0-1) and the scaling differs per device and per Live version.
`live.set_device_parameter_display` binary-searches for the native value whose
*displayed* value matches, so safe ranges can be written in dB/ms/Hz and stay
valid across an upgrade.

**Adding a role:** add a `RoleSpec` to `ROLES` with candidate parameter names
for both Live 11 and 12 devices, a hard range in engineering units, and a
test in `bridge/tests/mastering-chain.test.ts`.

**Adding a QC rule:** add it to `evaluate()` with a test in
`bridge/tests/mastering-policy.test.ts`. Every finding needs an `action`, and
the action for a mix-level problem should say so rather than suggest master
processing.

**Capturing the Master:** the capture track's input is Resampling, so its
monitoring must be off or the Master feeds back into itself. Live loops a
freshly recorded Session clip into playback and holds its file exclusively
while the clip is loaded; `MasterCapture` deletes the clip after recording,
which releases the file (the WAV stays on disk). Without that, ffprobe gets
"Permission denied".

**Version-dependent features are detected, never assumed.** Device insertion
checks `hasattr(Track, 'insert_device')`; True Peak mode is detected from the
Limiter's parameters. Keep it that way, so upgrading Live needs no code change.

## Drums

Grids are data (`agent/knowledge/drum-patterns.json`), copied from
DRUMS.md; rows are one character per step or space-separated tokens, where
a number is an exact velocity. `agent/src/drums.ts` turns them into notes.

- Anchors (the kick on the beat, primary kicks, the backbeat) never move in
  variation, swing, humanisation or chance. Tests enforce anchor retention.
- Swing is a pair ratio, not the Groove Pool amount. Keep the wording exact.
- Canonical notes are DRUMS.md's 909-compatible map; `writeDrums`
  (`bridge/src/workflows.ts`) remaps them to the track's Drum Rack by pad
  name. The 909 Core Kit's note 50 is a ride: never assume a pad.
- On a shared step the open hat plays, and an open hat stops at the next
  closed hat. Choke groups in the Drum Rack are not set through the API.
- **Adding a genre:** a template with `steps`, `meter`, backbeat voice,
  four-on-the-floor or half-time, a `fill` kind, and rows; then
  `checkDrumPattern` must pass it with no findings above info.

## Synthesis — use our own synth first

**AnalogFoundry 101 is the default instrument for synthesised parts, not
Drift, Analog or any other stock Live device.** It is ours: original DSP,
built to `ANALOG_SYNTH_AGENT.md`, measured rather than guessed (see
`analogfoundry/README.md` for the numbers). Reach for a Live device only when
one of the exceptions below applies, and say which one.

**It is monophonic by default, and polyphonic when asked** (`voices` 1-8, 0.5).
One voice is the 101 bit for bit: last-note priority, legato glide, note memory.
Set `voices` to the part's maximum simultaneous notes, and no higher:

| Part | Instrument |
|---|---|
| Bass, lead, acid line, any single-note part | **AnalogFoundry 101**, `voices 1` |
| Pads, chords, stabs | **AnalogFoundry 101**, `voices` = the most notes at once (up to 8) |
| A pure sine sub | a Live device. AF101's sub oscillator is a square; it has no sine, and the sub band is the one most closely matched to the references |
| More than 8 simultaneous notes, or a wavetable/FM/sampled timbre | a Live device, and say why |

Keep single-note parts on one voice even though more are available. Overlapping
notes in a monophonic part are often deliberate: an overlap is how a glide is
written, and with one voice AF101 slides to the new pitch without retriggering
the envelope. With two or more, the same overlap plays two notes instead. Count
maximum simultaneous notes, not overlaps.

**Polyphony costs CPU in proportion to notes x unison x filters.** Stereo spread
runs a second filter per voice: four notes of a 7-voice stereo stack is a third
of a core (`analogfoundry/README.md` *CPU*). Pads want 2-3 unison voices.

**Two ways to use it, because the bridge cannot insert plugins.**

1. **VST3** (`analogfoundry/build/bin/`, installed to
   `%USERPROFILE%\Documents\VST3` - Live's custom folder on this machine; a copy
   in the system folder is ignored. Install with Live closed, and check Log.txt's
   `successfully loaded ... v0.x.0` line for the version that actually loaded). A human has to enable VST3 folders
   in Live's Preferences and rescan once; the API cannot do it, and until then
   `live.browse {"category": "plugins"}` returns 0 entries. After that it
   loads like any browser item and its parameters automate normally.
2. **Offline render** (`analogfoundry/build/Release/render_note.exe`) into
   `<User Library>/Samples/<project>/`, then load into Simpler. Live indexes
   the User Library already, so no browser Place has to be added by hand.
   Use this when the plugin is not scanned, or when a baked sample is wanted.

Patches are plain text (`analogfoundry/presets/`), and the same parameter
table drives the preset format, the host's automation list and the DSP ranges
— so those three can never disagree. Add a parameter in one place:
`parameterTable()` in `src/model/Preset.h`.

**What it has (0.5):** three oscillators (saw, pulse, triangle, sine; octave,
semitone, fine) through one unison stack of up to 7, spread in stereo by `stereo`;
a square sub, noise; a ladder low-pass, a 24 dB high-pass or a band-pass
(`filter_mode`); amp, filter and a third envelope (a matrix source); two LFOs (five
waves, retrigger, and tempo sync from 1/32 to 4 bars, locked to the bar while
Live plays); velocity, key, mod wheel, aftertouch, pitch bend, per-note random; an
8-slot modulation matrix; vibrato fade-in, drift, legato-only glide, note memory;
1-8 voices. Its editor shows every parameter in words and the matrix as
"LFO 1 -> Cutoff +35 %". It has **no** wavetables and no effects (Live devices do
that). One filter per voice: a Serum or Diva patch with a high-pass *and* a
low-pass still needs EQ Eight for one of them. An LFO's mode packs wave, retrigger
and sync division into one parameter, `wave + 5*retrigger + 10*division`
(`Voice101.h` `LfoMode`), for the same 64-parameter reason as the matrix. The
`agent/src/presets/af101.ts` catalogue mirrors the parameter table, and
`bridge/tests/presets.test.ts` fails if they drift apart.

**Serum and Diva presets convert** with `npm run convert-preset` (see
`analogfoundry/README.md`). Read the report before using a patch: it says what was
approximated or dropped and which unit assumptions apply. The **timbre is
unverified** (neither synth is installed here), so audition a converted patch
before trusting it, and record what changed if you adjust it. Converted patches
are derived from licensed packs: they live in the git-ignored
`analogfoundry/presets/converted/` and are never committed. A restored AF101 in an
older Set keeps its old parameter list: delete it and load a fresh instance to get
the current one's (*Live facts*). 0.5 has 63 parameters, one under Live's 64: a
new parameter has to replace or pack an old one.

**Changing the DSP:** build and run the tests
(`ctest -C Release` in `analogfoundry/build`), and measure before and after.
Several bugs in that engine were invisible to listening and only showed up as
numbers — an attack finishing in 19.5 ms instead of 50, oversampling that
made aliasing *worse*, a test reporting 1e-15 because it correlated against
one quadrature. Never claim a behaviour is matched because one preset sounded
good.

**Never put two stateful calls in one expression.** The 2x oversampling defect
(a corner at −18 dB instead of −12, open for months) was
`down.process(processOversampled(a), processOversampled(b))`. C++ leaves argument
order unspecified, MSVC evaluates right to left, and the filter state ran
backwards. Every part measured clean alone, so isolating parts could not find
it. Give each call that changes state its own statement.

**Parameter ids are part of the saved-Set format.** Live stores a plugin's values
and automation by parameter id, and DPF's VST3 ids are positions: AF101's
parameter i is id 2081 + i (after DPF's program and MIDI-CC slots). Adding the
editor turned on DPF's separate controller, which inserts two parameters first;
every older Set's settings and envelopes moved two places up (Threshold's shimmer
level envelope drove Stage Drive). `DISTRHO_PLUGIN_WANT_DIRECT_ACCESS 1` keeps
the layout, and `plugin_load_test` now fails if any id moves. Only ever append
parameters; never insert, remove or reorder one without a migration plan. 0.5
broke this once: it removed 0.4's two LFO retrigger switches, so an instance saved
with 0.4 has its ids from LFO 2 Rate on shifted by one or two. Its own state comes
back (DPF saves by symbol), but Live's automation and stored values go by id: replace
such an instance with a fresh one. (Only Threshold's Bass and AF probe were saved with
0.4; neither had AF101 automation.)

**Check the build log, not the output file.** A failed plugin build leaves the
previous `.vst3` in place, and `plugin_load_test` passes on it. The editor needs
DPF's `pugl` submodule (`git submodule update --init` in `external/dpf`).

## Composition and effects

The effects codex (`agent/knowledge/effects.json`) is data, validated by
`bridge/tests/knowledge.test.ts`: unique ids, declared energy functions,
cross-references that resolve, recipes built only from devices Live 12
Standard has. `bridge/src/fx.ts` executes recipes and never improvises a
substitute for an `unsupported` one.

**Adding an effect:** add an entry with cue, mechanism, control law, time
scale, energy, confusions and references tagged `D` (documented) or `A`
(auditory). Read real parameter names from Live (insert the device on a
scratch track and list its parameters) - Live 11 and 12 differ, and guesses
have been wrong every time. Then sweep it on Live with `fx apply`.

**Live facts learned the hard way:**

- Tempo-synced rates display as divisions ("1/16", "1 Bar") on continuous
  parameters; set them as options, which sample the range.
- Auto Pan-Tremolo's sync option is "Synced"; Echo, Hybrid Reverb, Spectral
  Time and Roar are Suite-only; Operator is not in Standard.
- A restored plugin keeps the parameter list it was saved with, so a newer
  AF101's parameters appear only on a fresh instance; and loading a plugin onto a
  track that already has it does nothing. `live.delete_device` it, then load it
  (Live puts an instrument first in the chain), reapply the patch, read it back.
  A capture with master dynamics bypassed can clip: keep a probe track's fader down.
- **Arrangement clips are copies.** Editing a Session clip does not change the
  Arrangement copies placed from it. Placing copies notes **and** envelopes
  (measured three ways on Cathedral, 2026-10-05), so clear and re-place works -
  but it also overwrites any edit made only in the Arrangement. Prefer editing an
  Arrangement clip in place: `live.get_notes` / `live.update_notes` take
  `arrangement_index` (the order `live.get_arrangement_clips` reports). The API
  cannot see an Arrangement clip's envelopes (`automation_envelope()` returns None
  over a fade that is playing; `create_automation_envelope()` raises), so the
  automation commands refuse `arrangement_index` with `UNSUPPORTED`.
- **Writing an automated parameter overrides its automation, and Back to
  Arrangement does not undo it** - only Re-Enable Automation does
  (`live.re_enable_automation`). Measured: after one write, a placed fade played
  flat at the written value with `session_overrides_arrangement` false; after
  re-enabling it played again. Black Glass "lost" its automation this way - 42
  parameters overridden by envelope rewrites, every later capture flat - and
  reopening the Set brought it all back. `set_automation` now re-enables the one
  parameter it parks while seeding, and `master.capture` re-enables automation
  before recording. After probing a parameter yourself, call
  `live.re_enable_automation`. Reading a parameter with the transport stopped
  returns its resting value, not its automation: measure automation by capture.
- **Check the Arrangement after a capture session.** Two-beat "ref" clips once
  appeared at beat 16.85 on nine tracks, putting pitched parts into the DJ
  intro; the cause is unknown (Arrangement record was off). Look for clips that
  start off the bar grid with `live.get_arrangement_clips`.
- **An envelope seeded with the value the parameter already has starts at the
  parameter's default.** Threshold's lead duck began at 0 dB, not -6, after an
  earlier run had left Utility Output at -6. Changing the value and setting it
  back within one request does not count: move the parameter off the seed value
  in a request of its own, then write the envelope, and check `value_at_start`.
- **An EQ before saturation does not cut what the saturation makes.** A -3 dB bell
  at 200 Hz on Threshold's kick, ahead of its Saturator and Drum Buss, moved the
  mix's 200 Hz band 0.3 dB and the kick's loudness not at all. Cut after the
  device that generates the content, or change the balance instead.
- **Check a QC infra warning with a brick-wall FFT.** A band filter with a
  gentle edge reads a low sub fundamental (D1, 36.7 Hz) as infra. QC's 30 Hz edge
  is now 8th order for this reason; still, before high-passing for "rumble",
  measure energy below 30 Hz directly.
- **A ducked track hides velocity.** A 6 dB pump on the kick swamps the ~1 dB
  velocity adds, so per-note level in context correlates with nothing. Verify
  velocity on an unducked probe track instead. (Half velocity at full
  `vel_amp` measured -5.95 dB, as predicted.)
- Return tracks have no clip slots, so devices on returns cannot carry clip
  automation; automate the source track's send (`mixer: send:N`) instead.
- From a stopped transport a scene starts at once but a recording waits
  for the next bar, so captures began at the scene's second bar - even when
  both were fired in one tick. The capture now starts the transport first,
  then fires scene and recording together (`live.record_with_scene`), and
  both land on the same bar. Verified with a two-bar clip whose bars differ
  in pitch. Caveat: with the transport running, tracks outside the scene
  may play their Arrangement clips if the Set has an Arrangement.

## Producing a track - apply the expert guides, unprompted

Do not wait to be asked. Before writing any element of a track, read its guide
in full and apply it; read the always-on guides before the first note and again
when checking the result. Skimming a guide for one idea is not applying it.
("First Light" syncopated four layers because GROOVE.md was read late, and the
user had to point at it mid-build.)

**Always, on every track:**

| Guide | Apply it |
|---|---|
| `EMOTION.md` | first: the emotional sentence (§3) and the arc (§4) before any notes; then ≥3 levers per emotion (§53), one surprise per section (§54), protect the peak (§55), withholding (§56) |
| `COMPOSITION.md` | the decision order (idea → groove → arrangement → sound → balance → … → loudness) and the arrangement |
| `EDM-COMPOSITION.md` | effects and advanced rhythm, as perception → mechanism |
| `EDM-TIPS.md` | melody method, harmony complexity ladder, transition families, mix heuristics |
| `GROOVE.md` | every rhythmic part: assign anchor / groove / ornament roles (§15) before writing any of them; exactly one groove layer; run the §26 checklist |
| `HOOKS.md` | choose the hook type and attention hierarchy (§8) before writing it; one primary hook per section (§9); introduce, remove, return (§11); 80/20 variation (§12); the arrangement map (§41) in TRACK.md; the audit (§42) and the /40 score (§31), without inflation, before reporting a track done |
| `NEW_TRACK.md` | the finishing pass: diagnose in its order, minimum effective change, the 10-category audit scored /100 without inflation, and the Professional Finish Report |

**Per element, in addition:**

| Element | Guide |
|---|---|
| Melody, lead, hook, motif | `HOOKS.md` for the hook's identity and arrangement, `MELODY.md` for writing the line, then `CAMELPHAT.md` for the cell (rhythm, anchor, register) |
| Bassline | `BASSLINES.md` (scientific octave names), then `LOW_END.md` for how it sits against the kick |
| Kick, sub and the low end as a system | `LOW_END.md` |
| Drums | `DRUMS.md` |
| Chords, pads | `CHORDS.md` |
| Shimmer | `SHIMMER.md` |
| Choosing a sound | `Ableton_Sound_Selection_Expert.md` |
| Mix and master | `MIXING.md`, `LOW_END.md` (kick and bass first), `docs/lessons.md` |

**The order of work and the standard for an instruction:**
`NEW-TRACK-DETAILED.md` holds the end-to-end procedure — what to build in
what order, with a pass/fail test at each step. Read its agent contract
(§1) before the first edit and hold every action to it: target, location,
edit, starting value, expected effect, pass/fail test. "Add some groove" is
not an instruction. Its §43 failure modes name what this project keeps doing
wrong — adding layers instead of fixing composition, solving arrangement with
automation, processing in solo, swinging everything. It does not outrank the
guides above on their own jobs (see *Which guide for which job*).

Plus the genre or artist profile the brief names (see *Which guide for which
job*). Where guides conflict, the more specific one wins, as below.

**Show the work.** The track's `TRACK.md` lists, for each element, the guides
applied and the rules taken from them by section number, and the result of
*Auditing a track* (below). An element with no
guide listed is not finished. Before reporting a track done, check the result
against each always-on guide again - GROOVE.md's §26 checklist, HOOKS.md's §42
audit and NEW_TRACK.md's audit at minimum - and report what failed, not just what
passed.

## Basslines - roll, don't meander

**The user wants a rolling bassline by default.** On Threshold a melodic bass
that changed pitch on almost every note was rejected as "meandering"; the roll
that replaced it is the one they liked ("that relentless bass"). Black Glass and
Cathedral are the references - read their Sets, not just their TRACK.md.

- **Rhythm: KBBB** - the three 16ths after every kick, never on the kick
  (`progressive_rolling` in `bass-patterns.json`). KBB, the gallop (`K . B B`,
  Black Glass), is the alternative. Not an offbeat house bass, not a melodic line.
- **Pitch: one root per chord**, held for the whole chord. The octave on the
  third 16th; a pickup in octaves on the last beat of a 4-bar phrase. Move a note
  only where the rub audit says so (Threshold's Bb took its fifth, not its octave).
- **Movement lives in the timbre, not the pitch**: a filter LFO with a 3/16
  period so the accents rotate against the bar (GROOVE.md 7B), and filter moves
  written per section.
- **Sound: a clean sine sub + a hard growl.** Drift sine holding the root, and
  **choose its octave by measurement against the references**, never by rule.
  Cathedral's references wanted its D up at D2; Threshold's CamelPhat references
  wanted D1 (37 Hz closed a 12 dB gap at 40 Hz to under 1 dB), while notes below
  ~35 Hz (C1, Bb0) overshot the 31.5 Hz band by 11-14 dB. So a progression can
  need its roots in different octaves. AnalogFoundry 101 for the growl -
  resonance, a 7 Hz filter LFO, Saturator Hard Curve ~9 dB, high-passed so it
  never doubles the sub's fundamental. Patch: `analogfoundry/presets/threshold-growl.txt`.
- **Pump it.** Sub silent on the kick and back within an 8th; growl -15 dB on the
  kick, swelling across its three 16ths. The electronics pump; strings and
  orchestra are never ducked - that contrast is the point.

Check BASSLINES.md for anything this leaves open, and ask before writing any
other kind of bassline.

## Leads - not plucks

**Every lead so far has been a pluck, and the user hears all the tracks as
similar and plinky.** Across camelbone, Cowboy, Black Glass, Cathedral and
Threshold no synth lead held a note for a beat, and most traced arpeggios
(48-73 % leaps). The cause was a lesson that lumped CamelPhat's leads in with
their plucks; `docs/lessons.md` now has them measured apart. Before writing a
lead, read MELODY.md for its function (sections 3, 38, 52), then build it as
CamelPhat build theirs - from the pack, not from memory. `CAMELPHAT.md` has
the whole pack's MIDI measured (leads, plucks, chords, bass) and a step-by-step
procedure with pass/fail numbers.

**Threshold's lead took four rewrites, and each failed on a different thing, in
this order. Work in the same order:**

1. **The hook.** One shape of 2-5 notes over 1-2 bars, repeated identically
   (HOOKS 5, 12, 18; MELODY 4, 18, 38). Hum it. v1 matched every pack median and was heard as
   "random": it used six bar patterns, and its pitches changed on any step.
2. **What it means.** Choose an anchor with a story (the orchestra's tuning A) and
   say how the chords change its meaning. Harmony moving under a repeated note is
   colour, not a hook: v2 had that and nothing else.
3. **Its register against the sustained parts.** v3 sang, but it played the
   strings' own notes and fused into them. v4 moved up an octave, above the pad.
4. **Emotion in the line.** Held answers approached by a slur, targets that arch
   to one high point, velocity that follows the phrase (EMOTION 12-15, 43).
5. **Expression in the patch** (below). v2 was "stock" because the synth played
   every note the same.
6. **Then the numbers** (`CAMELPHAT.md` 6). They catch a bad lead; they do not
   make a good one.
7. **Then everything that quotes it.** When the lead changes, rewrite the
   hints, teases and callbacks that point at it. Threshold's break callback still
   quoted a cell the track no longer had, and so did the violins' peak line -
   a second, retired melody on top of the hook at the peak (HOOKS 9, 34). Search
   every pitched part for the old cell, not just the ones you remember.
8. **Then audit it (HOOKS 42) and measure it in context.** Capture the hook alone,
   everything else alone and each candidate competitor (master dynamics
   bypassed), and compare their mean level in the hook's bands - its
   fundamentals (350-800 Hz for a lead around A69), 800 Hz-2 kHz and 2-4 kHz. Threshold's hook was level with the growl in its own band and 10 dB
   under the mix at 2-4 kHz; opening the patch fixed it. Make room before raising
   the fader (HOOKS 22).

- **Sustain, not pluck.** Amp sustain around 0.8, release ~0.3 s, attack
  1-20 ms. A zero-sustain envelope is for a part whose job is a pluck, and
  says so in the track's TRACK.md.
- **Thick.** Saw-based, two oscillators an octave apart, a sub, unison or its
  equivalent, a ladder low-pass with a little drive, chorus into delay.
  AnalogFoundry 101 has **unison** (`unison` 1-7 voices, `unison_detune` in
  cents; off by default) and spreads it in stereo with `stereo` (0.5). The stack
  shares one filter per side; add an octave layer with a second instance, and
  Chorus-Ensemble when the width should move.
- **Expressive, not static.** A patch that plays every note the same sounds
  stock (Threshold's lead, twice). Use AF101 0.3's expression, as the CamelPhat
  Serum leads do (`CAMELPHAT.md` 6b): velocity to cutoff, a separate filter
  envelope that closes while the amp sustains, vibrato that fades in on held
  notes, a few cents of drift, glide on slurs only. Write velocities that follow
  the phrase, and automate the cutoff across each 4-bar phrase.
- **Low - unless the pad lives there.** Write the line around MIDI 50-65 and let
  the octave layer carry the top, not an octave or two above it on one thin
  oscillator. But check the register against the sustained parts first: a lead
  that plays the pad's own notes fuses into it and stops being a hook (Threshold's
  strings held A57 D62 F65 G67; its lead played the same notes). Clear the pad,
  as a vocal would sit.
- **A hook, not a riff.** One 1-2 bar shape, repeated identically, with at most
  the final note moving at phrase ends (MELODY 4, 38; EMOTION 15). A riff whose
  tail changes every bar measures right and still has no hook.
- **Rhythm first, not an arpeggio.** Measured over the pack's 34 lead
  MIDI files (medians): 4.6 notes a bar, one note ~50 % of the line, 67 % of
  onsets on the 3-3-2 steps (0 3 6 8 11 14), notes ~two-thirds of the gap to the
  next (gate 0.67), MIDI 55-64, repeats 21 % / steps 20 % / leaps 26 %. Check it
  against GROOVE.md: if the bass is the groove layer, the lead's syncopation
  must not become a second one by accident.
- **Read the presets.** `.h2p` is plain text; `.SerumPreset` is zstd + CBOR with
  a demo melody inside (`docs/lessons.md`). Measure the lead you write against
  them - note length, held share, steps vs leaps - before calling it done.

## Auditing a track

Run every check, in this order, before calling a track done and whenever a track
is re-audited. Each line says how to *measure* it; a check answered from memory
or by reading the code is not done. Report failures first, score without
inflation, and record the date, the result and the guides used in the track's
TRACK.md.

1. **Arrangement hygiene.** `live.get_arrangement_clips` on every track: no clip
   that starts off the bar grid, no stray "ref" clips, and Arrangement copies
   matching their Session clips (compare with `live.get_notes` and
   `arrangement_index`; fix differences in place - re-placing overwrites
   Arrangement-only edits).
2. **DJ intro and outro** (above): no pitched material in the first or last 16
   bars, changes on 8/16-bar lines, the sub in only after the intro's build,
   melodic layers out first, the last 8-16 bars drums only. Use `checkStylePlan`
   for what it encodes, and check the rest by hand.
3. **Rubs.** Every pitched part against every other, in arrangement time: no
   semitone or minor-ninth overlap longer than a 32nd unless it is a written,
   resolving appoggiatura.
4. **Groove** (GROOVE §26). List every syncopated part, LFO rates included:
   exactly one groove layer.
5. **Hook** (HOOKS §42, §31, §41). Name the primary hook in one sentence and
   classify every other part (secondary, support, texture, transition). Write the
   arrangement map. Search **every** pitched part for retired motifs. Check the
   hook's register against the sustained parts. Measure it in context: the hook,
   the rest and each competitor captured alone, compared in the hook's bands. Score
   /40 and name the weakest category.
6. **Lead** (`CAMELPHAT.md` 6). The numbers, plus expression: does velocity reach
   the sound, does the filter move within the note and across the phrase? Verify
   velocity on an unducked probe track.
7. **Bass and the low end** (*Basslines* above; `LOW_END.md` 19). Rolling, one
   root per chord, the low end owned by one part at a time. Then, measured in
   mono below 120 Hz against references chosen by **low-end likeness** (fold
   each candidate's sub-band envelope onto one beat and correlate it with the
   track's; LOW_END 3): the low-end share of the mix, the beat profile (where
   kick and bass sit across the beat), bar-to-bar level across the progression
   (17), mono correlation, bass harmonics 120-400 Hz against the sub for
   translation (12), and phase: kick, sub and bass captured together against the
   power sum of each alone (9). A combined level well under the power sum is
   cancellation; fix it before reaching for sidechain or EQ.
8. **Automation.** Check what plays, by capture: each automated entrance in 30 ms
   windows (a seed blip shows as a full-level first window), after
   `live.re_enable_automation`. Do not trust `value_at_start` or a beat-0 read
   from `live.get_automation` alone: on Cathedral one read 0.000 for an envelope
   that played from -0.8, and Black Glass's 42 "blips" read that way never showed
   in its Arrangement.
9. **Emotion** (EMOTION §53-56): three levers per emotional change, one surprise per
   section, the peak protected (highest note, widest, brightest kept for it), and
   something withheld.
10. **Mix.** Soloed balance against the kick with master dynamics bypassed (keep
    probe faders down: a bypassed capture can clip), then QC against the
    reference. Make room before raising a fader. The low end is decided in
    full context last (LOW_END 14): a balance that works below 120 Hz can fail
    once the synths and low mids are back.
11. **Finish** (NEW_TRACK.md): the 10-category audit /100 and the Professional
    Finish Report.

**Sub decisions are measured, not heard here.** The user monitors on
headphones (no sub-capable system), and LOW_END 17 forbids sub decisions from a
system that cannot reproduce the sub. Decide the sub by measurement against the
references; leave "how it feels on a club system" open in the report.

**Listening tests are the user's.** Hum-back (HOOKS §13) and one-finger (§14) need
an ear. Supply the material, e.g. the hook rendered on a plain tone, and record
the result as open until the user answers. Do not score a listening test
yourself.

## Back catalogue - re-audit with current knowledge

Every rule above was learned on a track, and the tracks made before a rule
existed have not been checked against it. **Re-audit them** (the order in
*Auditing a track*), fix what the user approves, and keep this table current:

- **Adding a rule** to this file or to a guide: add it to *Known gaps* for every
  track it could affect, and set that track's status back to *due*.
- **Re-auditing a track:** update its row (date, result) and its TRACK.md.

Older Sets carry older plugin state. A restored AF101 instance keeps the parameter
list it was saved with, so expression (0.3) and everything since - the matrix
(0.4), sync, stereo, voices, env 3 and filter modes (0.5) - need a fresh instance
(delete, load, reapply the patch, carry any clip envelopes over, and re-place or
edit in place the Arrangement copies - *Live facts*). Before 0.3, AF101 ignored velocity entirely: any accents
written into those tracks have never sounded. An instance saved with 0.4 is a
special case (*Synthesis*: its ids shifted in 0.5): take its values from its
preset file, not from reading it back. Threshold's instances are all 0.5 as of
2026-10-05.

| Track | Folder | Key / BPM | Last audited | Known gaps from rules learned since | Status |
|---|---|---|---|---|---|
| camelbone | `D:/ableton/tinman` | A minor (8A), 124 | never, against the rules below | leads plucked and arpeggiated (*Leads*); no hook audit (HOOKS); AF101 before 0.3 (velocity silent, filter tied to amp); bass before *Basslines*; GROOVE one-layer check; DJ intro/outro pitch rule; envelope `value_at_start`; LOW_END audit (sec. 19, measured); full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due |
| Cowboy | `D:/ableton/cowboy` | unknown - **no TRACK.md**, write one from the Set first | never | all of the above; LOW_END audit (sec. 19, measured); full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due |
| Black Glass | `D:/ableton/blackglass` | E minor (9A), 125 | 2026-10-05, partial: hygiene clean; rubs 0 genuine (183 tails crossing chord changes); harmony agrees bar by bar; Arrangement envelopes have no seed blip; arp register against the strings measured and kept (an octave lift cost the breakdown 2.3 dB); arp now a live AF101 0.5 (patch rebuilt by measurement, `blackglass-arp.txt`; accents rewritten 112/65/41; Drop B within 0.6 dB of the render); stabs given a Simpler filter envelope and velocity to cutoff; GROOVE one-layer: six polymeters, kept as the user's brief; QC PASS | hook audit (HOOKS 42, /40); lead numbers (CAMELPHAT 6); LOW_END 19 against references; emotion; NEW_TRACK /100; DJ intro sub vs "after the build"; growl and stabs are still pre-0.3 AF101 renders in Simpler; listening tests open; full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due |
| Cathedral | `D:/ableton/cathedral` | E minor (9A), 126 | 2026-10-05, partial: hygiene clean; rubs 0 genuine; DJ intro/outro pass; automation plays; HOOKS 23/40 (arp never removed, 3-8 dB under the mix in its bands, static sound); build 2 repeats build 1; peak's ceiling (E6) spent in the builds; four groove layers (brief); peak QC REVIEW (air -8, low-mid -3.3, -11.9 LUFS) | CAMELPHAT 6; LOW_END 19 against references; EMOTION in full; NEW_TRACK /100; timpani tuning; bars 65-96 darker than the render above 6 kHz; arp, bass, chords, shimmer are pre-0.3 renders; listening tests open; full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due |
| Clockwork | `D:/ableton/clockwork` | D minor (7A), 121 | never | **no Set in the folder** - ask the user where it was saved; then everything above; LOW_END audit (sec. 19, measured); full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due - blocked on the Set |
| Threshold | `D:/ableton/threshold` | D minor (7A), 124 | 2026-10-05: HOOKS audit, 28/40; LOW_END audit (sub D2 -> D1; kick +1.5 dB with a post-saturation cut at 220 Hz; low bands now within 2.7 dB of three CamelPhat references, from 6.7); CAMELPHAT; QC PASS | listening tests (HOOKS 13, 14) open; HOOKS 30 four variants not written; return at bar 97 identical to 65; sound identity 2/5; GROOVE §26 not re-run since the lead became the groove layer; NEW_TRACK audit not done; full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | due |
| B.O.B. (Electric Revival Remix) | `D:/ableton/bobdad` | B minor (10A), 132 | 2026-10-07 verse pass: source tempo is **153.82**, not 154 (rewarped; drift now -18 ms over a 32-bar verse, 100 % of onsets within half a 16th); rap clips **Pitch +1 st**; the rap's fundamentals cleared (spiccato +12 st, strings' low voice +12 st, 0 rubs); vocal chain built and measured (verse 1 QC vs `camelphat`: air -3.2 -> -1.4, mid +3.4 -> +2.8, three REVIEW flags down to one). 2026-10-06 first build: hygiene, DJ, rubs, low-end phase, automation PASS | verse 1's clip is off-grid (beat 255.75 to 385.50, spilling 1.5 beats over bar 97); final chorus lost its register lift over the verse spiccato; the TRACK.md hook map still describes structure v1; listening tests; HOOKS /40; EMOTION review; LOW_END 19 in full; mastering; NEW_TRACK /100; full CHORDS.md and EDM-TIPS.md (2026-10-07) and NEW-TRACK-DETAILED.md never applied: harmony audited against §8 voice leading, §68 low-interval limit and §69 loop boundary; EDM-TIPS §21 symptom table; the §39 validation passes | in production |

## Starting a new track - ask for the key

**Before writing any notes for a new track, ask the user what key it should be
in.** They plan keys against their other tracks on the Camelot wheel (e.g. "one
up on the A ring" from 8A A minor is 9A E minor), so a key chosen on musical
grounds alone can be wrong for the set. Record the key and its Camelot code in
the project's TRACK.md.

## DJ intro and outro - always

Every club track gets a **proper DJ intro and outro**, whatever the style
template says. A track a DJ cannot mix in and out of is not finished.

Measured on the CamelPhat extended mixes in `D:/beatport`: the outro runs
32-48 bars on a steady beat at full low-end level, melodic content steps
down 6-13 dB in 8- and 16-bar moves, the last 8-16 bars are drums only, and
the track then stops cleanly. Build to that:

- **At least 32 bars each way**, beat-led from the first bar to the last.
  Kick on every beat; no kickless bars, no tempo or meter change.
- **Every change on an 8- or 16-bar boundary**, so a DJ counting phrases
  lands on it. Pickups and fills inside a phrase are fine.
- **Outro order: melodic layers out, then bass, then percussion.** Bass that
  stays into the outro plays a root pedal, not the chord loop, so it sits in
  key against the next record; it leaves on a 16-bar line - the DJ's bass
  swap. The intro mirrors it: drums first, bass in on a 16-bar line.
- **The sub waits for the intro's build to finish.** If the intro has a build
  (Threshold's orchestral warm-up, bars 17-32), let it complete, breath
  included, before the sub enters on the next 16-bar line. A sub fading in under
  the warm-up took its arrival away (user, Threshold).
- **No pitched material in the first 16 bars or the last 16.** That is where
  the DJ mixes over the neighbouring record, which may be in another key.
  Drones, pads, chords, melodic loops and tonal FX wait for bar 17 - never open
  a track on a drone - and leave before the final 16. A tonal part entering
  later in the intro fades in, and hands over rather than stopping dead.
  (Black Glass opened on a drone that faded out at bar 32; the user cut its
  first 16 bars and kept the rest.)
- **The last 8-16 bars are drums only** - kick, hats and a little
  percussion - ending on a clean bar line with no tail into silence.
- **Nothing stops abruptly.** Atmosphere and pads fade over at least
  8 bars (clip automation on a device, reset after the note ends) rather
  than cutting when their clip does.
- `planArrangement` and `checkArrangement` encode the beat-led part; check
  lengths and the bass-out point by hand until they encode the rest.

## Expert documents

Each expert `.md` is integrated as a prompt (`agent/prompts/`), data
(`agent/knowledge/`) and code (`agent/src/`), with tests. Keep the source's
own numbers; when a document leaves something open, record the assumption
next to the data.

### Which guide for which job

Read the guide before doing its job. Where it says "not encoded", nothing in
the code enforces it yet — apply it by reading, and treat that as a gap.

**Starting and composing a track**

| Guide | What it is for | Encoded in |
|---|---|---|
| `EMOTION.md` | Emotional intent first: write the *emotional sentence* (§3), plan the arc (§4), change ≥3 levers per emotion (§53), one surprise per section (§54), **protect the peak** (§55), withholding (§56) | not encoded |
| `COMPOSITION.md` | House / deep house / techno end to end; sets the decision order idea → groove → arrangement → sound → balance → … → loudness | `agent/src/arrangement.ts`, `styles.json` |
| `NEW-TRACK-DETAILED.md` | The end-to-end operational procedure, house / tech-house: the **agent contract** (§1) — every production action states target, location, edit, starting value, expected effect and a pass/fail test — session init (§2), harmony → voicing → extensions (§3-6), chord rhythm and sound (§7-9), kick, bass and ducking (§10-12), drums, velocity and swing (§13-16), hook (§17), space (§19), the 8-bar loop before arrangement (§20), arrangement and the 8-bar change rule (§21-22), transitions and automation (§23-24), mixing order (§25-32), per-element diagnostics (§34-36), seven validation passes (§39), the execution state machine (§40), checkpoint outputs (§41), the no-hand-waving table (§42), nine failure modes (§43), and the one-pass procedure (§45). A **procedure, not an authority**: see the precedence note below | `agent/prompts/track-construction.md`, `track-construction.json`, `track-construction.ts` (`checkAction` for the six fields, `translateRequest` for §42, the §39 passes, §43 failure modes, §44 minimum track) |
| `MELODIC-TECHNO.md` | Genre profile: tempo, motif, chord loop, drum and bass templates, arrangement. Uses **Live octave names** (C1 = 36) | `melodic-techno.json`, `styles.json`, `melody.ts` |
| `HOUSE.md` | House / tech-house build order: groove -> kick/bass -> hook -> arrangement. Riffs rhythmically distinct from the bass, one primary hook, remove something before a drop, sidechained chord stabs, high-pass non-bass parts, balance in mono, quality gates A-F. Written for Wavetable, which Standard lacks: use AF101 or Drift | not encoded |
| `HOOKS.md` | The hook as the track's identity: five hook types and how to choose one, the primary-hook rule, introduce-remove-return, 80/20 variation, memory and one-finger tests, rhythmic fingerprint, layering and mixing a hook, failure modes, the arrangement map, the audit, a /40 score | not encoded |
| `MELODY.md` | Writing leads: rhythm before pitch, target 3rds/7ths not roots, question/answer, phrase arcs, **the tonic is a destination** | `checkMelodyShape` in `agent/src/melody.ts` |
| `EDM-TIPS.md` | The full expert manual: diagnose before touching anything (§2), reference workflow (§4), production order (§5), melody (§6), harmony (§7), polyrhythm and polymeter (§8), synth layering as eleven named techniques (§9), kick/bass low end (§10), arrangement (§11), transitions (§12), the ten-step decision tree (§20), the symptom → action table (§21), stock-device recipes (§22), agent rules for driving Live (§23), pre-final and master checklists (§25-26). Its numbers are labelled `[SOURCE RULE]`, `[STARTING RANGE]` or `[STOP CONDITION]` — a `[STARTING RANGE]` is never a target | `checkMelody` in `agent/src/melody.ts` |
| `CHORDS.md` | The full expert manual: the five harmonic layers (§1.2), chord construction and scale-to-chord maps (§4-5), functional logic (§6), the progression procedure (§7), the exact voice-leading cost algorithm (§8), inversions (§9), open and rootless voicings (§10), extensions and suspensions (§11-12), tension and release (§13), bass design (§14), melody harmonisation (§16-17), the "change one chord" procedure (§18), twenty hard rules (§59), the Sol State checklist (§60), humanisation without random damage (§63), four- and eight-bar templates (§64-65), the low-interval-limit heuristic (§68), loop-boundary voice leading (§69), pedal tones (§70), inner-voice lines (§71), and the chord simplification pass (§76) | `chord-progressions.json`, `chords.ts` (§68 graded low-interval limit, §69 `loopBoundary`, §76 doubled pitch classes), `voiceLeadingCost` in `music-theory.ts` (§8.3, which `voiceLead` now scores candidates by) |
| `BASSLINES.md` | Bassline writing. Uses **scientific octave names** (C4 = 60) | `bass-patterns.json`, `basslines.ts` |
| `DRUMS.md` | Drum grids, variation, swing, fills, anchors | `drum-patterns.json`, `drums.ts` |
| `GROOVE.md` | Dotted-eighth (3/16) syncopation: one stable anchor (kick, clap, hats), **one** groove layer moving around it, phrase-reset vs free-running pulse, note length shorter than spacing, accents, omissions. "If everything is syncopated, nothing sounds syncopated" | not encoded |
| `ORCHESTRAL.md` | Orchestral composition and mock-ups. Assumes **Live Suite / Max for Live**; this machine runs Standard, so only its `filesystem` mode applies | not encoded |

**Artist and style profiles** — each names an artist through a style template

| Guide | Encoded in |
|---|---|
| `JON_HOPKINS.md`, `TINLICKER.md` | `artists.json`, `styles.json`, `artists.ts` |
| `ERIC.md` (Eric Prydz / Pryda progressive house) | `styles.json`, `bass-patterns.json`, `chords.ts` |
| `CAMELPHAT.md` - measured from the TPS x CamelPhat pack's 120 MIDI files, not written by an expert: lead kinds, rhythm cells, anchor and bounce, voicings, bass shapes | not encoded |

**Sound, synthesis and effects**

| Guide | What it is for | Encoded in |
|---|---|---|
| `ANALOG_SYNTH_AGENT.md` | Spec for **our own synth**, AnalogFoundry 101 — see *Synthesis* above | `analogfoundry/` |
| `Ableton_Sound_Selection_Expert.md` | Choosing samples and presets by role before processing them | `sound-selection.json`, `sound-selection.ts`, `qc/src/samples.ts` |
| `EFFECTS.md` | Effects field guide: cue, mechanism, control law, confusions | `effects.json`, `qc/src/identify.ts` |
| `EDM-COMPOSITION.md` | Effects and advanced rhythm (ratchets, retrigger deceleration, polymeters) as perception → mechanism | `effects.json`, `patterns.ts` |
| `SHIMMER.md` | Granular sparkle / crystal / shimmer: short tonal source -> Grain Delay (+12, +7, +19) -> dotted-eighth delay -> slow pan -> dark reverb, high-passed. An **event** at 3-8 structural moments (phrase ends, breakdown entry/exit, before drops), automated as a bloom - slow start, accelerating rise, peak, sharp cut leaving the tail. Standard lacks Echo and Hybrid Reverb (use Delay, Reverb) and the bridge cannot reach return devices, so build it as an insert chain on its own track | not encoded |
| `ABLETON_VOCALS_EXPERT.md` | Vocals: chops, processing, placement | `vocals.ts` |

**Mixing, mastering and finishing**

| Guide | What it is for | Encoded in |
|---|---|---|
| `LOW_END.md` | Kick, bass and low end as one system: a reference with a similar low-end design (sec. 3), mono + 120 Hz low-pass analysis (4), kick first (5-6), bass against it (7), diagnose before processing (8), phase and timing (9), sidechain as a tool not the whole fix (10), small deliberate EQ (11), harmonics for translation (12), envelopes (13), back to full context (14), club verification (17), the decision tree (19), anti-patterns (20), report format (22) | not encoded |
| `MIXING.md` | Mix and master policy: references, true-peak ceiling, QC rules, master-chain roles | `agent/src/mastering/`, `bridge/src/mastering/`, `qc/` |
| `NEW_TRACK.md` | Despite the filename, titled *PROFESSIONAL_TRACK_FINISH*: the finishing pass. Diagnose in order composition → … → mastering, minimum effective change, a 10-category audit scored /100 **without inflation**, and a required *Professional Finish Report* | not encoded |
| `EDM-PRODUCTION.md` | A summary of a generated production `AGENTS.md` that was **not supplied**; overlaps the guides above. Use only the rules it states | not encoded |

**Background, not instructions**

| Guide | What it is |
|---|---|
| `PROJECT.md` | The original implementation plan for this repository (wrapped in a Python string). Its `noteNameToMidi("F1") -> 29` example assumes scientific octaves — see *Gotchas* |
| `docs/lessons.md` | What producing whole tracks taught. **Read before producing or mixing** |
| `docs/capabilities.md` | What the bridge can and cannot do in Live |

Where guides overlap, the more specific one wins for its own job: `MELODIC-TECHNO.md` over `HOUSE.md` for a melodic track, `MELODY.md`
over `EDM-TIPS.md` for leads, `HOOKS.md` over `MELODY.md` for what the hook is and
where it appears (MELODY.md still governs how its line is written), `MIXING.md` over `COMPOSITION.md` for the master
chain, `LOW_END.md` over `MIXING.md` for the kick/bass relationship (MIXING.md
still owns the master chain and loudness), *Basslines* above over `LOW_END.md` for
what the bass plays (LOW_END.md decides how it sits), an artist profile over its genre profile.

`NEW-TRACK-DETAILED.md` is the exception to that rule, because it is a
procedure rather than an authority. Use it for the **order of work**, the
agent contract and its pass/fail tests, and let the specific guide win on
every job it owns: HOOKS.md for the hook, LOW_END.md for kick and bass,
GROOVE.md for syncopation, *Basslines* above for what the bass plays,
MIXING.md for the master chain. Its concrete values are self-labelled
`[AGENT-DEFAULT]` or `[AGENT-DERIVED]` — starting points its author added so
an agent could act, not measurements — so they never override a number this
project measured. The same holds for EDM-TIPS.md's `[STARTING RANGE]` values.

- **Octave names differ between documents.** BASSLINES.md is read as
  scientific pitch (C4 = 60); MELODIC-TECHNO.md uses Live's names (its kick
  is C1 = 36). Each pattern records its `convention`; never mix them silently.
- **CHORDS.md and EDM-TIPS.md are now the full expert documents** (supplied
  2026-10-07, replacing the summaries). Anything written against the
  summaries — prompts, knowledge data, the checks in `melody.ts` and
  `chords.ts` — was built without their detail, so treat a rule missing from
  the code as unencoded rather than rejected, and read the section before
  relying on a summary of it.
- Documents that cite YouTube references they could not see mark those
  fields unresolved; do not fill them in.
- Artist documents (JON_HOPKINS.md, TINLICKER.md) live in
  `agent/knowledge/artists.json`; a style template names its artist through
  the profile's `style`, and `checkStylePlan` adds that artist's tests to the
  generic arrangement rules. A style that is not DJ-first sets
  `dj_friendly: false` with its reason. Use `checkStylePlan`, not
  `checkArrangement`, wherever a style is known.

## Gotchas

`docs/lessons.md` collects what producing a whole track taught: Live and
bridge behaviour, measuring a mix, drum clarity, bass and harmony. Read it
before producing or mixing.

**A key-finder on a single line is circular.** Run on a lead alone it calls the
most-played note the tonic. Measure a line against its own anchor note
(`CAMELPHAT.md`), and get the key from the harmony or the user.

**Note ids change.** Deleting and re-adding a note gives it a new id. Always
re-read before a second edit pass; `live.update_notes` returns
`NOTE_NOT_FOUND` with the ids that do exist rather than guessing.

**`live.replace_notes` is destructive.** It is for new material only. Edits to
existing parts go through `live.update_notes`.

**Beats are zero-based; bars as users speak them are one-based.** Use
`barToBeat` / `beatToBar`; do not open-code the arithmetic.

**Middle C is C3 here**, matching Ableton's piano roll. The implementation
plan's `noteNameToMidi("F1") -> 29` example assumes scientific notation
instead — that is available as `noteNameToMidi('F1', 'scientific')`. The
default was chosen so note names match what the user sees on screen.

**Parameter ranges are per-device.** Never write a value you have not
bounds-checked against that parameter's own `min` and `max`.

**Snapshots are in memory only.** They do not survive a bridge restart. Live's
own undo stack is the user's, and is shared — prefer a snapshot for anything
the agent did.

## Development order

The plan's ordering, for anything still unbuilt: arrangement features come
last, after device enumeration, parameter editing, automation and scenes.
Reliability of Live control comes before genre generation, always.
