# Third-party code and licences

ANALOG_SYNTH_AGENT.md requires every external dependency to have its licence
inspected and recorded before use, and warns specifically against casually
importing GPL code into a project intended to remain permissively licensed.

## Status: one dependency, permissively licensed

`analogfoundry/` contains **no copied or adapted third-party DSP source**.
The one external dependency is the plugin framework:

| Dependency | Licence | How it is used |
|---|---|---|
| [DPF](https://github.com/DISTRHO/DPF) | **ISC** | Plugin wrapper for VST3 and CLAP. Fetched into `external/dpf`, not vendored. Optional: everything but the plugin builds without it. |

ISC is a permissive, GPL-free licence, which is why DPF was chosen over the
alternatives below. It also ships its own VST3 implementation, so the
Steinberg SDK - and its GPLv3-or-proprietary licence - is never involved.

The DSP is written from published algorithms:

| Technique | Where | Source of the idea |
|---|---|---|
| PolyBLEP band-limiting | `src/dsp/Oscillator.h` | Published polyBLEP method (Valimaki/Huovilainen's work on alias suppression); implemented from the algorithm, no code copied |
| Topology-preserving one-pole / ZDF ladder | `src/dsp/Filter101.h` | Zavalishin, *The Art of VA Filter Design* (freely published); implemented from the described structure |
| xorshift32 PRNG | `src/dsp/Oscillator.h` | Marsaglia's published xorshift; three lines of arithmetic, written directly |
| Exponential ADSR | `src/dsp/Envelope.h` | Standard one-pole-to-target; no external source |
| Kaiser-windowed half-band FIR | `src/dsp/Decimator.h` | Textbook windowed-sinc design with a Kaiser window; Bessel I0 from its series |
| Minimal IPluginFactory vtable | `tests/plugin_load_test.cpp` | The COM ABI layout only, declared directly so the test needs no Steinberg SDK |

Build dependencies are CMake and a C++17 compiler. Nothing is vendored and
there is no package manifest to audit.

## The plugin framework decision, and why

ANALOG_SYNTH_AGENT.md asks for a VST3 and says to inspect a framework's
licence *before* committing to it. That inspection ruled out the two obvious
choices and settled on DPF:

| Option | Licence | Consequence |
|---|---|---|
| JUCE | GPLv3 or paid commercial | GPLv3 would make the whole plugin GPL - against this document's own rule. The commercial licence costs money. |
| Steinberg VST3 SDK (direct) | GPLv3 or proprietary Steinberg agreement | Same fork in the road. |
| iPlug2 | Permissive (MIT-style) | Compatible. Still needs the VST3 SDK for a VST3 build. |
| **DPF (DISTRHO Plugin Framework)** | **ISC** | **Chosen.** Compatible, and has its own VST3 implementation, so no Steinberg SDK. Also gives CLAP for free. |
| CLAP + clap-wrapper | MIT | Compatible. Live does not host CLAP natively, so it needs the wrapper to reach VST3. |

The DSP core was built first regardless, because the document requires it to
be independent of the wrapper. DPF wraps `af::Voice101` without changing a
line of it: `src/plugin/PluginProcessor.cpp` only translates MIDI events and
parameter indices.

## Rules for adding anything

1. inspect the licence;
2. record it in this file with the source URL;
3. check compatibility with the intended licence of this project;
4. prefer reimplementing from a published algorithm over copying code;
5. never copy proprietary plugin code, leaked source, firmware, ROMs or
   factory content.

Note that the `synth/` directory elsewhere in this repository depends on Vita,
which is **GPLv3**. That dependency is optional, invoked as a separate process
and never linked - but it is a reason to keep these two subsystems apart.
