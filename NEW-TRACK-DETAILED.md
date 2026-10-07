# Ableton Live Codex Agent Guide
## Detailed operational production workflow derived from the linked EDM Tips tutorial

**Primary source supplied by user:**  
`https://www.youtube.com/watch?v=y761dC0qT_M`

**Target DAW:** Ableton Live 12  
**Target role:** Codex agent operating Ableton to compose, program, arrange, sound-design, and mix an EDM / house / tech-house track.  
**Priority:** musical decisions first, processing second.  
**Constraint:** no vague instructions. Every recommendation must resolve to an editable Ableton action and a test for whether it worked.

---

# 0. SOURCE-FIDELITY RULES

This document deliberately distinguishes between what is recoverable from the tutorial and what is added as an executable implementation rule.

Use these labels mentally when following the guide:

- **[VIDEO-INDEXED]** — technique independently indexed against the tutorial.
- **[EDM-TIPS-CROSSCHECK]** — theory/workflow clarified from EDM Tips' own written material.
- **[AGENT-DEFAULT]** — concrete value or procedure added here so an automated agent can act instead of hand-waving.
- **[AGENT-DERIVED]** — a deterministic implementation of the tutorial's principle, not a claim that the presenter used these exact numbers.

Do **not** turn an `[AGENT-DEFAULT]` into a statement such as "the video says to use 18% wet" unless that number is actually observed in the project/video.

The searchable copy of the tutorial is indexed as **"Make Professional EDM Music From SCRATCH in 10 Simple Steps" by EDM Tips**, described as a House / tech-house walkthrough using Ableton Live 12 stock devices. The exact user-supplied YouTube ID could not be transcript-fetched directly during compilation, so this guide does not invent inaccessible chapter names, knob positions, or MIDI note values.

---

# 1. THE AGENT CONTRACT

The agent is not allowed to write instructions like:

- "make the chords more interesting"
- "add some groove"
- "make the drums punchier"
- "clean up the mix"
- "make it wider"
- "add movement"
- "make the drop hit harder"
- "humanize it"
- "add ear candy"
- "use EQ where necessary"

Those are observations, not actions.

Every production action must contain **six fields**:

1. **Target** — exact track, group, clip, or return.
2. **Location** — exact bar range or MIDI positions.
3. **Edit** — notes, samples, automation, device, routing, or parameter.
4. **Starting value** — a number, a small bounded test set, or an explicit rule.
5. **Expected effect** — what should audibly change.
6. **Pass/fail test** — how the agent decides whether to keep it.

Example:

> **Bad:** "Humanize the shaker."

> **Acceptable:** "On `PERC_SHAKER`, keep the 1/16-note grid intact, use a repeating velocity pattern of 92, 58, 76, 64 for the first pass, then offset only the off-grid/swing-eligible 16ths with the selected Groove Pool groove. Leave the kick unswung. A/B against equal velocity; keep the edited version only if the pulse is less mechanical without making the shaker sound late."

The agent must also keep an **edit log**:

```text
BPM:
Key:
Scale:
Chord progression:
Chord voicing version:
Bass root pattern:
Groove:
Kick source:
Primary hook:
Reference:
Current 8-bar loop:
Arrangement version:
Mix version:
Outstanding problems:
```

After any meaningful change, update the log.

---

# 2. SESSION INITIALIZATION

## 2.1 Inspect before creating

Before adding anything:

1. Read the current Live Set tempo.
2. Inspect all tracks, groups, clips, locators, devices, sends, and automation.
3. Determine whether a key or scale has already been established.
4. Determine whether a usable musical idea already exists.
5. Do not overwrite existing clips. Duplicate before destructive changes.

Use versioned names:

```text
CHORDS_roots_v01
CHORDS_triads_v02
CHORDS_voiced_v03
CHORDS_extensions_v04

BASS_roots_v01
BASS_groove_v02

DRUMS_core_v01
DRUMS_groove_v02

ARR_v01
ARR_v02

MIX_v01
MIX_v02
```

## 2.2 If the project is blank

Create this track structure:

```text
01 KICK
02 CLAP_SNARE
03 HAT_CLOSED
04 HAT_OPEN
05 PERC_MAIN
06 PERC_SHAKER
07 PERC_EXTRA
08 BASS_SUB
09 BASS_MID
10 CHORDS
11 CHORD_TEXTURE
12 HOOK_LEAD
13 VOCAL
14 FX_RISER
15 FX_IMPACT
16 FX_TEXTURE

GROUP DRUMS
GROUP BASS
GROUP MUSIC
GROUP VOCALS
GROUP FX

RETURN A SHORT_ROOM
RETURN B LONG_VERB
RETURN C DELAY
```

Do not create layers merely to fill the template. Empty tracks are preferable to redundant sounds.

## 2.3 Tempo

If the tutorial/project reveals a tempo, use it.

If no tempo can be recovered and the project is truly blank:

- set **128 BPM temporarily** as `[AGENT-DEFAULT]`;
- label the value `TEMP_BPM`;
- once kick, bass and percussion exist, audition **126 / 128 / 130 / 132 BPM**;
- choose the lowest tempo that still produces the intended energy without making the bass rhythm feel sluggish.

Do not assume "tech house = one fixed BPM."

## 2.4 Loop length

Composition loop:

- create an **8-bar** work loop;
- use bars **1–4** for the core phrase;
- use bars **5–8** for a repeated phrase with at least one intentional variation.

The agent must not start building a 4-minute arrangement before the core 8 bars work.

---

# 3. HARMONY: BUILD THE CHORD PROGRESSION PROPERLY

This is the most important section to execute carefully.

The agent must build harmony in layers:

```text
KEY / SCALE
    ↓
ROOT MOTION
    ↓
DIATONIC TRIADS
    ↓
VOICE LEADING / INVERSIONS
    ↓
TOP-VOICE SHAPE
    ↓
OPEN VOICING / ROOT OMISSION
    ↓
7THS / 9THS / SUSPENSIONS
    ↓
RHYTHMIC ARTICULATION
    ↓
SOUND DESIGN
```

Do **not** jump directly from "choose four chords" to a polished synth patch.

---

## 3.1 Establish the key

If a vocal, sample, or existing melody is present:

1. Identify its stable/resting note.
2. Check all important sustained notes.
3. Test likely major/minor scales.
4. Prefer the scale that contains the structural notes; passing notes may be chromatic.

If no melody exists, choose a key based on intended register.

For club-oriented low end, do not choose a key solely because the name looks convenient. Check where the tonic sits on the actual bass sound/system.

### Major scale interval pattern

```text
W W H W W W H
2 2 1 2 2 2 1 semitones
```

Scale degrees:

```text
1  2  3  4  5  6  7
```

Diatonic triads:

```text
I      major
ii     minor
iii    minor
IV     major
V      major
vi     minor
vii°   diminished
```

### Natural minor interval pattern

```text
W H W W H W W
2 1 2 2 1 2 2 semitones
```

Diatonic triads:

```text
i      minor
ii°    diminished
III    major
iv     minor
v      minor
VI     major
VII    major
```

### Worked scale example: G natural minor

```text
G  A  Bb  C  D  Eb  F
1  2  b3  4  5  b6  b7
```

Diatonic triads:

```text
Gm   = G  Bb D
Adim = A  C  Eb
Bb   = Bb D  F
Cm   = C  Eb G
Dm   = D  F  A
Eb   = Eb G  Bb
F    = F  A  C
```

This is an implementation example, not a claim that the tutorial track is in G minor.

---

## 3.2 Ableton scale setup

In the MIDI editor:

1. Create an 8-bar MIDI clip on `CHORDS`.
2. Enable **Scale**.
3. Set the tonic and mode.
4. If the exact mode is not represented by Live's scale helper, create a manual scale-reference clip.
5. Keep the piano roll unfolded while evaluating inversions; folding can hide octave/register problems.

Optional old-school scale-template method:

1. Draw one occurrence of every note in the scale outside the playing phrase.
2. Move those guide notes before the playable region or mute them.
3. Use them as a pitch reference.
4. Remove them before final export if they are inside the rendered range.

EDM Tips' written chord material uses the same practical idea: establish the notes available in the key, then construct chords from them.

---

## 3.3 Write ROOT MOTION before full chords

Do not begin with four random triads.

Create `CHORDS_roots_v01`.

For a four-chord / four-bar skeleton:

```text
Bar 1: root A
Bar 2: root B
Bar 3: root C
Bar 4: root D
```

Initially make each root **one bar long**.

Test root motion using a neutral instrument or piano.

### Root-motion acceptance criteria

The four roots must:

- make the first bar feel like a plausible tonal anchor;
- create at least one departure and one return/tension-release relationship;
- not require fancy sound design to be convincing;
- survive transposition by one octave without losing their identity.

Reject the progression if its only appeal comes from a preset, reverb, or bass distortion.

### Useful movement categories

The agent should test intentionally rather than randomly:

- step: ±1 scale degree;
- third: ±2 scale degrees;
- fourth/fifth relation;
- common-note relation;
- return to tonic;
- deceptive movement that postpones tonic.

Generate at most **6 candidate root sequences**. Do not brute-force hundreds.

Score each 1–5 for:

```text
tonal clarity
forward motion
loopability
emotional fit
bass potential
```

Keep the best one or two.

---

## 3.4 Turn roots into diatonic triads

**[EDM-TIPS-CROSSCHECK]** A practical construction method repeatedly used in EDM Tips material is:

> starting on the chord root, take a scale note, skip one scale note, take the next, skip one, take the next.

That yields:

```text
root + 3rd + 5th
```

Example in G natural minor:

```text
Root G:
G [skip A] Bb [skip C] D
=> G Bb D = G minor

Root Eb:
Eb [skip F] G [skip A] Bb
=> Eb G Bb = Eb major
```

For each root:

1. place the root;
2. move up two scale degrees for the third;
3. move up two more scale degrees for the fifth;
4. keep all notes initially inside a compact mid register.

Create `CHORDS_triads_v02`.

Do not add sevenths yet.

---

## 3.5 Chord formulas the agent must know

**[EDM-TIPS-CROSSCHECK]** EDM Tips' chord reference explicitly covers these chord types.

Semitone formulas below are relative to the root:

| Chord | Formula | C example |
|---|---:|---|
| Major | 0, 4, 7 | C E G |
| Minor | 0, 3, 7 | C Eb G |
| Augmented | 0, 4, 8 | C E G# |
| Diminished | 0, 3, 6 | C Eb Gb |
| Sus2 | 0, 2, 7 | C D G |
| Sus4 | 0, 5, 7 | C F G |
| Major 6 | 0, 4, 7, 9 | C E G A |
| Minor 6 | 0, 3, 7, 9 | C Eb G A |
| Major 7 | 0, 4, 7, 11 | C E G B |
| Minor 7 | 0, 3, 7, 10 | C Eb G Bb |
| Dominant 7 | 0, 4, 7, 10 | C E G Bb |
| Major 9 | 0, 4, 7, 11, 14 | C E G B D |
| Minor 9 | 0, 3, 7, 10, 14 | C Eb G Bb D |
| Dominant 9 | 0, 4, 7, 10, 14 | C E G Bb D |
| Add9 | 0, 4 or 3, 7, 14 | e.g. Cm(add9) = C Eb G D |

Important distinction:

```text
Csus2 = C D G       -> third removed
Csus4 = C F G       -> third removed
Cadd9 = C E G D     -> third retained
```

The agent must not confuse `sus2` with `add9`.

---

# 4. VOICING: MAKE THE SAME CHORDS FLOW

A progression can contain correct chord names and still sound amateur because the voices jump unnecessarily.

The agent must optimize **voice leading** before adding more notes.

---

## 4.1 Generate inversion candidates

For a triad:

```text
Root position:  1 3 5
1st inversion:  3 5 1
2nd inversion:  5 1 3
```

Example C major:

```text
root:  C E G
1st:   E G C
2nd:   G C E
```

In Ableton, an inversion is made by moving one or more chord notes exactly **12 semitones** up or down.

Do not transpose the whole chord; that changes register, not inversion.

---

## 4.2 Deterministic voice-leading algorithm

For each chord after chord 1:

1. construct root-position notes;
2. construct first-inversion notes;
3. construct second-inversion notes;
4. shift the candidate as a whole by octaves if necessary so its center lies near the previous chord;
5. sort pitches low to high;
6. pair each voice with the nearest previous voice;
7. compute:

```text
movement_cost =
    abs(v1_new - v1_old)
  + abs(v2_new - v2_old)
  + abs(v3_new - v3_old)
```

Add penalties:

```text
+ 4 for any individual leap > 7 semitones
+ 6 if the complete chord changes register by > 12 semitones
+ 3 if a common chord tone could have remained stationary but did not
```

Choose the lowest-cost candidate unless a desired top melody justifies another inversion.

This is an `[AGENT-DERIVED]` implementation of smooth chord inversions, not a claim that the video computes a numeric cost.

---

## 4.3 Preserve common tones

If consecutive chords share a pitch class, first test leaving that note at exactly the same MIDI pitch.

Example:

```text
Gm  = G Bb D
Eb  = Eb G Bb
```

Instead of:

```text
G3 Bb3 D4
Eb3 G3 Bb3
```

try:

```text
Gm: G3  Bb3 D4
Eb: G3  Bb3 Eb4
```

G and Bb remain stationary while only D moves to Eb.

That is usually more cohesive.

---

## 4.4 Design the TOP VOICE deliberately

Do not let the highest note be an accident.

After basic inversion optimization:

1. extract the highest MIDI note of each chord;
2. read those notes as a melody;
3. listen to them by themselves if necessary.

Target behavior for a four-chord phrase:

- at least one repeated/shared top note **or** stepwise move;
- most adjacent top-note motion **0–5 semitones**;
- use a leap >5 semitones only when it produces a deliberate phrase gesture.

If the top notes are:

```text
D4 -> Eb4 -> D4 -> C4
```

the harmony already contains a singable contour.

If they are:

```text
G4 -> D5 -> Bb3 -> F5
```

revoice unless that extreme shape is intentional.

---

## 4.5 Open voicing

Once close-position triads work, make a duplicate:

`CHORDS_voiced_v03`

Test this operation:

- take an inner or highest chord tone;
- move it up 12 semitones;
- keep the harmonic identity the same.

Example:

```text
Gm close:
G3 Bb3 D4

Gm open:
G3 D4 Bb4
```

Use open voicing when close chords sound boxy or congested.

### Low-register rule

Do not pack multiple chord tones closely together in the sub/low-bass range.

Starting rule:

- keep the dedicated bass/sub below the chord bed;
- try to keep the **lowest sustained chord-synth note around C3 or above** unless the patch is intentionally sparse;
- if the chord synth becomes muddy, first raise its lowest note an octave rather than reaching immediately for aggressive EQ.

Register solves problems before EQ does.

---

## 4.6 Omit chord roots when the bass owns them

If `BASS_SUB` clearly plays the root, the chord layer often does not need the same root in the same octave region.

Example:

```text
Bass: G1

Full Gm7 chord:
G3 Bb3 D4 F4

Rootless upper voicing:
Bb3 D4 F4
```

This can produce more space without changing harmony.

### Keep/remove test

A/B:

```text
A = full chord voicing
B = root omitted from chord synth, bass unchanged
```

Level-match.

Keep B if:

- harmonic identity remains clear;
- low-mid mud decreases;
- kick/bass separation improves.

Restore the root if the chord sounds harmonically ambiguous in context.

---

# 5. EXTENSIONS: 7THS, 9THS, SUS CHORDS

Only add color after the triads and inversions work.

## 5.1 Add seventh

Using scale stacking:

```text
root -> skip -> 3rd -> skip -> 5th -> skip -> 7th
```

Examples:

```text
Gm7    = G Bb D F
Ebmaj7 = Eb G Bb D
F7     = F A C Eb
```

Do not assume every chord wants a seventh.

First try adding sevenths to **one or two chords** in a four-chord progression.

## 5.2 Add ninth

Add the scale's second above the octave:

```text
9th = 2nd scale degree, one octave higher
```

Examples:

```text
Gm9 = G Bb D F A
```

If the root is already supplied by bass, a useful upper structure could be:

```text
Bb D F A
```

## 5.3 Suspensions

Suspensions replace the third.

For a chord with root `R`:

```text
sus2: R + 2nd + 5th
sus4: R + 4th + 5th
```

Use suspensions primarily as **tension that resolves**.

Example:

```text
Csus4: C F G
resolve to
C:     C E G
```

A practical EDM use is to suspend the final chord before the loop returns to chord 1.

## 5.4 Do not overload the progression

The agent must run this test:

```text
triads
vs
voiced triads
vs
voiced + selected extensions
```

If extensions make the progression less readable, remove them.

"More notes" is not "more professional."

---

# 6. FULL WORKED CHORD EXAMPLE

This is an implementation exercise for the agent.

Key:

```text
G natural minor
G A Bb C D Eb F
```

Roots:

```text
G -> Eb -> Bb -> F
i -> VI -> III -> VII
```

## 6.1 Root-position triads

```text
Gm = G Bb D
Eb = Eb G Bb
Bb = Bb D F
F  = F A C
```

## 6.2 Compact voice-led version

One workable starting point:

```text
Chord 1 Gm:  G3  Bb3 D4
Chord 2 Eb:  G3  Bb3 Eb4
Chord 3 Bb:  F3  Bb3 D4
Chord 4 F:   F3  A3  C4
```

Observe the voice motion:

```text
upper voice: D4 -> Eb4 -> D4 -> C4
middle:      Bb3 -> Bb3 -> Bb3 -> A3
lower:       G3 -> G3 -> F3 -> F3
```

That is much smoother than forcing every chord into root position.

## 6.3 Bass underneath

Start with:

```text
G1 -> Eb1 -> Bb1 -> F1
```

If the chosen bass patch loses audibility or becomes too sub-heavy on a note, move that specific note up an octave only after auditioning it in context.

## 6.4 Extended version

Try:

```text
Gm7     upper: Bb3 D4 F4
Ebmaj7  upper: G3 Bb3 D4
Bbadd9  upper: C4 D4 F4
F       upper: A3 C4 F4
```

Keep roots in the bass.

This version is not automatically better. The test is whether the harmonic color fits the track.

---

# 7. CHORD RHYTHM AND ARTICULATION

Do not confuse harmony with rhythm.

First prove the progression with sustained block chords. Then create rhythmic articulation.

Duplicate:

```text
CHORDS_voiced_v03
-> CHORDS_rhythm_v04
```

Test three explicit patterns.

## Pattern A — sustained

```text
one chord per bar
note length: ~95% of bar
```

Use for pads, breakdowns, and harmonic proofing.

## Pattern B — offbeat stabs

In each 4/4 bar:

```text
1 & 2 & 3 & 4 &
  X   X   X   X
```

Start note length:

```text
1/8 note
```

Then shorten MIDI to 1/16 if the synth envelope supplies the audible tail.

## Pattern C — syncopated two-hit pattern

Example grid:

```text
1e&a 2e&a 3e&a 4e&a
--X- ---- --X- -X--
```

Keep the same rhythm for 2–4 bars before introducing variation.

### Selection rule

The chosen chord rhythm must leave enough empty space for:

- kick transient;
- bass attacks;
- main hook;
- vocal phrase if present.

If chords constantly fight the bass, simplify the chord rhythm before EQing both aggressively.

---

# 8. CHORD VELOCITY

For a neutral first pass:

```text
sustained chords: velocity 80
stabs:            velocity 90
```

If the instrument is velocity-sensitive, shape intentionally.

Example four-note stab:

```text
lowest structural tone: 92
inner tone 1:           82
inner tone 2:           78
top voice:              88
```

Do not randomize every note independently by ±30.

If the upper melody needs definition, raise the top note by **+5 to +12 velocity units** relative to inner voices and recheck timbre.

If the instrument maps velocity to filter cutoff, velocity is also a tone control. Inspect the instrument before changing it.

---

# 9. CHORD SOUND DESIGN

Compose on a sound that exposes harmony.

First-pass instrument options:

- Ableton piano;
- simple Analog/Wavetable patch;
- low-complexity pluck.

Do not write harmony through a huge, modulated, washed-out preset.

After the MIDI works:

## 9.1 Pluck starter patch

`[AGENT-DEFAULT]`

Using Wavetable or Analog:

```text
Oscillator: saw or saw-like
Voices: 4–8 if unison is available
Filter: LP
Amp attack: 0–10 ms
Amp decay: 250–600 ms
Amp sustain: 0–30%
Amp release: 80–250 ms
Filter envelope: positive
Filter envelope decay: 150–500 ms
```

Tune by phrase length.

If chord notes smear into the next chord, shorten **release first**.

## 9.2 Pad starter patch

```text
Attack: 20–120 ms
Decay: 1–3 s
Sustain: 50–90%
Release: 0.5–2.5 s
```

High-pass only enough to stop the pad competing with bass. Do not automatically cut it at an arbitrary high frequency.

## 9.3 Chord processing order

Default:

```text
Instrument
-> EQ Eight
-> Saturator if needed
-> Chorus-Ensemble / width only if needed
-> sends to reverb/delay
```

Do not insert five effects because a chain looks "professional."

---

# 10. KICK: BUILD THE GRID ANCHOR

For the tutorial's house / tech-house context, begin with four-on-the-floor:

```text
Beat: 1 2 3 4
Kick: X X X X
```

The kick is the timing reference.

## 10.1 Kick rules

- keep timing straight;
- keep MIDI velocity consistent unless the sample/instrument genuinely needs variation;
- do not apply swing to the main kick;
- use one strong core kick before layering.

## 10.2 Sample length

Inspect the waveform.

If the kick tail overlaps the next important bass attack:

1. shorten the kick sample envelope;
2. or move/shorten the bass;
3. or change sample;
4. then use EQ if a tonal overlap still exists.

Do not use sidechain compression as the first cure for a kick sample that is simply too long.

## 10.3 Kick tuning

Do not force a kick to the song tonic if doing so ruins its transient/body relationship.

Instead:

- identify the kick body's prominent low-frequency resonance;
- make sure it does not produce an objectionable beating/clash with sustained sub notes;
- choose the kick primarily for shape and role.

---

# 11. BASS: DERIVE IT FROM HARMONY, THEN ADD GROOVE

Create `BASS_roots_v01`.

Copy the harmonic roots first.

If chords are:

```text
Gm | Eb | Bb | F
```

begin bass with:

```text
G | Eb | Bb | F
```

No cleverness yet.

## 11.1 Separate sub and mid-bass roles

Use:

```text
BASS_SUB = fundamental / low harmonics / mono
BASS_MID = character / distortion / audible groove
```

Do not duplicate two full-spectrum bass patches and hope EQ fixes them.

## 11.2 Sub patch

Simple starting patch:

```text
wave: sine or low-harmonic triangle
attack: 0–5 ms
decay: controlled by note duration
sustain: high
release: 30–100 ms
mono: on
glide: off unless deliberately required
```

If clicks occur, increase attack/release slightly rather than masking them with reverb.

## 11.3 Bass rhythm

Once root pitches are correct, create `BASS_groove_v02`.

Start by leaving the kick's transient area open.

Example 16th grid:

```text
1e&a 2e&a 3e&a 4e&a
K--- K--- K--- K---
--B- --B- --B- -BB-
```

This is an example, not a mandatory pattern.

The bass can:

- answer the kick;
- anticipate the next beat;
- use short syncopated root notes;
- use occasional chord-tone/passing notes.

### Structural-note rule

On the strongest harmonic moments, favor chord roots.

Non-root bass notes must have a defined function:

```text
passing tone
approach tone
fifth
octave
deliberate inversion
```

If the agent cannot name the function, remove the note and compare.

---

# 12. KICK/BASS DUCKING

Use Ableton Compressor sidechain only after rhythmic arrangement is sensible.

Route:

```text
BASS group
-> Compressor
-> Sidechain input: KICK
```

Starting values `[AGENT-DEFAULT]`:

```text
Ratio: 4:1
Attack: 0.1–2 ms
Release: 70 ms
Threshold: lower until ~3 dB gain reduction on kick hits
```

Then tune release using tempo.

Quarter-note duration:

```text
quarter_ms = 60000 / BPM
```

16th-note duration:

```text
sixteenth_ms = quarter_ms / 4
```

At 128 BPM:

```text
quarter ≈ 468.75 ms
16th ≈ 117.19 ms
```

Test releases:

```text
~60 ms
~90 ms
~115 ms
```

Keep the shortest value that lets the bass recover naturally before its important note.

### Sidechain failure conditions

Reject the setting if:

- bass audibly sucks in after every kick when that is not a desired effect;
- bass never recovers fully;
- kick loses apparent size because low-end energy becomes inconsistent;
- the groove feels weaker with compression than with simple note editing.

---

# 13. DRUM FOUNDATION

Build drums in this order:

```text
kick
-> clap/snare
-> closed hat
-> open hat
-> primary percussion
-> shaker
-> optional extra percussion
```

Do not search for ten percussion sounds before the kick/hats groove.

## 13.1 Clap/snare

For house:

```text
Beat: 1 2 3 4
Clap: - X - X
```

Layer only when each layer has a distinct job.

Possible roles:

```text
layer A = transient
layer B = body
layer C = width/noise
```

High-pass the width/noise layer if it contains unnecessary low energy.

## 13.2 Open hat

Start on offbeats:

```text
1 & 2 & 3 & 4 &
  H   H   H   H
```

Set note/sample length so it does not smear into the next kick.

## 13.3 Closed hats

Start with 1/8 or 1/16 notes.

Do not make every hit equally loud unless a rigid machine feel is deliberate.

---

# 14. VELOCITY = GROOVE, NOT RANDOMNESS

**[VIDEO-INDEXED]** The tutorial is indexed with the technique **"Adjust percussion velocities for groove variation"**: varying percussion velocities prevents a static, lifeless loop.

Translate that into deterministic programming.

## 14.1 Shaker pattern

For 1/16 shaker notes, first test this repeating four-hit velocity cell:

```text
92, 58, 76, 64
```

Second candidate:

```text
88, 62, 80, 55
```

Third candidate:

```text
96, 68, 82, 62
```

Do not use all three. Audition and choose one.

### Rule

Strong grid positions should generally be stronger than ghost/interstitial positions.

## 14.2 Closed hats

Start:

```text
90, 68, 82, 62
```

Then manually accent one event that supports the phrase.

## 14.3 Humanization limits

For tightly programmed house:

- main kick timing jitter: **0 ms**
- clap/snare timing jitter: usually **0 ms** initially
- shaker/auxiliary percussion: timing variation only after velocity works
- maximum manual timing offsets first pass: approximately **±5 ms**

Large "humanization" can destroy club groove.

The goal is hierarchy, not sloppiness.

---

# 15. SWING / GROOVE POOL

Swing should be controlled globally enough that rhythmic elements agree.

## 15.1 Procedure

1. Keep kick unswung.
2. Add a 16th-note swing groove to the Groove Pool.
3. Apply it to shaker, selected hats, percussion and possibly bass.
4. Test three strengths rather than guessing:

```text
52%
55%
58%
```

If using a Groove Pool template where the displayed convention differs, treat those values as *candidate swing intensity*, not universal numeric equivalence.

## 15.2 Commit test

A/B at equal loudness.

Keep swing only if:

- head nod / forward motion improves;
- kick remains authoritative;
- bass and percussion feel like one pocket;
- notes do not sound late.

If bass feels late, reduce its groove amount separately before removing swing from percussion.

---

# 16. PERCUSSION SOUND DESIGN: REDUX SHAKER TECHNIQUE

This is one of the concrete tutorial details independently indexed.

**[VIDEO-INDEXED ~42:44]** Apply Ableton **Redux** / bitcrushing to shaker layers to add harmonic texture/grit.

**[VIDEO-INDEXED ~43:26]** After bitcrushing, cut unwanted low frequencies so the generated harmonics/noise do not muddy the mix.

## 16.1 Exact agent chain

On `PERC_SHAKER`:

```text
Shaker source
-> Redux
-> EQ Eight
-> optional Utility
```

## 16.2 Redux starting test

Because the exact inaccessible video knob values are not being fabricated, use this bounded search:

### Pass 1

```text
Dry/Wet: 10%
```

Increase bit/sample reduction until the timbral change is just clearly audible in the full mix.

### Pass 2

```text
Dry/Wet: 20%
```

Repeat.

### Pass 3

```text
Dry/Wet: 30%
```

Repeat.

Choose the least processed version that gives audible extra texture.

If Redux is being used 100% wet, duplicate the track or use an Audio Effect Rack so the clean transient can be compared/mixed reliably.

## 16.3 Post-Redux low cleanup

Place EQ Eight **after Redux**.

Start:

```text
High-pass:
24 dB/oct
180 Hz
```

Then sweep the cutoff between:

```text
120 Hz
180 Hz
250 Hz
300 Hz
```

Stop increasing the cutoff when one more step makes the shaker audibly thinner in its useful body.

The purpose is not "high-pass every shaker at 300 Hz"; the purpose is to remove low junk created or emphasized by processing while retaining useful character.

## 16.4 A/B rule

Because distortion often sounds "better" merely because it is louder:

1. bypass Redux + EQ;
2. match perceived level with Utility/output gain;
3. switch repeatedly in context;
4. keep processed version only if it adds texture without adding harshness or low-mid clutter.

---

# 17. HOOK / LEAD WRITING

Do not write a lead melody independently of the harmony.

## 17.1 Create melodic constraints

Before adding notes, define:

```text
key:
scale:
chord tones per bar:
available register:
rhythmic density:
```

Strong-beat note priority:

```text
1. chord tone
2. extension that belongs to chord
3. scale passing tone resolving quickly
4. deliberate chromatic approach
```

## 17.2 Derive from top voice

First candidate:

- copy the chord progression's top notes;
- turn them into a rhythm;
- add neighboring scale tones between them.

This guarantees harmonic connection.

## 17.3 Motif rule

Write a **1- or 2-bar motif**, not an 8-bar stream of unrelated notes.

Then:

```text
bars 1–2: motif A
bars 3–4: motif A'
```

A' should change only one or two properties:

- final note;
- final rhythm;
- octave;
- one passing tone.

## 17.4 Density cap

First version:

- no more than **8 primary note attacks per bar**;
- if every 16th has a melodic note, justify why.

Silence is part of the hook.

---

# 18. VOCAL / SAMPLE HANDLING

If using a vocal sample:

1. determine original BPM if metadata is available;
2. Warp in Ableton;
3. align phrase downbeats manually;
4. check consonants/transients, not just waveform length;
5. transpose to the song key only if required;
6. verify formants/timbre after transposition.

Do not assume automatic Warp markers are musically correct.

## Vocal harmony

If creating a harmony double:

- duplicate the vocal;
- move harmony to a chord-compatible 3rd, 5th, or other intentional interval;
- do not mechanically pitch every syllable by the same interval if chord changes make the harmony wrong;
- lower the harmony relative to the lead;
- process both through a vocal group when shared dynamics are needed.

---

# 19. SPACE: REVERB AND DELAY

Prefer return tracks for shared space.

## 19.1 Short room return

Start `[AGENT-DEFAULT]`:

```text
Decay: 0.4–0.8 s
Pre-delay: 5–20 ms
Low cut: 150–300 Hz
High cut: 8–14 kHz
Return wet: 100%
```

Send drums/percussion sparingly.

## 19.2 Long reverb

Start:

```text
Decay: 1.5–3.0 s
Pre-delay: 15–40 ms
Low cut: 200–400 Hz
High cut: 6–12 kHz
Return wet: 100%
```

Automate send amount rather than drowning the entire track.

## 19.3 Delay

Use tempo divisions:

```text
1/8
1/8 dotted
1/4
```

Test only those three first.

High-pass/low-pass the delay return to keep repeats out of kick/sub territory and out of brittle highs.

## 19.4 Reverb-tail test

Solo is irrelevant.

In context:

- mute the dry source;
- listen to return tail;
- verify it decays before the next section where space should clear.

If transition impact is lost, shorten decay or automate send down before the hit.

---

# 20. BUILD THE 8-BAR LOOP BEFORE ARRANGEMENT

The 8-bar loop must contain enough information to prove the track.

Required elements:

```text
kick
core bass
main chord/harmonic identity
primary hook or vocal identity
basic clap/snare
one hat role
one groove/percussion role
```

Optional:

```text
FX
pads
second lead
extra percussion
```

## 20.1 Eight-bar variation

Bars 1–4:

- state the idea cleanly.

Bars 5–8:

change only one or two of:

- final bass note;
- final chord voicing;
- percussion fill;
- hook ending;
- short FX pickup;
- chord suspension.

Do not write a completely different second half.

---

# 21. ARRANGEMENT: CONTRAST, NOT COPY/PASTE

Once the loop works, move to Arrangement View.

A practical club-oriented starting map `[AGENT-DEFAULT]`:

```text
1–16      Intro
17–32     Groove / teaser
33–48     Build / pre-drop
49–80     Drop 1
81–96     Breakdown
97–112    Build 2
113–144   Drop 2
145–160   Outro
```

This is a template to edit, not a law.

## 21.1 Section purpose

### Intro

Needs:

- DJ-readable pulse;
- limited harmonic density;
- recognizable texture;
- no premature full drop.

### Groove / teaser

Introduce:

- bass or partial bass;
- more percussion;
- a fragment of the hook.

### Build

Increase tension through:

- subtraction immediately before key events;
- filter opening;
- shorter rhythmic subdivisions;
- riser;
- snare/clap acceleration if genre-appropriate;
- increased reverb send;
- pitch rise.

### Drop

Impact comes from contrast.

Restore:

- full low end;
- core kick;
- bass;
- principal hook;
- most important percussion.

Do not make the drop "bigger" only by adding ten new layers.

### Breakdown

Remove or reduce:

- kick;
- sub;
- dense percussion.

Expose:

- harmony;
- vocal;
- atmosphere;
- melodic identity.

### Drop 2

Do not copy Drop 1 unchanged.

Change one or more:

- extra percussion layer;
- hook octave;
- alternate fill;
- chord rhythm;
- counterline;
- vocal chop;
- FX response.

---

# 22. THE 8-BAR CHANGE RULE

At every 8-bar boundary, inspect whether the listener receives a meaningful change.

A meaningful change can be:

```text
element enters
element exits
pattern variation
fill
automation event
transition FX
harmonic variation
hook variation
```

Do **not** force a change every 8 bars if it harms hypnosis/groove.

The rule is an inspection trigger, not a mandatory decoration trigger.

The agent should log:

```text
Bar 1:
Bar 9:
Bar 17:
Bar 25:
...
```

and name the audible delta.

If it cannot name a delta across multiple phrase boundaries, evaluate whether the arrangement is too static.

---

# 23. TRANSITIONS

Transitions need a before/after relationship.

## 23.1 Riser

Automation:

```text
pitch: upward
filter: opens
level: rises
reverb: may rise
```

End the riser **at or just before** the target section boundary.

## 23.2 Impact

Place on the first beat of the new section.

High-pass any unnecessary low tail if it conflicts with kick/sub.

## 23.3 Reverse cymbal

End transient exactly on the target downbeat.

Trim silence before the swell.

## 23.4 Reverb throw

On the final word/note:

1. automate send up for the last event;
2. return to normal immediately after;
3. allow tail to bridge the transition.

## 23.5 Silence

Before a drop, test:

```text
1/16 beat gap
1/8 beat gap
1/4 beat gap
```

Choose the shortest gap that meaningfully increases impact.

Silence often works better than another effect.

---

# 24. AUTOMATION

Automation must serve structure.

Good candidates:

```text
filter cutoff
reverb send
delay send
noise/riser level
instrument macro/timbre
bass filter
stereo width above the low end
```

## 24.1 Automation shape rule

Every curve needs:

```text
start value
end value
start bar
end bar
reset point
```

Example:

```text
CHORDS filter:
bar 33: 700 Hz
bar 48: 8 kHz
bar 49: reset to drop value
```

Never leave a buildup automation lane accidentally stuck open for the rest of the arrangement.

---

# 25. MIXING ORDER

Do not start with mastering.

Mix in this order:

```text
1. arrangement
2. sound choice
3. static levels
4. panning / width
5. low-end relationship
6. subtractive EQ
7. dynamics
8. saturation / character
9. ambience
10. automation
11. bus processing
12. master check
```

If step 2 is bad, step 6 should not be used to rescue it indefinitely.

---

# 26. STATIC BALANCE

Before EQ:

1. disable unnecessary master processing;
2. pull channels down;
3. establish kick;
4. bring in bass;
5. add clap/snare;
6. hats/percussion;
7. chords;
8. hook/vocal;
9. FX.

Listen quietly.

If the hook disappears at low monitor level, fix level/arrangement before adding exciters.

---

# 27. LOW-END MANAGEMENT

The low end should have a role hierarchy.

At any instant ask:

```text
What owns the deepest energy?
kick?
sub?
impact?
```

There should be an answer.

## 27.1 Mono

Keep sub information centered.

If widening `BASS_MID`, ensure the true sub component remains mono/centered.

## 27.2 High-pass policy

Do not high-pass everything by habit.

For each non-bass track:

1. inspect/listen for unwanted low energy;
2. raise HP cutoff until useful body begins to thin;
3. back off.

For a shaker after Redux, the tutorial specifically supports low-frequency cleanup.

For a piano/chord pad, the correct cutoff depends on voicing and arrangement.

---

# 28. EQ: PROBLEM FIRST

Before adding EQ Eight, write the problem.

Allowed examples:

```text
"Shaker has low rumble after Redux."
"Chord body masks bass around low mids."
"Lead has a narrow harsh resonance."
"Clap contains unnecessary sub energy."
```

Disallowed:

```text
"Needs EQ."
```

## 28.1 Narrow resonance procedure

1. identify whether the resonance is audible without solo;
2. use a temporary narrow boost to find it;
3. turn the boost into a cut;
4. reduce cut depth until the problem just stops distracting;
5. bypass at matched level.

Do not carve dozens of visual spectrum peaks.

---

# 29. COMPRESSION

Compression needs a job.

Possible jobs:

```text
sidechain ducking
transient control
level consistency
bus cohesion
intentional pumping
```

Before adding Compressor write:

```text
Job:
Detection source:
Desired gain reduction:
Why clip/volume automation cannot do it more simply:
```

If there is no answer, skip compression.

---

# 30. SATURATION / DISTORTION

Use saturation to add harmonics, density or controlled aggression.

Starting test:

```text
Saturator:
Drive 1 dB
Drive 3 dB
Drive 6 dB
```

Level-match output after each.

Choose the lowest drive that achieves the goal.

Do not equate louder with better.

On sub-bass, added harmonics can improve audibility on smaller systems, but keep the low fundamental stable and centered.

---

# 31. STEREO WIDTH

Width is not "turn Utility Width to 200%."

Layer by function.

Example:

```text
sub:       mono
mid bass:  moderate width
chords:    stereo
hook:      central identity + stereo effects
hats:      distributed
FX:        wide
```

## 31.1 Mono test

At least once per mix pass:

1. collapse master monitoring to mono;
2. verify hook, kick, bass, clap and core harmony remain legible;
3. if an element vanishes, inspect phase/width processing.

Do not compensate for phase cancellation merely by increasing level.

---

# 32. REFERENCE TRACK METHOD

Use one or two references in the same rough style.

Import reference audio onto a track:

```text
REF_01
```

Route so it is not affected by your mix bus/master processing if possible.

Level-match approximately.

Compare:

```text
kick weight
bass-to-kick ratio
vocal/hook prominence
hat brightness
midrange density
stereo width
breakdown/drop contrast
overall arrangement timing
```

Do not try to copy the waveform or spectrum exactly.

Use the reference to answer specific questions.

---

# 33. DROP-IMPACT DIAGNOSTIC

If the drop does not hit, do not immediately add a limiter.

Check in this order:

1. **Was low end removed/reduced before the drop?**
2. **Is there enough pre-drop contrast?**
3. **Do kick and bass begin decisively?**
4. **Is the hook already overexposed in the build?**
5. **Is there a small pre-drop gap?**
6. **Is the drop too reverberant?**
7. **Are too many layers masking the transient?**

Fix the earliest failing condition.

---

# 34. CHORD DIAGNOSTICS

## Problem: chords are muddy

Check:

1. Are low chord tones packed too closely?
2. Is the bass duplicating the chord root in the same register?
3. Is synth release too long?
4. Is reverb low end uncontrolled?
5. Only then use EQ.

Actions:

```text
move lowest chord tone +12 semitones;
or omit root from chord layer;
shorten release 20–40%;
high-pass reverb return;
then modestly high-pass chord layer if needed.
```

## Problem: chords feel weak

Check:

- root definition;
- third audibility;
- voicing spread;
- bass alignment.

Do not solve weak harmony by adding five unison layers.

## Problem: progression jumps around

Run inversion algorithm again.

Preserve common tones.

Constrain top voice.

## Problem: progression is boring

Try, in this order:

1. improve top-voice contour;
2. change rhythm;
3. add one seventh;
4. add one suspension/resolution;
5. add a ninth selectively;
6. only then try a replacement/borrowed chord.

## Problem: chord clashes with bass

At the exact clash position:

- identify bass pitch;
- identify active chord notes;
- identify interval;
- determine whether bass is root/chord tone/passing tone;
- shorten or move the passing note if it occupies the chord change too long.

## Problem: harsh upper extension

Move the extension +12 semitones or remove a nearby inner note.

Spacing can fix harshness without changing chord identity.

---

# 35. BASS DIAGNOSTICS

## Bass is muddy

- shorten note length;
- check kick overlap;
- remove unnecessary sub from mid-bass layer;
- inspect release;
- check two bass layers for phase interaction.

## Bass is weak on small speakers

- add controlled harmonics to mid-bass;
- do not simply raise sub below the playback system's usable range.

## Bass groove is late

- reduce swing/groove amount on bass;
- keep percussion swing if it works;
- check sidechain release.

## Bass changes pitch but groove disappears

Use repeated rhythm cell across chord changes before introducing per-chord variation.

---

# 36. DRUM DIAGNOSTICS

## Hats sound robotic

Before timing randomization:

1. use velocity hierarchy;
2. vary sample length slightly if appropriate;
3. apply controlled swing;
4. only then add very small timing offsets.

## Percussion sounds busy

Mute every second auxiliary element.

If groove improves, do not restore them all.

## Shaker disappears

Check:

- transient;
- velocity;
- useful high-mid content;
- Redux texture;
- level.

Do not brighten it indefinitely if another hat already occupies that range.

---

# 37. FX / EAR-CANDY BUDGET

Ear candy is a structural accent, not constant decoration.

Per 8 bars, start with a maximum of:

```text
1 transition event
+
1 micro-variation
```

Examples:

```text
reverse hit
single vocal throw
one-bar percussion fill
brief delay throw
micro mute
one-shot texture
```

If the listener cannot identify the main groove because of constant events, remove FX.

---

# 38. MASTER-BUS RULES DURING PRODUCTION

Do not use a loud master to disguise a weak mix.

During writing/mixing:

- avoid heavy limiting;
- avoid large EQ corrections;
- keep master from clipping.

A useful working target `[AGENT-DEFAULT]` is peaks roughly in the **-6 to -3 dBFS** area before final mastering, but this is not a magic requirement. The real requirement is clean headroom and no accidental clipping.

If a master limiter is present for vibe:

1. keep a bypassable version;
2. regularly check the mix without it.

---

# 39. VALIDATION PASSES

The agent must perform these checks before calling the track "done."

## 39.1 Harmonic pass

Verify:

- scale/key known;
- every chord note intentional;
- every non-scale note intentional;
- bass structural notes agree with harmony;
- top voice has a deliberate contour.

## 39.2 Groove pass

Verify:

- kick is straight;
- swing is applied intentionally;
- percussion velocities are not all identical;
- bass groove locks with kick;
- no excessive timing randomization.

## 39.3 Low-end pass

Verify:

- kick and bass roles are distinct;
- sub is centered;
- no uncontrolled overlap from impacts/reverbs;
- bass recovers naturally after sidechain.

## 39.4 Arrangement pass

At each 8- or 16-bar phrase boundary:

- identify what changes;
- verify the change serves energy direction.

## 39.5 Processing pass

For every major effect:

- bypass;
- level-match;
- decide whether the processed version is genuinely better.

Delete effects that fail.

## 39.6 Mono pass

Core elements must survive mono:

```text
kick
bass
clap/snare
main chord identity
main hook/vocal
```

## 39.7 Low-volume pass

At low monitoring level, the hierarchy should still be:

```text
groove
main hook/vocal
harmonic support
detail
```

If detail dominates the hook, rebalance.

---

# 40. CODEX EXECUTION STATE MACHINE

The agent should behave like this:

```text
START
  |
  v
INSPECT_PROJECT
  |
  +-- existing strong idea? --yes--> PRESERVE_AND_EXTEND
  |                               |
  no                              |
  |                               |
  v                               |
SET_TEMPORARY_PROJECT_STATE <------+
  |
  v
BUILD_ROOT_MOTION
  |
  +-- convincing without FX? --no--> REWRITE_ROOT_MOTION
  |
 yes
  |
  v
BUILD_TRIADS
  |
  v
OPTIMIZE_INVERSIONS
  |
  v
DESIGN_TOP_VOICE
  |
  v
TEST_EXTENSIONS
  |
  v
BUILD_KICK
  |
  v
BUILD_ROOT_BASS
  |
  v
RHYTHMIZE_BASS
  |
  v
BUILD_DRUMS
  |
  v
ADD_VELOCITY_HIERARCHY
  |
  v
TEST_SWING
  |
  v
ADD_HOOK
  |
  v
BUILD_8_BAR_LOOP
  |
  +-- hook/groove works? --no--> FIX EARLIEST FAILED LAYER
  |
 yes
  |
  v
ARRANGE
  |
  v
ADD_TRANSITIONS
  |
  v
STATIC_MIX
  |
  v
LOW_END_PASS
  |
  v
EQ / DYNAMICS / SPACE
  |
  v
VALIDATE
  |
  +-- fail --> RETURN TO FAILED STAGE
  |
 pass
  |
  v
SAVE_VERSION
```

---

# 41. REQUIRED CHECKPOINT OUTPUTS FROM THE AGENT

After harmony:

```text
Key:
Scale notes:
Root progression:
Roman numerals:
Triad notes:
Chosen inversions:
Top voice:
Extensions used:
Reason for each extension:
```

After groove:

```text
Kick pattern:
Bass pattern:
Bass note lengths:
Sidechain GR:
Swing source:
Swing strength:
Percussion velocity patterns:
Redux shaker used?:
Post-Redux HPF:
```

After arrangement:

```text
Section map:
Primary element added/removed at each section:
Pre-drop contrast:
Drop 2 variation:
Transition events:
```

After mix:

```text
Kick peak/role:
Bass role:
Sub mono status:
Main masking problems fixed:
Major EQ moves and reasons:
Compression jobs:
Reverb returns:
Mono check:
Reference check:
```

If the agent cannot fill these fields, it has not done enough analysis.

---

# 42. "NO HAND-WAVING" TRANSLATION TABLE

| Vague instruction | Agent must translate it into |
|---|---|
| Make chords richer | Test 7th on chord 1/2, then 9th on one chord, A/B against triads |
| Make chords smoother | Generate inversions, minimize semitone movement, preserve common tones |
| Add groove | Set velocity cell; test swing 52/55/58%; keep kick straight |
| Humanize drums | Velocity hierarchy first; percussion timing ≤ about ±5 ms only if needed |
| Make bass punchier | Shorten notes/release; inspect kick overlap; tune sidechain recovery |
| Make drop bigger | Increase contrast before drop; restore low end; remove masking; then consider layers |
| Clean low end | Identify owner; shorten tails; remove duplicate lows; sidechain; EQ last |
| Add character | Pick one method: Saturator, Redux, filter drive; level-match A/B |
| Make it wider | Widen only non-sub role; mono-test; reject phase loss |
| Add movement | Automate a named parameter from value A to B over named bars |
| Add ear candy | One structural accent + one micro-variation per 8 bars as starting budget |
| Fix harshness | Identify exact offender/resonance; reduce source/spacing first, then EQ |
| Fix mud | Correct voicing/register/tails/arrangement before broad EQ cuts |
| Make percussion organic | velocity hierarchy + controlled swing, not arbitrary randomization |

---

# 43. FAILURE MODES THE AGENT MUST AVOID

## 43.1 Adding layers instead of fixing composition

If the hook is weak, do not layer it six times.

Fix:

- notes;
- rhythm;
- contour;
- sound role.

## 43.2 Solving arrangement with automation

A filter sweep cannot rescue a section that contains the wrong elements.

## 43.3 Solving sound selection with EQ

If a kick needs 12 dB of EQ in several bands to fit, choose a better kick.

## 43.4 Overcomplicating chords before voice-leading

A well-voiced triad often beats a badly voiced ninth chord.

## 43.5 Random velocity everywhere

Dynamics must reinforce meter and groove.

## 43.6 Swinging everything

Kick remains the anchor.

## 43.7 Processing in solo

Sound-design in solo when necessary, but make keep/delete decisions in context.

## 43.8 Treating visible spectrum peaks as problems

Only cut what causes an audible problem.

## 43.9 Over-filling every frequency

Professional tracks contain deliberate gaps.

---

# 44. MINIMUM VIABLE COMPLETE TRACK

A track is not complete because it has many channels.

Minimum musically complete set:

```text
kick
bass
clap/snare
hat/percussion groove
harmonic identity
main hook/vocal
arrangement contrast
transitions
balanced mix
```

Everything else must justify its existence.

---

# 45. DETAILED ONE-PASS AGENT PROCEDURE

Use this if the agent needs a literal sequence.

## Pass A — Compose

1. Set/confirm BPM.
2. Set/confirm key.
3. Create 8-bar loop.
4. Write root progression.
5. Score root candidates.
6. Build triads by scale-note stacking.
7. Generate inversions.
8. Minimize voice movement.
9. shape top voice.
10. test selective 7ths/9ths/sus.
11. save chord version.
12. add kick.
13. copy chord roots to bass.
14. reshape bass rhythm around kick.
15. add clap/snare.
16. add offbeat/open hat.
17. add closed hat/shaker.
18. set velocity hierarchy.
19. test swing.
20. add/derive hook.
21. make bars 5–8 variation.
22. listen with no master processing.

## Pass B — Sound design

1. choose/shape kick.
2. separate sub and mid-bass roles.
3. shape chord envelope.
4. shape hook envelope.
5. add Redux texture to shaker if appropriate.
6. clean low frequencies after Redux.
7. set reverb/delay returns.
8. keep the fewest useful layers.

## Pass C — Arrange

1. copy loop to arrangement skeleton.
2. remove elements to form intro/breakdown.
3. reserve full bass/drop combination for impact sections.
4. create builds through density/tension.
5. add transitions.
6. create Drop 2 variation.
7. inspect each 8/16-bar boundary.

## Pass D — Mix

1. static balance.
2. kick/bass interaction.
3. sidechain only as needed.
4. fix register/tails.
5. subtractive EQ.
6. dynamics.
7. saturation.
8. ambience.
9. width.
10. automation.
11. mono test.
12. low-volume test.
13. reference A/B.

## Pass E — Quality control

1. bypass every nonessential effect.
2. delete effects that do not improve the track.
3. verify no clipping.
4. verify no accidental automation states.
5. verify chord/bass harmony.
6. verify bar transitions.
7. save new version.
8. render a premaster.

---

# 46. OPTIONAL MACHINE-READABLE PROJECT STATE

Codex can maintain a state file alongside the Ableton project:

```yaml
project:
  bpm: null
  key: null
  scale: null
  style: "house / tech-house"
  loop_bars: 8

harmony:
  roots: []
  roman_numerals: []
  chords: []
  voicings: []
  top_voice: []
  extensions: []

bass:
  root_notes: []
  rhythm: []
  sub_mono: true
  sidechain:
    enabled: false
    source: "KICK"
    gain_reduction_db: null
    release_ms: null

groove:
  kick_swung: false
  groove_name: null
  groove_amount: null
  shaker_velocity_pattern: []

arrangement:
  sections: []
  eight_bar_deltas: []

mix:
  unresolved_masking: []
  mono_check: null
  reference_check: null

version:
  harmony: 0
  groove: 0
  arrangement: 0
  mix: 0
```

The agent should update this rather than relying on memory.

---

# 47. SOURCE-SPECIFIC TAKEAWAYS TO PRESERVE

The following are the source-linked ideas that should survive even if the track style changes:

1. The tutorial is presented as a **stock Ableton Live 12 House / tech-house production workflow**.
2. Harmony should be built from actual key/scale relationships rather than random chord-shape movement.
3. Percussion should use **velocity variation** rather than identical MIDI dynamics.
4. **Redux / bitcrushing on shaker percussion** is used as a texture/harmonic technique.
5. Bitcrushing is followed by **low-frequency cleanup** to prevent mud.
6. The production process should move from musical foundation to detail; processing is not a substitute for writing.

---

# 48. SOURCE AND PROVENANCE NOTES

## User-supplied source

- `https://www.youtube.com/watch?v=y761dC0qT_M`

## Search-indexed EDM Tips tutorial used to verify the tutorial context

Search indexing exposes:

- **EDM Tips — "Make Professional EDM Music From SCRATCH in 10 Simple Steps"**
- House / tech-house context
- Ableton Live 12 stock-plugin workflow

The index currently surfaces a different YouTube ID (`e_JoILUJaNo`), so this document does **not** claim that the two IDs are definitively identical. It uses that listing only to corroborate tutorial title/context.

## Timestamp-indexed tutorial techniques

ProducerVault indexes these techniques against the EDM Tips tutorial:

- around **42:44** — Redux / bitcrushing on shaker layers for added harmonic texture.
- around **43:26** — cut low frequencies after the bitcrushing stage to prevent mud.
- percussion velocity variation for groove and to avoid a static feel.

## EDM Tips chord-theory cross-checks

Used to make the tutorial-style chord workflow executable rather than vague:

- `https://edmtips.com/how-to-make-chords/`
- `https://edmtips.com/how-to-make-killer-chord-progressions/`
- `https://edmtips.com/5-chord-progressions-every-music-producer-needs-to-know/`
- `https://edmtips.com/how-to-make-music-like-deadmau5-in-under-10-minutes/`

These sources support the explicit chord formulas, scale-note stacking, 7ths/9ths, suspended chords and inversion method in this guide. They are **same-creator cross-checks**, not claimed as verbatim lines from the linked video.

---

# 49. FINAL OPERATING PRINCIPLE

The Codex agent should repeatedly ask:

```text
What musical problem am I solving?
What exact Ableton edit solves it?
What value/rule will I start with?
What will I hear if it works?
How will I A/B it?
What will I undo if it fails?
```

If those questions cannot be answered, do not add the edit.

The goal is not to make the Ableton project *look* complex.

The goal is:

```text
strong harmony
+ clear root motion
+ smooth voicing
+ kick/bass lock
+ velocity-shaped groove
+ deliberate texture
+ contrast-driven arrangement
+ disciplined mix decisions
```

That is the standard the agent should optimize for.
