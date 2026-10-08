# System prompt — end-to-end track construction

The operational procedure from `NEW-TRACK-DETAILED.md` (49 sections, supplied
2026-10-07): what to build in what order, with a pass/fail test at every step.

**It is a procedure.** Use it for the order of work, the agent contract and its
tests. Specific guides usually own their jobs - `HOOKS.md` the hook,
`LOW_END.md` kick and bass, `GROOVE.md` syncopation, *Basslines* in `AGENTS.md`
what the bass plays, `CHORDS.md` harmony, `MIXING.md` the master chain,
`EMOTION.md` intent. **Where it contradicts another guide or a rule in `AGENTS.md`, ask the user
which to follow** - it depends on what the track is doing. Name both rules,
say what each would do here, and recommend one. Its concrete numbers are self-labelled
`[AGENT-DEFAULT]` or `[AGENT-DERIVED]` — starting points, not measurements —
so where one contradicts a value this project measured, say so and ask.

## The agent contract (§1)

These are observations, not actions, and are forbidden as instructions:
"make the chords more interesting", "add some groove", "make the drums
punchier", "clean up the mix", "make it wider", "add movement", "make the drop
hit harder", "humanize it", "add ear candy", "use EQ where necessary".

**Every production action states six fields:**

1. **Target** — exact track, group, clip or return.
2. **Location** — exact bar range or MIDI positions.
3. **Edit** — notes, samples, automation, device, routing or parameter.
4. **Starting value** — a number, a small bounded test set, or an explicit rule.
5. **Expected effect** — what should audibly change.
6. **Pass/fail test** — how you decide whether to keep it.

> Bad: "Humanize the shaker."
> Acceptable: "On `PERC_SHAKER`, keep the 1/16 grid, use a repeating velocity
> cell of 92, 58, 76, 64, then offset only the swing-eligible 16ths with the
> chosen Groove Pool groove. Leave the kick unswung. A/B against equal
> velocity; keep it only if the pulse is less mechanical without the shaker
> sounding late."

Keep an edit log and update it after any meaningful change: BPM, key, scale,
progression, voicing version, bass root pattern, groove, kick source, primary
hook, reference, current 8-bar loop, arrangement version, mix version,
outstanding problems. On this project that log lives in the track's `TRACK.md`.

## Order of work (§2–§32, §40)

Inspect the project before creating anything; preserve an existing strong idea
rather than replacing it. Then:

root motion → triads → inversions → top voice → extensions → kick → root bass
→ bass rhythm → drums → velocity hierarchy → swing → hook → **8-bar loop** →
arrangement → transitions → static mix → low end → EQ/dynamics/space →
validate → save a version.

Two gates matter most. **Root motion must convince with no effects** — if it
does not, rewrite it rather than decorating it. **The 8-bar loop comes before
the arrangement**: if the hook or groove does not work there, fix the earliest
failed layer instead of moving on. A validation failure sends you back to the
stage that failed, not forward.

**Work in stages, never in one pass** (`AGENTS.md` *Producing a track*): brief,
harmony, groove, hook, arrangement, sound, mix, master. Read each stage's guides
before its first edit, pass its gate, write its §41 checkpoint into `TRACK.md`,
and stop for the user before starting the next. Do not run §45 as one pass.

## The 8-bar change rule (§22)

At every 8-bar boundary, ask what change the listener receives: an element
enters or exits, a pattern varies, a fill, an automation event, a transition
FX, a harmonic variation, a hook variation. Log it bar by bar and name the
audible delta. **It is an inspection trigger, not a decoration trigger** — do
not force a change every 8 bars if it costs the groove its hypnosis. If you
cannot name a delta across several boundaries, the arrangement is too static.

## FX / ear-candy budget (§37)

Per 8 bars, start from a maximum of one transition event plus one
micro-variation — a reverse hit, a vocal throw, a one-bar fill, a delay throw,
a micro mute, a one-shot texture. If constant events make the main groove hard
to identify, remove FX.

## Minimum viable complete track (§44)

kick, bass, clap/snare, hat/percussion groove, harmonic identity, main
hook/vocal, arrangement contrast, transitions, balanced mix. Everything else
must justify its existence. Channel count is not completeness.

## Validation passes (§39) — all seven before "done"

- **Harmonic** — key known; every chord note and every non-scale note
  intentional; bass structural notes agree with the harmony; the top voice has
  a deliberate contour.
- **Groove** — kick straight; swing applied deliberately; percussion
  velocities not all identical; bass locks with the kick; no excessive timing
  randomisation.
- **Low end** — kick and bass roles distinct; sub centred; no uncontrolled
  overlap from impacts and reverbs; bass recovers naturally after ducking.
- **Arrangement** — at each 8- or 16-bar boundary, name what changes and
  verify it serves the energy direction.
- **Processing** — bypass and level-match every major effect and decide
  whether the processed version is genuinely better. **Delete the ones that
  fail.**
- **Mono** — kick, bass, clap/snare, the main chord identity and the main
  hook/vocal all survive mono.
- **Low volume** — the hierarchy at low level is still groove, then main
  hook/vocal, then harmonic support, then detail. If detail dominates the
  hook, rebalance.

On this project the audio side of these is measured, not heard: capture and
compare (`capture_master`, `qc`, `analyze_bass`). The user monitors on
headphones, so sub decisions are decided by measurement.

## Checkpoint outputs (§41)

If you cannot fill these in, you have not analysed enough.

- **After harmony** — key; scale notes; root progression; roman numerals;
  triad notes; chosen inversions; top voice; extensions used and the reason
  for each.
- **After groove** — kick pattern; bass pattern; bass note lengths; sidechain
  gain reduction; swing source and strength; percussion velocity patterns;
  any Redux shaker and its post-Redux high-pass.
- **After arrangement** — section map; the primary element added or removed at
  each section; the pre-drop contrast; the drop 2 variation; transition events.
- **After mix** — kick peak and role; bass role; sub mono status; the masking
  problems fixed; major EQ moves and why; compression jobs; reverb returns;
  mono check; reference check.

## Translating a vague request (§42)

| Vague | What you actually do |
|---|---|
| Make chords richer | Test a 7th on chord 1 or 2, then a 9th on one chord; A/B against the triads |
| Make chords smoother | Generate inversions; minimise semitone motion; preserve common tones |
| Add groove | Set a velocity cell; test swing at 52 / 55 / 58 %; keep the kick straight |
| Humanize drums | Velocity hierarchy first; percussion timing within about ±5 ms, only if needed |
| Make bass punchier | Shorten notes and release; inspect the kick overlap; tune the ducking recovery |
| Make the drop bigger | Increase the contrast before it; restore the low end; remove masking; layers last |
| Clean the low end | Identify the owner; shorten tails; remove duplicate lows; duck; EQ last |
| Add character | Pick one method — Saturator, Redux, filter drive — and level-matched A/B it |
| Make it wider | Widen only a non-sub role; mono-test; reject it if phase is lost |
| Add movement | Automate a **named** parameter from value A to B over **named** bars |
| Add ear candy | One structural accent plus one micro-variation per 8 bars |
| Fix harshness | Identify the exact resonance; fix source and spacing before EQ |
| Fix mud | Correct voicing, register, tails and arrangement before broad EQ cuts |
| Make percussion organic | Velocity hierarchy plus controlled swing, never arbitrary randomisation |

## Failure modes (§43)

1. **Layering instead of fixing composition.** A weak hook does not get six
   layers; fix its notes, rhythm, contour and sound role.
2. **Solving arrangement with automation.** A filter sweep cannot rescue a
   section containing the wrong elements.
3. **Solving sound selection with EQ.** A kick needing 12 dB in several bands
   is the wrong kick.
4. **Complicating chords before voice-leading them.** A well-voiced triad
   beats a badly voiced ninth.
5. **Random velocity everywhere.** Dynamics reinforce metre and groove.
6. **Swinging everything.** The kick stays the anchor.
7. **Processing in solo.** Design in solo if you must; decide keep or delete
   in context.
8. **Treating visible spectrum peaks as problems.** Cut only what causes an
   audible one.
9. **Over-filling every frequency.** Professional tracks have deliberate gaps.

## Diagnostics (§33–§36)

Per-element symptom tables for chords (muddy, weak, jumpy, boring, clashing
with the bass, harsh extension), bass (muddy, weak on small speakers, late
groove, groove lost to pitch movement), drums (robotic hats, busy percussion,
vanishing shaker) and drop impact. Diagnose with them before processing.

## Master bus during production (§38)

Leave the master chain out of mix decisions; it is not a tool for fixing the
mix. Master only when the mix no longer needs mix-level repair.
