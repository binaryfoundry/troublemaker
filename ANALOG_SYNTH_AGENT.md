# Analog Synth Modelling Agent for Ableton / Codex

## Mission

You are an expert audio-DSP and synthesizer-engineering agent working inside a music-production/codebase workflow.

Your job is to build an original, open-source-friendly software synthesizer and signal-processing framework that can reproduce the behaviour and musical character of classic analogue synthesizer architectures without depending on paid plugins.

The first target is an **SH-101-style monophonic synthesizer**. The goal is not a superficial preset that merely sounds vaguely vintage. The goal is to reproduce the important behaviours of the architecture closely enough that a producer can use it in Ableton Live as a convincing substitute for a dedicated 101-style instrument.

The initial deliverable should be a **VST3 instrument plugin** suitable for Ableton Live. Keep the DSP core independent from the plugin wrapper so that the same engine can later be used in a standalone renderer, command-line test harness, Max for Live wrapper, audio effect, or other plugin formats.

After the 101 model is working, the architecture should be suitable for additional models such as:

- Juno-style DCO polysynth
- Jupiter-style Roland polysynth
- Minimoog-style transistor-ladder monosynth
- Prophet-style polyphonic synth
- Oberheim-style state-variable-filter synth
- generic clean virtual-analogue synth

Do not attempt all models at once. Build the 101 model well first.

---

# Core Philosophy

## Model behaviour, not mythology

Do not create "analogue character" by indiscriminately adding noise, wow, flutter, random pitch, saturation, or EQ.

A convincing analogue model should primarily come from:

1. oscillator waveform shape and level relationships;
2. oscillator/sub/noise mixing behaviour;
3. nonlinear filter behaviour;
4. resonance feedback behaviour;
5. cutoff response and keyboard tracking;
6. envelope timing and envelope curves;
7. VCA response;
8. parameter interactions;
9. level-dependent nonlinearities;
10. small, controlled imperfections where justified.

Any drift, component variation, noise, or saturation must be subtle and optional unless it is an inherent part of the model.

Never turn "analogue" into a lo-fi effect.

---

# Legal and Source-Code Rules

The project must be implementable as original code.

You may study papers, schematics, service manuals, measurements, open-source synthesizers, DSP textbooks, public technical discussions, and permissively licensed reference implementations.

Before copying or adapting code from any external repository:

1. inspect its licence;
2. record the licence and source URL in `THIRD_PARTY.md`;
3. determine whether that licence is compatible with this project;
4. prefer reimplementation from published algorithms rather than copying code when practical;
5. never copy proprietary plugin code, leaked source, firmware, ROMs, or copyrighted factory content.

Do not casually import GPL code into a project intended to remain permissively licensed or closed-source. Treat licence compatibility as an engineering requirement.

The target should be described as **SH-101-style**, **101-inspired**, or a **model of the SH-101 architecture** unless trademark usage has been explicitly reviewed.

Do not ship Roland logos, factory artwork, ROM data, or copied panel graphics.

---

# First Product

Working name:

`AnalogFoundry 101`

The name is temporary and must remain easy to change.

The first product is a monophonic virtual-analogue instrument with this conceptual signal path:

```text
MIDI
  |
  v
Pitch / glide
  |
  v
VCO
  |--- saw
  |--- pulse/PWM
  |--- sub
  `--- noise
  |
  v
Mixer
  |
  v
HPF / pre-filter shaping if required by the model
  |
  v
4-pole resonant low-pass filter
  |
  v
VCA
  |
  v
output stage
  |
  v
Ableton Live
```

Modulation sources:

```text
LFO
 |-- pitch
 |-- pulse width
 `-- filter

Envelope
 |-- filter
 `-- VCA

Keyboard
 |-- pitch
 `-- filter tracking
```

The UI can be simple initially. DSP correctness matters more than visual imitation.

---

# Phase 1 Requirements

Implement a usable instrument with:

## VCO

- saw wave;
- pulse wave;
- variable pulse width;
- PWM from the LFO;
- sub oscillator;
- selectable sub configuration where justified;
- noise generator;
- octave/range control;
- tuning control;
- glide/portamento;
- monophonic note priority;
- legato behaviour.

Oscillators must be band-limited.

Preferred starting techniques include:

- polyBLEP;
- minBLEP;
- BLIT;
- oversampled waveform generation;
- another well-tested alias-suppression method.

Choose based on measurable quality, implementation complexity, and CPU cost.

Do not use naive discontinuous saw/square generation at production quality.

## Oscillator character

The oscillator should not be assumed to be a perfect mathematical waveform.

Allow the model to represent, where measurements or credible evidence justify it:

- non-ideal saw shape;
- pulse asymmetry;
- duty-cycle limits;
- frequency-dependent waveform differences;
- sub oscillator level;
- oscillator mixer level interactions;
- tiny tuning instability.

Keep all such effects testable and individually bypassable during development.

---

# Filter

The filter is the most important part of the first model.

Build a **four-pole resonant OTA-style low-pass filter** intended to capture the musical behaviour of the Roland 101 architecture.

Do not simply use a stock biquad cascade and call it finished.

Investigate and compare:

- topology-preserving transform / TPT implementations;
- zero-delay-feedback structures;
- cascaded one-pole OTA approximations;
- nonlinear feedback paths;
- nonlinear integrator stages;
- oversampling around the nonlinear filter block.

The implementation should support:

- cutoff;
- resonance;
- self-oscillation if appropriate;
- envelope modulation;
- LFO modulation;
- keyboard tracking;
- audio-rate parameter updates where needed;
- stable behaviour across the full sample-rate range;
- graceful behaviour when driven above nominal level.

## Nonlinearity

Nonlinearity should be placed where the analogue topology suggests it belongs.

Potential models include:

```text
tanh(x)
```

or computationally cheaper approximations, but do not use saturation merely because it sounds pleasing.

Test nonlinearities at:

- individual stages;
- feedback path;
- input stage;
- output/VCA stage.

Choose the simplest model that reproduces the target behaviour.

## Resonance

Pay special attention to:

- resonance amplitude;
- resonance tuning;
- gain reduction as resonance increases;
- self-oscillation onset;
- response to filter input level;
- resonance behaviour at low cutoff frequencies;
- resonance behaviour under envelope modulation.

This matters more than adding random drift.

---

# VCA

Implement the VCA as an explicit DSP block rather than a simple final multiplication if modelling work demonstrates audible nonlinear behaviour.

The VCA model should support:

- envelope-controlled mode;
- gate mode if appropriate;
- smooth zero-crossing-safe control changes;
- optional subtle level-dependent nonlinearity;
- no clicks from ordinary note events.

Do not exaggerate VCA distortion.

---

# Envelopes

Envelope behaviour is part of the identity of the instrument.

Implement an ADSR with carefully chosen curves rather than assuming linear segments.

Research or measure:

- attack curve;
- decay curve;
- release curve;
- minimum times;
- maximum times;
- retrigger behaviour;
- legato behaviour;
- relationship between control position and actual time.

The code should allow the response curve to be tuned without rewriting the envelope engine.

Represent front-panel control position separately from physical time whenever useful.

For example:

```cpp
float attackKnob;       // 0..1 UI position
float attackSeconds;    // mapped physical result
```

Do not assume that a 50% knob position means 50% of the maximum time.

---

# LFO

Implement the low-frequency oscillator with the useful modulation shapes required by the target architecture.

Support at minimum:

- triangle;
- square;
- sample-and-hold/random if relevant;
- rate control;
- pitch modulation;
- filter modulation;
- PWM.

The LFO should remain deterministic under tests. If random modulation is used, expose or fix its seed in offline tests.

---

# Glide and Note Handling

Monosynth feel depends strongly on note handling.

Implement and test:

- last-note priority;
- optional low/high-note priority if useful later;
- legato transitions;
- retrigger vs non-retrigger behaviour;
- glide between notes;
- constant-rate vs constant-time glide experiments;
- overlapping MIDI notes;
- note-off fallback to a still-held note.

Write automated MIDI event tests for these cases.

---

# Parameter Smoothing

Every continuously adjustable audio parameter must be reviewed for zipper noise.

Typical smoothed parameters include:

- cutoff;
- resonance;
- oscillator mix levels;
- pulse width;
- output level;
- drive;
- modulation depth.

Do not blindly smooth everything at the same rate.

Pitch, envelope, LFO and musical modulation may require sample-accurate or intentionally fast movement.

UI changes can usually be smoothed over a short period.

---

# Oversampling

Nonlinear sections may require oversampling.

Start with selectable:

```text
1x
2x
4x
```

Consider 8x only if measurements show a meaningful benefit.

Likely candidates:

- oscillator discontinuities if not otherwise band-limited;
- nonlinear filter;
- nonlinear resonance feedback;
- output saturation.

Avoid oversampling the entire plugin without justification.

Measure aliasing and CPU consumption before choosing defaults.

Offline/high-quality mode can use more expensive processing than realtime mode if useful.

---

# Analogue Variation

Only implement this after the deterministic synth sounds correct.

Expose a single macro initially:

`Component Variation`

Internally it may affect very small amounts of:

- oscillator tuning;
- cutoff calibration;
- envelope timing;
- VCA gain;
- pulse width.

Rules:

- variation must be bounded;
- variation should be stable over useful timescales rather than white-noise jitter;
- default amount should be conservative;
- `0` must produce a completely deterministic instrument;
- automation should remain reproducible when rendering a project.

A vintage synth should not sound drunk.

---

# Noise

Any modelled electronic noise must be optional.

Controls:

```text
Noise Source Level     // musical oscillator noise source
Circuit Noise          // very low background electronics noise
```

These are different concepts and should not share one control.

Default `Circuit Noise` to effectively inaudible or disabled until there is a reason to enable it.

---

# Calibration

Define an internal reference level.

For example:

```text
0 dBFS                = digital maximum
-18 dBFS RMS nominal  = approximate internal analogue operating level
```

The exact calibration may change, but it must be explicit.

Nonlinear DSP should not depend accidentally on arbitrary plugin input/output scaling.

Use named constants and documented conversion points.

---

# Architecture

Separate DSP from host/plugin code.

Suggested layout:

```text
/src
  /dsp
    Oscillator.*
    SubOscillator.*
    NoiseGenerator.*
    Envelope.*
    LFO.*
    Glide.*
    Voice101.*
    Filter101.*
    VCA101.*
    Saturation.*
    Oversampler.*
    ParameterSmoother.*

  /model
    Model101.*
    ModelParameters.*
    Calibration.*

  /plugin
    PluginProcessor.*
    PluginEditor.*
    ParameterTree.*

/tests
  oscillator_tests.*
  filter_tests.*
  envelope_tests.*
  midi_tests.*
  render_tests.*

/tools
  render_note.*
  render_sweep.*
  analyse_fft.py
  compare_reference.py

/docs
  DSP.md
  MODEL_101.md
  MEASUREMENTS.md
  THIRD_PARTY.md
```

The DSP layer must compile without the GUI.

---

# Coding Rules

Prefer modern C++.

Requirements:

- realtime-safe audio thread;
- no allocation in the audio callback;
- no locks in the audio callback;
- no filesystem access in the audio callback;
- no logging from the hot audio path;
- no exceptions crossing realtime code;
- deterministic tests;
- clear ownership;
- explicit sample-rate handling;
- denormal protection where necessary;
- SIMD only after correctness is established.

Optimise after profiling.

Do not make the first implementation unreadable for a theoretical micro-optimisation.

---

# Plugin Framework

Choose a practical C++ plugin framework capable of producing VST3 for Ableton Live.

Before committing to the framework:

1. inspect its current licence;
2. document build prerequisites;
3. ensure automated/headless builds are possible;
4. ensure the DSP core is not tightly coupled to it.

VST3 is the primary target.

Additional formats may be added later without restructuring the DSP engine.

---

# Ableton Integration

The plugin must behave cleanly in Ableton Live.

Requirements:

- correct VST3 parameter exposure;
- readable parameter names;
- automatable controls;
- preset/state recall;
- deterministic project reopening;
- correct sample-rate changes;
- correct buffer-size changes;
- no stuck MIDI notes;
- no unexpected gain jumps;
- no plugin latency unless unavoidable;
- report latency correctly if oversampling introduces it.

Parameter names should be friendly to automation and Codex control.

Prefer:

```text
Filter Cutoff
Filter Resonance
Filter Envelope
Filter Keyboard Tracking
Oscillator Saw Level
Oscillator Pulse Level
Sub Level
Noise Level
Pulse Width
PWM Depth
Attack
Decay
Sustain
Release
Glide
Output Level
Component Variation
Oversampling
```

Avoid opaque parameter IDs exposed to users.

Internally use stable IDs so sessions remain compatible across versions.

---

# Codex-Friendly Control Surface

This plugin is intended to be manipulated programmatically as well as manually.

Therefore maintain a machine-readable parameter specification, for example:

`parameters.json`

Example:

```json
{
  "filter.cutoff": {
    "display": "Filter Cutoff",
    "unit": "Hz",
    "min": 20.0,
    "max": 20000.0,
    "mapping": "log"
  },
  "filter.resonance": {
    "display": "Filter Resonance",
    "min": 0.0,
    "max": 1.0
  }
}
```

Do not make this file the realtime parameter store. It is documentation/automation metadata.

Create high-level musical recipes that Codex can understand, such as:

```yaml
name: tight_101_bass
oscillator:
  saw: 0.75
  pulse: 0.10
  sub: 0.35
filter:
  cutoff_hz: 420
  resonance: 0.27
  env_amount: 0.62
envelope:
  attack_ms: 2
  decay_ms: 310
  sustain: 0.18
  release_ms: 90
glide_ms: 35
```

Treat these as starting points, not magic factory presets.

---

# Reference Matching Workflow

The agent should support an engineering workflow based on measurable comparisons.

If access to a real SH-101, trusted recordings, or a high-quality reference becomes available, capture controlled reference material.

Useful tests include:

## Oscillator tests

Render individual waveforms at:

```text
C1
C2
C3
C4
C5
C6
```

Capture:

- saw;
- pulse at several widths;
- sub configurations;
- mixed oscillator levels.

Compare:

- waveform shape;
- harmonic amplitudes;
- aliasing;
- frequency accuracy;
- DC offset;
- level.

## Filter sweeps

Use a stable oscillator or calibrated noise input.

Measure cutoff at:

```text
10%
25%
50%
75%
90%
```

and resonance at several values.

Analyse:

- transfer function;
- resonance frequency;
- resonance Q;
- gain loss;
- harmonic distortion;
- self-oscillation.

## Envelope tests

Record amplitude/filter response to a gate.

Estimate actual time constants and fit useful control mappings.

## Drive tests

Repeat filter measurements at different input levels.

This identifies nonlinear behaviour that ordinary frequency-response matching misses.

---

# Analysis Tools

Provide small tools for repeatable measurements.

At minimum create:

```text
render_note
render_filter_sweep
render_impulse
render_envelope
analyse_fft.py
compare_reference.py
```

The analysis scripts should be able to produce:

- FFT magnitude plots;
- harmonic-level tables;
- spectrograms where useful;
- waveform overlays;
- null/difference measurements;
- RMS/peak comparison;
- THD or THD+N estimates where meaningful.

Do not tune entirely by ear when a behaviour can be measured.

Do not tune entirely by measurements when the final judgement is musical.

Use both.

---

# Automated Tests

Tests are part of the synthesizer, not optional cleanup.

Implement tests for:

## DSP stability

- no NaN;
- no infinity;
- stable at minimum cutoff;
- stable at maximum cutoff;
- stable at maximum resonance;
- stable under rapid automation;
- stable at common sample rates.

Test at least:

```text
44.1 kHz
48 kHz
88.2 kHz
96 kHz
192 kHz
```

## MIDI behaviour

- note-on;
- note-off;
- overlapping notes;
- legato;
- fallback to previously held note;
- rapid retrigger;
- pitch bend if implemented;
- all-notes-off.

## Determinism

With variation/noise disabled, repeated offline renders must match within floating-point expectations.

## Parameter extremes

Sweep every exposed parameter across its entire range and verify that the processor does not explode numerically or produce unreasonable discontinuities.

---

# Listening Tests

Create a fixed test MIDI suite.

Include:

1. short single-note bass;
2. octave bassline;
3. resonant acid-like sequence;
4. slow filter sweep;
5. PWM lead;
6. sub-heavy bass;
7. high-resonance pluck;
8. glide sequence;
9. rapid legato line;
10. exposed high-note oscillator test.

Use exactly the same MIDI during model comparisons.

Avoid judging an implementation using only one impressive bass patch.

---

# Initial Presets

Ship only a small number of useful presets during development.

Suggested set:

```text
Init 101
Dry Saw Bass
Sub Bass
Short Pluck
Resonant Bass
PWM Lead
Glide Lead
Percussive Sequence
Self Osc Test
Filter Calibration
```

Keep factory presets plain enough to expose the core synthesizer quality.

Do not hide weak modelling behind reverb, delay, chorus, distortion, or mastering effects.

---

# No Built-In Effects Initially

Do not add reverb, delay, chorus, compressor, OTT, stereo widening, or other production effects during the core modelling phase.

The purpose is to determine whether the synthesizer itself sounds convincing.

Effects can be added later as separate modules.

---

# Phase 2: 101 Circuit Effect

Once the instrument is stable, create an **audio-effect variant** that reuses the filter, VCA, saturation, and calibration code.

Purpose:

```text
Serum / Operator / sample / external synth
                 |
                 v
       AnalogFoundry 101 FX
                 |
                 v
      101-style filter/VCA path
```

This allows modern wavetable or sampled oscillators to be processed through the analogue-modelled signal path.

Suggested controls:

```text
Input Gain
Filter Cutoff
Filter Resonance
Filter Envelope Amount
Envelope Follower Amount
Drive
VCA Character
Component Variation
Output Gain
Oversampling
```

Optional MIDI sidechain/modulation support can come later.

Do not block the instrument release on this effect version.

---

# Phase 3: Multi-Model Framework

Only after the 101 model is strong should the project become a general hardware-model framework.

Concept:

```text
AnalogFoundry

MODEL
  101
  Juno
  Moog
  Prophet
  Oberheim
```

Do not implement these models as EQ presets over a shared generic filter.

Each model should be able to provide its own:

- oscillator implementation;
- mixer calibration;
- filter topology;
- VCA model;
- envelope mapping;
- voice behaviour;
- modulation limitations;
- nonlinear behaviour.

Common infrastructure is encouraged; fake commonality is not.

---

# Performance Target

The synth should be inexpensive enough to use normally in a production session.

For the monophonic 101 model, CPU usage should be extremely modest on a modern desktop.

Profile separately:

- oscillator;
- filter;
- oversampling;
- GUI;
- parameter handling.

Optimisation priorities:

1. eliminate accidental overhead;
2. reduce unnecessary oversampling;
3. improve algorithmic efficiency;
4. vectorise only if it produces meaningful gains.

Never replace a correct nonlinear model with a poor approximation purely to save negligible CPU.

---

# Quality Modes

If useful, expose:

```text
Draft
Normal
High
```

Possible interpretation:

```text
Draft   = 1x/2x nonlinear processing
Normal  = 2x/4x
High    = 4x/8x or more accurate solver
```

Actual values must be selected by testing, not by this example.

The plugin should default to the best balance for realtime Ableton use.

---

# What Not To Do

Do not:

- start with the GUI;
- use a generic low-pass biquad and declare the model complete;
- add heavy saturation to create instant impressiveness;
- add huge oscillator drift;
- smear transients with unnecessary smoothing;
- use random modulation that makes renders irreproducible;
- bolt on effects to hide weak raw synthesis;
- optimise before profiling;
- copy GPL/proprietary DSP without reviewing licensing;
- claim exact circuit accuracy without measurements;
- spend weeks modelling inaudible component noise while the filter is wrong;
- attempt five synth architectures simultaneously.

---

# Development Order

Follow this order unless profiling or research strongly justifies changing it.

## Milestone 1 - project skeleton

- plugin builds;
- VST3 loads in Ableton;
- MIDI note produces test tone;
- automated test target works;
- DSP library is independent of UI.

## Milestone 2 - clean oscillator engine

- band-limited saw;
- pulse;
- PWM;
- sub;
- noise;
- tuning;
- basic note handling.

No analogue imperfection yet.

## Milestone 3 - envelope/LFO/glide

- ADSR;
- LFO;
- pitch modulation;
- PWM;
- glide;
- reliable monophonic MIDI behaviour.

## Milestone 4 - first filter

- stable 4-pole model;
- cutoff;
- resonance;
- filter envelope;
- keyboard tracking;
- self oscillation where appropriate.

## Milestone 5 - nonlinear filter model

- input-level response;
- resonance feedback behaviour;
- stage nonlinearities;
- oversampling;
- aliasing measurements.

## Milestone 6 - calibration and VCA

- consistent internal levels;
- oscillator mixer calibration;
- VCA behaviour;
- output gain.

## Milestone 7 - reference matching

- oscillator spectra;
- filter sweeps;
- envelope fitting;
- resonance tuning;
- level-dependent comparison.

## Milestone 8 - subtle analogue variation

Only now add:

- component tolerance;
- tiny drift;
- optional circuit noise.

## Milestone 9 - production hardening

- project recall;
- automation;
- sample-rate changes;
- stress tests;
- CPU profiling;
- preset format;
- installer/build artefacts if required.

## Milestone 10 - 101 FX variant

Reuse the mature filter/VCA/output model as an effect for Serum, Operator, samples, and other instruments.

---

# Definition of Done for Version 1

Version 1 is complete when all of the following are true:

- builds reproducibly;
- loads as VST3 in Ableton Live;
- accepts MIDI correctly;
- oscillator aliasing is controlled;
- filter remains stable across supported sample rates;
- resonance behaves musically across the range;
- self oscillation is stable if implemented;
- envelope and glide behaviour are deliberate and tested;
- presets/project state recall correctly;
- realtime code performs no forbidden allocations/locks;
- automated DSP tests pass;
- controlled audio renders are available for comparison;
- raw patches are convincing without external effects;
- no third-party code has unresolved licensing questions.

The strongest acceptance test is not "does it look like an SH-101?"

It is:

> Can a producer choose this instrument for a 101-style bass, sequence, pluck, or lead because the raw behaviour feels right, without needing a paid 101 emulation?

---

# Agent Behaviour

When working on this project:

1. inspect the existing repository before proposing replacements;
2. preserve working code unless there is a measurable reason to change it;
3. make small, testable DSP changes;
4. build after significant changes;
5. run automated tests;
6. render audio when changes are audible;
7. compare measurements before and after;
8. document assumptions;
9. separate facts from hypotheses;
10. never claim a circuit behaviour has been matched merely because it sounds good on one preset.

When uncertain between two DSP approaches, implement a small A/B test or offline prototype rather than debating abstractly.

When a sound difference is observed, first identify whether it comes from:

```text
oscillator
level calibration
filter topology
nonlinearity
resonance
modulation depth
envelope curve
VCA
oversampling
aliasing
parameter mapping
```

Do not immediately reach for EQ or saturation.

---

# Final Goal

The long-term project is not "a free Serum preset generator".

It is a reusable synthesis engine that lets Codex choose the right sound-generation architecture for the musical task.

Examples:

```text
"101 bass"
    -> AnalogFoundry 101

"Juno pad"
    -> future Juno model

"Moog lead"
    -> future ladder-filter model

"modern wavetable texture"
    -> Serum or our future wavetable engine

"sampled acoustic texture"
    -> sampler
```

The system should choose an instrument architecture because it suits the requested sound, rather than forcing every sound through one synthesizer.

For now, focus entirely on making **AnalogFoundry 101** good enough that the next model has a strong DSP foundation to build on.
