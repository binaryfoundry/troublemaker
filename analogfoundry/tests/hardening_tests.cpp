// Milestone 9: production hardening.
//
// Project recall, automation ranges, sample-rate changes, and stress. These
// are the failures a user actually hits - a project that reopens sounding
// different, a host sending a parameter out of range, a sample-rate switch
// that leaves a voice screaming - and none of them are audible bugs in a
// quick listen. They need tests.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "../src/model/Preset.h"
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

std::vector<double> render(const af::Voice101Parameters& p, double sr, int note, int samples) {
  af::Voice101 v;
  v.setSampleRate(sr);
  v.setParameters(p);
  v.reset();
  v.noteOn(note);
  std::vector<double> out;
  out.reserve(static_cast<size_t>(samples));
  for (int i = 0; i < samples; ++i) out.push_back(v.process());
  return out;
}

void presetTests() {
  std::printf("preset and recall\n");

  // Every parameter must be in the table. A parameter the host cannot see is
  // a parameter that silently will not recall.
  check(af::parameterTable().size() >= 20, "parameter table is populated",
        static_cast<double>(af::parameterTable().size()));

  // Ids must be unique, or a preset would load the wrong field.
  bool unique = true;
  const auto& table = af::parameterTable();
  for (size_t i = 0; i < table.size(); ++i) {
    for (size_t j = i + 1; j < table.size(); ++j) {
      if (std::string(table[i].id) == table[j].id) unique = false;
    }
  }
  check(unique, "parameter ids are unique", unique ? 1.0 : 0.0);

  // Defaults must be inside their own declared ranges.
  bool defaultsValid = true;
  for (const auto& d : table) {
    if (d.defaultValue < d.minimum || d.defaultValue > d.maximum) defaultsValid = false;
    if (d.maximum <= d.minimum) defaultsValid = false;
  }
  check(defaultsValid, "defaults lie within their ranges", defaultsValid ? 1.0 : 0.0);

  // Round trip: save, load, and the sound must be bit-identical. This is what
  // "the project reopens the same" actually means.
  af::Voice101Parameters original;
  original.sawLevel = 0.8;
  original.subLevel = 0.42;
  original.pulseLevel = 0.3;
  original.pulseWidth = 0.37;
  original.cutoffHz = 734.5;
  original.resonance = 0.63;
  original.envToCutoff = 0.55;
  original.attack = 0.013;
  original.decay = 0.27;
  original.sustain = 0.31;
  original.release = 0.19;
  original.glideSeconds = 0.08;
  original.keyboardTracking = 0.4;

  const std::string text = af::savePreset(original);
  const af::Voice101Parameters restored = af::loadPreset(text);

  const auto a = render(original, 48000.0, 45, 24000);
  const auto b = render(restored, 48000.0, 45, 24000);
  bool identical = a.size() == b.size();
  for (size_t i = 0; identical && i < a.size(); ++i) {
    if (a[i] != b[i]) identical = false;
  }
  check(identical, "preset round trip is bit-identical", identical ? 1.0 : 0.0);

  // Unknown keys must be ignored, not fatal: a preset from a future build
  // should still load what it can.
  const af::Voice101Parameters future =
      af::loadPreset(text + "some_future_parameter 0.5\nanother 12\n");
  const auto c = render(future, 48000.0, 45, 24000);
  bool stillIdentical = c.size() == a.size();
  for (size_t i = 0; stillIdentical && i < a.size(); ++i) {
    if (a[i] != c[i]) stillIdentical = false;
  }
  check(stillIdentical, "unknown preset keys are ignored", stillIdentical ? 1.0 : 0.0);

  // A missing key must fall back to its default, not to garbage.
  const af::Voice101Parameters sparse = af::loadPreset("analogfoundry101 1\ncutoff 1000\n");
  check(sparse.cutoffHz == 1000.0, "sparse preset reads what is present", sparse.cutoffHz);
  check(sparse.sawLevel == 1.0, "sparse preset defaults what is absent", sparse.sawLevel);

  // Malformed input must not crash or produce NaN.
  const af::Voice101Parameters junk =
      af::loadPreset("not a preset\n\n###\ncutoff\nresonance abc\n\xff\xfe binary");
  const auto j = render(junk, 48000.0, 45, 4800);
  check(finiteAll(j), "malformed preset still yields a usable patch", peak(j));

  // Out-of-range values from a host must be clamped, not trusted.
  af::Voice101Parameters wild;
  wild.cutoffHz = 1.0e9;
  wild.resonance = 50.0;
  wild.sustain = -3.0;
  wild.attack = std::nan("");
  const af::Voice101Parameters safe = af::clampToRanges(wild);
  check(safe.cutoffHz <= 20000.0, "absurd cutoff is clamped", safe.cutoffHz);
  check(safe.resonance <= 1.0, "absurd resonance is clamped", safe.resonance);
  check(safe.sustain >= 0.0, "negative sustain is clamped", safe.sustain);
  check(std::isfinite(safe.attack), "NaN parameter is replaced by its default", safe.attack);

  // Normalised conversion must round trip, since that is what hosts automate.
  bool roundTrips = true;
  double worst = 0.0;
  for (const auto& d : table) {
    for (double t : {0.0, 0.25, 0.5, 0.75, 1.0}) {
      const double value = af::fromNormalised(d, t);
      const double back = af::toNormalised(d, value);
      worst = std::fmax(worst, std::fabs(back - t));
      if (std::fabs(back - t) > 1e-9) roundTrips = false;
    }
  }
  check(roundTrips, "normalised parameter conversion round trips", worst);
}

void sampleRateTests() {
  std::printf("sample rate and stress\n");

  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.subLevel = 0.5;
  p.cutoffHz = 1200.0;
  p.resonance = 0.6;
  p.envToCutoff = 0.5;
  p.sustain = 0.4;
  p.attack = 0.005;
  p.decay = 0.2;

  // The same patch must sound like the same patch at any supported rate.
  // Compared by RMS, since sample-by-sample equality is impossible across
  // rates - but a patch that changes character with the rate is broken.
  double levels[4];
  int index = 0;
  for (double sr : {44100.0, 48000.0, 88200.0, 96000.0}) {
    const auto out = render(p, sr, 45, static_cast<int>(sr * 0.5));
    check(finiteAll(out), "stable at " + std::to_string(static_cast<int>(sr)) + " Hz", peak(out));
    double sum = 0.0;
    for (double x : out) sum += x * x;
    levels[index++] = std::sqrt(sum / static_cast<double>(out.size()));
  }
  double lowest = levels[0], highest = levels[0];
  for (int i = 1; i < 4; ++i) {
    lowest = std::fmin(lowest, levels[i]);
    highest = std::fmax(highest, levels[i]);
  }
  const double spreadDb = 20.0 * std::log10(highest / lowest);
  check(spreadDb < 1.0, "level is consistent across sample rates within 1 dB", spreadDb);
  std::printf("        level spread 44.1-96 kHz: %.2f dB\n", spreadDb);

  // Changing the rate mid-flight must not leave the voice unstable. Hosts do
  // this when the audio device changes.
  af::Voice101 voice;
  voice.setSampleRate(48000.0);
  voice.setParameters(p);
  voice.reset();
  voice.noteOn(45);
  std::vector<double> out;
  for (int i = 0; i < 24000; ++i) out.push_back(voice.process());
  voice.setSampleRate(96000.0);  // reconfigure while sounding
  voice.noteOn(45);
  for (int i = 0; i < 48000; ++i) out.push_back(voice.process());
  check(finiteAll(out), "sample-rate change mid-note stays finite", peak(out));
  check(peak(out) < 5.0, "sample-rate change does not blow up", peak(out));

  // Stress: rapid note events, overlapping, out of order, with glide on.
  af::Voice101Parameters fast = p;
  fast.glideSeconds = 0.05;
  af::Voice101 stress;
  stress.setSampleRate(48000.0);
  stress.setParameters(fast);
  stress.reset();
  std::vector<double> stressed;
  stressed.reserve(96000);
  unsigned seed = 7u;
  for (int i = 0; i < 96000; ++i) {
    seed = seed * 1664525u + 1013904223u;
    if ((seed >> 28) == 0) stress.noteOn(30 + static_cast<int>((seed >> 16) % 60));
    if ((seed >> 28) == 1) stress.noteOff(30 + static_cast<int>((seed >> 16) % 60));
    stressed.push_back(stress.process());
  }
  check(finiteAll(stressed), "survives rapid random note events", peak(stressed));
  check(peak(stressed) < 5.0, "bounded under note stress", peak(stressed));

  // Parameters changing every sample, as an automating host would.
  af::Voice101 automated;
  automated.setSampleRate(48000.0);
  automated.reset();
  automated.noteOn(45);
  std::vector<double> auto_out;
  auto_out.reserve(48000);
  for (int i = 0; i < 48000; ++i) {
    af::Voice101Parameters moving = p;
    const double t = static_cast<double>(i) / 48000.0;
    moving.cutoffHz = 40.0 + 15000.0 * (0.5 + 0.5 * std::sin(2.0 * af::kPi * 7.0 * t));
    moving.resonance = 0.5 + 0.5 * std::sin(2.0 * af::kPi * 3.0 * t);
    automated.setParameters(moving);
    auto_out.push_back(automated.process());
  }
  check(finiteAll(auto_out), "survives per-sample automation", peak(auto_out));
  check(peak(auto_out) < 5.0, "bounded under per-sample automation", peak(auto_out));

  // Denormals: a long decay into silence must not stall on tiny numbers.
  af::Voice101Parameters quiet = p;
  quiet.release = 0.01;
  af::Voice101 tail;
  tail.setSampleRate(48000.0);
  tail.setParameters(quiet);
  tail.reset();
  tail.noteOn(45);
  for (int i = 0; i < 4800; ++i) tail.process();
  tail.noteOff(45);
  std::vector<double> silence;
  for (int i = 0; i < 240000; ++i) silence.push_back(tail.process());
  check(peak(silence) < 1.0, "decays to silence without denormal trouble", peak(silence));
  check(!tail.isActive(), "voice becomes inactive after a long tail",
        tail.isActive() ? 1.0 : 0.0);
}

}  // namespace

int main() {
  std::printf("AnalogFoundry 101 - hardening tests (M9)\n\n");
  presetTests();
  sampleRateTests();
  std::printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
