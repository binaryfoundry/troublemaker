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

Python changes need a **Live restart** to take effect. Install with `-Link`
during development so you only restart, not reinstall.

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

## Testing

```bash
npm test                      # 116 tests, no Ableton needed
npm run typecheck
npm run cli -- selftest       # round trip, needs Live running
```

The fake Remote Script in `bridge/tests/bridge.test.ts` speaks the real
protocol, so protocol, reconnect, snapshot and transaction behaviour are all
covered without Ableton.

Golden musical tests assert **properties**, not exact note lists: pitch
sequence preserved, note count within a range, some notes moved off-grid. Do
not tighten them into exact-output tests — variation is the point of these
operations.

Transform functions take a `seed` and must be reproducible for a given seed.
A user needs undo-and-retry to converge, which random output prevents.

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

## Gotchas

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
