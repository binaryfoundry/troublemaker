// CPU profiling (Milestone 9).
//
// Reports realtime factor per quality mode: how many seconds of audio the
// engine renders per second of CPU. A plugin needs to beat 1x by a wide
// margin to be usable, since a session runs dozens of things at once.
//
// This measures the DSP core only - no plugin wrapper, no host - so the
// number is a property of the engine rather than of someone's buffer size.

#include <chrono>
#include <cmath>
#include <cstdio>
#include <vector>

#include "../src/model/Effect101.h"
#include "../src/model/Voice101.h"

namespace {

double secondsFor(void (*body)(int), int samples) {
  const auto start = std::chrono::steady_clock::now();
  body(samples);
  const auto end = std::chrono::steady_clock::now();
  return std::chrono::duration<double>(end - start).count();
}

volatile double gSink = 0.0;  // stops the optimiser deleting the work

void report(const char* label, double audioSeconds, double cpuSeconds) {
  std::printf("  %-34s %7.1fx realtime  (%.1f%% of one core)\n", label,
              audioSeconds / cpuSeconds, 100.0 * cpuSeconds / audioSeconds);
}

}  // namespace

int main() {
  const double sr = 48000.0;
  const int samples = static_cast<int>(sr * 10.0);  // ten seconds of audio
  const double audioSeconds = samples / sr;

  std::printf("AnalogFoundry 101 - CPU profile (48 kHz, 10 s of audio)\n\n");

  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.pulseLevel = 0.5;
  p.subLevel = 0.6;
  p.noiseLevel = 0.1;
  p.cutoffHz = 1200.0;
  p.resonance = 0.6;
  p.envToCutoff = 0.5;
  p.sustain = 0.5;

  for (af::Quality q : {af::Quality::Draft, af::Quality::Normal, af::Quality::High}) {
    af::Voice101 voice;
    voice.setSampleRate(sr);
    voice.setParameters(p);
    voice.setQuality(q);
    voice.reset();
    voice.noteOn(45);
    const auto start = std::chrono::steady_clock::now();
    double sink = 0.0;
    for (int i = 0; i < samples; ++i) sink += voice.process();
    const auto end = std::chrono::steady_clock::now();
    gSink = sink;
    char label[64];
    std::snprintf(label, sizeof(label), "voice, %dx oversampling",
                  static_cast<int>(q));
    report(label, audioSeconds, std::chrono::duration<double>(end - start).count());
  }

  // With every nonlinearity and variation enabled: the worst realistic case.
  {
    af::Voice101Parameters heavy = p;
    heavy.filterStageDrive = 1.0;
    heavy.filterInputDrive = 1.0;
    heavy.lfoToCutoff = 0.5;
    heavy.lfoToPitch = 2.0;
    af::AnalogVariation v;
    v.componentTolerance = 0.02;
    v.driftCents = 3.0;
    v.noiseFloor = 1.0e-4;
    af::Voice101 voice;
    voice.setSampleRate(sr);
    voice.setParameters(heavy);
    voice.setQuality(af::Quality::High);
    voice.setVariation(v);
    voice.reset();
    voice.noteOn(45);
    const auto start = std::chrono::steady_clock::now();
    double sink = 0.0;
    for (int i = 0; i < samples; ++i) sink += voice.process();
    const auto end = std::chrono::steady_clock::now();
    gSink = sink;
    report("voice, 4x + all nonlinearity", audioSeconds,
           std::chrono::duration<double>(end - start).count());
  }

  // Unison at its maximum: 7 oscillators into the same filter.
  {
    af::Voice101Parameters wide = p;
    wide.unisonVoices = 7.0;
    wide.unisonDetuneCents = 25.0;
    af::Voice101 voice;
    voice.setSampleRate(sr);
    voice.setParameters(wide);
    voice.setQuality(af::Quality::High);
    voice.reset();
    voice.noteOn(45);
    const auto start = std::chrono::steady_clock::now();
    double sink = 0.0;
    for (int i = 0; i < samples; ++i) sink += voice.process();
    const auto end = std::chrono::steady_clock::now();
    gSink = sink;
    report("voice, 4x + unison 7", audioSeconds,
           std::chrono::duration<double>(end - start).count());
  }

  // The effect build.
  {
    af::Effect101 fx;
    af::Effect101Parameters ep;
    ep.cutoffHz = 900.0;
    ep.resonance = 0.5;
    ep.followerToCutoff = 2.0;
    fx.setSampleRate(sr);
    fx.setParameters(ep);
    fx.setQuality(af::Quality::High);
    fx.reset();
    const auto start = std::chrono::steady_clock::now();
    double sink = 0.0;
    for (int i = 0; i < samples; ++i) {
      sink += fx.process(std::sin(2.0 * af::kPi * 220.0 * i / sr));
    }
    const auto end = std::chrono::steady_clock::now();
    gSink = sink;
    report("effect, 4x oversampling", audioSeconds,
           std::chrono::duration<double>(end - start).count());
  }

  std::printf("\n(a realtime factor of N means N instances fit in one core)\n");
  return 0;
}
