// Internal level calibration and analogue variation.
//
// Milestone 6 asks for consistent internal levels and a calibrated oscillator
// mixer. The problem it solves: a saw at full scale and a 50 % pulse at full
// scale do not carry the same energy, so moving a mixer slider from one to the
// other changes loudness as well as timbre, and the filter sees a different
// drive level. Both are wrong. The constants below are *measured*, by
// `calibration_tests`, not guessed - if an oscillator changes, the test fails
// and the number has to be re-measured.
//
// Milestone 8 asks for component tolerance, drift and circuit noise, and is
// explicit that this comes **last** and must be subtle and bypassable. All of
// it is off by default: `AnalogVariation{}` is a perfectly matched, drift-free,
// noiseless instrument, and every field has to be turned on deliberately.

#pragma once

#include <cmath>
#include <cstdint>

namespace af {

/// RMS of each waveform at unit amplitude, measured by calibration_tests.
/// Dividing by these makes the mixer sliders equal-loudness.
struct OscillatorCalibration {
  /// A unit saw has RMS 1/sqrt(3).
  static constexpr double kSawRms = 0.5773502691896258;
  /// A unit square has RMS 1.
  static constexpr double kPulseRms = 1.0;
  /// The sub is a square an octave down: same RMS.
  static constexpr double kSubRms = 1.0;
  /// Uniform white noise over +/-1 has RMS 1/sqrt(3).
  static constexpr double kNoiseRms = 0.5773502691896258;

  /// Scale each source to a common reference so the mixer is calibrated.
  /// The reference is the saw, because it is the voice's default source.
  static constexpr double sawGain() { return 1.0; }
  static constexpr double pulseGain() { return kSawRms / kPulseRms; }
  static constexpr double subGain() { return kSawRms / kSubRms; }
  static constexpr double noiseGain() { return kSawRms / kNoiseRms; }
  /// A unit triangle has the saw's RMS, 1/sqrt(3); a unit sine 1/sqrt(2).
  static constexpr double kTriangleRms = 0.5773502691896258;
  static constexpr double kSineRms = 0.7071067811865476;
  static constexpr double triangleGain() { return kSawRms / kTriangleRms; }
  static constexpr double sineGain() { return kSawRms / kSineRms; }
};

/// Subtle per-instance imperfection. Everything defaults to off.
struct AnalogVariation {
  /// Filter stage cutoff spread, as a fraction. 0.02 = +/-2 % between poles.
  double componentTolerance = 0.0;
  /// Slow pitch wander in cents, peak.
  double driftCents = 0.0;
  /// How fast the drift wanders, Hz.
  double driftRateHz = 0.1;
  /// Circuit noise floor, linear amplitude. 1e-4 is about -80 dBFS.
  double noiseFloor = 0.0;
  /// Seed, so an "imperfect" instrument is still reproducible.
  uint32_t seed = 0x101a1u;

  bool anyEnabled() const noexcept {
    return componentTolerance > 0.0 || driftCents > 0.0 || noiseFloor > 0.0;
  }
};

/// Generates the variation signals. Deterministic for a given seed, which is
/// what lets "analogue" coexist with a bit-exact determinism test.
class VariationEngine {
 public:
  void configure(const AnalogVariation& v, double sampleRate) noexcept {
    settings_ = v;
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    state_ = v.seed | 1u;

    // Component tolerance is fixed at build time for an instance, as real
    // resistors are: it must not wander, or it would be drift by another name.
    for (int i = 0; i < 4; ++i) {
      stageSpread_[i] = v.componentTolerance * bipolar();
    }

    // Two detuned sines make a wander that does not audibly repeat, without
    // the cost of filtered noise.
    driftPhaseA_ = 0.0;
    driftPhaseB_ = 0.37;
    noise_ = state_;
  }

  const double* stageSpread() const noexcept { return stageSpread_; }

  /// Pitch multiplier for this sample. Exactly 1.0 when drift is off.
  double tickPitchMultiplier() noexcept {
    if (settings_.driftCents <= 0.0) return 1.0;
    const double rate = settings_.driftRateHz / sampleRate_;
    driftPhaseA_ += rate;
    driftPhaseB_ += rate * 0.613;  // irrational-ish ratio: no short cycle
    if (driftPhaseA_ >= 1.0) driftPhaseA_ -= 1.0;
    if (driftPhaseB_ >= 1.0) driftPhaseB_ -= 1.0;
    const double wander = 0.5 * (std::sin(kTwoPi * driftPhaseA_) + std::sin(kTwoPi * driftPhaseB_));
    return std::pow(2.0, (settings_.driftCents * wander) / 1200.0);
  }

  /// Circuit noise for this sample. Exactly 0.0 when the noise floor is off.
  double tickNoise() noexcept {
    if (settings_.noiseFloor <= 0.0) return 0.0;
    noise_ ^= noise_ << 13;
    noise_ ^= noise_ >> 17;
    noise_ ^= noise_ << 5;
    return static_cast<double>(static_cast<int32_t>(noise_)) * (1.0 / 2147483648.0) *
           settings_.noiseFloor;
  }

 private:
  double bipolar() noexcept {
    state_ ^= state_ << 13;
    state_ ^= state_ >> 17;
    state_ ^= state_ << 5;
    return static_cast<double>(static_cast<int32_t>(state_)) * (1.0 / 2147483648.0);
  }

  static constexpr double kTwoPi = 6.283185307179586;

  AnalogVariation settings_{};
  double sampleRate_ = 48000.0;
  uint32_t state_ = 1u;
  uint32_t noise_ = 1u;
  double stageSpread_[4] = {0.0, 0.0, 0.0, 0.0};
  double driftPhaseA_ = 0.0;
  double driftPhaseB_ = 0.0;
};

}  // namespace af
