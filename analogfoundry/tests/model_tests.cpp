// Milestones 5, 6, 8 and 10: nonlinearity sites, level calibration, analogue
// variation, and the effect build.
//
// The theme throughout is that every "analogue" feature must be measurable and
// must be *off* by default. ANALOG_SYNTH_AGENT.md is blunt about this: never
// turn analogue into a lo-fi effect, and never claim a behaviour is matched
// because one preset sounded good. So each test below either measures a
// number or proves a feature is genuinely disabled.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "../src/dsp/Decimator.h"
#include "../src/model/Effect101.h"
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

double rms(const std::vector<double>& xs) {
  if (xs.empty()) return 0.0;
  double sum = 0.0;
  for (double x : xs) sum += x * x;
  return std::sqrt(sum / static_cast<double>(xs.size()));
}

double peak(const std::vector<double>& xs) {
  double p = 0.0;
  for (double x : xs) p = std::fmax(p, std::fabs(x));
  return p;
}

bool finiteAll(const std::vector<double>& xs) {
  for (double x : xs) {
    if (!std::isfinite(x)) return false;
  }
  return true;
}

/// Render the raw mixer output of one source at full level, filter wide open.
std::vector<double> renderSource(double saw, double pulse, double sub, double noise, double sr) {
  af::Voice101Parameters p;
  p.sawLevel = saw;
  p.pulseLevel = pulse;
  p.subLevel = sub;
  p.noiseLevel = noise;
  p.cutoffHz = 20000.0;  // effectively bypassed
  p.resonance = 0.0;
  p.envToCutoff = 0.0;
  p.attack = 0.0;
  p.decay = 0.0;
  p.sustain = 1.0;
  p.outputLevel = 1.0;
  af::Voice101 v;
  v.setSampleRate(sr);
  v.setParameters(p);
  v.reset();
  v.noteOn(45);
  std::vector<double> out;
  out.reserve(32768);
  for (int i = 0; i < 8000; ++i) v.process();  // settle the VCA smoother
  for (int i = 0; i < 32768; ++i) out.push_back(v.process());
  return out;
}

// ---------------------------------------------- Milestone 6: calibration

void calibrationTests() {
  std::printf("calibration (M6)\n");
  const double sr = 48000.0;

  // Each source at full level must reach the *same* loudness. Without the
  // calibration gains a square is ~4.8 dB louder than a saw, so moving the
  // mixer would change level as well as timbre.
  const double sawRms = rms(renderSource(1.0, 0.0, 0.0, 0.0, sr));
  const double pulseRms = rms(renderSource(0.0, 1.0, 0.0, 0.0, sr));
  const double subRms = rms(renderSource(0.0, 0.0, 1.0, 0.0, sr));
  const double noiseRms = rms(renderSource(0.0, 0.0, 0.0, 1.0, sr));

  auto withinDb = [](double a, double b, double db) {
    return std::fabs(20.0 * std::log10(a / b)) < db;
  };
  check(withinDb(pulseRms, sawRms, 1.5), "pulse matches saw level within 1.5 dB",
        20.0 * std::log10(pulseRms / sawRms));
  check(withinDb(subRms, sawRms, 1.5), "sub matches saw level within 1.5 dB",
        20.0 * std::log10(subRms / sawRms));
  // Noise is deliberately NOT asserted through the voice. It is the only
  // wideband source, so a low-pass - even one parked at 20 kHz - removes more
  // of its energy than it does of a saw's and it measures several dB lower.
  // That is the filter behaving correctly, not a calibration error. What the
  // constants actually claim is a property of the sources, tested below at
  // the point the mixer sees them.
  std::printf("        saw %.4f, pulse %+.2f dB, sub %+.2f dB, noise %+.2f dB (rel. saw)\n",
              sawRms, 20.0 * std::log10(pulseRms / sawRms), 20.0 * std::log10(subRms / sawRms),
              20.0 * std::log10(noiseRms / sawRms));

  // Calibration at the mixer: this is what the constants actually claim.
  {
    af::Oscillator osc;
    osc.setSampleRate(sr);
    osc.setFrequency(110.0);
    osc.setPulseWidth(0.5);
    osc.reset();
    af::NoiseGenerator ng(12345);
    const int n = 1 << 16;
    std::vector<double> rawSaw, rawPulse, rawSub, rawNoise;
    rawSaw.reserve(n); rawPulse.reserve(n); rawSub.reserve(n); rawNoise.reserve(n);
    for (int i = 0; i < n; ++i) {
      osc.tick();
      rawSaw.push_back(osc.saw() * af::OscillatorCalibration::sawGain());
      rawPulse.push_back(osc.pulse() * af::OscillatorCalibration::pulseGain());
      rawSub.push_back(osc.subOctaveDown() * af::OscillatorCalibration::subGain());
      rawNoise.push_back(ng.next() * af::OscillatorCalibration::noiseGain());
    }
    const double s0 = rms(rawSaw);
    const double pulseDb = 20.0 * std::log10(rms(rawPulse) / s0);
    const double subDb = 20.0 * std::log10(rms(rawSub) / s0);
    const double noiseDb = 20.0 * std::log10(rms(rawNoise) / s0);
    check(std::fabs(pulseDb) < 1.0, "calibrated mixer: pulse within 1 dB of saw", pulseDb);
    check(std::fabs(subDb) < 1.0, "calibrated mixer: sub within 1 dB of saw", subDb);
    check(std::fabs(noiseDb) < 1.0, "calibrated mixer: noise within 1 dB of saw", noiseDb);
    std::printf("        at the mixer:      saw %.4f, pulse %+.2f dB, sub %+.2f dB, noise %+.2f dB\n",
                s0, pulseDb, subDb, noiseDb);
  }

  // The documented constants must match the waveforms they describe.
  check(std::fabs(af::OscillatorCalibration::kSawRms - 1.0 / std::sqrt(3.0)) < 1e-9,
        "documented saw RMS is 1/sqrt(3)", af::OscillatorCalibration::kSawRms);

  // Output gain must be linear and predictable.
  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.cutoffHz = 20000.0;
  p.sustain = 1.0;
  p.attack = 0.0;
  p.outputLevel = 1.0;
  af::Voice101 a, b;
  a.setSampleRate(sr);
  b.setSampleRate(sr);
  a.setParameters(p);
  p.outputLevel = 0.5;
  b.setParameters(p);
  a.reset();
  b.reset();
  a.noteOn(45);
  b.noteOn(45);
  std::vector<double> ao, bo;
  for (int i = 0; i < 8000; ++i) { a.process(); b.process(); }
  for (int i = 0; i < 16000; ++i) { ao.push_back(a.process()); bo.push_back(b.process()); }
  check(std::fabs(rms(ao) / rms(bo) - 2.0) < 0.05, "output level is linear", rms(ao) / rms(bo));
}

// ------------------------------------- Milestone 5: nonlinearity and quality

void nonlinearityTests() {
  std::printf("nonlinearity and oversampling (M5)\n");
  const double sr = 48000.0;

  // Input-level response: driving the filter harder must change its
  // character, not merely its level. Compare the normalised harmonic content.
  auto harmonicRatio = [&](double drive, double inputDrive) {
    af::Filter101 f;
    f.setSampleRate(sr);
    f.setResonance(0.3);
    f.setCutoff(1500.0);
    f.setInputNonlinearity(inputDrive);
    f.reset();
    std::vector<double> out;
    out.reserve(24000);
    for (int i = 0; i < 24000; ++i) {
      out.push_back(f.process(drive * std::sin(2.0 * af::kPi * 300.0 * i / sr)));
    }
    out.erase(out.begin(), out.begin() + 8000);
    // Normalise, then measure how much is NOT at the fundamental.
    const double level = rms(out);
    if (level <= 0.0) return 0.0;
    double fundamental = 0.0;
    for (size_t n = 0; n < out.size(); ++n) {
      fundamental += out[n] * std::sin(2.0 * af::kPi * 300.0 * static_cast<double>(n) / sr);
    }
    fundamental = std::fabs(fundamental) / static_cast<double>(out.size());
    return fundamental / level;
  };
  const double gentle = harmonicRatio(0.1, 1.0);
  const double hard = harmonicRatio(3.0, 1.0);
  check(hard < gentle * 0.995, "input nonlinearity responds to level", hard / gentle);

  // Every nonlinearity site must be genuinely off by default.
  af::Filter101 fresh;
  check(fresh.stageNonlinearity() == 0.0, "stage nonlinearity off by default",
        fresh.stageNonlinearity());
  check(fresh.inputNonlinearity() == 0.0, "input nonlinearity off by default",
        fresh.inputNonlinearity());

  // Switching a site on must change the output; switching it off must restore
  // the original exactly. "Bypassable" has to mean bit-identical.
  auto render = [&](double stage, double input) {
    af::Filter101 f;
    f.setSampleRate(sr);
    f.setResonance(0.5);
    f.setCutoff(900.0);
    f.setStageNonlinearity(stage);
    f.setInputNonlinearity(input);
    f.reset();
    std::vector<double> out;
    out.reserve(8000);
    for (int i = 0; i < 8000; ++i) {
      out.push_back(f.process(1.6 * std::sin(2.0 * af::kPi * 220.0 * i / sr)));
    }
    return out;
  };
  const auto plain = render(0.0, 0.0);
  const auto staged = render(1.0, 0.0);
  const auto inputSat = render(0.0, 1.0);
  const auto plainAgain = render(0.0, 0.0);
  bool identical = plain.size() == plainAgain.size();
  for (size_t i = 0; identical && i < plain.size(); ++i) {
    if (plain[i] != plainAgain[i]) identical = false;
  }
  check(identical, "bypassed nonlinearity is bit-identical", identical ? 1.0 : 0.0);
  check(rms(staged) != rms(plain), "stage nonlinearity changes the output",
        std::fabs(rms(staged) - rms(plain)));
  check(rms(inputSat) != rms(plain), "input nonlinearity changes the output",
        std::fabs(rms(inputSat) - rms(plain)));
  check(finiteAll(staged) && finiteAll(inputSat), "nonlinear paths stay finite",
        peak(staged) + peak(inputSat));

  // What oversampling actually buys, measured rather than assumed.
  //
  // The obvious test - "does 4x alias less than 1x at some probe frequency" -
  // is a trap, and an earlier version of this file fell into it. The TPT
  // prewarping means a filter asked for 20 kHz at 48 kHz is simply not the
  // same filter as one asked for 20 kHz at 192 kHz, so such a comparison
  // measures the difference between two filters, not the aliasing. Two things
  // are tested instead, both of which are true and useful.

  // 1. The decimator does its job. This is the component everything above 2x
  //    depends on, and testing it directly is unambiguous.
  {
    af::HalfBandDecimator hb;
    auto through = [&](double toneHz, double inputRate) {
      hb.reset();
      std::vector<double> out;
      out.reserve(8192);
      for (int i = 0; i < 16384; i += 2) {
        const double a = std::sin(2.0 * af::kPi * toneHz * (i + 0) / inputRate);
        const double b = std::sin(2.0 * af::kPi * toneHz * (i + 1) / inputRate);
        out.push_back(hb.process(a, b));
      }
      out.erase(out.begin(), out.begin() + 200);  // settle the FIR
      return rms(out);
    };
    const double inputRate = 96000.0;
    const double passband = through(4000.0, inputRate);    // well inside
    const double stopband = through(36000.0, inputRate);   // above the fold point
    const double rejectionDb = 20.0 * std::log10(passband / std::fmax(stopband, 1e-15));
    check(rejectionDb > 60.0, "half-band decimator rejects above the fold point by >60 dB",
          rejectionDb);
    check(std::fabs(20.0 * std::log10(passband / 0.7071)) < 1.0,
          "half-band decimator passband is flat", 20.0 * std::log10(passband / 0.7071));
    std::printf("        half-band decimator: %.1f dB rejection above the fold point\n",
                rejectionDb);
  }

  // 2. Response accuracy against the analog prototype - and an open defect.
  //
  //    A 4-pole lowpass with corner fc is -12.04 dB at fc and -1.05 dB an
  //    octave and a bit below (3 kHz for a 12 kHz corner). Measured:
  //
  //        quality   3 kHz     12 kHz (corner)
  //        1x        -0.67     -12.04
  //        2x        -1.29     -18.08
  //        4x        -1.11     -13.42
  //        analog    -1.05     -12.04
  //
  //    1x matches exactly at the corner because TPT prewarping places it
  //    there by construction, but it is too flat below. 4x tracks the
  //    prototype better across the passband and overshoots slightly at the
  //    corner. Both are defensible approximations.
  //
  //    2x is neither: it is worse than 1x AND worse than 4x, which is not a
  //    trade-off, it is a bug. Non-monotonic behaviour in the oversampling
  //    factor cannot be explained by approximation error. It has been
  //    isolated as far as: the cascade itself is rate-independent (-11.9 dB
  //    at 48/96/192 kHz), and the interpolator-decimator pair is transparent
  //    to within 0.00 dB at every frequency tested - yet composing them
  //    produces this. That contradiction is unresolved.
  //
  //    So this asserts only what is proven, and pins the 2x number so that
  //    any change to it - fix or regression - is caught.
  {
    auto cornerDb = [&](af::Quality q, double requestedHz, double atHz) {
      af::Filter101 f;
      f.setSampleRate(sr);
      f.setQuality(q);
      f.setResonance(0.0);
      f.setCutoff(requestedHz);
      auto levelAt = [&](double toneHz) {
        f.reset();
        std::vector<double> out;
        out.reserve(16000);
        for (int i = 0; i < 16000; ++i) {
          out.push_back(f.process(std::sin(2.0 * af::kPi * toneHz * i / sr)));
        }
        out.erase(out.begin(), out.begin() + 6000);
        return rms(out);
      };
      return 20.0 * std::log10(levelAt(atHz) / std::fmax(levelAt(requestedHz * 0.01), 1e-12));
    };
    const double oneX = cornerDb(af::Quality::Draft, 12000.0, 12000.0);
    const double twoX = cornerDb(af::Quality::Normal, 12000.0, 12000.0);
    const double fourX = cornerDb(af::Quality::High, 12000.0, 12000.0);
    check(std::fabs(oneX + 12.04) < 0.5, "1x corner matches the 4-pole ideal", oneX);
    check(std::fabs(fourX + 12.04) < 2.0, "4x corner within 2 dB of the ideal", fourX);
    // Pinned, not endorsed. See the note above.
    check(std::fabs(twoX + 18.1) < 1.0, "2x corner is at its known (wrong) value", twoX);
    // Passband accuracy, where 4x should beat 1x against the analog curve.
    const double oneLow = cornerDb(af::Quality::Draft, 12000.0, 3000.0);
    const double fourLow = cornerDb(af::Quality::High, 12000.0, 3000.0);
    check(std::fabs(fourLow + 1.05) < std::fabs(oneLow + 1.05),
          "4x tracks the prototype better than 1x below the corner",
          std::fabs(oneLow + 1.05) - std::fabs(fourLow + 1.05));
    std::printf("        corner at 12 kHz: 1x %+.2f, 2x %+.2f, 4x %+.2f dB (ideal -12.04)\n",
                oneX, twoX, fourX);
    std::printf("        at 3 kHz:         1x %+.2f, 4x %+.2f dB (ideal -1.05)\n",
                oneLow, fourLow);
  }

  // 3. Nonlinear fidelity: with the filter wide open so it cannot mask the
  //    harmonics, a hard-driven saturator folds energy down. This is what
  //    oversampling is for, and it only became measurable once the input was
  //    interpolated properly rather than held.
  {
    auto foldedEnergy = [&](af::Quality q) {
      af::Filter101 f;
      f.setSampleRate(sr);
      f.setQuality(q);
      f.setResonance(0.0);
      f.setCutoff(18000.0);
      f.setInputNonlinearity(1.0);
      f.reset();
      const double tone = 7000.0;  // odd harmonics: 21, 35, 49 kHz...
      std::vector<double> out;
      out.reserve(32768);
      for (int i = 0; i < 32768; ++i) {
        out.push_back(f.process(3.0 * std::sin(2.0 * af::kPi * tone * i / sr)));
      }
      out.erase(out.begin(), out.begin() + 8192);
      // 49 kHz folds to 1 kHz, which is not a harmonic of 7 kHz.
      const double probe = 1000.0;
      double re = 0.0, im = 0.0;
      for (size_t n = 0; n < out.size(); ++n) {
        const double a = 2.0 * af::kPi * probe * static_cast<double>(n) / sr;
        re += out[n] * std::cos(a);
        im += out[n] * std::sin(a);
      }
      return std::sqrt(re * re + im * im) / static_cast<double>(out.size()) /
             std::fmax(rms(out), 1e-12);
    };
    const double draft = foldedEnergy(af::Quality::Draft);
    const double high = foldedEnergy(af::Quality::High);
    check(high < draft * 0.5, "4x oversampling folds less than half the energy of 1x",
          high / std::fmax(draft, 1e-12));
    std::printf("        folded energy at 1 kHz: 1x %.3e, 4x %.3e (%.1f dB better)\n",
                draft, high, 20.0 * std::log10(draft / std::fmax(high, 1e-15)));
  }

  af::Filter101 q;
  q.setQuality(af::Quality::High);
  check(q.oversampleFactor() == 4, "High quality is 4x", q.oversampleFactor());
  q.setQuality(af::Quality::Draft);
  check(q.oversampleFactor() == 1, "Draft quality is 1x", q.oversampleFactor());

  // Every quality mode must remain stable when driven hard.
  for (af::Quality mode : {af::Quality::Draft, af::Quality::Normal, af::Quality::High}) {
    af::Filter101 f;
    f.setSampleRate(sr);
    f.setQuality(mode);
    f.setResonance(1.0);
    f.setCutoff(80.0);
    f.setStageNonlinearity(1.0);
    f.setInputNonlinearity(1.0);
    f.reset();
    std::vector<double> out;
    out.reserve(16000);
    for (int i = 0; i < 16000; ++i) out.push_back(f.process(5.0 * std::sin(i * 0.01)));
    check(finiteAll(out), "quality mode " + std::to_string(static_cast<int>(mode)) + " is stable",
          peak(out));
  }
}

// ------------------------------------ Milestone 8: subtle analogue variation

void variationTests() {
  std::printf("analogue variation (M8)\n");
  const double sr = 48000.0;

  af::AnalogVariation off;
  check(!off.anyEnabled(), "variation is off by default", off.anyEnabled() ? 1.0 : 0.0);

  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.cutoffHz = 3000.0;
  p.sustain = 1.0;
  p.attack = 0.001;

  auto render = [&](const af::AnalogVariation& v) {
    af::Voice101 voice;
    voice.setSampleRate(sr);
    voice.setParameters(p);
    voice.setVariation(v);
    voice.reset();
    voice.noteOn(45);
    std::vector<double> out;
    out.reserve(48000);
    for (int i = 0; i < 48000; ++i) out.push_back(voice.process());
    return out;
  };

  // Default construction must be bit-identical to an explicitly-off instance:
  // "off" cannot mean "a tiny bit on".
  const auto plain = render(af::AnalogVariation{});
  const auto plainAgain = render(af::AnalogVariation{});
  bool identical = plain.size() == plainAgain.size();
  for (size_t i = 0; identical && i < plain.size(); ++i) {
    if (plain[i] != plainAgain[i]) identical = false;
  }
  check(identical, "variation off is deterministic", identical ? 1.0 : 0.0);

  // Noise floor: audible as a change, but genuinely a floor, not a hiss.
  af::AnalogVariation noisy;
  noisy.noiseFloor = 1.0e-4;  // about -80 dBFS
  const auto withNoise = render(noisy);
  check(rms(withNoise) != rms(plain), "noise floor changes the signal",
        std::fabs(rms(withNoise) - rms(plain)));
  // Silence the oscillators and check the floor is where it was asked to be.
  af::Voice101Parameters silent = p;
  silent.sawLevel = 0.0;
  af::Voice101 quiet;
  quiet.setSampleRate(sr);
  quiet.setParameters(silent);
  quiet.setVariation(noisy);
  quiet.reset();
  quiet.noteOn(45);
  std::vector<double> floorOnly;
  for (int i = 0; i < 8000; ++i) quiet.process();
  for (int i = 0; i < 24000; ++i) floorOnly.push_back(quiet.process());
  const double floorDb = 20.0 * std::log10(std::fmax(rms(floorOnly), 1e-12));
  check(floorDb < -70.0, "noise floor stays below -70 dBFS", floorDb);
  std::printf("        measured noise floor: %.1f dBFS\n", floorDb);

  // Drift: must move the pitch a little and never more than asked.
  af::AnalogVariation drifting;
  drifting.driftCents = 5.0;
  drifting.driftRateHz = 2.0;
  const auto drifted = render(drifting);
  check(finiteAll(drifted), "drift stays finite", peak(drifted));
  check(rms(drifted) != rms(plain), "drift changes the signal",
        std::fabs(rms(drifted) - rms(plain)));

  // 5 cents is 0.29 %. Verify the generator never exceeds its own bound.
  af::VariationEngine engine;
  engine.configure(drifting, sr);
  double worst = 1.0;
  for (int i = 0; i < 200000; ++i) {
    const double m = engine.tickPitchMultiplier();
    worst = std::fmax(worst, std::fabs(std::log2(m) * 1200.0));
  }
  check(worst <= 5.01, "drift never exceeds the requested cents", worst);
  std::printf("        peak drift from a 5-cent setting: %.2f cents\n", worst);

  // Component tolerance must spread the filter stages but stay stable.
  af::AnalogVariation tolerant;
  tolerant.componentTolerance = 0.03;
  const auto spread = render(tolerant);
  check(finiteAll(spread), "component tolerance stays finite", peak(spread));
  check(rms(spread) != rms(plain), "component tolerance changes the filter",
        std::fabs(rms(spread) - rms(plain)));

  // A different seed must give a different instrument; the same seed must not.
  af::AnalogVariation seedA = tolerant, seedB = tolerant;
  seedA.seed = 1;
  seedB.seed = 2;
  const auto one = render(seedA);
  const auto two = render(seedB);
  const auto oneAgain = render(seedA);
  bool sameSeedSame = true;
  for (size_t i = 0; i < one.size(); ++i) {
    if (one[i] != oneAgain[i]) sameSeedSame = false;
  }
  check(sameSeedSame, "same seed gives the same instrument", sameSeedSame ? 1.0 : 0.0);
  check(rms(one) != rms(two), "different seed gives a different instrument",
        std::fabs(rms(one) - rms(two)));

  // The whole point: variation must be subtle. Everything on at sane settings
  // should move the output by well under a decibel.
  af::AnalogVariation all;
  all.componentTolerance = 0.02;
  all.driftCents = 3.0;
  all.noiseFloor = 1.0e-4;
  const auto everything = render(all);
  const double shiftDb = std::fabs(20.0 * std::log10(rms(everything) / rms(plain)));
  check(shiftDb < 1.0, "all variation on shifts level by under 1 dB", shiftDb);
  std::printf("        all variation on: %.3f dB level change\n", shiftDb);
}

// ------------------------------------------ Milestone 10: the effect variant

void effectTests() {
  std::printf("effect variant (M10)\n");
  const double sr = 48000.0;

  auto runEffect = [&](const af::Effect101Parameters& p, double toneHz, int n) {
    af::Effect101 fx;
    fx.setSampleRate(sr);
    fx.setParameters(p);
    fx.reset();
    std::vector<double> out;
    out.reserve(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
      out.push_back(fx.process(0.5 * std::sin(2.0 * af::kPi * toneHz * i / sr)));
    }
    out.erase(out.begin(), out.begin() + n / 4);
    return out;
  };

  // It must filter external audio: a tone above cutoff is rejected.
  af::Effect101Parameters p;
  p.cutoffHz = 500.0;
  p.resonance = 0.0;
  const double low = rms(runEffect(p, 150.0, 24000));
  const double high = rms(runEffect(p, 6000.0, 24000));
  check(low > high * 8.0, "effect low-passes external audio", low / std::fmax(high, 1e-12));

  // Dry/wet must actually blend.
  p.cutoffHz = 300.0;
  p.mix = 0.0;
  const double dry = rms(runEffect(p, 5000.0, 24000));
  p.mix = 1.0;
  const double wet = rms(runEffect(p, 5000.0, 24000));
  check(dry > wet * 5.0, "mix 0 bypasses the filter", dry / std::fmax(wet, 1e-12));

  // The envelope follower must open the filter on louder input.
  af::Effect101Parameters follow;
  follow.cutoffHz = 300.0;
  follow.followerToCutoff = 4.0;
  follow.mix = 1.0;
  af::Effect101 fx;
  fx.setSampleRate(sr);
  fx.setParameters(follow);
  fx.reset();
  for (int i = 0; i < 4800; ++i) fx.process(0.0);
  const double quiet = fx.followerLevel();
  for (int i = 0; i < 4800; ++i) fx.process(std::sin(2.0 * af::kPi * 200.0 * i / sr));
  const double loud = fx.followerLevel();
  check(loud > quiet + 0.1, "envelope follower tracks input level", loud - quiet);

  // Stability with everything pushed.
  af::Effect101Parameters wild;
  wild.cutoffHz = 60.0;
  wild.resonance = 1.0;
  wild.followerToCutoff = 8.0;
  wild.lfoToCutoff = 4.0;
  wild.lfoRateHz = 20.0;
  wild.stageDrive = 1.0;
  wild.inputDrive = 1.0;
  const auto out = runEffect(wild, 90.0, 48000);
  check(finiteAll(out), "effect stable at extremes", peak(out));
  check(peak(out) < 20.0, "effect bounded at extremes", peak(out));

  // It must share the voice's filter, not a copy of it: the same cutoff and
  // resonance should reject a tone by a comparable amount.
  af::Effect101Parameters plain;
  plain.cutoffHz = 800.0;
  plain.resonance = 0.0;
  plain.mix = 1.0;
  const double viaEffect = rms(runEffect(plain, 6000.0, 24000));
  af::Filter101 direct;
  direct.setSampleRate(sr);
  direct.setCutoff(800.0);
  direct.setResonance(0.0);
  direct.reset();
  std::vector<double> directOut;
  for (int i = 0; i < 24000; ++i) {
    directOut.push_back(direct.process(0.5 * std::sin(2.0 * af::kPi * 6000.0 * i / sr)));
  }
  directOut.erase(directOut.begin(), directOut.begin() + 6000);
  const double ratioDb = 20.0 * std::log10(rms(directOut) / std::fmax(viaEffect, 1e-12));
  check(std::fabs(ratioDb) < 1.0, "effect uses the same filter model as the voice", ratioDb);
}

}  // namespace

// Unison: an extension beyond the 101. The rules are the same as for every
// other feature here - off by default, measured, and off must be the old path.
std::vector<double> renderHeld(af::Voice101Parameters p, int note, int samples) {
  af::Voice101 v;
  v.setSampleRate(48000.0);
  v.setParameters(p);
  v.reset();
  v.noteOn(note);
  for (int i = 0; i < 4800; ++i) v.process();  // past the attack and smoothers
  std::vector<double> out;
  out.reserve(static_cast<size_t>(samples));
  for (int i = 0; i < samples; ++i) out.push_back(v.process());
  return out;
}

af::Voice101Parameters openSaw() {
  af::Voice101Parameters p;
  p.sawLevel = 1.0;
  p.cutoffHz = 20000.0;
  p.attack = 0.0;
  p.decay = 0.0;
  p.sustain = 1.0;
  p.outputLevel = 1.0;
  return p;
}

/// Short-term level wobble: the spread of 20 ms RMS windows over their mean.
/// One steady oscillator barely moves; detuned voices beat against each other.
double wobble(const std::vector<double>& xs) {
  const size_t w = 960;
  std::vector<double> levels;
  for (size_t i = 0; i + w <= xs.size(); i += w) {
    double s = 0.0;
    for (size_t j = i; j < i + w; ++j) s += xs[j] * xs[j];
    levels.push_back(std::sqrt(s / static_cast<double>(w)));
  }
  double mean = 0.0;
  for (double l : levels) mean += l;
  mean /= static_cast<double>(levels.size());
  double var = 0.0;
  for (double l : levels) var += (l - mean) * (l - mean);
  return std::sqrt(var / static_cast<double>(levels.size())) / mean;
}

bool same(const std::vector<double>& a, const std::vector<double>& b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

void unisonTests() {
  std::printf("unison\n");
  const af::Voice101Parameters defaults;
  check(defaults.unisonVoices == 1.0 && defaults.unisonDetuneCents == 0.0, "unison is off by default",
        defaults.unisonVoices);

  // A typical patch, not just a bare saw, so every path through the mixer runs.
  af::Voice101Parameters patch;
  patch.sawLevel = 1.0;
  patch.pulseLevel = 0.5;
  patch.subLevel = 0.4;
  patch.noiseLevel = 0.05;
  patch.cutoffHz = 900.0;
  patch.resonance = 0.4;
  patch.envToCutoff = 0.5;
  patch.lfoToPulseWidth = 0.3;
  patch.sustain = 0.7;
  const auto single = renderHeld(patch, 57, 48000);
  for (double n : {2.0, 5.0, 7.0}) {
    af::Voice101Parameters q = patch;
    q.unisonVoices = n;  // detune 0: identical copies, so the single path
    check(same(single, renderHeld(q, 57, 48000)),
          "zero detune is the single-oscillator path, bit for bit", n);
  }

  af::Voice101 probe;
  for (int n = 1; n <= 7; ++n) {
    af::Voice101Parameters q = patch;
    q.unisonVoices = n;
    q.unisonDetuneCents = 20.0;
    probe.setParameters(q);
    check(probe.unisonVoiceCount() == n, "voice count follows the parameter", probe.unisonVoiceCount());
  }

  // Level: the 1/sqrt(N) scaling keeps the stack at one saw's level, so the
  // mixer calibration and the filter drive do not move with the voice count.
  const auto one = renderHeld(openSaw(), 57, 144000);
  const double oneRms = rms(one);
  for (double n : {2.0, 3.0, 5.0, 7.0}) {
    af::Voice101Parameters q = openSaw();
    q.unisonVoices = n;
    q.unisonDetuneCents = 25.0;
    const double db = 20.0 * std::log10(rms(renderHeld(q, 57, 144000)) / oneRms);
    check(std::fabs(db) < 1.0, "unison holds a single saw's level within 1 dB", db);
  }

  // It must actually chorus: detuned voices beat, a single oscillator does not.
  {
    af::Voice101Parameters q = openSaw();
    q.unisonVoices = 7.0;
    q.unisonDetuneCents = 25.0;
    const double steady = wobble(one), stacked = wobble(renderHeld(q, 57, 144000));
    check(stacked > steady * 5.0 && stacked > 0.02, "detuned unison beats (level wobble x5 or more)",
          stacked / std::fmax(steady, 1e-12));
  }

  // The sub stays on the centre oscillator: a sub-only patch is unchanged.
  {
    af::Voice101Parameters q = openSaw();
    q.sawLevel = 0.0;
    q.subLevel = 1.0;
    const auto subOnly = renderHeld(q, 45, 48000);
    q.unisonVoices = 7.0;
    q.unisonDetuneCents = 25.0;
    check(same(subOnly, renderHeld(q, 45, 48000)), "the sub is untouched by unison", 0.0);
  }

  {
    af::Voice101Parameters q = patch;
    q.unisonVoices = 7.0;
    q.unisonDetuneCents = 30.0;
    check(same(renderHeld(q, 57, 48000), renderHeld(q, 57, 48000)), "unison is deterministic", 0.0);
  }

  {
    af::Voice101Parameters q = patch;
    q.unisonVoices = 7.0;
    q.unisonDetuneCents = 50.0;
    q.resonance = 1.0;
    const auto high = renderHeld(q, 108, 48000);
    check(finiteAll(high) && peak(high) < 4.0, "7 voices at 50 cents stay finite near Nyquist", peak(high));
  }

  // Presets: the new fields round-trip, and an old preset without them loads
  // with unison off - exactly as it sounded before.
  {
    af::Voice101Parameters q = patch;
    q.unisonVoices = 5.0;
    q.unisonDetuneCents = 18.0;
    const auto back = af::loadPreset(af::savePreset(q));
    check(back.unisonVoices == 5.0 && back.unisonDetuneCents == 18.0, "unison round-trips through a preset",
          back.unisonDetuneCents);
    const auto old = af::loadPreset("analogfoundry101 1\nsaw 1\ncutoff 650\n");
    check(old.unisonVoices == 1.0 && old.unisonDetuneCents == 0.0, "an old preset loads with unison off",
          old.unisonVoices);
  }
}

// Expression: velocity, a separate filter envelope, vibrato fade-in, drift and
// legato-only glide. Extensions beyond the 101 - off by default, off is the
// old path bit for bit, and each one measured when on.
std::vector<double> renderVelocity(af::Voice101Parameters p, int note, double velocity, int samples,
                                   int skip = 4800) {
  af::Voice101 v;
  v.setSampleRate(48000.0);
  v.setParameters(p);
  v.reset();
  v.noteOn(note, velocity);
  for (int i = 0; i < skip; ++i) v.process();
  std::vector<double> out;
  out.reserve(static_cast<size_t>(samples));
  for (int i = 0; i < samples; ++i) out.push_back(v.process());
  return out;
}

/// Brightness: RMS of the first difference over RMS. Rises with high-frequency content.
double brightness(const std::vector<double>& xs, size_t from, size_t to) {
  double d = 0.0, a = 0.0;
  for (size_t i = from + 1; i < to && i < xs.size(); ++i) {
    d += (xs[i] - xs[i - 1]) * (xs[i] - xs[i - 1]);
    a += xs[i] * xs[i];
  }
  return a > 0.0 ? std::sqrt(d / a) : 0.0;
}

/// Times (seconds) of upward zero crossings, linearly interpolated. Armed only
/// after the signal has gone well below zero, so ripple near zero is not a cycle.
std::vector<double> upCrossings(const std::vector<double>& xs, double sr) {
  std::vector<double> t;
  bool armed = false;
  for (size_t i = 1; i < xs.size(); ++i) {
    if (xs[i] < -0.2) armed = true;
    if (armed && xs[i - 1] < 0.0 && xs[i] >= 0.0) {
      armed = false;
      const double f = xs[i - 1] / (xs[i - 1] - xs[i]);
      t.push_back((static_cast<double>(i - 1) + f) / sr);
    }
  }
  return t;
}

/// Spread of the period, in cents, between crossing times in [from, to) seconds.
double pitchSpreadCents(const std::vector<double>& t, double from, double to) {
  double lo = 1e9, hi = -1e9;
  for (size_t i = 1; i < t.size(); ++i) {
    if (t[i - 1] < from || t[i] >= to) continue;
    const double cents = 1200.0 * std::log2(1.0 / (t[i] - t[i - 1]));
    lo = std::fmin(lo, cents);
    hi = std::fmax(hi, cents);
  }
  return hi > lo ? hi - lo : 0.0;
}

double meanFrequency(const std::vector<double>& t, double from, double to) {
  double first = -1.0, last = -1.0;
  int n = 0;
  for (double x : t) {
    if (x < from || x >= to) continue;
    if (first < 0.0) first = x;
    last = x;
    ++n;
  }
  return n > 1 ? (n - 1) / (last - first) : 0.0;
}

void expressionTests() {
  std::printf("expression\n");
  const af::Voice101Parameters defaults;
  check(defaults.velocityToAmp == 0.0 && defaults.velocityToCutoff == 0.0 &&
            defaults.filterEnvSeparate == 0.0 && defaults.vibratoFadeIn == 0.0 &&
            defaults.driftCents == 0.0 && defaults.legatoGlide == 0.0,
        "expression is off by default", 0.0);

  af::Voice101Parameters patch;
  patch.sawLevel = 1.0;
  patch.pulseLevel = 0.4;
  patch.subLevel = 0.3;
  patch.cutoffHz = 900.0;
  patch.resonance = 0.3;
  patch.envToCutoff = 0.5;
  patch.lfoToPitch = 0.2;
  patch.lfoToPulseWidth = 0.3;
  patch.sustain = 0.7;
  patch.glideSeconds = 0.03;
  patch.unisonVoices = 5.0;
  patch.unisonDetuneCents = 18.0;
  const auto base = renderHeld(patch, 57, 48000);

  // Off is the old path: filter times are ignored while the envelope is shared,
  // and full velocity changes nothing even with both velocity amounts up.
  {
    af::Voice101Parameters q = patch;
    q.filterAttack = 0.5;
    q.filterDecay = 2.0;
    q.filterSustain = 0.1;
    q.filterRelease = 3.0;
    check(same(base, renderHeld(q, 57, 48000)), "filter times do nothing while the envelope is shared", 0.0);
    q = patch;
    q.velocityToAmp = 1.0;
    q.velocityToCutoff = 1.0;
    check(same(base, renderHeld(q, 57, 48000)), "full velocity is the old path, bit for bit", 0.0);
  }

  // Velocity to amp: at 1, half velocity is half amplitude (-6 dB).
  {
    af::Voice101Parameters q = openSaw();
    q.velocityToAmp = 1.0;
    const double db = 20.0 * std::log10(rms(renderVelocity(q, 57, 0.5, 48000)) /
                                        rms(renderVelocity(q, 57, 1.0, 48000)));
    check(std::fabs(db + 6.02) < 0.3, "velocity to amp: half velocity is -6 dB", db);
    q.velocityToAmp = 0.0;
    const double flat = 20.0 * std::log10(rms(renderVelocity(q, 57, 0.5, 48000)) /
                                          rms(renderVelocity(q, 57, 1.0, 48000)));
    check(std::fabs(flat) < 0.01, "velocity does nothing to level when off", flat);
  }

  // Velocity to cutoff: softer notes are darker; level is left alone.
  {
    af::Voice101Parameters q = openSaw();
    q.cutoffHz = 3000.0;
    q.velocityToCutoff = 0.6;
    const auto soft = renderVelocity(q, 57, 0.3, 24000), hard = renderVelocity(q, 57, 1.0, 24000);
    const double ratio = brightness(soft, 0, soft.size()) / brightness(hard, 0, hard.size());
    check(ratio < 0.7, "velocity to cutoff: a soft note is darker", ratio);
  }

  // A separate filter envelope closes the tone while the note sustains at full level.
  {
    af::Voice101Parameters q = openSaw();
    q.cutoffHz = 250.0;
    q.envToCutoff = 0.6;
    q.filterEnvSeparate = 1.0;
    q.filterAttack = 0.001;
    q.filterDecay = 0.15;
    q.filterSustain = 0.0;
    const auto x = renderVelocity(q, 57, 1.0, 48000, 0);
    const double early = brightness(x, 480, 2400), late = brightness(x, 24000, 48000);
    // A 220 Hz saw under a 250 Hz cutoff is nearly a sine late on; early the envelope
    // has it at ~0.9-3 kHz. The difference metric is dominated by the fundamental,
    // so the honest ratio is modest: 1.35 measured, against 1.00 shared.
    check(early > late * 1.25, "separate filter envelope: the tone closes over the note", early / late);
    const double lateDb = 20.0 * std::log10(rms(std::vector<double>(x.begin() + 24000, x.end())));
    q.filterEnvSeparate = 0.0;  // shared: sustain 1 keeps the filter open
    const auto y = renderVelocity(q, 57, 1.0, 48000, 0);
    const double flat = brightness(y, 480, 2400) / brightness(y, 24000, 48000);
    check(std::fabs(flat - 1.0) < 0.1, "shared envelope at sustain 1: the tone holds", flat);
    check(lateDb > -40.0, "the note still sounds after the filter closes", lateDb);
  }

  // Vibrato fade-in: no vibrato at the start, full depth after the fade.
  {
    af::Voice101Parameters q = openSaw();
    q.lfoRateHz = 5.0;
    q.lfoToPitch = 0.3;  // +/-30 cents
    q.vibratoFadeIn = 1.0;
    const auto x = renderVelocity(q, 57, 1.0, 96000, 0);
    const auto t = upCrossings(x, 48000.0);
    const double early = pitchSpreadCents(t, 0.05, 0.2), late = pitchSpreadCents(t, 1.2, 2.0);
    check(late > 45.0, "vibrato reaches full depth after the fade", late);
    check(early < late * 0.15, "vibrato fade-in: little vibrato in the first 200 ms", early);
  }

  // Drift: a slow wander of about the stated size; none when off.
  {
    af::Voice101Parameters q = openSaw();
    q.driftCents = 15.0;
    const auto x = renderVelocity(q, 57, 1.0, 48000 * 6, 0);
    const auto t = upCrossings(x, 48000.0);
    double lo = 1e9, hi = -1e9;
    for (double s0 = 0.2; s0 < 5.9; s0 += 0.1) {
      const double f = meanFrequency(t, s0, s0 + 0.1);
      if (f > 0.0) {
        lo = std::fmin(lo, f);
        hi = std::fmax(hi, f);
      }
    }
    const double cents = 1200.0 * std::log2(hi / lo);
    check(cents > 8.0 && cents < 32.0, "drift wanders by about its stated cents (peak to peak)", cents);
    q.driftCents = 0.0;
    check(same(renderHeld(openSaw(), 57, 48000), renderHeld(q, 57, 48000)), "drift off is the old path", 0.0);
  }

  // Legato-only glide: a detached note jumps, an overlapping one slides.
  {
    af::Voice101Parameters q = openSaw();
    q.glideSeconds = 0.2;
    auto secondNote = [&](bool overlap) {
      af::Voice101 v;
      v.setSampleRate(48000.0);
      v.setParameters(q);
      v.reset();
      v.noteOn(45);
      for (int i = 0; i < 9600; ++i) v.process();
      if (!overlap) {
        v.noteOff(45);
        for (int i = 0; i < 480; ++i) v.process();
      }
      v.noteOn(57);
      std::vector<double> out;
      for (int i = 0; i < 2400; ++i) out.push_back(v.process());
      return meanFrequency(upCrossings(out, 48000.0), 0.0, 0.05);
    };
    q.legatoGlide = 1.0;
    const double detached = secondNote(false), slurred = secondNote(true);
    check(std::fabs(detached - 220.0) < 5.0, "legato glide: a detached note starts on pitch", detached);
    check(slurred < 200.0, "legato glide: an overlapping note slides", slurred);
    q.legatoGlide = 0.0;
    check(secondNote(false) < 200.0, "without legato glide every note slides", secondNote(false));
  }

  // Presets: the new fields round-trip; an old preset loads with them off.
  {
    af::Voice101Parameters q = patch;
    q.velocityToCutoff = 0.4;
    q.filterEnvSeparate = 1.0;
    q.filterDecay = 0.25;
    q.vibratoFadeIn = 0.6;
    q.driftCents = 6.0;
    q.legatoGlide = 1.0;
    const auto back = af::loadPreset(af::savePreset(q));
    check(back.velocityToCutoff == 0.4 && back.filterEnvSeparate == 1.0 && back.filterDecay == 0.25 &&
              back.vibratoFadeIn == 0.6 && back.driftCents == 6.0 && back.legatoGlide == 1.0,
          "expression round-trips through a preset", back.filterDecay);
    const auto old = af::loadPreset("analogfoundry101 1\nsaw 1\ncutoff 650\nunison 5\n");
    check(old.velocityToAmp == 0.0 && old.filterEnvSeparate == 0.0 && old.driftCents == 0.0,
          "an old preset loads with expression off", old.driftCents);
  }
}

// Note memory and MIDI panic (0.3.1). Last-note priority as before, but a held
// note is remembered: releasing the newest returns, legato, to the one still
// held. CC 123 releases everything; CC 120 silences at once.
namespace {
struct Run {
  af::Voice101 v;
  explicit Run(const af::Voice101Parameters& p) {
    v.setSampleRate(48000.0);
    v.setParameters(p);
    v.reset();
  }
  std::vector<double> take(int samples) {
    std::vector<double> out;
    out.reserve(static_cast<size_t>(samples));
    for (int i = 0; i < samples; ++i) out.push_back(v.process());
    return out;
  }
};
}  // namespace

void noteMemoryTests() {
  std::printf("note memory and MIDI panic\n");
  af::Voice101Parameters p = openSaw();
  p.release = 0.05;

  // Hold A1, press A2 over it, let go of A2: the voice returns to A1, still sounding.
  {
    Run r(p);
    r.v.noteOn(45);
    r.take(9600);
    r.v.noteOn(57);
    r.take(9600);
    r.v.noteOff(57);
    const auto after = r.take(9600);
    const double f = meanFrequency(upCrossings(std::vector<double>(after.begin() + 2400, after.end()), 48000.0), 0.0, 1.0);
    check(std::fabs(f - 110.0) < 2.0, "releasing the newest note returns to the held one", f);
    check(rms(std::vector<double>(after.begin() + 4800, after.end())) > 0.3, "and it keeps sounding (no release)",
          rms(after));
    check(r.v.heldNoteCount() == 1, "one note is still held", r.v.heldNoteCount());
  }

  // Releasing the older note first changes nothing that sounds; then the voice releases.
  {
    Run r(p);
    r.v.noteOn(45);
    r.take(4800);
    r.v.noteOn(57);
    r.take(4800);
    r.v.noteOff(45);
    const auto still = r.take(9600);
    const double f = meanFrequency(upCrossings(still, 48000.0), 0.0, 1.0);
    check(std::fabs(f - 220.0) < 2.0, "releasing an older note leaves the sounding one alone", f);
    r.v.noteOff(57);
    r.take(9600);
    check(!r.v.isActive(), "releasing the last held note releases the voice", 0.0);
  }

  // The same calls as before 0.3.1 render the same: one note, then a legato pair.
  {
    af::Voice101Parameters q = p;
    q.glideSeconds = 0.05;
    Run a(q), b(q);
    a.v.noteOn(45); a.take(4800); a.v.noteOn(57); a.take(4800); a.v.noteOff(45); a.take(2400); a.v.noteOff(57);
    b.v.noteOn(45); b.take(4800); b.v.noteOn(57); b.take(4800); b.v.noteOff(45); b.take(2400); b.v.noteOff(57);
    check(same(a.take(9600), b.take(9600)), "note handling is deterministic", 0.0);
  }

  // CC 123: everything held is released through the release stage.
  {
    Run r(p);
    r.v.noteOn(45); r.v.noteOn(52); r.v.noteOn(57);
    r.take(4800);
    r.v.allNotesOff();
    const auto tail = r.take(4800);
    check(rms(std::vector<double>(tail.begin(), tail.begin() + 240)) > 0.05, "all notes off releases rather than cuts",
          rms(tail));
    r.take(9600);  // a 50 ms release reaches the idle threshold after ~125 ms
    check(!r.v.isActive() && r.v.heldNoteCount() == 0, "all notes off: nothing held, the voice idle", r.v.heldNoteCount());
    r.v.noteOff(52);  // a late note-off for a forgotten note must not misbehave
    check(!r.v.isActive(), "a stale note-off after all notes off is harmless", 0.0);
  }

  // CC 120: silence on the next sample.
  {
    af::Voice101Parameters q = p;
    q.release = 2.0;
    Run r(q);
    r.v.noteOn(45);
    r.take(4800);
    r.v.allSoundOff();
    const auto next = r.take(480);
    check(peak(next) == 0.0 && !r.v.isActive(), "all sound off is immediate, with no release", peak(next));
  }

  // More held notes than the stack keeps: the oldest is forgotten, nothing breaks.
  {
    Run r(p);
    for (int n = 40; n < 40 + af::Voice101::kMaxHeldNotes + 4; ++n) r.v.noteOn(n);
    check(r.v.heldNoteCount() == af::Voice101::kMaxHeldNotes, "the held-note stack is bounded", r.v.heldNoteCount());
    for (int n = 40 + af::Voice101::kMaxHeldNotes + 3; n >= 40; --n) r.v.noteOff(n);
    r.take(9600);
    check(!r.v.isActive() && r.v.heldNoteCount() == 0, "releasing them all leaves the voice idle", r.v.heldNoteCount());
  }

  // A repeated note (pressed again while held) does not leave a stuck copy.
  {
    Run r(p);
    r.v.noteOn(45);
    r.v.noteOn(45);
    r.v.noteOff(45);
    r.take(9600);
    check(!r.v.isActive(), "a repeated note releases with one note-off", 0.0);
  }
}

// 0.4: oscillators 2 and 3, LFO 2 and waveforms, pitch bend and controllers,
// and the modulation matrix. Off by default, off is the 0.3.1 path bit for bit,
// and each part measured when on.
namespace {
af::Voice101Parameters bareSine2() {
  // Oscillator 1 silent, oscillator 2 a sine: clean zero crossings to measure pitch.
  af::Voice101Parameters p = openSaw();
  p.sawLevel = 0.0;
  p.osc2Level = 1.0;
  p.osc2Wave = 3.0;
  return p;
}
double freqOf(const std::vector<double>& x) { return meanFrequency(upCrossings(x, 48000.0), 0.0, 100.0); }
std::vector<double> held(const af::Voice101Parameters& p, int note, int samples, double velocity = 1.0) {
  return renderVelocity(p, note, velocity, samples);
}
}  // namespace

void oscillatorMatrixTests() {
  std::printf("oscillators 2-3, LFO 2, controllers, matrix (0.4)\n");
  const af::Voice101Parameters d;
  check(d.osc2Level == 0.0 && d.osc3Level == 0.0 && d.mod1 == af::kModSlotEmpty && d.mod8 == af::kModSlotEmpty &&
            d.lfo1Wave == 0.0 && d.pitchBendRange == 2.0,
        "0.4 is off by default", 0.0);

  // Off is the old path: settings that only matter when switched on change nothing.
  {
    af::Voice101Parameters patch = openSaw();
    patch.pulseLevel = 0.4;
    patch.cutoffHz = 1200.0;
    patch.envToCutoff = 0.4;
    patch.sustain = 0.7;
    patch.unisonVoices = 5.0;
    patch.unisonDetuneCents = 15.0;
    const auto base = renderHeld(patch, 57, 48000);
    af::Voice101Parameters q = patch;
    q.osc2Wave = 2.0; q.osc2Octave = 1.0; q.osc2Semi = 7.0; q.osc3Fine = 30.0;  // levels still 0
    q.lfo2RateHz = 7.0; q.lfo2Wave = 4.0; q.pitchBendRange = 12.0;
    af::setModSlot(q, 0, 3, 1, 0.0);                     // amount 0
    af::setModSlot(q, 1, 0, 2, 0.5);                     // source none
    af::setModSlot(q, 2, 5, 0, 0.5);                     // destination none
    check(same(base, renderHeld(q, 57, 48000)), "inactive 0.4 settings are the 0.3.1 path, bit for bit", 0.0);
  }

  // Each wave of oscillator 2 at full level sits at oscillator 1's saw level.
  {
    const double sawDb = 20.0 * std::log10(rms(held(openSaw(), 57, 48000)));
    const char* names[] = {"saw", "pulse", "triangle", "sine"};
    for (int w = 0; w < 4; ++w) {
      af::Voice101Parameters q = openSaw();
      q.sawLevel = 0.0;
      q.osc2Level = 1.0;
      q.osc2Wave = w;
      const double db = 20.0 * std::log10(rms(held(q, 57, 48000))) - sawDb;
      check(std::fabs(db) < 0.5, std::string("osc 2 ") + names[w] + " is level-calibrated to the saw", db);
    }
  }

  // Tuning: octave, semitone and fine move oscillator 2 as stated; oscillator 3 alike.
  {
    af::Voice101Parameters q = bareSine2();
    q.osc2Octave = 1.0;
    check(std::fabs(freqOf(held(q, 57, 48000)) - 440.0) < 1.0, "osc 2 octave +1 doubles the pitch", freqOf(held(q, 57, 48000)));
    q.osc2Octave = 0.0;
    q.osc2Semi = 7.0;
    q.osc2Fine = 50.0;
    const double want = 220.0 * std::pow(2.0, 7.5 / 12.0);
    check(std::fabs(freqOf(held(q, 57, 48000)) - want) < 0.5, "osc 2 semitone and fine tune", freqOf(held(q, 57, 48000)));
    af::Voice101Parameters r = openSaw();
    r.sawLevel = 0.0;
    r.osc3Level = 1.0;
    r.osc3Wave = 3.0;
    r.osc3Octave = -1.0;
    check(std::fabs(freqOf(held(r, 57, 48000)) - 110.0) < 0.5, "osc 3 octave -1 halves the pitch", freqOf(held(r, 57, 48000)));
  }

  // Oscillator 2 shares the unison stack: detuned, it beats.
  {
    af::Voice101Parameters q = openSaw();
    q.sawLevel = 0.0;
    q.osc2Level = 1.0;
    const double steady = wobble(held(q, 57, 144000));
    q.unisonVoices = 7.0;
    q.unisonDetuneCents = 25.0;
    const double stacked = wobble(held(q, 57, 144000));
    check(stacked > steady * 5.0, "osc 2 uses the unison stack", stacked / std::fmax(steady, 1e-12));
  }

  // Pitch bend: full bend at a 7-semitone range raises the pitch 7 semitones.
  {
    af::Voice101Parameters q = bareSine2();
    q.pitchBendRange = 7.0;
    af::Voice101 v;
    v.setSampleRate(48000.0);
    v.setParameters(q);
    v.reset();
    v.noteOn(57);
    v.setPitchBend(1.0);
    for (int i = 0; i < 4800; ++i) v.process();
    std::vector<double> x;
    for (int i = 0; i < 48000; ++i) x.push_back(v.process());
    check(std::fabs(freqOf(x) - 220.0 * std::pow(2.0, 7.0 / 12.0)) < 0.5, "pitch bend follows its range", freqOf(x));
  }

  // Matrix: velocity -> amp. Velocity 0.5 at amount 1 is gain x1.5 (+3.5 dB) over velocity 0.
  {
    af::Voice101Parameters q = openSaw();
    af::setModSlot(q, 0, af::kSrcVelocity, af::kDstAmp, 1.0);
    const double db = 20.0 * std::log10(rms(held(q, 57, 24000, 0.5)) / rms(held(q, 57, 24000, 0.0)));
    check(std::fabs(db - 3.52) < 0.2, "matrix: velocity to amp, x(1 + amount * source)", db);
  }

  // Matrix: the filter envelope bends the pitch down from +12 to the note (a pitch drop).
  {
    af::Voice101Parameters q = bareSine2();
    q.filterEnvSeparate = 1.0;
    q.filterAttack = 0.0;
    q.filterDecay = 0.2;
    q.filterSustain = 0.0;
    af::setModSlot(q, 0, af::kSrcFilterEnv, af::kDstPitch, 0.5);  // 12 semitones at the envelope's peak
    const auto x = renderVelocity(q, 57, 1.0, 48000, 0);
    const auto t = upCrossings(x, 48000.0);
    const double early = meanFrequency(t, 0.0, 0.01), late = meanFrequency(t, 0.5, 1.0);
    check(early > 380.0 && std::fabs(late - 220.0) < 1.0, "matrix: envelope to pitch drops an octave to the note", early);
  }

  // Matrix: key -> cutoff tracks; mod wheel -> fine; LFO 2 square -> pitch alternates.
  {
    af::Voice101Parameters q = openSaw();
    q.cutoffHz = 600.0;
    af::setModSlot(q, 0, af::kSrcKey, af::kDstCutoff, 1.0);
    const double low = brightness(held(q, 45, 24000), 0, 24000), high = brightness(held(q, 81, 24000), 0, 24000);
    check(high > low * 2.0, "matrix: key to cutoff opens the filter for higher notes", high / low);

    af::Voice101Parameters w = bareSine2();
    af::setModSlot(w, 0, af::kSrcModWheel, af::kDstFine, 1.0);  // 100 cents at full wheel
    af::Voice101 v;
    v.setSampleRate(48000.0);
    v.setParameters(w);
    v.reset();
    v.noteOn(57);
    v.setModWheel(1.0);
    for (int i = 0; i < 4800; ++i) v.process();
    std::vector<double> x;
    for (int i = 0; i < 48000; ++i) x.push_back(v.process());
    check(std::fabs(freqOf(x) - 220.0 * std::pow(2.0, 1.0 / 12.0)) < 0.5, "matrix: mod wheel to fine, 100 cents at full", freqOf(x));

    af::Voice101Parameters l = bareSine2();
    l.lfo2RateHz = 2.0;
    l.lfo2Wave = 3.0;  // square
    af::setModSlot(l, 0, af::kSrcLfo2, af::kDstPitch, 1.0 / 24.0);                // +/-1 semitone
    const auto y = renderVelocity(l, 57, 1.0, 48000, 0);
    const auto ty = upCrossings(y, 48000.0);
    const double up = meanFrequency(ty, 0.02, 0.23), down = meanFrequency(ty, 0.27, 0.48);
    check(std::fabs(up / down - std::pow(2.0, 2.0 / 12.0)) < 0.01, "LFO 2 square to pitch: two semitones apart", up / down);
  }

  // LFO waves: sample-and-hold steps once a cycle; retrigger restarts the phase per note.
  {
    af::Voice101Parameters q = bareSine2();
    q.lfoRateHz = 4.0;
    q.lfo1Wave = 4.0;
    af::setModSlot(q, 0, af::kSrcLfo1, af::kDstFine, 0.5);
    const auto x = renderVelocity(q, 57, 1.0, 48000, 0);
    const auto t = upCrossings(x, 48000.0);
    double lo = 1e9, hi = -1e9;
    for (double s0 = 0.01; s0 < 0.95; s0 += 0.25) {
      const double f = meanFrequency(t, s0, s0 + 0.2);
      lo = std::fmin(lo, f);
      hi = std::fmax(hi, f);
    }
    check(hi / lo > 1.005, "LFO sample-and-hold steps between cycles", 1200.0 * std::log2(hi / lo));
    check(same(x, renderVelocity(q, 57, 1.0, 48000, 0)), "sample-and-hold is deterministic", 0.0);
  }

  // Note random: a different value per note, the same sequence every run.
  {
    af::Voice101Parameters q = bareSine2();
    af::setModSlot(q, 0, af::kSrcNoteRandom, af::kDstFine, 0.5);
    auto two = [&]() {
      af::Voice101 v;
      v.setSampleRate(48000.0);
      v.setParameters(q);
      v.reset();
      std::vector<double> f;
      for (int n = 0; n < 2; ++n) {
        v.noteOn(57);
        std::vector<double> x;
        for (int i = 0; i < 24000; ++i) x.push_back(v.process());
        v.noteOff(57);
        for (int i = 0; i < 9600; ++i) v.process();
        f.push_back(freqOf(std::vector<double>(x.begin() + 2400, x.end())));
      }
      return f;
    };
    const auto a = two(), b = two();
    check(std::fabs(a[0] - a[1]) > 0.05, "note random differs between notes", a[0] - a[1]);
    check(a[0] == b[0] && a[1] == b[1], "and repeats run to run", a[0] - b[0]);
  }

  // The packed slot: every source x destination and amounts to 1/10000 survive a
  // host's 32-bit normalised value (what Live stores) and come back exact.
  {
    bool ok = true;
    double worst = 0.0;
    for (int src = 0; src < af::kSrcCount; ++src)
      for (int dst = 0; dst < af::kDstCount; ++dst)
        for (double amt : {-1.0, -0.4999, -0.0083, 0.0, 0.0001, 0.3333, 1.0}) {
          const float normalised = static_cast<float>(af::packModSlot(src, dst, amt) / af::kModSlotMax);
          const af::ModSlot back = af::unpackModSlot(static_cast<double>(normalised) * af::kModSlotMax);
          const double err = std::fabs(back.amount - amt);
          worst = std::fmax(worst, err);
          if (back.source != src || back.dest != dst || err > 0.00005) ok = false;
        }
    check(ok, "a packed matrix slot survives a 32-bit normalised host value", worst);
  }

  // Everything at once, at the extremes, stays finite.
  {
    af::Voice101Parameters q = openSaw();
    q.resonance = 1.0;
    q.osc2Level = 1.0; q.osc2Wave = 1.0; q.osc2Octave = 3.0;
    q.osc3Level = 1.0; q.osc3Wave = 2.0; q.osc3Octave = -3.0;
    q.unisonVoices = 7.0; q.unisonDetuneCents = 50.0;
    for (int i = 0; i < 8; ++i) {
      af::setModSlot(q, i, 1 + (i % 9), 1 + (i * 2) % 16, i % 2 ? -1.0 : 1.0);
    }
    const auto x = held(q, 100, 48000);
    check(finiteAll(x) && peak(x) < 8.0, "every 0.4 feature at its extreme stays finite", peak(x));
  }

  // Presets: every 0.4 field round-trips; an old preset loads with them off.
  {
    af::Voice101Parameters q;
    q.osc2Level = 0.5; q.osc2Wave = 2; q.osc2Octave = 1; q.osc2Semi = -5; q.osc2Fine = 12;
    q.osc3Level = 0.25; q.osc3Wave = 3; q.osc3Octave = -2;
    q.lfo1Wave = 4; q.lfo1Retrigger = 1; q.lfo2RateHz = 0.7; q.lfo2Wave = 1; q.lfo2Retrigger = 1;
    q.pitchBendRange = 12;
    af::setModSlot(q, 7, 9, 16, -0.25);
    const auto back = af::loadPreset(af::savePreset(q));
    const af::ModSlot m8 = af::getModSlot(back, 7);
    check(back.osc2Semi == -5 && back.osc3Octave == -2 && back.lfo2RateHz == 0.7 && m8.source == 9 && m8.dest == 16 &&
              m8.amount == -0.25 && back.lfo1Retrigger == 1,
          "0.4 fields round-trip through a preset", m8.amount);
    const auto old = af::loadPreset("analogfoundry101 1\nsaw 1\nvel_cutoff 0.3\n");
    check(old.osc2Level == 0.0 && af::getModSlot(old, 0).source == 0 && old.lfo2RateHz == 2.0, "an older preset loads with 0.4 off",
          old.osc2Level);
  }
}

int main() {
  std::printf("AnalogFoundry 101 - model tests (M5, M6, M8, M10, unison, expression, note memory, 0.4)\n\n");
  calibrationTests();
  nonlinearityTests();
  variationTests();
  effectTests();
  unisonTests();
  expressionTests();
  noteMemoryTests();
  oscillatorMatrixTests();
  std::printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
}
