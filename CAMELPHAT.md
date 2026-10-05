# CAMELPHAT.md
## What the TPS x CamelPhat Producer Pack's MIDI teaches - melody first

### Source and method

The pack's 120 MIDI files, one per preset, at
`D:/samples/TPS x CamelPhat - Producer Pack/.../TPS x CamelPhat - MIDI Files/`
(`Diva Presets/` 60, `Serum 2 Presets/` 60, all distinct):

| Prefix | Role | Files |
|---|---|---|
| `LD` | lead | 34 |
| `PL` | pluck | 29 |
| `SY` | synth: chords, stabs, pads | 26 |
| `BS` | bass | 31 |

Every file is 124 BPM, 4/4, quantised to the 16th grid (0 % off-grid), 3-9 bars
long. Each file was parsed note by note. For monophonic roles the *line* is the
top note of each onset (the lowest for bass). All numbers below are measured
from the files. Quartiles are written 25/50/75.

**Read these as what they are.** They are 4-8 bar demo loops, written to show off
a patch, not whole-track melodies. They show how CamelPhat build a *cell*: its
rhythm, pitch set, length and register. They say nothing about arrangement
or development across a track.

**Octave names are Live's** (C3 = 60), as in the piano roll. MIDI numbers are
given alongside.

**The files carry no harmony.** A key-finder run on a lead alone calls the
lead's most-played note the tonic (25 of 34). That is circular, so pitch here is
measured against the line's **anchor**, its most-played note, which needs no
key. Whether the anchor is the tonic, the fifth or the third depends on the
chord under it, and that is the writer's choice.

---

# 1. The finding in one paragraph

A CamelPhat lead is **one anchor note, struck in a fixed syncopated rhythm,
with one or two other notes that leave it and come straight back.** It plays
about 4 distinct pitches inside an octave, mostly in the dotted-8th family of
rhythms, as short notes on a sustaining patch, around G2-E3 (MIDI 55-64). The
rhythm almost never changes from bar to bar, and the pitch changes a little.
Of the leads' leaps, 75 % go to or from the anchor, and only **7 %** continue
in the same direction as the leap before. These leads bounce off a pedal; they
do not climb an arpeggio. Our earlier leads were 48-73 % leaps tracing
arpeggios, an octave or two higher, on one thin oscillator. That is the
"plinky" sound (`docs/lessons.md`).

---

# 2. Leads (`LD`, 34 files)

## 2.1 Six kinds of lead

Read off each file's grid. The counts add up to 34.

| Kind | Files | What it is | Examples |
|---|---|---|---|
| **Pedal riff** | 10 | anchor on most hits; 1-3 notes above it (5th, 4th, b3, b6, b7) and back | Melancholia, Tune, Breeze, Spiritual, Vision, Window, Ultra, Network, Ride, Fragmented |
| **One-note rhythm** | 8 | a single pitch; the rhythm is the hook, with at most one passing note per bar or per 4 bars | Heaven, Spice, Compound, Round, Standing, Short, Play, Sun |
| **Octave figure** | 5 | anchor plus notes an octave or more above | Electronic, Fluid, Tunnel, Functional, Mixture |
| **Sparse phrase** | 4 | 2-4 notes, then a bar or more of rest | Coming, Frame, Aspects, Twilight |
| **Long-note line** | 4 | whole-bar notes moving by 1-2 semitones | Blind, Electricity, Serene, Shutter |
| **Shifted cell** | 3 | one cell transposed as the harmony moves | Powers, Horizons, Shifting |

Grids, as semitones from the anchor (`.` rest, `-` held):

```
Melancholia (pedal riff)      0  -  .  0  -  .  0  -  .  0  .  . +5  . +7  .
                              0  -  .  0  -  .  0  -  .  0  .  . +8  . +7  .
                              0  -  .  0  -  .  0  -  .  0  -  . +5  . +7  .
                              0  -  .  0  .  .  0  .  .  0  -  . +3  . +2  .

Spice (one-note rhythm)       0  -  .  0  -  .  0  -  0  -  .  0  -  . -2  -   (every bar)

Breeze (pedal riff)           0  -  .  0  -  . +3  -  0  -  .  0  -  . +2  -   (every bar)

Tune (pedal riff, Q/A)        0  -  .  0  -  .  0  -  .  0  -  .  .  .  .  .
                              0  -  .  0  -  . +3  -  . +3  -  . +2  -  .  .
                              0  -  .  0  -  .  0  -  .  0  -  .  .  .  .  .
                              0  -  .  0  -  . +5  -  . +5  -  . +3  -  .  .

Powers (shifted cell)        -7  .  .  0  . -4  .  . -7  .  .  0  . -4  .  .   (x2)
                             -2  .  . +1  .  0  .  . -2  .  . +1  .  0  .  .   (x2)
```

## 2.2 Rhythm

| Measure | Leads |
|---|---|
| Onsets a bar | 2.3 / **4** / 6 (10 files play exactly 6) |
| On the 3-3-2 steps (0 3 6 8 11 14) | 57 / **67** / 100 % |
| On the beat | 33 / 33 / 40 % - two-thirds of onsets are off the beat |
| Starts on the downbeat | 31 of 34 |
| **Same rhythm in every bar** | **18 of 34**; at most two rhythms in 32 of 34 |
| Bars identical in pitch too | 7 of 34 - the rhythm holds while the pitch moves |
| Loop | 4 bars in 21, 8 bars in 6; 12 files leave whole bars empty (A-B-) |
| Sounding time | 30 / **42** / 63 % of the loop has a note on |

**The rhythm cells.** These are whole-bar onset patterns shared by at least two files,
across all the monophonic roles (leads, plucks, bass; 94 files):

| Cell | Files | Reading |
|---|---|---|
| `x..x.x..x..x.x..` | 11 | 3-2-3, twice |
| `xxxxxxxxxxxxxxxx` | 10 | straight 16ths - bass rolls, two plucks, no leads |
| `x..x..x.x..x..x.` | 7 | **3-3-2, twice** (Heaven, Spice, Spiritual, Breeze, Compound) |
| `x..x..x..x..x...` | 7 | five dotted 8ths then a rest (Tune, Tunnel, Ultra, Window) |
| `x..x..x..x..x.x.` | 5 | dotted 8ths with a 2-step close (Melancholia) |
| `x..x..x.........` | 5 | three dotted 8ths, then half a bar of silence |
| `x..x.xx.x..x.xx.` | 4 | 3-2-1-2, plucks |

The half-bar `x..x..x.` (dotted, dotted, 8th) appears in **24 files**, 14 of
them leads, more than any other figure. The pack's syncopation is
dotted-8th syncopation, the same family GROOVE.md is built on.

**Velocity is not the accent.** 27 of 34 leads vary velocity (typically 78-109),
but the median velocity at each 16th position sits within 5 of the file's
mean, and the beat is not louder. The accent comes from *where* the notes fall.

## 2.3 Note length

| Gap to the next onset | Median note length |
|---|---|
| a 16th | a 16th |
| an 8th | a 16th |
| a dotted 8th | 1.5 16ths |
| 5 16ths | 2 16ths |

Lead notes are **short and nearly fixed in length**: median 0.20-0.75 beats in
30 of 34 files, whatever the gap. The pooled gate for gaps up to a beat is
0.43 / 0.53 / 0.79. No lead uses legato overlaps. Only the four long-note leads
have a median note of a beat or more.

The *sound* is not short: the Serum leads' amp sustain is 0.8 with release
~0.3 s, and chorus and delay follow (`docs/lessons.md`). So the line is
**staccato MIDI on a sustaining patch**. The note stays full for its 16th or
two, then the release and delay carry it. A pluck patch with the same notes
decays at once, and that difference is the "plinky" sound.

## 2.4 Pitch

| Measure | Leads |
|---|---|
| Distinct pitches | 3 / **4** / 5 (1 in five files; 14 in one, Horizons) |
| Range | 3 / **8** / 12 semitones - a fifth to an octave |
| Register | low 53 / 55 / 60, high 60 / 64 / 67 - **G2 to E3** (MIDI 55-64) |
| Anchor share of all onsets | 33 / **50** / 82 % |
| First note of a bar is the anchor | 75 % (downbeat note: 78 %) |
| Where the anchor sits | **lowest note in 16**, middle in 12, highest in 1, sole pitch in 5 |
| Fits one diatonic scale | 34 of 34; no chromatic passing notes |

**Intervals, pooled over all 633 lead intervals:** repeat 39 %, 1-2 semitones 15 %,
3-4 11 %, 5-7 18 %, 8-11 4 %, octave 2 %, beyond 10 %. The file medians are
repeat 21 %, step 20 %, leap 26 % (AGENTS.md). Files split into near-one-note
lines (13 have ≥ 50 % repeats) and bouncing lines (13 have ≥ 40 % leaps).

**The leaps bounce.** Of 220 leaps of 5 semitones or more, 36 % land on the
anchor, 39 % leave it, and 25 % do neither. Only **7 %** continue in the same
direction as the previous interval. A CamelPhat leap goes out and comes back.

**The notes around the anchor** (share of non-anchor onsets): **+7 17 %**, +2 9 %,
+3 8 %, +5 8 %, +8 7 %, -2 7 %, +10 6 %, +12 4 %, +15 4 %. Most moving notes sit
*above* the anchor: the anchor is a floor, and the line steps up from it and
falls back.

**Where the change happens.** It is not saved for the bar's tail or the phrase's
last bar. 44 % of non-anchor notes fall in the second half of a bar, and 27 %
in bar 4 of a 4-bar loop (25 % would be even). Some files do answer at the end
(Melancholia, Tune, Window, Spice's -2 on step 14), but it is not the rule.

**Colour.** Seven files touch the semitone above the anchor (Heaven, Powers,
Serene, Tunnel; Scale; the basses Losing, Sub). Over a chord rooted on the
anchor that is a Phrygian b2; over the anchor as the fifth it is a plain b6. Use
it on purpose, as MELODY.md 32 says about pedal tones.

---

# 3. Plucks (`PL`, 29 files)

Plucks are leads made even simpler:

- **1-bar loops** in 13 of 29, all 4 bars long. **11 are a single pitch**, and
  15 use at most two pitch classes.
- 6 onsets a bar (5.5 / 6 / 8). 25 of 29 start on the downbeat.
  64 % fall on the 3-3-2 steps.
- The anchor is the downbeat note 87 % of the time, and the lowest note in 14.
- Moving notes: **+5 24 %, +3 20 %, +12 13 %**, +7 7 %, +8 7 %. These are
  fourths, minor thirds and octaves: Exact `0 +3 +5`, End and Tweak `0 +3 0 +5`,
  Scale and What `0 +12`, Nemesis `0 +3 +12 / +8`.
- Leaps bounce even harder than in the leads: 94 % of them touch the anchor,
  and only 8 % chain.
- Notes are a 16th long whatever the gap (gate 0.50).
- The only arpeggio in the pack is **Fuse**, 16ths `0 +5 +8 +5 0 +8 +5 0`, a
  triad going up and down inside a sixth, one bar repeated.

A pluck is a percussive rhythm part with pitch. If it needs more than three
notes, it is probably a lead.

---

# 4. Synths: chords and stabs (`SY`, 26 files)

| Measure | Synths |
|---|---|
| Notes at once | 3 (11 files), 4 (8), 2 (6), 5 (1) |
| Loop | 4 bars (14), 8 bars (12) |
| Chord changes | **one every 2 bars**, or none |

**Voicings are open and thin, not stacked triads:**

- **Power-chord tonics.** The tonic chord has *no third* in 9 files: `0 12 19`
  (root, octave, fifth above it) - Edition, Mind, Trying, Swells, Align,
  Instead, Plans, Sustain, Smear.
- **Tenths and shells.** Thirds are placed an octave up: `0 15` (a minor tenth),
  `0 16 23` (major tenth plus major seventh) and `0 12 27`.
- **A major-seventh shell is the colour chord** in 5 files, on **bVI** in 4: a
  third-less i moving to bVI maj7, e.g. Mind `D5 -> Bbmaj7`, Trying
  `F5 -> Dbmaj7`, Align `G5 -> Ebmaj7`. Waiting runs **i - iv - III - VI(maj7)**
  (Fm Bbm Ab/C Dbmaj7), and Keep puts it on III (Bbm -> Dbmaj7).
- **Other moves:** i - bVII - bVI - bVII (Impactful: Am G F G), i - IV (Dimension:
  Bm E7sus), and a pedal under bVI and bVII (Hollow).

**Two rhythms.** Half the files hold chords for 2-8 bars (pads). The other half
are **16th stabs** (Mind, Trying, Using, Magician, Page, Plans, Smear) in the
same dotted families as the leads, e.g. Mind's chords on steps 0 3 6 9 12 14.
Every file starts on the downbeat.

A third-less tonic is what lets a lead's anchor sound like the tonic, the fifth
or neither. The harmony keeps the minor/major question open, and the bVI
maj7 answers it with colour, not with a cadence.

---

# 5. Bass (`BS`, 31 files)

| Measure | Bass |
|---|---|
| Polyphony | 1 in all 31 |
| Distinct pitches | 1 in 9 files; median 3 |
| Register | low 50 / 53 / 55, high 56 / 58 / 61 - **D2-A#2** (MIDI 50-58), as the MIDI is written; the patch sets the real octave |
| Intervals (pooled) | **repeat 54 %, octave 40 %**, everything else 6 % |
| Anchor on degree 1 by the key-finder | 28 of 31 (for bass this is not circular: a bass anchor is the root) |
| Loop | 4 bars (19), 8 bars (10); changes on 2-bar lines (AABB, AABBCCDD) |

Four shapes:

1. **Rolling 16ths** (8): every 16th, the root alternating with its octave
   (`0 12 0 12`: Stronger, Encore, Losing, Shadows, Life, Valley) or held flat
   (Feel, Listener). The root changes every 2 bars, mostly by a step (Shadows
   +2 to 0, Feel +2 to -2).
2. **Syncopated one-note riff** (10): the 3-2-3 cell `x..x.x..x..x.x..` and its
   relatives on one pitch (Fragments, Create, Ways, Memory, Sub, Rift, Tops,
   Storms, Someone, Coded). Rift steps its root down 0, -2, -4.
3. **Dotted pedal** (4): `x..x..x.` on one note, then silence or a pickup
   (Screen, Ignite, Path, Water). The bass states the figure and leaves half the
   bar empty.
4. **Held roots** (9): whole-bar or 2-bar notes, a reese or sub (Bridges,
   Eclipse, Embers, Shuffle, Star, Away, Kinetic, Coast, Warping).

**The bass plays on the kick.** 30 of 31 files start on step 0, and the rolls
fill every 16th. The pack leaves the kick/bass split to sidechain and the
filter envelope (`docs/lessons.md`: zero resonance, an envelope snapping
shut), not to the MIDI. Our KBBB roll (AGENTS.md *Basslines*) is the
MIDI-side version of the same result. Both are valid, and the user prefers ours.

---

# 6. Writing a CamelPhat lead - the procedure

Run it with MELODY.md (§5 rhythm before pitch, §31 repeated notes, §32 pedal
tones, §42 melodic techno) and GROOVE.md (one groove layer).

1. **Choose the kind** from 2.1. A drop hook is a pedal riff or a one-note
   rhythm. A breakdown or intro lead is a long-note line or a sparse phrase.
2. **Choose the anchor and the chord under it.** Over a third-less tonic, the
   anchor on the root is safe. The anchor on the fifth or third gives a
   different colour from the same notes. Check every chord against it
   (MELODY.md 32).
3. **Write the rhythm first, one bar,** from the cells in 2.2: `x..x..x.x..x..x.`,
   `x..x.x..x..x.x..` or `x..x..x..x..x...`. Start on the downbeat. Aim for 4-6
   onsets.
4. **Keep that rhythm in every bar**, or alternate two. Vary pitch, not rhythm.
5. **Pitch: the anchor on most hits** (about half the onsets, and the downbeat),
   plus 1-3 other notes from +7, +5, +3, +2, +8, +10, -2. A move away
   returns to the anchor on the next note. Never chain three leaps upward.
6. **Four bars, question and answer**: bars 1 and 3 alike, and bars 2 and 4
   carry the answer (Tune, Melancholia). Or leave bars 2 and 4 empty (A-B-).
7. **Register G2-E3** (MIDI 55-64), range a fifth to an octave. Let an
   octave-up layer (a second AF101) carry the top.
8. **Notes a 16th to a dotted 16th long**, on a patch with sustain ~0.8 and
   release ~0.3 s, into chorus and a 16th or dotted-8th delay.
9. **Groove check (GROOVE.md):** if this lead is dotted, it is the groove layer.
   Straighten everything else that moves, including a bass filter LFO.
10. **Measure it** against this file before calling it done. Use onsets a bar,
    anchor share, share on the 3-3-2 steps, leaps that bounce versus chain, and
    register. `docs/lessons.md` records that our leads failed exactly these.

**Passing the numbers is not enough.** Threshold's first CamelPhat-style lead
matched the pack's medians (5.8 onsets a bar, 100 % 3-3-2, gate 0.67) and was
still heard as "random, lacking emotion". It used six different bar patterns
with pitches changing on any step, and its anchor was the tonic over a tonic
chord. The rewrite fixed one rhythm for all 16 bars and moved pitch only on the
last two hits. It took a note with a story as the anchor (the orchestra's tuning
A) and let the chords move under it (5th, then maj7, then 6th). Check both: the
table below, then the idea - *what does the anchor mean, and how does that
meaning change?*

### Checks, as numbers

| Check | Pass |
|---|---|
| Onsets a bar | 2-6 |
| Anchor share | ≥ 33 % (median 50 %) |
| Downbeat note is the anchor | in most bars |
| On the 3-3-2 / dotted steps | ≥ 57 % |
| Distinct rhythms across the loop | ≤ 2 |
| Distinct pitches | ≤ 6 |
| Range | ≤ 12 semitones |
| Leaps that chain in one direction | < 15 % (pack 7 %) |
| Register | lowest note 53-60, highest 60-67 |
| Note length at a dotted-8th gap | 1-2 16ths |

---

# 7. Where this disagrees with the other guides

| Guide says | The pack shows | Use |
|---|---|---|
| MELODY.md 16: the tonic is a destination; do not overuse it | the anchor is half the line and most downbeats | The anchor need not be the tonic: put it on the fifth, or over a third-less or moving chord, and 16 still holds. For a straight tonic anchor, withhold the tonic chord instead (e.g. bVI maj7 under it) |
| MELODY.md 7: target 3rds and 7ths on strong beats | strong beats are the anchor | The colour comes from the chord moving under a fixed anchor (MELODY.md 32), not from the line targeting chord tones |
| MELODY.md 9: repetition with variation | rhythm fixed in 18 of 34, pitch varied | Agrees, and narrows it: vary pitch, not rhythm |
| AGENTS.md *Basslines*: KBBB, never on the kick | 30 of 31 pack basses hit the kick step and rely on sidechain | Keep KBBB (the user's preference); the pack is not a reason to change it |
| AGENTS.md *Leads*: sustain, not pluck | sustaining patch, **short MIDI notes** | Both: sustain in the envelope, staccato in the MIDI |

---

# 8. Not yet measured

- How a lead and a chord file fit together. The pack never pairs them. The 20
  synth loops in `Loops/` are audio with keys in their names (e.g. `Synth Loop
  14 Dmin`) and would show it, after pitch tracking.
- Arrangement-scale development: these are loops.
- Macro automation in the Serum presets' `MidiClip0` (filter sweeps over the
  demo melody). It can be decoded (`docs/lessons.md`) but has not been read here.
