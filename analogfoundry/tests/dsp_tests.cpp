// Deterministic DSP tests. No framework: a failure prints the expression and
// the measured number, because "assert failed" is useless when the question is
// how much aliasing a change introduced.
//
// Covers what ANALOG_SYNTH_AGENT.md asks for under "Automated Tests":
// DSP stability, MIDI behaviour, determinism, parameter extremes - plus the
// oscillator and filter measurements it asks be recorded rather than asserted
// by ear.

#include <cmath>
#include <complex>
#include <cstdio>
#include <string>
#include <vector>

#include "../src/model/Voice101.h"

namespace {

int gFailures = 0;
int gChecks = 0;

void check(bool condition, const std::string& what, double measured) {
  ++gChecks;
  if (!condition) {
    ++gFailures;
    std::printf("  FAIL  %-58s measured %.6g\n", what.c_str(), measured);
  }
}

bool finiteAll(const std::vector<double>& xs) {
  for (double x : xs) {
    if (!std::isfinite(x)) return false;
  }
  return true;
}

double peak(const std::vector<double>& xs) {
  double p = 0.0;
  for (double x : xs) p = std::fmax(p, std::fabs(x));
  return p;
}

double rms(const std::vector<double>& xs) {
  if (xs.empty()) return 0.0;
  double sum = 0.0;
  for (double x : xs) sum += x * x;
  return std::sqrt(sum / static_cast<double>(xs.size()));
}

/// Goertzel magnitude at one frequency. Cheaper and clearer than a full FFT
/// when the question is "how much energy is at exactly this partial".
double magnitudeAt(const std::vector<double>& x, double hz, double sampleRate) {
  const double w = 2.0 * af::kPi * hz / sampleRate;
  std::complex<double> acc{0.0, 0.0};
  for (size_t n = 0; n < x.size(); ++n) {
    const double a = w * static_cast<double>(n);
    acc += x[n] * std::complex<double>(std::cos(a), -std::sin(a));
  }
  return std::abs(acc) / static_cast<double>(x.size());
}

/// Energy at frequencies that are NOT harmonics of f0 - i.e. aliasing.
///
/// The test frequency matters enormously here. When f0 divides the sample
/// rate exactly (2 kHz at 48 kHz, say) every aliased image folds back *onto*
/// a harmonic and this measurement reports almost nothing, however bad the
/// aliasing is. Callers must use a fundamental that does not divide the rate.
double inharmonicEnergy(const std::vector<double>& x, double f0, double sampleRate) {
  const double nyquist = sampleRate * 0.5;
  double total = 0.0;
  for (double hz = 300.0; hz < nyquist - 300.0; hz += 37.0) {
    const double ratio = hz / f0;
    const double nearest = std::round(ratio);
    if (std::fabs(ratio - nearest) < 0.08) continue;  // skip real harmonics
    const double m = magnitudeAt(x, hz, sampleRate);
    total += m * m;
  }
  return std::sqrt(total);
}

std::vector<double> renderOscillator(double f0, double sampleRate, int n, bool naive) {
  af::Oscillator osc;
  osc.setSampleRate(sampleRate);
  osc.setFrequency(f0);
  osc.reset();
  std::vector<double> out;
  out.reserve(static_cast<size_t>(n));
  for (int i = 0; i < n; ++i) {
    osc.tick();
    out.push_back(naive ? osc.naiveSawForTesting() : osc.saw());
  }
  return out;
}

// ---------------------------------------------------------------- oscillator

void oscillatorTests() {
  std::printf("oscillator\n");
  const double sr = 48000.0;

  // Band-limiting must measurably beat a naive ramp at a high fundamental,
  // where aliasing is worst. 1873 Hz deliberately does not divide 48 kHz; see
  // inharmonicEnergy for why that choice decides whether this measures
  // anything at all.
  const double f0 = 1873.0;
  const auto blep = renderOscillator(f0, sr, 16384, false);
  const auto naive = renderOscillator(f0, sr, 16384, true);
  const double aliasBlep = inharmonicEnergy(blep, f0, sr);
  const double aliasNaive = inharmonicEnergy(naive, f0, sr);
  const double improvementDb = 20.0 * std::log10(aliasNaive / std::fmax(aliasBlep, 1e-12));
  check(improvementDb > 10.0, "polyBLEP beats naive saw by >10 dB at 1873 Hz", improvementDb);
  std::printf("        aliasing improvement at 1873 Hz: %.1f dB\n", improvementDb);

  // The fundamental must survive band-limiting.
  const double fundamental = magnitudeAt(blep, f0, sr);
  check(fundamental > 0.2, "saw fundamental present", fundamental);

  // Output stays in range at every frequency, including absurd ones.
  for (double hz : {1.0, 55.0, 440.0, 5000.0, 18000.0, 40000.0}) {
    const auto xs = renderOscillator(hz, sr, 4096, false);
    check(finiteAll(xs), "saw finite at " + std::to_string(static_cast<int>(hz)) + " Hz", hz);
    check(peak(xs) < 2.5, "saw bounded at " + std::to_string(static_cast<int>(hz)) + " Hz",
          peak(xs));
  }

  // Pulse width is clamped away from the degenerate ends.
  af::Oscillator osc;
  osc.setSampleRate(sr);
  osc.setPulseWidth(0.0);
  check(osc.pulseWidth() >= af::Oscillator::kMinPulseWidth, "pulse width clamped low",
        osc.pulseWidth());
  osc.setPulseWidth(1.0);
  check(osc.pulseWidth() <= af::Oscillator::kMaxPulseWidth, "pulse width clamped high",
        osc.pulseWidth());

  // A 50 % pulse must be symmetric: near-zero DC.
  osc.setFrequency(220.0);
  osc.setPulseWidth(0.5);
  osc.reset();
  double sum = 0.0;
  const int n = 48000;
  for (int i = 0; i < n; ++i) {
    osc.tick();
    sum += osc.pulse();
  }
  check(std::fabs(sum / n) < 0.02, "50% pulse has no DC offset", sum / n);

  // The sub must be exactly one octave below.
  osc.setFrequency(440.0);
  osc.reset();
  std::vector<double> sub;
  sub.reserve(16384);
  for (int i = 0; i < 16384; ++i) {
    osc.tick();
    sub.push_back(osc.subOctaveDown());
  }
  const double at220 = magnitudeAt(sub, 220.0, sr);
  const double at440 = magnitudeAt(sub, 440.0, sr);
  check(at220 > at440 * 4.0, "sub is one octave down (220 >> 440 Hz)", at220 / (at440 + 1e-12));

  // Noise is deterministic for a given seed.
  af::NoiseGenerator a(1234), b(1234);
  bool identical = true;
  for (int i = 0; i < 1000; ++i) {
    if (a.next() != b.next()) identical = false;
  }
  check(identical, "noise is deterministic for a seed", identical ? 1.0 : 0.0);
}

// -------------------------------------------------------------------- filter

void filterTests() {
  std::printf("filter\n");
  const double sr = 48000.0;

  // Stability across the whole cutoff/resonance plane, driven hard.
  af::Filter101 filter;
  filter.setSampleRate(sr);
  bool stable = true;
  double worst = 0.0;
  for (double res : {0.0, 0.3, 0.6, 0.9, 1.0}) {
    for (double hz : {10.0, 40.0, 200.0, 1000.0, 8000.0, 20000.0}) {
      filter.reset();
      filter.setResonance(res);
      filter.setCutoff(hz);
      af::NoiseGenerator noise(99);
      for (int i = 0; i < 8000; ++i) {
        const double y = filter.process(noise.next() * 4.0);  // driven above nominal
        if (!std::isfinite(y)) stable = false;
        worst = std::fmax(worst, std::fabs(y));
      }
    }
  }
  check(stable, "filter stays finite across cutoff/resonance extremes", stable ? 1.0 : 0.0);
  check(worst < 50.0, "filter output bounded when driven above nominal", worst);

  // It must actually be a low-pass: a tone above cutoff is attenuated more
  // than one below it.
  auto toneThrough = [&](double toneHz, double cutoffHz) {
    filter.reset();
    filter.setResonance(0.0);
    filter.setCutoff(cutoffHz);
    std::vector<double> out;
    out.reserve(12000);
    for (int i = 0; i < 12000; ++i) {
      const double x = std::sin(2.0 * af::kPi * toneHz * i / sr);
      out.push_back(filter.process(x));
    }
    out.erase(out.begin(), out.begin() + 4000);  // let it settle
    return rms(out);
  };
  const double below = toneThrough(200.0, 1000.0);
  const double above = toneThrough(8000.0, 1000.0);
  check(below > above * 8.0, "low-pass: 200 Hz passes, 8 kHz rejected", below / (above + 1e-12));
  std::printf("        1 kHz cutoff: 200 Hz %.3f, 8 kHz %.5f rms\n", below, above);

  // Four poles means roughly -24 dB/octave. Measure two octaves above cutoff.
  const double oneOctave = toneThrough(2000.0, 1000.0);
  const double twoOctaves = toneThrough(4000.0, 1000.0);
  const double slopeDb = 20.0 * std::log10(oneOctave / std::fmax(twoOctaves, 1e-12));
  check(slopeDb > 15.0, "slope steeper than 15 dB/octave (4-pole)", slopeDb);
  std::printf("        measured slope: %.1f dB/octave\n", slopeDb);

  // Taking the output after fewer poles: 6 dB per octave per pole, two octaves out.
  for (int poles : {2, 3}) {
    filter.setOutputPoles(poles);
    const double one = toneThrough(4000.0, 1000.0);
    const double two = toneThrough(8000.0, 1000.0);
    const double db = 20.0 * std::log10(one / std::fmax(two, 1e-12));
    check(std::fabs(db - 6.0 * poles) < 2.0, std::to_string(poles) + "-pole tap falls about " + std::to_string(6 * poles) + " dB/octave", db);
  }
  filter.setOutputPoles(4);

  // Resonance must add level at the cutoff, not merely exist as a parameter.
  auto peakAtCutoff = [&](double res) {
    filter.reset();
    filter.setResonance(res);
    filter.setCutoff(1000.0);
    std::vector<double> out;
    out.reserve(12000);
    for (int i = 0; i < 12000; ++i) {
      const double x = std::sin(2.0 * af::kPi * 1000.0 * i / sr);
      out.push_back(filter.process(x));
    }
    out.erase(out.begin(), out.begin() + 4000);
    return rms(out);
  };
  const double dry = peakAtCutoff(0.0);
  const double wet = peakAtCutoff(0.8);
  check(wet > dry * 1.5, "resonance emphasises the cutoff frequency", wet / (dry + 1e-12));

  // Self-oscillation: at full resonance with no input, it must sustain a tone
  // near the cutoff rather than decay to silence or blow up.
  filter.reset();
  filter.setResonance(1.0);
  filter.setCutoff(440.0);
  std::vector<double> ring;
  ring.reserve(40000);
  for (int i = 0; i < 40000; ++i) {
    const double impulse = (i == 0) ? 1.0 : 0.0;
    ring.push_back(filter.process(impulse));
  }
  std::vector<double> tail(ring.end() - 16384, ring.end());
  const double tailRms = rms(tail);
  check(tailRms > 1.0e-3, "self-oscillates at full resonance", tailRms);
  check(finiteAll(tail), "self-oscillation stays finite", tailRms);
  if (tailRms > 1.0e-3) {
    const double atCutoff = magnitudeAt(tail, 440.0, sr);
    const double offCutoff = magnitudeAt(tail, 1500.0, sr);
    check(atCutoff > offCutoff * 3.0, "self-oscillation is near the cutoff",
          atCutoff / (offCutoff + 1e-12));
  }

  // Sample-rate independence: the same cutoff must reject the same tone.
  for (double rate : {44100.0, 48000.0, 96000.0}) {
    af::Filter101 f;
    f.setSampleRate(rate);
    f.setResonance(0.0);
    f.setCutoff(500.0);
    std::vector<double> out;
    const int n = static_cast<int>(rate * 0.2);
    out.reserve(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
      out.push_back(f.process(std::sin(2.0 * af::kPi * 4000.0 * i / rate)));
    }
    out.erase(out.begin(), out.begin() + n / 3);
    check(rms(out) < 0.05, "4 kHz rejected at " + std::to_string(static_cast<int>(rate)) + " Hz",
          rms(out));
  }
}

// ------------------------------------------------------------------ envelope

void envelopeTests() {
  std::printf("envelope\n");
  const double sr = 48000.0;
  af::Envelope env;
  env.setSampleRate(sr);
  env.setAttack(0.05);
  env.setDecay(0.1);
  env.setSustain(0.5);
  env.setRelease(0.2);

  // Attack must reach full level in about the stated time, not merely
  // approach it. 20 % tolerance on an exponential curve.
  env.reset();
  env.noteOn();
  int samples = 0;
  while (env.stage() == af::Envelope::Stage::Attack && samples < static_cast<int>(sr)) {
    env.tick();
    ++samples;
  }
  const double attackSeconds = samples / sr;
  check(attackSeconds > 0.04 && attackSeconds < 0.06, "attack takes ~50 ms", attackSeconds);

  // Decay must settle at sustain.
  for (int i = 0; i < static_cast<int>(sr * 0.5); ++i) env.tick();
  check(std::fabs(env.value() - 0.5) < 0.01, "decays to the sustain level", env.value());

  // Release must reach silence and go idle.
  env.noteOff();
  for (int i = 0; i < static_cast<int>(sr * 2.0); ++i) env.tick();
  check(env.value() < 1.0e-4, "release reaches zero", env.value());
  check(!env.isActive(), "goes idle after release", env.isActive() ? 1.0 : 0.0);

  // A zero-length attack must not produce NaN or hang.
  env.setAttack(0.0);
  env.reset();
  env.noteOn();
  env.tick();
  check(std::isfinite(env.value()), "zero attack is finite", env.value());

  // Sustain 0 must still produce a usable pluck, not silence.
  af::Envelope pluck;
  pluck.setSampleRate(sr);
  pluck.setAttack(0.001);
  pluck.setDecay(0.1);
  pluck.setSustain(0.0);
  pluck.reset();
  pluck.noteOn();
  double maxValue = 0.0;
  for (int i = 0; i < static_cast<int>(sr * 0.05); ++i) maxValue = std::fmax(maxValue, pluck.tick());
  check(maxValue > 0.9, "sustain 0 still reaches full level on attack", maxValue);
}

// --------------------------------------------------------------------- voice

std::vector<double> renderVoice(const af::Voice101Parameters& p, int midiNote, double sr,
                                double noteSeconds, double totalSeconds) {
  af::Voice101 voice;
  voice.setSampleRate(sr);
  voice.setParameters(p);
  voice.reset();
  voice.noteOn(midiNote);
  const int noteSamples = static_cast<int>(noteSeconds * sr);
  const int total = static_cast<int>(totalSeconds * sr);
  std::vector<double> out;
  out.reserve(static_cast<size_t>(total));
  for (int i = 0; i < total; ++i) {
    if (i == noteSamples) voice.noteOff(midiNote);
    out.push_back(voice.process());
  }
  return out;
}

void voiceTests() {
  std::printf("voice\n");
  const double sr = 48000.0;
  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.subLevel = 0.5;
  p.cutoffHz = 800.0;
  p.resonance = 0.4;
  p.envToCutoff = 0.5;
  p.attack = 0.002;
  p.decay = 0.3;
  p.sustain = 0.3;
  p.release = 0.1;

  const auto out = renderVoice(p, 45, sr, 0.5, 1.0);
  check(finiteAll(out), "voice output is finite", peak(out));
  check(peak(out) > 0.05, "voice actually makes sound", peak(out));
  check(peak(out) < 4.0, "voice output is bounded", peak(out));

  // The note must be at the right pitch: MIDI 45 is 110 Hz.
  std::vector<double> body(out.begin() + 2000, out.begin() + 18000);
  const double at110 = magnitudeAt(body, 110.0, sr);
  const double at130 = magnitudeAt(body, 130.0, sr);
  check(at110 > at130 * 2.0, "MIDI 45 sounds at 110 Hz", at110 / (at130 + 1e-12));

  // It must fall silent after release rather than hanging.
  std::vector<double> tail(out.end() - 4000, out.end());
  check(peak(tail) < 1.0e-3, "silent after release", peak(tail));

  // Determinism: identical parameters must give a bit-identical render.
  const auto again = renderVoice(p, 45, sr, 0.5, 1.0);
  bool identical = out.size() == again.size();
  if (identical) {
    for (size_t i = 0; i < out.size(); ++i) {
      if (out[i] != again[i]) {
        identical = false;
        break;
      }
    }
  }
  check(identical, "render is deterministic", identical ? 1.0 : 0.0);

  // No clicks on note events: the VCA smoother must stop the first sample
  // jumping straight to full level.
  check(std::fabs(out[0]) < 0.05, "no click on note-on", std::fabs(out[0]));

  // Parameter extremes must not break anything.
  af::Voice101Parameters extreme;
  extreme.sawLevel = 1.0;
  extreme.pulseLevel = 1.0;
  extreme.subLevel = 1.0;
  extreme.noiseLevel = 1.0;
  extreme.cutoffHz = 20.0;
  extreme.resonance = 1.0;
  extreme.envToCutoff = 1.0;
  extreme.lfoToCutoff = 1.0;
  extreme.lfoToPitch = 12.0;
  extreme.lfoRateHz = 50.0;
  extreme.keyboardTracking = 1.0;
  extreme.attack = 0.0;
  extreme.decay = 0.0;
  extreme.sustain = 1.0;
  extreme.glideSeconds = 0.5;
  const auto wild = renderVoice(extreme, 100, sr, 0.3, 0.6);
  check(finiteAll(wild), "survives every parameter at its extreme", peak(wild));
  check(peak(wild) < 20.0, "bounded at parameter extremes", peak(wild));

  // Glide: a second note must arrive at the new pitch, having passed through
  // the interval rather than jumping.
  af::Voice101Parameters glide;
  glide.sawLevel = 1.0;
  glide.cutoffHz = 4000.0;
  glide.sustain = 1.0;
  glide.attack = 0.001;
  glide.glideSeconds = 0.15;
  af::Voice101 voice;
  voice.setSampleRate(sr);
  voice.setParameters(glide);
  voice.reset();
  voice.noteOn(45);
  for (int i = 0; i < static_cast<int>(sr * 0.3); ++i) voice.process();
  voice.noteOn(57);  // an octave up, overlapping -> glides
  std::vector<double> during;
  during.reserve(4096);
  for (int i = 0; i < 4096; ++i) during.push_back(voice.process());
  std::vector<double> settled;
  settled.reserve(16384);
  for (int i = 0; i < static_cast<int>(sr * 0.4); ++i) voice.process();
  for (int i = 0; i < 16384; ++i) settled.push_back(voice.process());
  const double at220 = magnitudeAt(settled, 220.0, sr);
  const double at110b = magnitudeAt(settled, 110.0, sr);
  check(at220 > at110b, "glide arrives at the target pitch", at220 / (at110b + 1e-12));

  // A released note that is not the sounding one must be ignored.
  af::Voice101 mono;
  mono.setSampleRate(sr);
  mono.setParameters(glide);
  mono.reset();
  mono.noteOn(45);
  mono.noteOn(52);
  mono.noteOff(45);  // the older note: must not stop the voice
  double after = 0.0;
  for (int i = 0; i < 2000; ++i) after = std::fmax(after, std::fabs(mono.process()));
  check(after > 0.01, "releasing an older note does not cut the voice", after);
}

}  // namespace

int main() {
  std::printf("AnalogFoundry 101 - DSP tests\n\n");
  oscillatorTests();
  filterTests();
  envelopeTests();
  voiceTests();
  std::printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
