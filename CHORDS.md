# Ableton Chord Progression Expert for Codex

## Purpose

This document defines how a Codex agent should **design, program, inspect, improve, and vary chord progressions in Ableton Live**.

The target is not merely to produce technically valid chords. The target is to produce harmony that has:

- a clear tonal or modal centre;
- deliberate tension and release;
- smooth or intentionally dramatic voice movement;
- a bass line that supports the harmonic direction;
- useful harmonic rhythm;
- voicings appropriate to the register and instrument;
- enough repetition to feel coherent;
- enough variation to avoid sounding mechanically looped;
- space for the melody, bass, drums, vocals, and sound design.

This is written for practical electronic-music production, especially house, deep house, progressive house, melodic techno, techno with tonal material, electronica, synth-pop, and related styles.

The agent must treat harmony as a system it can reason about and edit deterministically. Do not rely on phrases such as:

- "use richer chords";
- "add tension";
- "try some inversions";
- "make the voice leading smoother";
- "add jazzier notes";
- "make it more emotional";
- "make the progression less boring".

Those phrases are descriptions of a goal, **not instructions**.

Whenever the agent applies one of those ideas, it must know exactly:

1. which pitch changes;
2. from what note to what note;
3. in which chord;
4. in which octave/register;
5. on which beat;
6. for how long;
7. why the change works;
8. what musical problem it solves.

---

# 1. Operating Contract

## 1.1 Never destroy the user's existing harmony

Before a substantial rewrite:

1. Duplicate the MIDI clip or duplicate the chord track.
2. Rename the working version clearly, for example:
   - `Chords - AI v01`
   - `Chords - AI Voicelead`
   - `Chords - AI Alt B`
3. Leave the original available for A/B comparison.

When only fixing one obvious note, a duplicate is optional, but prefer reversible editing.

---

## 1.2 Separate the five harmonic layers

For every chord passage, analyse these independently:

### A. Harmonic identity
Which chord is it?

Example:

`Am9`

Pitch classes:

`A C E G B`

### B. Voicing
Where are those notes placed?

These are all versions of Am9:

- A2 C3 E3 G3 B3
- A2 E3 G3 B3 C4
- A2 G3 B3 C4 E4
- E2 A2 G3 B3 C4
- A1 E2 G3 B3 C4

They have the same broad harmonic identity but very different weight, width, and colour.

### C. Bass
What is the lowest perceived harmonic note?

`Am9/C` is still related to Am9, but putting C in the bass changes the sense of motion.

### D. Harmonic rhythm
When does the harmony change?

The same four chords can feel completely different if they last:

- one bar each;
- two beats each;
- `1 bar + 1 bar + 1.5 bars + 0.5 bar`;
- or use an anticipated final chord on beat `4&`.

### E. Inner movement / embellishment
Do individual notes move while the basic harmony stays recognizable?

Examples:

- `Csus4 -> C`
- `C -> Cmaj7 -> C6`
- `Am -> Am(add9) -> Am`
- a held top-note pedal over multiple changing chords.

Never confuse these layers.

---

# 2. Source-Derived Principles

The source videos repeatedly attack the same failure mode from different directions: **correct chord labels alone do not make interesting harmony**.

The practical ideas used in this guide are organized around the following principles.

## 2.1 Bland voicings and missing tension are separate problems

A plain progression can be weak because:

1. the chords themselves have little directional tension; or
2. the chord sequence is acceptable but every chord is voiced as a static root-position block.

These require different fixes.

Do not replace the progression if changing the voicing solves the problem.

Do not keep polishing voicings if the progression itself has no useful movement.

---

## 2.2 Harmony should create expectation

A listener should be able to feel that some events are:

- stable;
- moving away;
- increasing tension;
- delaying resolution;
- resolving;
- unexpectedly redirecting.

The agent should deliberately control that curve.

A four-chord loop does **not** need to fully resolve every four bars. In dance music it is often useful for the last chord to point back toward the first so that the loop itself creates forward motion.

---

## 2.3 One changed chord can transform a familiar progression

Do not assume an entire loop has to be reharmonized.

An effective procedure is:

1. keep three chords;
2. modify or substitute one chord;
3. listen/inspect the new harmonic direction;
4. only change more if necessary.

This preserves familiarity while introducing surprise.

---

## 2.4 Circle-of-fifths movement creates strong direction

Root motion down a fifth / up a fourth is one of the strongest functional movements in tonal harmony.

Examples:

`D -> G -> C`

`E7 -> Am`

`A7 -> Dm`

`D7 -> G`

Use it when the harmony needs a stronger sense of "going somewhere".

Do not force it into every progression.

---

## 2.5 The bass is an independent compositional tool

Changing the bass note without replacing the entire upper chord can create:

- inversions;
- stepwise bass motion;
- pedal tones;
- contrary motion;
- slash chords;
- stronger transitions.

Do not treat "the bass" as automatically identical to "the root".

---

## 2.6 Major/minor interchange can provide the surprise

Changing one major chord to minor, or borrowing a chord from the parallel major/minor key, can create a strong emotional colour without making the progression incomprehensible.

Classic example in C major:

`C -> F -> Fm -> C`

The borrowed `Fm` supplies `Ab`, which pulls down to `G` in C major.

---

## 2.7 Rhythm is part of harmony

A chord progression played as four whole-note blocks may sound dull even when its note choices are good.

Before adding exotic chords, test:

- anticipation;
- syncopation;
- short stabs;
- held chords with rhythmic re-triggers;
- rests;
- delayed chord entries;
- one chord arriving half a beat early;
- one bar split into two chords;
- different note lengths inside the chord.

---

## 2.8 Suspensions create controllable tension

A suspension works because a note temporarily delays a more stable chord tone.

Example:

`Gsus4 -> G`

Notes:

- Gsus4 = `G C D`
- G = `G B D`

Only one note changes:

`C -> B`

That semitone movement is the event.

Do not simply label something `sus4`; program and time the resolution.

---

# 3. Ableton Live Working Method

The guide assumes Ableton Live 12 terminology.

Live MIDI clips contain pitch, position, duration, and velocity data. The agent should therefore translate every harmonic decision into explicit MIDI edits.

## 3.1 Create or open the working MIDI clip

If a chord track does not already exist:

1. Create a MIDI track.
   - Windows: `Ctrl+Shift+T`
   - macOS: `Cmd+Shift+T`
2. Name it `Chords`.
3. Load an appropriate instrument already available in the user's project/library.
4. In Arrangement View, select the intended time range.
5. Insert an empty MIDI clip.
   - Windows: `Ctrl+Shift+M`
   - macOS: `Cmd+Shift+M`
6. Open Clip View/MIDI Note Editor.
7. Set the clip loop to the intended phrase length.

A four-bar chord phrase is a useful default, but use 8 or 16 bars when the musical idea requires a longer harmonic sentence.

---

## 3.2 Set the scale deliberately

In Live 12, scale settings are clip-aware rather than one immutable global key for the entire Set.

For a new progression:

1. determine the intended key/mode;
2. set the clip root;
3. set the clip scale;
4. enable scale highlighting when useful.

Important:

Setting a scale does **not** automatically correct pre-existing MIDI notes. It is a visual and scale-aware editing aid.

Chromatic notes, borrowed chords, secondary dominants, and altered tensions may intentionally fall outside the chosen scale. Never delete an out-of-scale note merely because it is visually marked as chromatic.

---

## 3.3 Use MIDI note numbers when octave naming could be ambiguous

For deterministic communication, the agent may specify both Live-style note names and MIDI numbers.

Middle C is MIDI note 60. Ableton conventionally displays it as `C3`.

Example:

- C3 = 60
- E3 = 64
- G3 = 67
- B3 = 71
- D4 = 74

When exact register matters, MIDI numbers remove ambiguity between octave-naming conventions used by different software.

---

## 3.4 Recommended chord-track architecture

For electronic music, prefer separating low bass from chord voicing.

A useful default:

### Bass track
Approximate working register:

`MIDI 28-48`

depending on sound and arrangement.

### Chord track
Approximate working register:

`MIDI 48-84`

depending on sound.

Do not stack dense thirds too low. Low-register close-position chords produce frequency crowding because the partials are physically close together.

When a chord sounds muddy:

1. remove the root from the chord instrument if bass already plays it;
2. raise the third, fifth, seventh, or extension by an octave;
3. widen the voicing;
4. high-pass the chord sound if appropriate;
5. do **not** automatically change the harmonic progression.

---

# 4. Chord Construction Engine

Codex must be able to construct chords instead of guessing note names.

Represent a root as pitch class `0`.

## 4.1 Core interval formulas

| Chord | Semitone set from root |
|---|---|
| Major | `0 4 7` |
| Minor | `0 3 7` |
| Diminished | `0 3 6` |
| Augmented | `0 4 8` |
| Sus2 | `0 2 7` |
| Sus4 | `0 5 7` |
| Major 6 | `0 4 7 9` |
| Minor 6 | `0 3 7 9` |
| Dominant 7 | `0 4 7 10` |
| Major 7 | `0 4 7 11` |
| Minor 7 | `0 3 7 10` |
| Half-diminished 7 | `0 3 6 10` |
| Diminished 7 | `0 3 6 9` |
| Add9 major | `0 4 7 14` |
| Add9 minor | `0 3 7 14` |
| Dominant 9 | `0 4 7 10 14` |
| Major 9 | `0 4 7 11 14` |
| Minor 9 | `0 3 7 10 14` |
| Dominant 7 b9 | `0 4 7 10 13` |
| Dominant 7 #9 | `0 4 7 10 15` |
| Major add #11 | `0 4 7 18` |

The raw formula is the **pitch inventory**, not the final voicing.

A five-note chord does not require all five notes on every instrument.

---

# 5. Scale-to-Chord Mapping

## 5.1 Major key triads

For a major scale:

| Degree | Function label | Quality |
|---|---|---|
| I | tonic | major |
| ii | predominant | minor |
| iii | tonic substitute / mediant | minor |
| IV | predominant | major |
| V | dominant | major |
| vi | tonic substitute | minor |
| vii° | dominant-function leading-tone chord | diminished |

C major:

`C D E F G A B`

Triads:

- I = C E G
- ii = D F A
- iii = E G B
- IV = F A C
- V = G B D
- vi = A C E
- vii° = B D F

---

## 5.2 Major key seventh chords

C major:

- Imaj7 = C E G B
- ii7 = D F A C
- iii7 = E G B D
- IVmaj7 = F A C E
- V7 = G B D F
- vi7 = A C E G
- viiø7 = B D F A

These are not automatically "better" than triads. Use sevenths when the arrangement benefits from the extra colour.

---

## 5.3 Natural minor triads

A natural minor:

`A B C D E F G`

Triads:

- i = A C E
- ii° = B D F
- III = C E G
- iv = D F A
- v = E G B
- VI = F A C
- VII = G B D

In tonal minor, it is common to raise scale degree 7 at a dominant point:

`G -> G#`

That turns:

`Em` into `E` or `E7`

and creates a strong pull:

`E7 -> Am`

E7 notes:

`E G# B D`

Am notes:

`A C E`

Voice-leading:

- G# -> A = +1 semitone
- D -> C = -2 semitones
- E can remain common
- B can move to C or A depending on voicing

That is why the move sounds directed.

---

# 6. Functional Harmonic Logic

The agent should understand three broad functional areas.

## 6.1 Tonic: stability

Common examples in major:

- I
- vi
- sometimes iii

In C major:

- C
- Am
- Em

These can act as resting or home-related chords.

---

## 6.2 Predominant: moving away from home

Common examples:

- ii
- IV

In C:

- Dm
- F

These often prepare dominant harmony.

---

## 6.3 Dominant: maximum directional pull toward tonic

Common examples:

- V
- V7
- vii°
- secondary dominants when resolving to another temporary target

In C:

- G
- G7
- Bdim

Basic functional sentence:

`Tonic -> Predominant -> Dominant -> Tonic`

Example:

`C -> Dm -> G7 -> C`

Do not interpret this as a mandatory formula. In loop-based electronic music, an unresolved or partially resolving end can create useful circular motion.

---

# 7. The Progression-Generation Procedure

Use this procedure instead of random chord selection.

## Step 1: Determine constraints

Collect or infer:

- key;
- mode;
- tempo;
- genre;
- emotional target;
- section type;
- bar length;
- whether a melody already exists;
- whether a bass line already exists;
- density of the arrangement;
- instrument register.

If key is unknown but melody exists, infer likely tonal centres from:

- phrase-ending notes;
- repeated important notes;
- bass;
- accidentals;
- existing chord tones.

Do not declare a key from one note alone.

---

## Step 2: Choose a harmonic energy curve

Examples:

### Stable loop
`T -> T/substitute -> PD -> T/substitute`

### Strong resolution
`T -> PD -> D -> T`

### Continuous circular pull
`T -> PD -> T-sub -> D`

The final dominant points back to bar 1.

### Dark/modal loop
Use mode-defining chords without forcing V-I classical resolution.

Example in A Dorian:

`Am7 -> D7`

The F# in D7 supplies the characteristic Dorian major sixth.

---

## Step 3: Choose chord roots/qualities before extensions

Example target:

Deep house, A minor, 4 bars.

Start simple:

`Am | F | C | G`

Roman numerals:

`i | VI | III | VII`

Do not immediately decorate.

First verify that the root movement and emotional shape work.

---

## Step 4: Improve one dimension at a time

Order:

1. chord choice;
2. inversion/bass;
3. voice leading;
4. extensions;
5. suspensions;
6. rhythmic placement;
7. passing/approach harmony;
8. micro-variation.

This makes it possible to know which change improved the result.

---

# 8. Voice Leading: Exact Algorithm

"Use smooth voice leading" is not sufficient.

The agent must compute it.

## 8.1 Basic principle

Between two adjacent chord voicings:

- keep common tones in the same register when possible;
- move other voices to the nearest suitable chord tone;
- avoid unnecessary octave jumps;
- avoid every voice moving in the same direction unless a parallel-block effect is intentionally desired.

---

## 8.2 Candidate-generation method

Suppose the progression is:

`Am7 -> Fmaj7 -> Cmaj7 -> G7`

Pitch classes:

- Am7 = A C E G
- Fmaj7 = F A C E
- Cmaj7 = C E G B
- G7 = G B D F

### Initial Am7 voicing

Choose:

`A2 E3 G3 C4`

MIDI:

`57 64 67 72`

Now create candidate Fmaj7 voicings around the same register.

Possible Fmaj7 notes:

`F A C E`

Candidates:

1. `F2 E3 A3 C4`
2. `F2 C3 E3 A3`
3. `A2 E3 F3 C4`
4. `A2 C3 E3 F3`

Candidate 3 preserves:

- A2
- E3
- C4

and only changes:

`G3 -> F3`

This is extremely smooth, although the bass is A, making it `Fmaj7/A`.

If the bass is on a separate track, the chord instrument can use:

`A2 E3 F3 C4`

while bass plays:

`F1/F2`

The total harmony still reads as Fmaj7.

---

## 8.3 Practical voice-leading cost

For each transition, score a candidate voicing.

A useful conceptual cost:

```text
cost =
    total_absolute_voice_motion
  + 4 * number_of_voice_leaps_over_7_semitones
  + 3 * number_of_unwanted_voice_crossings
  + 3 * low_register_cluster_penalty
  - 2 * common_tones_preserved
  - 1 * contrary_motion_bonus
```

This is not sacred mathematics. It is a decision procedure.

The important point is that the agent compares **actual candidate note placements** instead of merely saying "use an inversion".

---

## 8.4 Common-tone first procedure

For chord A -> chord B:

1. List pitch classes in A.
2. List pitch classes in B.
3. Find intersection.
4. Hold those notes if their register works.
5. For each remaining voice, find the nearest unused chord tone of B.
6. Check spacing.
7. Check bass separately.
8. Move an octave only when it improves register or avoids mud.

---

# 9. Inversions: How to Use Them

A triad:

`C E G`

has three basic bass positions.

## Root position
`C E G`

Root in bass.

## First inversion
`E G C`

Third in bass.

Symbol:

`C/E`

## Second inversion
`G C E`

Fifth in bass.

Symbol:

`C/G`

An inversion is not simply "the notes in another order". Its strongest perceptual effect is the changed lowest note.

---

## 9.1 Use inversion to make a bass line

Progression:

`C | G | Am | F`

Root-position bass:

`C -> G -> A -> F`

Large movement.

Alternative:

`C | G/B | Am | F`

Bass:

`C -> B -> A -> F`

Now the first three bass notes descend stepwise.

Another option:

`C | G/B | Am | F/A`

Bass:

`C -> B -> A -> A`

Different contour.

---

## 9.2 Inversions are not automatically better

Avoid blindly maximizing smoothness.

Sometimes a root-position chord at the start of a drop is desirable because it sounds stable and physically grounded.

Use inversion to solve one of these problems:

- awkward bass leap;
- static upper voices;
- register collision;
- need for a melodic bass line;
- need for a weaker or less final version of the chord.

---

# 10. Open and Spread Voicings

## 10.1 Closed triad

C major:

`C3 E3 G3`

MIDI:

`60 64 67`

All voices lie within one octave.

---

## 10.2 Spread voicing

Move the middle note up an octave:

`C3 G3 E4`

MIDI:

`60 67 76`

Same pitch classes, more space.

---

## 10.3 Bass-separated voicing

Bass track:

`C2`

Chord track:

`G3 C4 E4`

This often works better in electronic production than placing a dense C chord near the bass.

---

## 10.4 Rootless upper voicing

If bass clearly supplies C:

Bass:

`C2`

Chord instrument:

`E3 B3 D4 G4`

Total harmony:

`Cmaj9`

The chord instrument itself does not need to play C.

This prevents redundant low-frequency energy.

---

# 11. Extensions: Exact Rules

Extensions should solve a musical problem or create a chosen colour.

## 11.1 Seventh

Add the appropriate seventh.

C major:

`C E G B` = Cmaj7

A minor:

`A C E G` = Am7

G dominant:

`G B D F` = G7

Use:

- maj7 for softer/colourful tonic or IV sonority;
- min7 for smoother minor harmony;
- dominant 7 when stronger resolution is wanted.

---

## 11.2 Ninth

A ninth is scale degree 2 one octave above the root.

C major 9:

`C E G B D`

Am9:

`A C E G B`

G9:

`G B D F A`

For voicing, omit the fifth first if too dense.

Example rootless G9 over G bass:

`B3 F4 A4`

This contains:

- 3rd = B
- b7 = F
- 9th = A

Those notes strongly identify G9 even without D.

---

## 11.3 Add9 versus 9

`Cadd9`:

`C E G D`

No seventh is implied.

`Cmaj9`:

`C E G B D`

Includes major seventh.

`C9`:

`C E G Bb D`

Dominant seventh plus ninth.

Never use these labels interchangeably.

---

## 11.4 Sixth

C6:

`C E G A`

Am7:

`A C E G`

Notice that they contain the same pitch classes in a different root context.

The bass and musical context decide how the listener interprets them.

---

# 12. Suspensions: Program the Resolution

## 12.1 Sus4

C:

`C E G`

Csus4:

`C F G`

Resolution:

`F -> E`

In a one-bar C chord, program:

- beats `1.1.1` to `2.3.1`: `C F G`
- beats `2.3.1` to end: `C E G`

Or make the suspension shorter:

- first 1/8 or 1/4 of the chord as sus4;
- then resolve.

The timing changes the emotional effect.

---

## 12.2 Sus2

C:

`C E G`

Csus2:

`C D G`

Resolution:

`D -> E`

or leave the sus2 unresolved when a floating/modal sound is wanted.

---

## 12.3 Suspension over a changing bass

One upper note can be held while bass/chord roots change.

Example top note E:

- Am = `A C E`
- C = `C E G`
- Fmaj7 = `F A C E`

E remains constant.

This creates coherence while roots move.

---

# 13. Tension and Release

The agent should be able to identify exactly where the tension comes from.

## 13.1 Semitone resolution

Strong because the voice only has to move one semitone.

Examples:

- B -> C
- G# -> A
- F -> E
- Ab -> G

Use these deliberately.

---

## 13.2 Dominant seventh resolution

G7:

`G B D F`

to C:

`C E G`

Critical guide tones:

- B -> C
- F -> E

Those two voices encode much of the resolution.

Program them where they are audible.

---

## 13.3 Secondary dominant

A secondary dominant temporarily treats a diatonic chord as a tonic target.

In C major:

Target `Dm` = ii.

Dominant of D is A.

Use:

`A7 -> Dm`

A7:

`A C# E G`

The C# is outside C major but intentionally points to D.

Other examples in C:

- `E7 -> Am`
- `D7 -> G`
- `C7 -> F`

Do not "correct" the chromatic note back into C major.

---

## 13.4 Borrowed iv in major

In C major:

`C -> F -> Fm -> C`

F:

`F A C`

Fm:

`F Ab C`

C:

`C E G`

Key emotional voice:

`A -> Ab -> G`

Program that line in the same register if you want the effect to be obvious.

---

## 13.5 Diminished passing chord

Example bass movement:

`C -> C#dim7 -> Dm`

C#dim7:

`C# E G Bb`

This can connect I to ii chromatically.

Use sparingly in styles where the harmonic language supports it.

---

# 14. Bass Design

## 14.1 Four bass strategies

### Strategy A: roots
Clear, strong.

### Strategy B: inversions
Use 3rd or 5th in bass to smooth movement.

### Strategy C: pedal
Hold one bass note across multiple upper harmonies.

Example in A:

Bass holds A while upper chords imply:

`A -> D/A -> F#m/A -> E/A`

This creates a suspended, progressive feel.

### Strategy D: passing bass
Insert stepwise connection notes.

Example:

`C -> G/B -> Am`

Bass:

`C -> B -> A`

---

## 14.2 Contrary motion

If upper voices rise, let bass descend.

Example conceptual contour:

Bass:

`C -> B -> A -> G`

Top note:

`E -> G -> A -> B`

Opposing directions enlarge the perceived motion without requiring exotic chords.

---

## 14.3 Fifths in the bass

A root/fifth bass pattern can reinforce a chord without repeatedly striking the root.

For Am:

`A -> E`

For F:

`F -> C`

For G:

`G -> D`

In house music, this may be a separate rhythmic bass phrase rather than part of the chord clip.

---

# 15. Rhythmic Shifts

A static harmonic sequence can become musical through timing.

Start:

```text
Bar 1: Am7     4 beats
Bar 2: Fmaj7   4 beats
Bar 3: Cmaj7   4 beats
Bar 4: G7      4 beats
```

## Variation A: anticipate the final chord

```text
Bar 3: Cmaj7 for 4 beats
Bar 4:
  beats 1-3.5: G7
  final 1/8:   Am7 pickup
```

The next loop begins before the bar line.

---

## Variation B: split the fourth bar

```text
Bar 4 beats 1-2: Dm7
Bar 4 beats 3-4: G7
Bar 1 next loop: Am7
```

Now the turnaround has extra direction.

---

## Variation C: stab pattern

Instead of one long chord:

- hit on beat 1;
- short hit on `2&`;
- hit on beat 4;
- leave silence between hits.

The exact pattern should follow the groove.

Do not automatically quantize every chord onset to the same rhythmic grid if the production intentionally uses push/pull.

---

# 16. Melody-First Harmonization

If a melody already exists, harmony must support it.

Do not select chords first and then force the melody to fit.

## 16.1 Identify structural melody notes

Give highest importance to melody notes on:

- strong beats;
- long durations;
- phrase endings;
- repeated accents;
- climactic pitches.

Passing and neighbour notes need less harmonic support.

---

## 16.2 Candidate chord method

For each important melody note:

1. list diatonic chords containing that note;
2. list useful extended chords where that note is a 7th/9th/etc.;
3. consider a controlled non-chord tone if it resolves;
4. choose candidates based on the previous and next chord.

Example in C major, melody note E.

Diatonic triads containing E:

- C = C E G
- Em = E G B
- Am = A C E

Possible extended role:

- Dm9 contains E as 9th
- Fmaj7 contains E as maj7
- G13 can contain E as 13th

So "melody note E" does not imply "play C major".

---

## 16.3 Avoid collision with a vocal

If the vocal holds E4, do not automatically place a loud chord voice on E4.

Options:

- omit E from the chord synth if harmony remains clear;
- place E an octave lower;
- place E an octave higher;
- retain E only on chord attack;
- use another chord tone in the top voice.

Chord-vocal fit is both harmonic **and registral**.

---

# 17. Chord/Melody Top-Line Method

Treat the highest chord voice as a small melody.

Suppose the roots are:

`Am | F | C | G`

Do not simply use:

`E | C | G | D`

because those happen to be root-position tops.

Design the top line first.

Example target:

`E -> E -> E -> F`

Then construct voicings around it:

### Am7
`A2 C3 G3 E4`

### Fmaj7
`A2 C3 F3 E4`

### C
`G2 C3 G3 E4`

### G7
`G2 B2 D3 F4`

Top movement:

`E -> E -> E -> F`

The first three chords feel related, then F creates tension over G7.

On loop return to Am, F can move to E.

That is an audible one-semitone resolution.

---

# 18. The "Change One Chord" Procedure

When a progression is functional but generic:

Example:

`C | G | Am | F`

Test one alteration at a time.

## Option 1: secondary dominant

`C | E7 | Am | F`

E7 strongly targets Am.

Notes:

E7 = `E G# B D`

The new note G# creates the pull.

---

## Option 2: borrowed iv

`C | G | Am | Fm`

On loop back:

`Fm -> C`

Key voice:

`Ab -> G`

---

## Option 3: deceptive colour

`Cmaj7 | G/B | Am9 | Fmaj7`

Same broad roots, more sophisticated voicing.

---

## Option 4: dominant turnaround

`C | Am | Dm7 | G7`

Functional cycle:

`I -> vi -> ii -> V`

Loop back to I.

Do not apply all options simultaneously. A single surprising chord often works better than four surprising chords.

---

# 19. Circle-of-Fifths Procedure

Use descending-fifth root motion when a passage needs stronger inevitability.

Example:

`Em7 -> A7 -> Dm7 -> G7 -> Cmaj7`

Root motion:

`E -> A -> D -> G -> C`

Each root moves down a fifth/up a fourth.

This is a long chain; electronic music often uses only part of it.

Example two-step turnaround:

`Dm7 -> G7 -> Cmaj7`

Or in A minor:

`Bm7b5 -> E7 -> Am`

---

# 20. Major/Minor Switch Procedure

Do not interpret "major/minor switch" as random chord mutation.

There are several controlled versions.

## 20.1 Parallel mixture

C major -> C minor colour.

Borrow Fm:

`C -> F -> Fm -> C`

---

## 20.2 Picardy-style final major

A minor progression ending on A major:

`Dm -> E7 -> A`

Instead of Am.

The C# in A major changes the emotional ending.

Use only if style supports the brighter resolution.

---

## 20.3 Temporary major dominant in minor

A natural minor normally contains Em.

Use E major/E7 instead:

`Dm -> E7 -> Am`

The G# creates leading-tone tension.

This is one of the most useful major/minor alterations in tonal minor.

---

# 21. "Fifths at the End" and Fifth-Based Finishing

A fifth is stable and open because it omits the third.

At the end of a chord phrase, try reducing a full voicing to root+fifth.

Example final G harmony:

Instead of:

`G B D F`

use an open pickup:

`G D`

then resolve into:

`Am7`

or return to the loop's opening chord.

This can create breathing space before the next phrase.

Another method is to let an upper fifth ring after other chord tones end.

Example C chord:

- C3/E3 end at beat 4;
- G3 rings an extra 1/8 or 1/4.

This is a production/arrangement move, not a new chord.

---

# 22. "Sneaky Fifths"

Use perfect fifths as connective material because they imply harmonic direction without spelling full major/minor quality.

Example:

Between Am and F:

- play `A-E`;
- then a brief `G-D`;
- arrive at `F-C`.

The middle fifth is ambiguous enough to function as connective material.

For MIDI programming, keep these as short transition notes, not necessarily full chords.

---

# 23. Reverse the Bass

If the upper progression rises, try a descending bass contour, or vice versa.

Example upper harmony:

`C -> Dm -> Em -> F`

Roots rise:

`C D E F`

Alternative bass plan:

- C chord / bass C
- Dm/C / bass C
- Em/B / bass B
- F/A / bass A

Bass:

`C -> C -> B -> A`

Upper harmonic roots rise while bass falls.

This makes the arrangement feel more composed than block-root harmony.

---

# 24. Controlled Unpredictability

"Unpredictable" does not mean random.

Use a prediction/violation rule:

1. establish a pattern twice;
2. change one thing on the third/fourth occurrence.

Examples:

- repeat bars 1-3 exactly, alter bar 4;
- keep chord roots, change top voice only;
- keep notes, shift the rhythm;
- keep first loop diatonic, use one borrowed chord on second loop;
- keep bass roots for 7 bars, use an inversion in bar 8.

The listener needs a pattern before surprise has meaning.

---

# 25. Eight-Level Chord Improvement Ladder

Use this ladder when a progression exists but sounds flat.

Do **not** jump straight to Level 8.

## Level 1: root-position triads

Example:

`Am | F | C | G`

Use this to verify the composition.

---

## Level 2: inversions

Goal: reduce unnecessary voice movement.

Example:

`Am: A C E`
`F:  A C F`
`C:  G C E`
`G:  G B D`

Notice that A and C can remain common between Am and F.

---

## Level 3: separate bass from upper harmony

Bass plays roots.

Chord instrument omits repeated roots when possible.

Example Am:

Bass: `A1/A2`

Chord: `C3 E3 G3`

---

## Level 4: sevenths and ninths

Example:

`Am9 | Fmaj7 | Cmaj9 | G7`

Do not add every extension to every chord if the section becomes harmonically blurry.

---

## Level 5: deliberate top line

Choose a top-voice melody.

Example:

`B -> C -> B -> A`

Build voicings under those notes.

---

## Level 6: suspensions and inner movement

Example over G:

`Gsus4 -> G7`

C -> B internally.

Or:

`Am(add9) -> Am`

B -> C or B -> A depending desired motion.

---

## Level 7: one functional surprise

Choose one:

- secondary dominant;
- borrowed chord;
- passing diminished;
- inversion with chromatic bass;
- modal interchange.

Only one is needed.

---

## Level 8: rhythmic/harmonic arrangement

Alter:

- chord onset;
- note length;
- anticipations;
- re-triggers;
- rests;
- pickups;
- transition notes;
- second-loop variation.

At this point the progression becomes a performed/produced part rather than a static chord chart.

---

# 26. Detailed Worked Example 1: Deep House in A Minor

## 26.1 Constraint

- Key: A minor
- Length: 4 bars
- Meter: 4/4
- Mood: warm, introspective
- Bass: separate
- Chord sound: soft piano/electric-key/synth
- Harmonic density: medium

---

## 26.2 Start with roots

```text
Bar 1: Am
Bar 2: F
Bar 3: C
Bar 4: G
```

Roman numerals:

`i - VI - III - VII`

---

## 26.3 Add sevenths/ninths

```text
Am9 | Fmaj7 | Cmaj9 | G7
```

Pitch inventories:

### Am9
`A C E G B`

### Fmaj7
`F A C E`

### Cmaj9
`C E G B D`

### G7
`G B D F`

---

## 26.4 Separate bass

Bass notes:

```text
Bar 1: A1/A2
Bar 2: F1/F2
Bar 3: C2
Bar 4: G1/G2
```

Choose octave to fit the actual bass sound.

---

## 26.5 Upper voicings

One practical set:

### Bar 1: Am9
`C3 E3 G3 B3`

MIDI:

`60 64 67 71`

Bass supplies A.

### Bar 2: Fmaj7
`C3 E3 F3 A3`

MIDI:

`60 64 65 69`

Movement from bar 1:

- C stays
- E stays
- G -> F = -2
- B -> A = -2

### Bar 3: Cmaj9
`B2 D3 E3 G3`

MIDI:

`59 62 64 67`

Bass supplies C.

### Bar 4: G7
`B2 D3 F3 G3`

MIDI:

`59 62 65 67`

Movement:

- B stays
- D stays
- E -> F = +1
- G stays

Then loop to bar 1 Am9:

G7 voicing:

`B2 D3 F3 G3`

to Am9:

`C3 E3 G3 B3`

Possible movement:

- B2 -> C3 = +1
- D3 -> E3 = +2
- F3 -> G3 = +2
- G3 -> B3 = +4

The loop has directional lift back to Am.

---

## 26.6 Add one suspension

In bar 4, replace the first half of G7 with G7sus4 flavour.

First two beats:

`C3 D3 F3 G3`

Second two beats:

`B2 D3 F3 G3`

Critical motion:

`C3 -> B2`

This makes the turnaround audible.

---

## 26.7 Add rhythm

Instead of four full-bar chord blocks:

Bars 1-3:
- main chord on beat 1, length 2.5 beats;
- re-hit on `3&`, shorter velocity.

Bar 4:
- sus voicing on beat 1;
- resolve on beat 3;
- short pickup Am9 on final `&` if groove permits.

Keep bass rhythm independently designed.

---

# 27. Detailed Worked Example 2: Melodic Techno in F# Minor

## 27.1 Goal

Create a progression that supports a repeating synth motif without changing chord every beat.

Use slower harmonic rhythm and a pedal/common tone.

Base progression:

`F#m | D | A | E`

Roman numerals:

`i | VI | III | VII`

---

## 27.2 Choose a common top note

The note `E` belongs to:

- F#m7 as b7
- Dadd9 as 9
- A as 5
- E as root

That makes E a powerful common-tone pedal.

Construct:

### F#m7
Bass: F#
Upper: `A C# E`

### Dadd9
Bass: D
Upper: `A D E F#` or a reduced `A E F#`

### A
Bass: A
Upper: `C# E A`

### E
Bass: E
Upper: `B E G#`

To keep E literally fixed in one voice, choose voicings that place E at the same MIDI pitch.

Example top voice:

`E4 -> E4 -> E4 -> E4`

This creates continuity while the bass changes.

---

## 27.3 Introduce movement on second repeat

First four bars:

`F#m7 | Dadd9 | A | E`

Second four bars:

`F#m7 | Dadd9 | A/C# | E`

Only bar 7 changes bass from A to C#.

That produces:

bass `F# -> D -> C# -> E`

instead of repeating exactly.

---

## 27.4 Add turnaround tension

On the final half-bar, use C#7 rather than staying on E if a stronger return to F#m is wanted.

C#7:

`C# E# G# B`

E# is enharmonically F in the piano roll.

Critical resolution:

`E# -> F#`

Do not respell the theoretical function mentally as "F" and lose why it exists: it is the raised third of C#7 and leading tone to F#.

---

# 28. Detailed Worked Example 3: Piano/House Progression in C Minor

## 28.1 Base progression

`Cm | Ab | Eb | Bb`

Roman numerals:

`i | VI | III | VII`

Basic triads:

- Cm = C Eb G
- Ab = Ab C Eb
- Eb = Eb G Bb
- Bb = Bb D F

---

## 28.2 House-friendly upper voicing

Separate bass.

### Cm7
Upper:
`Eb3 G3 Bb3 C4`

### Abmaj7
Upper:
`Eb3 G3 Ab3 C4`

Only one voice changes:

`Bb -> Ab`

### Ebmaj7
Upper:
`D3 G3 Bb3 Eb4`

### Bbadd9
Upper:
`C3 D3 F3 Bb3`

This creates more colour without needing a different progression.

---

## 28.3 Rhythmic piano stab pattern

For each bar, instead of holding continuously:

- stab on beat 1;
- stab on `2&`;
- stab on beat 4;
- shorten each to roughly 1/8-1/4 note depending on tempo and sound.

Velocity concept:

- beat 1 = strongest;
- `2&` = softer;
- beat 4 = medium.

Example:

`112 / 82 / 98`

Do not use these exact velocities mechanically for every chord. They are a starting contour.

---

# 29. Genre-Specific Harmonic Defaults

These are starting biases, not laws.

## 29.1 House

Useful traits:

- clear 4- or 8-bar loop;
- triads, sevenths, sixths, ninths;
- rhythmic stabs;
- one inversion to smooth bass;
- occasional dominant/borrowed turnaround;
- piano/organ/synth voicing often more important than exotic chord labels.

Avoid filling every beat with new harmony.

---

## 29.2 Deep house

Useful traits:

- minor7;
- maj7;
- 9ths;
- rootless upper structures;
- smooth voice leading;
- understated bass;
- one or two common tones across chords;
- rhythm and articulation creating much of the sophistication.

A useful rule:

Before adding an 11th or 13th, ask whether the same result can be achieved more cleanly through voicing.

---

## 29.3 Melodic techno

Useful traits:

- minor centre;
- slower harmonic rhythm;
- add9/sus2;
- pedal tones;
- open fifths;
- repeating top-note or motif;
- progression may remain harmonically simple while automation and timbre provide evolution.

Avoid turning every melodic-techno loop into neo-soul harmony.

---

## 29.4 Progressive house

Useful traits:

- diatonic progression with carefully chosen inversions;
- strong top voice;
- pedal note;
- chord extensions introduced gradually;
- 8/16-bar harmonic evolution;
- second-pass variation rather than a new chord every bar.

---

## 29.5 Techno

If the track is primarily groove/timbre-driven:

- one chord may be enough;
- two alternating sonorities may be enough;
- modal ambiguity can be desirable;
- moving one inner voice can create more useful tension than changing the root.

Do not impose song-like functional harmony where the arrangement does not need it.

---

# 30. Chord Register Rules

## 30.1 Low register

Use fewer notes.

Good low-register shapes:

- root + fifth;
- octave;
- root + fifth + octave.

Be careful with:

- close major/minor thirds;
- semitone extensions;
- dense 7th/9th stacks.

---

## 30.2 Mid register

Best location for most chord identity.

Use:

- 3rd;
- 7th;
- 9th;
- suspensions;
- inner movement.

---

## 30.3 High register

Use for:

- top-line colour;
- spread extensions;
- hooks;
- shimmering 9ths/11ths.

Do not make every chord cover four octaves unless the arrangement needs that width.

---

# 31. Omission Rules

A chord does not require every theoretical note.

Priority depends on context.

## Dominant 7/9

Most important:

- 3rd
- b7
- extension if it defines the chosen colour

Often safe to omit:

- fifth
- root if bass already supplies it

Example G9 with G bass:

Upper:

`B F A`

Enough to strongly imply G9.

---

## Major 9

With C bass:

Upper:

`E B D`

Strongly communicates Cmaj9.

G is optional.

---

## Minor 9

With A bass:

Upper:

`C G B`

Strongly communicates Am9.

E is optional.

---

# 32. Chord Density and Arrangement

Before adding harmonic complexity, check how many other pitched parts exist.

If the arrangement already has:

- bass;
- lead;
- vocal;
- arpeggio;
- counter-melody;
- FX with pitch;

the chord layer should often become **simpler**, not richer.

A three-note rootless voicing may work better than a six-note chord.

The goal is the combined arrangement, not the chord track in solo.

---

# 33. Top-Note Constraint Solver

When the melody or desired top line is known:

1. choose target top note;
2. select chord that either contains it or supports it as a controlled tension;
3. generate inversions;
4. reject candidates whose top note is wrong;
5. choose the best remaining voice-leading candidate.

Example target top line in C major:

`E4 -> F4 -> G4 -> G4`

Possible progression:

- C: `G3 C4 E4`
- Dm7: `A3 C4 D4 F4`
- C/E: `C4 E4 G4`
- G7: `B3 D4 F4 G4`

Now the top line is explicit rather than accidental.

---

# 34. Chord-Under-Melody Classification

For an important melody note, classify its relationship to each candidate chord.

Priority categories:

1. root;
2. 3rd;
3. 5th;
4. 7th;
5. 9th;
6. 11th/sus;
7. 13th;
8. non-chord tone resolving by step.

A melody note becoming a 9th or maj7 can sound more expressive than always making it the root/third.

Do not automatically harmonize every melody note with the simplest containing triad.

---

# 35. Passing and Approach Chords

Use short-duration harmony to connect structural chords.

## 35.1 Chromatic diminished approach

`C -> C#dim7 -> Dm`

If the main chords last a bar, the diminished chord can occupy only the last 1/4 or 1/2 beat before Dm.

This creates motion without redefining the entire bar.

---

## 35.2 Dominant approach

Before Am:

insert E7.

Example:

```text
Bar 4:
beats 1-3: G
beat 4:    E7
next bar:  Am
```

E7 is not a permanent replacement for G. It is a turnaround event.

---

# 36. Harmonic Rhythm Design

The agent should write a harmonic-rhythm plan before programming complicated passages.

Example 8 bars:

```text
1: Am9        4 beats
2: Fmaj7      4 beats
3: Cmaj9      4 beats
4: Gsus4/G7   2 + 2 beats

5: Am9        4 beats
6: Fmaj7      4 beats
7: C/E        4 beats
8: Dm7/G7     2 + 2 beats
```

The second half preserves identity while increasing turnaround energy.

This is usually stronger than making all eight bars harmonically unrelated.

---

# 37. Variation Without Losing the Hook

For loop-based electronic music, use an **A / A'** scheme.

## A
Original four bars.

## A'
Same recognizable progression, but change one or two parameters:

- bar 4 chord;
- one inversion;
- top voice;
- bass inversion;
- suspension;
- rhythmic anticipation;
- one extension;
- final note length.

Maximum useful variation is not the goal. Recognition is valuable.

---

# 38. Avoiding "AI Chords"

Common failure patterns:

## Failure 1: every chord has 5-6 notes

Fix:
reduce voices and create hierarchy.

## Failure 2: every chord uses 7/9/11/13

Fix:
let one or two chords carry colour; leave another as a triad/open fifth.

## Failure 3: random borrowed chords

Fix:
each chromatic chord needs a target or audible voice-leading purpose.

## Failure 4: root note always in bass and chord instrument

Fix:
separate bass and upper harmony.

## Failure 5: every bar changes chord exactly on beat 1

Fix:
vary harmonic rhythm only if groove benefits.

## Failure 6: maximum smoothness everywhere

Fix:
use occasional larger movement at structural moments.

## Failure 7: top voice is accidental

Fix:
write the top line as a melody.

## Failure 8: no relation to melody/vocal

Fix:
reharmonize around structural melody notes.

## Failure 9: over-dense low mids

Fix:
omit roots/fifths, spread voicing, raise extensions.

## Failure 10: chromatic notes treated as errors

Fix:
distinguish intentional tension from accidental wrong notes.

---

# 39. Deterministic Chord-Generation Pseudocode

```text
INPUT:
    key
    mode
    bars
    section_role
    style
    melody_notes[]
    existing_bass[]
    density_target
    tension_target

BUILD SCALE:
    scale_pitch_classes = get_scale(key, mode)

BUILD DIATONIC CHORD SET:
    for degree in 1..7:
        triad = stack_scale_thirds(degree, 3 notes)
        seventh = stack_scale_thirds(degree, 4 notes)

SELECT FUNCTIONAL SKELETON:
    choose root/chord-quality sequence
    based on section_role and desired energy curve

FOR EACH CHORD:
    create pitch-class inventory
    generate inversions
    generate octave placements inside target register
    optionally omit fifth/root
    constrain top note if melody/topline requires it

VOICE LEADING:
    score candidate against previous voicing:
        movement cost
        common-tone bonus
        leap penalty
        low-cluster penalty
        crossing penalty
        topline penalty
    choose lowest useful cost
    unless structural contrast requires a deliberate jump

TENSION PASS:
    decide whether a structural location needs:
        sus
        dominant 7
        secondary dominant
        borrowed chord
        diminished approach
        extension
    apply ONE change
    verify resolution

BASS PASS:
    choose:
        root
        inversion
        pedal
        passing note
        fifth pattern
    check relationship to kick/sub

RHYTHM PASS:
    assign chord onset/duration
    add controlled anticipations/retriggers/rests

VARIATION PASS:
    create A'
    change <= 2 harmonic variables unless user asked for a rewrite

VALIDATE:
    check key/mode
    check intentional chromatic notes
    check melody collisions
    check low-register density
    check loop transition
    check exact MIDI notes
```

---

# 40. Candidate Voicing Search in More Detail

For each chord pitch-class set:

1. choose a target note range;
2. instantiate each pitch class across all possible octaves in range;
3. construct 3-5 voice combinations;
4. reject combinations with duplicated notes unless duplication serves a purpose;
5. reject unreasonably narrow low-register clusters;
6. check required top-note constraint;
7. calculate movement from previous chord;
8. calculate spacing;
9. calculate whether the chord identity remains clear;
10. choose top candidates;
11. audition/inspect in musical context.

Example target register:

`MIDI 55-79`

Chord:

Cmaj9 pitch classes:

`C E G B D`

Possible 4-note upper voicing with C in bass:

`E3 B3 D4 G4`
= MIDI `64 71 74 79`

Another:

`G2 B2 D3 E3`
= MIDI `55 59 62 64`

The second is more compact/lower; the first is more open/bright.

Neither is universally correct.

---

# 41. Tension Budget

Do not maximize harmonic tension continuously.

Classify each chord/event from 0-4.

### 0: stable
Triad/open fifth, tonic-related.

### 1: colour
maj7, min7, add9 without strong resolution demand.

### 2: suspended
sus2/sus4, pedal dissonance, mild non-chord tension.

### 3: directional
dominant 7, secondary dominant, borrowed chord with obvious chromatic voice.

### 4: strong
altered dominant, dense semitone tension, diminished approach at a structural peak.

A useful four-bar contour might be:

`1 -> 1 -> 2 -> 3 -> loop to 0/1`

If every bar is level 4, the listener loses the sensation of tension because there is no contrast.

---

# 42. Emotional Control Through Specific Variables

Do not claim a chord has one universal emotion. Context matters.

Still, these manipulations have predictable structural effects.

## More settled
- root position;
- consonant triad;
- tonic pedal;
- slower harmonic rhythm;
- repeated common tone;
- less chromaticism.

## More yearning
- major 7;
- add9;
- suspended resolution;
- semitone inner movement;
- held common top note.

## More urgent
- dominant 7;
- secondary dominant;
- faster harmonic rhythm near transition;
- chromatic approach;
- rising bass;
- shorter note durations.

## Darker/more ambiguous
- open fifths;
- minor/add9;
- pedal tones;
- modal harmony;
- omission of third;
- low sustained root with changing upper structures.

These are design tendencies, not universal emotional laws.

---

# 43. Exact Ableton Editing Checklist

When programming a progression manually in the MIDI editor:

1. Set loop range.
2. Set grid suitable for the harmonic rhythm.
3. Enter bass only if bass belongs in the chord clip.
4. Enter the lowest upper chord voice.
5. Enter remaining chord tones.
6. Verify every note name.
7. Set durations.
8. Add suspensions as separate note events, not labels.
9. Adjust top voice.
10. Adjust inversions.
11. Add rhythmic re-triggers.
12. Set velocity contour.
13. Check the final-to-first loop transition.
14. Zoom out and visually inspect voice movement.
15. Solo briefly to detect obvious register problems.
16. Return to full arrangement and check that the chord layer does not occupy space needed by bass/lead/vocal.
17. Duplicate before any radical second pass.

---

# 44. Visual Voice-Leading Inspection

In the piano roll, each voice should form a visible horizontal/stepwise contour when smoothness is intended.

Bad symptom:

Each chord appears as an unrelated vertical tower.

Better symptom:

Some MIDI notes continue horizontally between chords while others move a small distance.

This visual inspection is especially useful when audio monitoring is unavailable to the agent.

The agent must never pretend to have heard an improvement if it cannot actually monitor audio.

If it cannot hear:

- verify theory;
- verify pitch/register;
- verify rhythm;
- verify MIDI overlap;
- verify arrangement density visually;
- state that listening validation remains necessary.

---

# 45. Velocity and Articulation

Harmony is not just pitch.

For sustained pads:

- velocities can be relatively even;
- note length and envelope may matter more.

For piano/house stabs:

- use a deliberate accent pattern;
- avoid every chord having identical velocity;
- shorten notes enough to create groove;
- allow reverb/delay tail to provide sustain.

For expressive keys:

- slightly offset/rebalance individual note velocities if the instrument responds musically;
- do not randomize everything blindly.

A useful deterministic method:

1. choose chord-level base velocity;
2. accent structural hits by +5 to +15;
3. reduce offbeat responses by -5 to -20;
4. keep internal chord-note differences small unless emphasizing top melody.

---

# 46. Note-Length Rules

## Pads
Chord notes may overlap slightly into the next harmony if the envelope and voice leading support it.

Do not overlap a chromatic tension into a chord where it becomes an unwanted clash.

## Piano/stabs
Use shorter durations.

## Suspension
The suspended note must end or move when the resolution happens.

Example Gsus4 -> G:

Bad:
C continues underneath B, accidentally creating extra colour.

Correct if pure resolution desired:
C ends exactly when B begins.

---

# 47. Chord Track Versus Bass Track Responsibility

Before editing, answer:

"Which track is responsible for the harmonic root?"

If bass already plays the root strongly, the chord track can omit it.

If there is no bass at a breakdown, the chord instrument may need the root restored.

Therefore the same MIDI chord voicing may need different versions for:

- breakdown;
- build;
- drop.

Do not duplicate the drop voicing into a sparse breakdown without checking whether the harmony loses its foundation.

---

# 48. Section-Specific Harmonic Behaviour

## Intro
- simpler voicing;
- fewer extensions;
- perhaps high-passed/no bass root;
- partial chord information.

## Build
- increase harmonic rhythm;
- add suspension;
- raise top voice;
- introduce dominant or approach harmony.

## Drop
- strongest recognizable version;
- clear bass/root support;
- avoid unnecessary dense extensions fighting the lead.

## Breakdown
- wider voicing;
- more maj7/add9 colour;
- longer notes;
- can expose inner voice movement.

## Outro
- simplify;
- remove extensions;
- reduce chord density for DJ-friendly mixing if appropriate.

---

# 49. Reharmonizing an Existing Four-Chord Loop

Use this conservative procedure.

Original:

`Am | F | C | G`

### Pass 1: preserve roots
Change only voicing.

### Pass 2: change one bass note
Example C -> C/E.

### Pass 3: add one colour
Am -> Am9.

### Pass 4: add one tension event
G -> Gsus4 -> G7.

### Pass 5: test one substitution
F -> Dm7/F or Fmaj7 depending context.

### Pass 6: second-loop surprise
Final G -> E7 to target Am.

At each pass, compare with the original.

Stop when the musical objective is met.

---

# 50. Chord Progression Diagnostic Tree

## Problem: "sounds boring"

Ask in order:

### Are the roots/chord qualities themselves weak?
If yes:
- change one chord;
- strengthen functional direction;
- test circle-of-fifths motion;
- test a secondary dominant;
- test a borrowed chord.

If no:

### Are all chords root-position blocks?
If yes:
- voice-lead;
- use inversion;
- separate bass.

If no:

### Is there no internal movement?
If yes:
- add sus-resolution;
- common-tone pedal;
- moving top voice.

If no:

### Is rhythm static?
If yes:
- change chord duration/onset;
- add anticipation/rests/stabs.

If no:

### Is harmony over-dense?
If yes:
- remove notes rather than add more.

If no:

### Is the loop too predictable?
If yes:
- vary only bar 4 or second repetition.

---

# 51. Diagnostic: "sounds too jazzy"

Likely causes:

- every chord has 7/9/11/13;
- too many chromatic dominants;
- rapid functional substitutions;
- dense rootless voicings;
- constant inner movement.

Fix:

1. revert structural chords to triads/add9;
2. keep only one extension-bearing chord;
3. retain the good voice leading;
4. reduce harmonic rhythm;
5. keep colour in the top voice rather than every chord.

---

# 52. Diagnostic: "sounds too cheesy"

Potential causes:

- obvious root-position I-V-vi-IV with bright triads;
- every chord change equally emphasized;
- no common tones;
- overly literal dominant-tonic cadence;
- predictable rising melody on top.

Fix options:

- use inversions;
- omit root from upper chord;
- use pedal/common tone;
- flatten rhythmic emphasis;
- replace one major triad with add9/sus;
- avoid over-resolving every phrase.

Do not assume "cheesy" means "use more dissonance".

---

# 53. Diagnostic: "sounds muddy"

Check:

1. Are chord voices below about the mid register packed in thirds?
2. Is bass duplicating chord roots?
3. Are sustained reverb tails overlapping chord changes?
4. Are both hands/parts playing five-note chords?
5. Is the fifth necessary?
6. Can one extension be raised an octave?

First harmonic fix:

remove redundant low notes.

Do not immediately EQ a voicing problem.

---

# 54. Diagnostic: "doesn't feel emotional"

Do not answer by adding a random maj7.

Check:

- Is there a clear stable note?
- Is there a note that moves by semitone into/out of stability?
- Does the top line have shape?
- Does one chord delay a resolution?
- Does the harmonic rhythm support the phrase?
- Is there contrast between loop 1 and loop 2?
- Is the melody interacting with the chord colour?

Emotion often comes from **movement between notes**, not the chord symbol in isolation.

---

# 55. Practical Pattern Library

Use these as templates, not finished songs.

## Major pop/house
`I - V - vi - IV`

C:
`C - G - Am - F`

Upgrade:
`Cmaj7 - G/B - Am7 - Fadd9`

---

## Minor dance loop
`i - VI - III - VII`

A minor:
`Am - F - C - G`

Upgrade:
`Am9 - Fmaj7 - C/E - Gsus4/G`

---

## Functional turnaround
`I - vi - ii - V`

C:
`C - Am - Dm - G`

Upgrade:
`Cmaj7 - Am7 - Dm9 - G13`

Use restrained voicing so the extensions do not overwhelm the style.

---

## Minor strong cadence
`i - iv - V7 - i`

A minor:
`Am - Dm - E7 - Am`

---

## Borrowed iv
`I - IV - iv - I`

C:
`C - F - Fm - C`

---

## Dorian
`i - IV`

A Dorian:
`Am7 - D7`

Characteristic pitch:
F#.

---

## Modal/pedal
Bass holds A:

`Am/A - G/A - D/A - F/A`

Exact interpretation depends on upper notes and melody.

---

# 56. Progression Scoring Rubric

After generating a candidate, score 0-2 on each dimension.

## Harmonic direction
0 = arbitrary
1 = usable
2 = clear intentional energy curve

## Voice leading
0 = unnecessary jumps
1 = acceptable
2 = controlled/common-tone-aware

## Bass line
0 = copied roots without thought
1 = functional
2 = melodic/supportive without stealing focus

## Melody compatibility
0 = clashes
1 = acceptable
2 = important melody notes are intentionally harmonized

## Register
0 = muddy/colliding
1 = workable
2 = space is deliberately allocated

## Rhythm
0 = mechanical
1 = appropriate
2 = groove/phrase-aware

## Variation
0 = monotonous or random
1 = coherent
2 = recognizable A/A' development

## Tension/release
0 = flat/random dissonance
1 = some direction
2 = clearly designed resolution

Total out of 16.

Below 10:
revise.

10-13:
usable.

14-16:
strong structural candidate, subject to listening/context.

Do not use the score as a substitute for musical judgement.

---

# 57. Agent Output Format Before Editing

When planning a new progression, internally produce a table like this:

| Bar | Function | Symbol | Bass | Upper notes | Top note | Tension | Rhythm |
|---|---|---|---|---|---|---|---|
| 1 | i | Am9 | A | C E G B | B | 1 | whole/stabs |
| 2 | VI | Fmaj7 | F | C E F A | A | 1 | whole/stabs |
| 3 | III | Cmaj9 | C | B D E G | G | 1 | whole |
| 4a | VII sus | G7sus4 | G | C D F G | G | 2 | beats 1-2 |
| 4b | VII dom | G7 | G | B D F G | G | 3 | beats 3-4 |

This forces the agent to make every layer explicit.

---

# 58. Agent Report After Editing

After completing an edit, report concisely:

```text
Key: A minor
Length: 4 bars

Progression:
Am9 | Fmaj7 | Cmaj9 | G7sus4 -> G7

Bass:
A | F | C | G

Main voicing logic:
- retained C/E between Am9 and Fmaj7
- retained B/D/G where possible into turnaround
- resolved C -> B in Gsus4 -> G7
- kept bass separate from upper chord voicing

Variation:
final G7 points back to Am9
```

Do not merely report:

"Added richer chords and smoother voice leading."

---

# 59. Hard Rules for the Codex Agent

1. Never use a chord name without being able to list its notes.
2. Never use "inversion" without specifying which bass note/voicing.
3. Never use "tension" without identifying the dissonant/unstable note and intended resolution.
4. Never use "voice leading" without comparing notes between adjacent chords.
5. Never add extensions to every chord by default.
6. Never treat chromatic notes as automatically wrong.
7. Never force the bass to play roots only.
8. Never duplicate low roots unnecessarily across bass and chord tracks.
9. Never change both progression and voicing at the same time when diagnosing a problem unless necessary.
10. Never assume more notes means a better chord.
11. Never ignore the melody/vocal.
12. Never ignore register.
13. Never ignore the loop boundary between final and first chord.
14. Never pretend to hear the result if audio monitoring is unavailable.
15. Always preserve a reversible version before radical changes.
16. Always give exact pitches/timing when describing an edit.
17. Prefer one purposeful surprise over constant random complexity.
18. Prefer controlled repetition plus variation over continual novelty.
19. If the user's brief is stylistically sparse, keep the harmony sparse.
20. Judge the chord part in the context of the full arrangement, not only solo.

---

# 60. Matt Johnson / Sol State Technique Checklist Operationalized for Ableton

The source video explicitly organizes a series of practical ideas including "Change One Chord", "Circle of Fifths", "Bass of Fifths", "Major/Minor Switch Up", "Fifths at the End", "Rhythmic Shifts", "Sneaky Fifths", "Reverse The Bass", chord/vocal fit, and unpredictability.

Use the following operational versions.

## Change One Chord
Keep three chords, replace one. Compare.

## Circle of Fifths
Introduce root movement by descending fifth/up fourth to strengthen direction.

## Bass of Fifths
Use root/fifth movement in bass rather than repeating only roots.

## Major/Minor Switch Up
Use parallel mixture or convert a minor-key dominant to major when function supports it.

## Fifths at the End
Strip the ending to an open fifth or let the fifth ring as a transition.

## Rhythmic Shifts
Move chord onsets/re-triggers without changing chord identity.

## Sneaky Fifths
Use brief open-fifth shapes as connective material.

## Reverse the Bass
Create contrary motion between bass and upper harmony.

## Vocal & Chord Fit
Treat sustained/accented vocal notes as harmonic constraints; avoid register masking and unwanted semitone collisions.

## Unpredictability
Establish a rule, then violate one element at a structural point.

The implementation must always be translated into specific MIDI notes.

---

# 61. Ableton-Specific Scale Awareness

Live 12 scale tools can help the workflow, but they are not the composer.

Use scale highlighting to:

- see diatonic tones;
- construct diatonic chords;
- transpose/select scale-aware material.

Do not allow it to erase intentional chromatic harmony.

If using a secondary dominant in C major:

`E7 = E G# B D`

G# will not belong to C major.

That is correct because it targets A/Am.

The agent must understand the harmonic reason before "fixing" it.

---

# 62. When to Use MIDI Generative/Transform Tools

Live 12 contains MIDI Transformations and Generators.

Use them as controlled assistants, not as a replacement for harmonic intent.

Good uses:

- create a starting rhythmic distribution;
- transform note timing;
- explore a variation;
- generate notes under a strict scale constraint;
- then curate manually.

Bad use:

"Generate chords until something sounds good."

The agent should know:

- the key;
- target chord function;
- desired top note;
- register;
- harmonic rhythm;

before accepting generated material.

---

# 63. Humanization Without Random Damage

Do not randomize note timing/velocity before the harmonic phrase works.

After the phrase works:

### Velocity
Apply small deliberate variation.

### Timing
For tight club music, chord timing should usually remain rhythmically intentional.

Humanization can be:

- chord-level timing offset;
- slightly different velocities;
- subtle note-length changes.

Avoid independently shifting every chord tone so far that attacks become sloppy unless the style calls for it.

---

# 64. Four-Bar Construction Template for the Agent

When asked "write me a chord progression" with insufficient detail:

1. infer/choose a key from project context;
2. choose a 4-bar skeleton appropriate to genre;
3. build triads;
4. create a bass line;
5. voice-lead upper notes;
6. add no more than 1-2 extension types;
7. create one tension event in bar 4;
8. program a rhythm appropriate to the existing drums;
9. create a second-pass variation if section length permits;
10. report exact chords/notes.

Example safe melodic/deep template:

```text
i9 | VImaj7 | III(add9) | VII7sus4 -> VII7
```

But do not force this formula into every track.

---

# 65. Eight-Bar Construction Template

Bars 1-4:
establish.

Bars 5-7:
repeat with minimal variation.

Bar 8:
increase return tension.

Example A minor:

```text
1 Am9
2 Fmaj7
3 Cmaj9
4 G7

5 Am9
6 Fmaj7
7 C/E
8 Dm7 (beats 1-2) -> E7 (beats 3-4)
```

E7 points strongly back to Am in the next phrase.

This creates a longer sentence than repeating the exact four bars twice.

---

# 66. Practical Chord Spelling Examples

## Cmaj9
Pitch classes:
C E G B D

Useful voicings:

- C2 G2 B2 D3 E3
- C2 E3 B3 D4
- with bass C: E3 B3 D4 G4

## Dm9
D F A C E

Useful:

- D2 A2 C3 E3 F3
- with bass D: F3 C4 E4 A4

## G13
G B D F E

The 13th is E.

Practical rootless version over G bass:

`B F E`

Add A if a 9th is wanted.

Do not assume the 11th C belongs in the voicing; it clashes strongly with B unless intentionally treated.

## Am9
A C E G B

With A bass:

`C3 G3 B3 E4`

---

# 67. Upper-Structure Minimalism

A sophisticated chord can be implied with three upper notes.

Example with bass C:

`E + B + D`

= 3rd + maj7 + 9th

strongly implies Cmaj9.

With bass G:

`B + F + A`

= 3rd + b7 + 9th

strongly implies G9.

This is often preferable to stacking five notes in a synth pad.

---

# 68. Low-Interval Limit Heuristic

This is not an absolute acoustics law, but a practical production heuristic:

- keep close intervals out of the sub/low-bass range;
- the lower the register, the wider the spacing should usually become;
- thirds that work beautifully around middle C can sound muddy an octave or two lower.

If a voicing is muddy, move a note **before** reaching for EQ.

---

# 69. Loop-Boundary Voice Leading

Always compare:

`last chord -> first chord`

not just chords inside the clip.

A four-bar loop can have perfect internal voice leading and an ugly reset at bar 1.

For each voice, calculate the transition across the loop boundary.

If bar 4 is G7 and bar 1 is Cmaj7:

Use G7 voicing:

`B D F G`

Cmaj7:

`B C E G`

Movement:

- B stays
- D -> C
- F -> E
- G stays

Excellent loop resolution.

Design this intentionally.

---

# 70. Controlled Pedal Tones

## Upper pedal

Hold one note across multiple chords.

Example E:

`Am7 -> Fmaj7 -> C -> E`

E acts as:

- fifth of Am
- maj7 of F
- third of C
- root of E

The function changes while pitch stays fixed.

## Bass pedal

Hold A bass while upper harmony changes.

This creates a different effect: harmonic ambiguity and sustained foundation.

Do not confuse upper pedal and bass pedal.

---

# 71. Inner-Voice Line Design

Choose one middle voice and compose it.

Example chords in C:

`C -> Am -> F -> G`

Create inner line:

`E -> E -> F -> F`

Then resolve F -> E on loop return.

Another line:

`G -> A -> A -> B -> C`

The listener may not consciously isolate the line, but it creates direction inside the harmony.

---

# 72. When Repetition Is Better Than New Chords

If the track already has:

- evolving automation;
- changing drums;
- moving bass;
- arpeggio;
- vocal;

do not make the harmony continuously evolve too.

Keep the chord loop stable and vary:

- filter;
- octave;
- note density;
- reverb;
- rhythmic gating;
- one top note.

Composition and sound design share the listener's attention budget.

---

# 73. Chord Choice Under a Fixed Bass

If the bass is already written, treat each bass note as a constraint, not automatically the root.

Bass C can support:

- C
- Am/C
- F/C
- Dm7/C
- Ab/C in chromatic/modal contexts

Choose according to melody and function.

This is a powerful reharmonization method.

---

# 74. Bass Choice Under Fixed Chords

If chords are fixed, test bass alternatives.

Chord C major can use:

- C = root position
- E = C/E
- G = C/G

An upper C chord can also sit over pedal A, producing an Am-related or slash/polychord colour depending context.

Do not rename complex combinations casually; first judge what the ear/context treats as root.

---

# 75. Melody Collision Tests

For each sustained melody note over each chord:

1. Is melody note in chord?
2. If not, what interval above bass/root is it?
3. Does it resolve?
4. Is the dissonance stylistically intended?
5. Is the collision in the same octave/register?
6. Does another instrument double the conflicting note?

Examples:

Melody F over C major:
- F is 11th/sus4 against E.
- F and E create a semitone.

Possible fixes:
- use Csus4;
- omit E temporarily;
- resolve F -> E;
- choose Dm7/F or F harmony instead;
- keep clash intentionally if desired.

This is concrete harmonic diagnosis.

---

# 76. Chord Simplification Pass

After making a progression sophisticated, perform a subtraction pass.

For each chord ask:

- Does the fifth add anything?
- Is root already in bass?
- Does the seventh create useful colour?
- Does the ninth support melody/topline?
- Is there any duplicated pitch class?
- Are two adjacent voices too close in a low register?
- Can one note be omitted without losing identity?

Delete notes before adding processing.

---

# 77. No-Hand-Waving Standard

Every instruction the agent gives itself should be executable.

Bad:

> Make the G chord more tense.

Good:

> Replace G major (`G B D`) in bar 4 with G7sus4 for beats 1-2 (`G C D F`), then G7 for beats 3-4 (`G B D F`). Keep G, D, and F stationary; move C down one semitone to B at beat 3. This creates a suspension-resolution and points toward the next C/Am-family chord depending the loop.

Bad:

> Use an inversion for smoother voice leading.

Good:

> Change bar 2 G from `G2 B2 D3` to `B2 D3 G3` so the bass moves C3 -> B2 and the upper D/G can remain close to neighbouring voices.

Bad:

> Add a 9th for colour.

Good:

> Over Am, add B3 (the 9th) above `A2 C3 E3 G3`, or if the voicing is crowded, omit E3 and use `A2 C3 G3 B3`.

Bad:

> Add a borrowed chord.

Good:

> In C major, replace bar 4 F major (`F A C`) with F minor (`F Ab C`) on the second loop. Keep F/C fixed and move A down one semitone to Ab; on return to C major, move Ab down to G.

This standard applies throughout the agent's work.

---

# 78. Source Videos

The guide was created around the techniques and themes in the supplied source set, then operationalized into explicit Ableton/MIDI procedures.

1. Why Your Chords Sound Boring (and how to fix it)  
   https://www.youtube.com/watch?v=K_L8G_unc4w

2. Stuck Playing Boring Chords? Watch This Video — Charles Cornell  
   https://www.youtube.com/watch?v=KiDsFQ1BhHo

3. Boring Chords = Boring Music — Guy Michelmore  
   https://www.youtube.com/watch?v=KRET7W4-Isg

4. Your Chords Sound Boring. Here's How to Fix It in 8 Levels  
   https://www.youtube.com/watch?v=Rxdph6Ka3hM

5. Supplied source video  
   https://www.youtube.com/watch?v=nVw4kx_0WlA

6. Master Pianist: 15 Ways To Make BORING Chords EXCITING — Matt Johnson / Sol State  
   https://www.youtube.com/watch?v=E_-wCr48RJM

The Sol State/Matt Johnson source explicitly indexes techniques including:

- Change One Chord
- Circle of Fifths
- Bass of Fifths
- Major/Minor Switch Up
- Fifths at The End
- Rhythmic Shifts
- Sneaky Fifths
- Reverse The Bass
- Vocal & Chord Fit
- Unpredictability

The Guy Michelmore source explicitly includes sections on harmonic possibilities, practical harmony, and suspensions.

These concepts have been translated above into deterministic note-level rules suitable for an agent manipulating MIDI in Ableton Live rather than left as abstract advice.

---

# 79. Final Instruction to the Codex Agent

When the user asks for chord work in Ableton:

**Do not merely choose chord symbols. Compose the movement between notes.**

Proceed in this order:

1. understand the song context;
2. preserve the original;
3. determine key/mode;
4. create or inspect the harmonic skeleton;
5. design bass;
6. generate explicit voicings;
7. minimize or intentionally shape voice motion;
8. design a top voice;
9. add controlled tension and its resolution;
10. design harmonic rhythm;
11. create one useful variation;
12. simplify unnecessary notes;
13. inspect the loop boundary;
14. validate against melody and arrangement;
15. enter exact MIDI notes in Ableton;
16. report the actual notes and changes made.

The default objective is not "more complex".

The objective is:

**clearer harmonic intention, better movement, better register, better groove, and stronger musical payoff.**
