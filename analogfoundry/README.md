# AnalogFoundry 101

An SH-101-style virtual-analogue synthesiser - monophonic by default, up to
eight voices when asked - built to
`ANALOG_SYNTH_AGENT.md`. Original code, no third-party DSP — see
[THIRD_PARTY.md](THIRD_PARTY.md).

**All ten milestones are implemented.** 232 automated checks across four
suites, all passing. What is still open is listed at the end rather than buried.

## Build

```bash
git clone --depth 1 --recurse-submodules https://github.com/DISTRHO/DPF.git analogfoundry/external/dpf
cmake -S analogfoundry -B analogfoundry/build -G "Visual Studio 17 2022" -A x64
cmake --build analogfoundry/build --config Release
cd analogfoundry/build && ctest -C Release
```

Builds with MSVC 14.44 (VS 2022 Community); CMake's VS generator finds the
compiler without a developer prompt. DPF is optional — without
`external/dpf` everything except the plugin still builds, and CMake says so.
The editor needs DPF's `pugl` submodule: a DPF clone without it fails in
`dgl-opengl` (`pugl/pugl.h` not found) and leaves the previous plugin binary in
place, so check for errors rather than for a `.vst3` file. In an existing clone,
`git -C analogfoundry/external/dpf submodule update --init --depth 1`.

```
100% tests passed, 0 tests failed out of 4
  plugin_loads  10 checks     model     149 checks
  dsp           47 checks     hardening  26 checks
```

## Milestones

| | | Evidence |
|---|---|---|
| 1 | Skeleton, VST3 loads, test target | VST3 built via DPF; `plugin_load_test` dlopens it and reads the factory back: vendor `AnalogFoundry`, class `AnalogFoundry 101`, category `Audio Module Class` |
| 2 | Band-limited oscillators | PolyBLEP measures **13.8 dB** less aliasing than a naive ramp at 1873 Hz; saw harmonics −5.79/−9.24 dB vs the ideal −6.02/−9.54 |
| 3 | Envelope, LFO, glide | Attack timing within 20 %, mono last-note priority, legato glide, release to silence |
| 4 | Four-pole filter | **22.8 dB/octave**, self-oscillates at the cutoff, stable at 44.1/48/96 kHz |
| 5 | Nonlinear model, oversampling | Half-band decimator **118 dB** rejection; **123 dB** less folded energy at 4x than 1x with a driven saturator |
| 6 | Calibration and VCA | Saw/pulse/sub/noise matched to **within 0.03 dB** at the mixer; output level linear |
| 7 | Reference matching | `tools/analyse.py`: spectrum, envelope fit, filter sweep, loudness-matched comparison |
| 8 | Analogue variation | Component tolerance, drift, noise floor — all off by default, bit-identical when off, **< 1 dB** total effect when fully on |
| 9 | Hardening | Preset round trip bit-identical, out-of-range clamped, NaN replaced, level spread 44.1–96 kHz **0.01 dB**, survives per-sample automation and random note storms |
| 10 | Effect variant | `Effect101` reuses the same filter — proven by measuring it against `Filter101` directly, within 1 dB |
| — | Unison (beyond the 101) | 1-7 detuned copies of saw and pulse into the same filter; sub stays on the centre VCO. **Off by default and bit-identical when off** (reference renders unchanged, byte for byte); level held **within 0.7 dB** from 1 to 7 voices; level wobble 2.9 % -> 19-29 % at 25 cents: it really choruses |
| — | Expression (beyond the 101, 0.3) | Velocity to amp and cutoff, a **separate filter ADSR**, a vibrato that **fades in** after each note, slow **pitch drift**, and **glide on slurs only**. All off by default and **bit-identical when off** (full velocity is too). Measured: velocity 0.5 at full amp depth **-6.0 dB**; a soft note darker; the separate envelope closes the tone while the note sustains (brightness 1.35x early vs late, 1.00 shared); vibrato under 15 % of full depth in the first 200 ms, full after the fade; drift of 15 cents wanders 8-32 cents peak to peak; a detached note under legato glide starts on pitch, a slurred one slides. Why: the CamelPhat leads route velocity to cutoff (16 of 18), an envelope to cutoff, slow LFO to fine tune (8) and vibrato on a macro, none of which the 101's one envelope could do |
| — | Note memory and MIDI panic (0.3.1) | Last-note priority as before, but up to 16 held notes are remembered: releasing the newest returns, legato, to the newest note still held (it used to release the voice). Releasing an older note changes nothing that sounds. **CC 123** (all notes off) releases everything through the release stage; **CC 120** (all sound off) silences on the next sample. Reference renders byte-identical to 0.3.0; 13 checks |
| — | Oscillators and modulation (0.4) | **Oscillators 2 and 3**: saw, pulse, triangle or sine, each with level, octave, semitone and fine tune, through the shared unison stack. **LFO 2**, waveforms for both LFOs (sine, triangle, saw, square, sample-and-hold) and retrigger. **Pitch bend** (range 0-24 st), **mod wheel**, **aftertouch**. An **8-slot modulation matrix**: 9 sources (both envelopes, both LFOs, velocity, key, wheel, pressure, per-note random) to 16 destinations (cutoff, pitch, each oscillator's pitch and level, pulse width, resonance, amp, noise, sub, LFO rates, fine). Off by default, and reference renders are **byte-identical** to 0.3.1. Measured: each osc-2 wave within 0.5 dB of the saw's level; octave, semitone and fine tune to 0.5 Hz; bend to its range; velocity -> amp x1.5 = +3.5 dB; envelope -> pitch drops an octave to the note; LFO-2 square -> pitch exactly two semitones apart; sample-and-hold steps and repeats; note random differs per note and repeats per run; every feature at its extreme stays finite. 23 checks. Worst case (3 oscillators x 7-voice unison, all 8 slots) **22.7x realtime** |
| — | Sync, stereo, polyphony (0.5) | **Tempo-synced LFOs**: each LFO's mode packs wave, retrigger and one of 13 divisions (1/32 to 4 bars, with triplets and dotted), read from the host's tempo and bar position. While the transport plays a synced LFO is **locked to the bar**: a note started one cycle later sounds the same (difference < 1 %), half a cycle later the other way; retriggered, it starts with the note. Measured 1/4 at 120 = 2.0 Hz, at 150 = 2.5 Hz, 1/8 at 120 = 4 Hz. **Stereo**: unison voices panned equal-power across the field (`stereo` 0-1); spread 1 takes the channel correlation below 0.8 and holds each channel's level within 1.5 dB; spread 0, or unison off, is mono bit for bit. **Polyphony**: `voices` 1-8; one voice is the monophonic 101 **bit for bit** (legato, glide, note memory), more give each note its own voice and steal the oldest; a three-note chord sounds each note within 3 dB, 30 dB above the gaps. **Envelope 3**, a free ADSR as a matrix source. **Filter modes**: the ladder low-pass, a 24 dB high-pass (the fundamental down 40 dB) and a 2-pole band-pass (unity at the cutoff, the fundamental down 15 dB). Reference renders **byte-identical** to 0.4 after the filter fix. 23 checks. An editor shows every parameter in words and the matrix as "LFO 1 -> Cutoff +35 %" |
| — | Low-pass slope (0.6) | `filter_poles`: the ladder's output taken after 2, 3 or 4 of its poles, **12, 18 or 24 dB per octave**; resonance still feeds back from the fourth stage, as in a multimode ladder. Default 4, **bit-identical to 0.5**, and appended as parameter 64 so saved Sets keep their ids. In Live 12.4.6 (2026-10-09): Log.txt shows v0.6.0 loaded, Live lists all 64 parameters with Filter Slope last, and the bridge sets it by display (12 and 18 dB read back exactly). Measured: 2 and 3 poles fall 12 and 18 dB per octave (within 2 dB) two octaves above cutoff (`dsp_tests`). Why: 36 of the 60 Serum pack presets use MG Low 12 or 18, and at 24 dB they rendered up to 46 dB too dark above 5 kHz against the pack's loops |

## CPU

48 kHz, ten seconds of audio, DSP core only:

| | Realtime factor |
|---|---|
| 1x oversampling | 334x |
| 2x | 68x |
| **4x (default)** | **27x** |
| 4x + all nonlinearity and variation | 22x |
| 4x + unison, 7 voices | 25x (26x with 0.3) |
| 4x + 3 oscillators x unison 7 + 8 matrix slots (0.4) | 22.7x |
| 8 voices, 4 notes x unison 7, stereo (0.5) | 2.9x |
| 8 voices, 8 notes x unison 7, stereo (0.5) | 1.4x |
| Effect, 4x | 26x |

Stereo runs a second filter per voice and each note its own voice, so a pad costs
notes x unison x 2 filters: four notes of a 7-voice stereo stack is a third of a
core. Use 2-3 unison voices for pads; the converted Serum pads ask for up to 7.

## The 2x oversampling defect - fixed in 0.5

For a long time 2x put a 12 kHz corner at −18.1 dB instead of −12.0, and 4x was
1.4 dB off too, though every part measured transparent alone. The cause was C++,
not DSP: `Filter101::process` passed two `processOversampled()` calls as the
arguments of one function. Their order is unspecified, and MSVC evaluates
arguments right to left, so each pair of oversampled samples went through the
ladder's state backwards in time. Each sample now has its own statement:

| Quality | 3 kHz | corner (ideal −12.04) |
|---|---|---|
| 1x | −0.67 | −12.04 |
| 2x | — | **−12.04** (was −18.08) |
| 4x | −1.03 (ideal −1.05) | **−12.04** (was −13.41) |

`model_tests` now holds 2x and 4x to within 0.2 dB of the ideal. The default
stays 4x, which still folds the least aliasing. Its sound moved slightly, by
being right.

## Installing in Live

**Live on this machine loads AF101 from a custom VST3 folder**, not the system
one. Its plugin database records the path:

```
%USERPROFILE%\Documents\VST3\AnalogFoundry101.vst3
```

Install there, with Live closed (it holds the file open). A copy left in the
system folder, `%LOCALAPPDATA%\Programs\Common\VST3`, is ignored, and Live then
keeps loading the old build. The log line `plugin processor successfully loaded:
... v0.x.0` says which version actually loaded; check it after every install.
`PluginScanner.txt` in Live's Preferences folder gives the path it scanned.

Live needs **Preferences -> Plug-Ins -> Use VST3 Plug-In System Folders** on,
then **Rescan** (no restart). That was done once on this machine, and Live has
listed AF101 since. If `live.browse {"category": "plugins"}` ever returns 0
entries again, that switch is the first thing to check. Close Live before
copying a new build over the installed one, since Live holds the file open. A
Set restores a plugin with the parameter list it was saved with, so a new
parameter shows up only on a fresh instance (delete the device, then load it
again).

## Layout

```
src/dsp/      Oscillator, Filter101, Decimator, Envelope (+ Vca, smoother)
src/model/    Voice101, Synth101 (voices), Effect101, Calibration, Preset
src/plugin/   DPF wrapper (VST3 + CLAP), the editor (PluginUI) and Labels.h
tests/        dsp, model, hardening, plugin_load
tools/        render_note, bench, analyse.py
```

The DSP core has no plugin, GUI or host dependency, which is what lets the
same engine serve the renderer, the tests and the VST3.

## Converting Serum and Diva presets

`npm run convert-preset -- <.SerumPreset | .h2p | folder>... [--out DIR]` (from the
repo root) writes, for each preset, an AF101 patch (`.txt`), the Live devices to put
after it (`.chain.json`) and a report (`.md`) of what was mapped, approximated and
dropped, with every unit assumption by code (S1-S10, D1-D9). Since 0.5 a polyphonic
preset plays on AF101's voices (8 for Serum, Diva's own count), Serum's unison stereo
becomes `stereo`, a Serum high- or band-pass uses `filter_mode` rather than an EQ
Eight, synced LFOs are synced (1/4, the default the pack stores), and a third
envelope a route uses becomes env 3. The code is
`agent/src/presets/`, and the tests are `bridge/tests/presets.test.ts`. The default
output, `presets/converted/`, is **git-ignored**: patches derived from a licensed
pack stay on this machine.

Each patch's level is calibrated with `render_note` so that its loudest peak over
three notes sits at -3 dBFS, like the hand-made patches. Every converted patch loads
as written: known ids, nothing clamped, matrix slots that decode and survive Live's
32-bit normalised values (`bridge/tests/presets.test.ts`).

**Checked against the synths' own audio (2026-10-09).** Neither synth is installed,
but the CamelPhat pack's loops were played on its presets. Matching each loop to a
preset's demo MIDI by its exact pitches (a semitone spectrogram against each clip's
notes and harmonics) finds 21 that clearly belong to one preset: Synth Loops 02-11
and Bass Loops 12, 18 and 20 are Serum, Synth Loops 12, 13, 15 and 18-20 and Bass
Loops 07 and 10 are Diva. Pitch classes and rhythm alone are not enough: they put
Synth Loop 13 on Serum's SY - Patterns when it is Diva's SY - Black, and two
"findings" made against it were wrong. `tools/pack_loops.py` renders each clip
through AF101 (`render_note --events`) and compares six bands, 40 Hz-12 kHz, with
the loop; it fails if a converter change makes any pair worse.

Fixed by measuring against them (the report's codes): Serum mod sources off by one,
so the mod wheel played as an amp-envelope sweep (S11); every synced LFO at 1/4 (S7);
LFOs never retriggered (S7); unipolar LFO routes centred on the base (S13); octave
unison stacks dropped - they go an octave up (S12); LFO drawn shapes ignored (S14,
read from the file, not measurable in the loops); Diva's cutoff an octave too high (D2).

| Band error against the source | Before | Without filter slopes | Now |
|---|---|---|---|
| Serum, 13 presets: median / mean | - | 2.1 / 4.2 dB | 1.9 / 2.7 dB |
| Diva, 8 presets: median / mean | 6.3 / 5.8 dB | - | 1.7 / 3.1 dB |

For the four Serum pairs measured first, the before -> now band errors were Coast
4.2 -> 0.7, Lines 11.7 -> 4.6, Following 12.5 -> 7.0 and Patterns (against its real
loop) -> 2.1 dB.

**Filter slope (0.6).** Serum's MG Low 12 and 18 (22 presets store MgL18, and the 14
that store no type use MG Low 12, Serum 2's default) play on AF101's ladder taken
after two or three of its four poles: `filter_poles`, appended as parameter 64 so
every saved Set keeps its ids. Against the loops it brought SY - Desire from 13.8 to
1.6 dB, Lines 4.6 to 1.5, Page 5.1 to 3.6 and Magician 10.3 to 6.9; Dimension and
Patterns moved under 0.4 dB the other way.

Tested and kept: the cutoff modulation scale (S4) - scaling every cutoff route by 0.75
or 0.5, or the macro offsets by 0.5, made the median worse (1.9 -> 2.9-12.4 dB); and the
stored velocity amounts - no single scale helps more presets than it hurts.

**Checked against Serum 2 itself (2026-10-09).** With Serum 2 installed (demo), it was hosted
in Live with the pack presets loaded from Serum's own browser and played the same demo clips
as AF101's renders, captured alone. Tone error, AF101 against Serum: BS - Coast 1.7 dB,
LD - Horizons 1.8 (3.9 before S16), LD - Window 3.7 (5.8), SY - Lines 4.9 (2.6). The leads
were compared with Serum's effects off; level contours match at 0.98-1.00. The finding: noise a
WHITE NOISE macro raises from zero plays far quieter in Serum than the converter made it -
matched between the harmonics at 0.35 and 0.25 of it - so it is now converted at 0.3 (S16).
SY - Lines reads the other way, against both Serum and its loop (1.5 -> 2.4 dB): most likely a
second, Lines-specific error the louder noise was hiding. Open. Serum's own offline state could
not be loaded by an offline host, so every Serum render goes through Live and Serum's browser
(the demo also falls silent after a while and has to be re-added).

**A finer check: `tools/synth_compare.py`.** Six long-term bands catch a balance error
and nothing finer, so this compares two renders of the same notes in 31 third-octave
bands, frame by frame (23 ms), per note (harmonics 1-16 at start, middle and end), by
noise between the harmonics, by width, and by level and pitch wobble inside held notes, and
writes a level-matched A/B file alternating every two bars. Against Serum 2 (dry), as
converted: LD - Horizons 1.7 dB tone, harmonics within 2.7 dB at every stage; LD - Window
3.3 dB, harmonics 9 dB strong - its "AT Juno 106" table (frame 0 at that position: Serum steps
frames there) is 2-7 dB softer than AF101's saw above the 2nd harmonic.

The converter now reads that frame from Serum's installed tables (S5), not the table's
name. Across the pack's 98 table oscillators the nearest AF101 wave is 2.7 dB from the real
frame, against 6.3 for a saw throughout. Pack loops: SY - Dimension 4.0 -> 1.6 dB, SY - Page
3.6 -> 3.3, the rest unchanged; against Serum 2, Horizons 1.6 dB tone and harmonics 2.5,
Window 3.2 (its softer saw has no AF101 wave, and is reported). SY - Lines took a square for
Osc B (Jno frame 1, 21 dB from a saw): tone 2.8 -> 3.2 dB, harmonics 2.0 -> 1.6, loop 2.4 ->
2.8. Width does not compare yet: AF101 renders these mono, where Serum's dry output reads
-11 to -22 dB side - Lines from LFOs on per-oscillator pan (AF101 has none), Coast from its
Utility, Horizons probably from its chorus leaking past the FX mix.

**Envelopes, velocity and pitch movement: a test clip.** The demo clips have no lone held
notes, so four presets (BS - Coast, SY - Lines, LD - Horizons, LD - Window) played a test
clip in Serum 2: two notes held for two bars, a velocity ramp (40, 70, 100, 127), eight
16ths and a held chord. Serum's effects have to be **removed** for a dry capture (the ×
beside each in the FX list): these presets' macros modulate the effects' MIX knobs, so a
knob turned fully left still lets the effect through. What it found, all now in the
converter:

- Serum's amp envelope is squared and its segments end at their stored times (S17).
  Its own panel shows a stored sustain of 0.671 as -6.9 dB. Squared sustain and decay and
  release x 1.8 bring the held level within 0.1-1.4 dB (Horizons was 4.9 off) and the
  release within 0.5 dB on three presets (was 3.3-10.2); 1.8 was the best scale of 1.0-2.4
  for every one. A route from Env 1 reads the envelope itself, not the squared amp, so it
  gets a linear copy in a free envelope slot: without it SY - Lines' cutoff closed with the
  sustain and its loop went from 2.8 to 4.4 dB.
- A fine-tune route counts by its oscillator's share of the level, since AF101 has one
  pitch (S18). Horizons' pitch wobble on held notes: 16.5 cents added, 7.2 weighted,
  Serum 7.1.
- Velocity to brightness already matched (within 0.1 octave on three presets; Coast's
  lowest velocity is 0.5 octave too dark).

Still open from it: Window's tone (6.7 dB; its Juno saw table, and an LFO of Serum's
chaotic Rossler type that AF101 lacks; its pitch can't be measured, since AF101's render
reads 20 cents of tracker wobble with no pitch modulation at all); Horizons' noise between
the harmonics, 9 dB above Serum's on these low notes against 1 dB on its demo clip (Serum's
noise may track the key); Coast's filter closing half as far over a held note; width
(AF101 renders mono: no per-oscillator pan). Pack loops after S17 and S18: Lines 2.6,
Kinetic 1.4, Smear 1.4, Following 6.8; Plans 1.1 -> 1.3 and Magician 6.9 -> 7.1, inside the
margin. Movement needs held,
single notes: the leads' demo clips have none and chords defeat pitch tracking, so LFO and
vibrato depth are not yet measured. A whole-file measure read the notes' own rhythm (one
beat at 124 BPM) as movement and nearly halved the bipolar routes on a false reading; that
change was reverted.

Still open, and probably how each loop was played rather than a conversion rule (the
demo clips automate macros, and a loop's velocities need not be the MIDI's):
SY - Following (7.0 dB, too bright: halving its filter-envelope or velocity depth
fixes it, but that breaks Coast and Lines), SY - Magician (6.9 dB, too dark: dropping
its negative velocity route gives 2.1), and Diva's BS - Life, BS - Tops and SY - Using
(deep, short filter envelopes; no single envelope-time scale fits all three). Not
measurable with these loops: wavetables other than the analog saws, LFO shapes (S14),
the bipolar route span (S13) and the default envelope times (S2). Basic Mini at
position 1 measured as a saw. A loop includes the synth's effects, so these numbers are
for tone, not a null test.

## Using it without the plugin

```bash
analogfoundry/build/Release/render_note.exe --note 45 --seconds 2.2 \
  --out bass.wav --saw 1.0 --sub 0.65 --pulse 0.25 --pw 0.42 \
  --cutoff 420 --res 0.42 --env-cutoff 0.55 --track 0.3 \
  --attack 0.002 --decay 0.30 --sustain 0.27 --release 0.12
```

`--preset FILE` loads a patch first (later flags override it) and `--velocity V`
sets the note's velocity. `--events FILE --bpm B` plays a note list instead of one
note, one `beat length note velocity` per line, which is how a preset's demo clip is
rendered for comparison; `--mod-wheel W` holds the wheel. `--unison N --detune CENTS` stack up to 7 detuned voices (the outermost at
+/- the detune), and `--stereo S` spreads them across the field. `--voices N --chord 60,64,67`
plays a chord, and `--bpm B` runs a transport so synced LFOs follow it. The WAV is true
stereo; with spread 0 both channels are identical.

Render into `<User Library>/Samples/<project>/` and Live indexes it
immediately — no Place needs adding, unlike an arbitrary folder.

## Still open

The acceptance test the document actually cares about — *can a producer choose
this for a 101-style bass because the raw behaviour feels right?* — is a
listening question, and nothing here has been listened to. Reference matching
has the tools (Milestone 7) but no real 101 recordings have been compared
against yet; that needs source material.

Not yet checked in Live, and stated so rather than assumed:

- **Pitch bend, mod wheel, aftertouch and CC 123/120** are measured offline, but
  have not been played from a controller through Live.
- **The editor** builds and loads with the plugin (`plugin_load_test`), but has
  not been seen on screen: the standalone build needs a JACK server, which this
  machine does not have. Open it in Live before relying on it.
- **Host tempo**: the sync tests drive the transport directly. Live's reported
  bar position reaching the LFOs is wired (`getTimePosition`) but not yet heard.
