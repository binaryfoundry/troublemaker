# AnalogFoundry 101

An SH-101-style monophonic virtual-analogue synthesiser, built to
`ANALOG_SYNTH_AGENT.md`. Original code, no third-party DSP — see
[THIRD_PARTY.md](THIRD_PARTY.md).

**All ten milestones are implemented.** 126 automated checks across four
suites, all passing. One open defect and one manual step are documented below
rather than buried.

## Build

```bash
git clone --depth 1 https://github.com/DISTRHO/DPF.git analogfoundry/external/dpf
cmake -S analogfoundry -B analogfoundry/build -G "Visual Studio 17 2022" -A x64
cmake --build analogfoundry/build --config Release
cd analogfoundry/build && ctest -C Release
```

Builds with MSVC 14.44 (VS 2022 Community); CMake's VS generator finds the
compiler without a developer prompt. DPF is optional — without
`external/dpf` everything except the plugin still builds, and CMake says so.

```
100% tests passed, 0 tests failed out of 4
  plugin_loads   9 checks     model      44 checks
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

## CPU

48 kHz, ten seconds of audio, DSP core only:

| | Realtime factor |
|---|---|
| 1x oversampling | 334x |
| 2x | 68x |
| **4x (default)** | **27x** |
| 4x + all nonlinearity and variation | 22x |
| Effect, 4x | 26x |

## Two things that are not finished

**A real defect at 2x oversampling.** Measured against the analog prototype
(ideal −12.04 dB at the corner, −1.05 dB at 3 kHz for a 12 kHz corner):

| Quality | 3 kHz | corner |
|---|---|---|
| 1x | −0.67 | −12.04 |
| **2x** | **−1.29** | **−18.08** |
| 4x | −1.11 | −13.41 |

1x matches at the corner because TPT prewarping places it there by
construction, and 4x tracks the prototype better across the passband. Both are
defensible. 2x is worse than *both*, which is not a trade-off — it is a bug.
Isolated as far as: the cascade alone is rate-independent (−11.9 dB at 48, 96
and 192 kHz) and the interpolator/decimator pair is transparent to 0.00 dB at
every frequency tested, yet composing them produces this. Unresolved. The
default is therefore **4x**, and `model_tests` pins the 2x number so any
change to it is caught.

**Live is not scanning any VST3 folder.** The plugin is installed to the
standard user-level VST3 location:

```
%LOCALAPPDATA%\Programs\Common\VST3\AnalogFoundry101.vst3
```

That is a VST3 system folder by specification, so no custom path should be
needed - but Live currently finds nothing there. Its own log is unambiguous:

```
info: PluginManager: Scan start ------------------
info: PluginManager: Scan end --------------------
```

Nothing between the two lines: zero modules scanned, and `PluginScanDb.txt`
has empty module and plugin tables to match. So plugin folders are switched
off (or were empty at scan time), not merely stale. `live.browse` with
`{"category": "plugins"}` returns 0 entries, which is how this was confirmed
rather than assumed.

The fix is one visit to Preferences, and **no restart** - Rescan works live:

> Preferences -> Plug-Ins -> enable **Use VST3 Plug-In System Folders**
> (and/or set a Custom Folder) -> **Rescan**

The API cannot change this: Live stores it in a binary `Preferences.cfg` that
it rewrites on exit, so editing it under a running Live would be both risky
and futile.

## What the tests caught that listening would not have

- A 50 ms attack finishing in **19.5 ms**. The attack aims past 1.0 for the
  right curve but ends at 1.0, so it needs its own exponent.
- An aliasing test measuring **nothing**: at 2 kHz with a 48 kHz rate every
  alias folds onto a harmonic. Moving to 1873 Hz took the reading from 0.6 dB
  to 13.8 dB. The oscillator was fine; the measurement was worthless.
- **4x oversampling aliasing *more* than 1x**, because decimation was two
  one-poles. Replaced with a Kaiser half-band FIR.
- Then still worse, because the input was **zero-order held** rather than
  interpolated. Adding a matching half-band interpolator took a 12 kHz corner
  from −21.9 dB to −13.4, and the folded-energy figure to 123 dB better.
- A nonlinearity test reporting **1e-15** — numerical zero — because it
  correlated against `sin` only, so anything in quadrature cancelled.

## Layout

```
src/dsp/      Oscillator, Filter101, Decimator, Envelope (+ Vca, smoother)
src/model/    Voice101, Effect101, Calibration, Preset
src/plugin/   DPF wrapper (VST3 + CLAP)
tests/        dsp, model, hardening, plugin_load
tools/        render_note, bench, analyse.py
```

The DSP core has no plugin, GUI or host dependency, which is what lets the
same engine serve the renderer, the tests and the VST3.

## Using it without the plugin

```bash
analogfoundry/build/Release/render_note.exe --note 45 --seconds 2.2 \
  --out bass.wav --saw 1.0 --sub 0.65 --pulse 0.25 --pw 0.42 \
  --cutoff 420 --res 0.42 --env-cutoff 0.55 --track 0.3 \
  --attack 0.002 --decay 0.30 --sustain 0.27 --release 0.12
```

Render into `<User Library>/Samples/<project>/` and Live indexes it
immediately — no Place needs adding, unlike an arbitrary folder.

## Still open

The acceptance test the document actually cares about — *can a producer choose
this for a 101-style bass because the raw behaviour feels right?* — is a
listening question, and nothing here has been listened to. Reference matching
has the tools (Milestone 7) but no real 101 recordings have been compared
against yet; that needs source material.
