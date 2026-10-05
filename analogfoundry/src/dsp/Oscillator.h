// Band-limited oscillators for the 101-style voice.
//
// PolyBLEP was chosen over minBLEP/BLIT for the first implementation: it is
// cheap, has no table state, and `oscillator_tests` measures the aliasing it
// actually achieves rather than assuming it. The test asserts a measured
// improvement over a naive ramp, so swapping in minBLEP later must beat a
// recorded number rather than an opinion.
//
// Realtime rules (ANALOG_SYNTH_AGENT.md "Coding Rules"): no allocation, no
// locks, no logging, no exceptions on the audio path. Everything here is a
// plain value type with a fixed footprint.

#pragma once

#include <cmath>
#include <cstdint>

namespace af {

inline constexpr double kPi = 3.14159265358979323846;

/// Wrap into [0,1). Branch form is faster than fmod for the small steps here.
inline double wrap01(double x) noexcept {
  while (x >= 1.0) x -= 1.0;
  while (x < 0.0) x += 1.0;
  return x;
}

/// PolyBLEP residual at a discontinuity. `t` is phase, `dt` is phase increment.
inline double polyBlep(double t, double dt) noexcept {
  if (dt <= 0.0) return 0.0;
  if (t < dt) {
    const double x = t / dt;
    return x + x - x * x - 1.0;
  }
  if (t > 1.0 - dt) {
    const double x = (t - 1.0) / dt;
    return x * x + x + x + 1.0;
  }
  return 0.0;
}

/// Saw and pulse from one phase accumulator, as the hardware derives them.
class Oscillator {
 public:
  void setSampleRate(double sr) noexcept { sampleRate_ = sr > 0.0 ? sr : 48000.0; }

  void setFrequency(double hz) noexcept {
    // Clamp below Nyquist; a phase increment >= 0.5 cannot be band-limited.
    const double maxHz = sampleRate_ * 0.49;
    frequency_ = hz < 0.0 ? 0.0 : (hz > maxHz ? maxHz : hz);
    increment_ = frequency_ / sampleRate_;
  }

  double frequency() const noexcept { return frequency_; }
  double increment() const noexcept { return increment_; }

  /// Duty cycle of the pulse output. The hardware cannot reach 0 or 100 %,
  /// and neither can this: at the limits the pulse would vanish entirely.
  void setPulseWidth(double pw) noexcept {
    pulseWidth_ = pw < kMinPulseWidth ? kMinPulseWidth
                                      : (pw > kMaxPulseWidth ? kMaxPulseWidth : pw);
  }
  double pulseWidth() const noexcept { return pulseWidth_; }

  void reset(double phase = 0.0) noexcept {
    phase_ = wrap01(phase);
    subPhase_ = 0.0;
  }

  double phase() const noexcept { return phase_; }

  /// Advance one sample. Call once per sample, then read the outputs.
  void tick() noexcept {
    phase_ = wrap01(phase_ + increment_);
    subPhase_ = wrap01(subPhase_ + increment_ * 0.5);
  }

  /// Band-limited falling saw, nominally -1..1.
  double saw() const noexcept {
    return (2.0 * phase_ - 1.0) - polyBlep(phase_, increment_);
  }

  /// Band-limited pulse at the current width, nominally -1..1.
  double pulse() const noexcept {
    double v = phase_ < pulseWidth_ ? 1.0 : -1.0;
    v += polyBlep(phase_, increment_);
    v -= polyBlep(wrap01(phase_ + 1.0 - pulseWidth_), increment_);
    return v;
  }

  /// Square one octave down, phase-locked to the main oscillator.
  double subOctaveDown() const noexcept {
    const double inc = increment_ * 0.5;
    double v = subPhase_ < 0.5 ? 1.0 : -1.0;
    v += polyBlep(subPhase_, inc);
    v -= polyBlep(wrap01(subPhase_ + 0.5), inc);
    return v;
  }

  /// Naive (aliasing) saw. Exists only so the tests can measure what
  /// band-limiting buys; never use it in the signal path.
  /// Triangle. Naive: its harmonics fall at 12 dB/octave, so what aliases is
  /// already 40 dB down by the 10th harmonic.
  double triangle() const noexcept {
    return phase_ < 0.5 ? 4.0 * phase_ - 1.0 : 3.0 - 4.0 * phase_;
  }

  double sine() const noexcept { return std::sin(2.0 * kPi * phase_); }

  double naiveSawForTesting() const noexcept { return 2.0 * phase_ - 1.0; }

  static constexpr double kMinPulseWidth = 0.02;
  static constexpr double kMaxPulseWidth = 0.98;

 private:
  double sampleRate_ = 48000.0;
  double frequency_ = 0.0;
  double increment_ = 0.0;
  double pulseWidth_ = 0.5;
  double phase_ = 0.0;
  double subPhase_ = 0.0;
};

/// Deterministic white noise. A fixed seed is a test requirement
/// (ANALOG_SYNTH_AGENT.md "Determinism"), so this never reads a clock.
class NoiseGenerator {
 public:
  explicit NoiseGenerator(uint32_t seed = 0x5eed1234u) noexcept : state_(seed | 1u) {}

  void reset(uint32_t seed = 0x5eed1234u) noexcept { state_ = seed | 1u; }

  double next() noexcept {
    // xorshift32: cheap, no allocation, repeatable.
    state_ ^= state_ << 13;
    state_ ^= state_ >> 17;
    state_ ^= state_ << 5;
    return static_cast<double>(static_cast<int32_t>(state_)) * (1.0 / 2147483648.0);
  }

 private:
  uint32_t state_;
};

}  // namespace af
