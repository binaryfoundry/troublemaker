# Music editing guide

Reference for turning musical intent into bridge commands. The helpers named
here live in `agent/src/` and are pure functions — use them rather than doing
arithmetic in your head.

## Time

A beat is a quarter note, zero-based from the clip start. Bars as the user
speaks them are 1-based.

In 4/4:

| User says | Beats     |
| --------- | --------- |
| bar 1     | 0–4       |
| bar 2     | 4–8       |
| bar 9     | 32–36     |
| bars 9–16 | 32–64     |

`barToBeat(9)` is 32. `barsToBeats(16)` is 64. Do not recompute these by hand,
and do not assume 4/4 — read the time signature from `live.get_project_state`.

## Pitch

`noteNameToMidi` defaults to Ableton's octave numbering, where middle C
(MIDI 60) is **C3** — the same label the user sees in the piano roll. Pass
`'scientific'` if you need C4 = 60 instead.

Useful anchors: kick 36, snare 38, clap 39, closed hat 42, open hat 46.
A techno sub-bass sits around 29–41; a lead sits above 60.

## Interpreting relative language

| Request              | Operation                | Typical amount |
| -------------------- | ------------------------ | -------------- |
| more syncopated      | `makeMoreSyncopated`     | 0.3–0.5        |
| straighter, tighter  | `straighten`             | strength 1     |
| busier               | `increaseDensity`        | 0.2–0.4        |
| less busy, sparser   | `reduceDensity`          | 0.2–0.4        |
| more human, less rigid | `humanizeVelocity` + `humanizeTiming` | spread 10–15, shift ≤0.02 |
| more groove          | `applySwing`             | 0.55–0.62      |
| more movement        | `varyEveryNthBar`        | every 4, 0.3–0.5 |
| darker               | lower filter cutoff      | −15–25% of range |
| brighter             | raise filter cutoff      | +15–25% of range |
| more spacious        | raise a reverb/delay send | +0.1–0.2 normalized |

These are starting points, not rules. One application should be clearly
audible but still recognisably the same part. If the user says "more" again,
apply another increment rather than jumping to an extreme.

## Preserving identity

Each transform returns an `EditPlan` — `updates`, `additions`, `removals` —
rather than a replacement pattern. Merge plans with `mergePlans` and convert
with `planToCommands`, which orders removals before additions so freed slots
can be reused. Send the result as one `transaction`.

After writing, read the clip back and run `compareMaterial(before, after)`.
For "make it more syncopated", a good result has:

- the same pitch sequence
- note count within ±20%
- at least two notes now off the eighth-note grid
- no overlapping notes at the same pitch

If those do not hold, the edit went too far — restore the snapshot and retry
with a smaller amount.

## Devices

Never write a parameter you have not read. `live.get_device_parameters`
returns `min`, `max`, `value`, `normalized` and `display_value`. Compute the
new value from the current one:

```
darker: normalized = max(0, current.normalized - 0.2)
```

`devices/` holds semantic hints mapping ideas like "brightness" to real
parameter names for common Live devices. They are hints: the device in the
Set is the authority, so still inspect it. If a device exposes no suitable
parameter, say so rather than changing something unrelated.

## Automation

Clip envelopes only. "Open the filter over the last 4 bars" of a 16-bar clip:

```json
{
  "command": "live.set_automation",
  "args": {
    "track_id": 4,
    "clip_slot": 0,
    "device_id": 22,
    "parameter_name": "Frequency",
    "points": [
      { "beat": 48, "normalized": 0.25 },
      { "beat": 64, "normalized": 0.9 }
    ]
  }
}
```

Read it back with `live.get_automation` and check the sampled curve rises.

## Structure

`defaultArrangement(32)` gives Intro / Groove / Breakdown / Drop with energy
levels; `partsForEnergy(energy)` says which roles should sound. Infer roles
with `inferTrackRole(name)` corroborated by `inferRoleFromNotes(notes)` — both
return a confidence, and a weak inference is not grounds for a destructive
edit. Ask, or pick the conservative reading.

Build a longer arrangement out of material the Set already has
(`extendClip`), not from unrelated new clips.

## Build-ups

A build is a combination, and not all of it suits every track:

- rising percussion density
- a snare roll that accelerates into the downbeat
- a filter opening across the span
- rising reverb send
- the kick dropping out for the last half bar
- one beat of silence before the drop

Inspect what is playing in the section first, then pick the two or three moves
that fit. Say which you chose and why.
