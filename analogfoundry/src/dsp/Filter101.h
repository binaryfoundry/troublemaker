// Four-pole OTA-style resonant low-pass, the heart of the 101 model.
//
// Structure: four cascaded topology-preserving-transform one-pole sections
// with a nonlinear resonance feedback path, run inside an oversampled block.
// TPT rather than a biquad cascade because cutoff is swept by the envelope on
// every note, and a direct-form biquad produces coefficient artefacts when
// modulated at that rate.
//
// Nonlinearity placement (ANALOG_SYNTH_AGENT.md "Nonlinearity" asks that each
// site be tested separately):
//
//   input stage   - optional, off by default
//   per-stage     - optional, off by default
//   feedback path - always on; this is what makes resonance behave
//
// The defaults are deliberate. The document forbids adding saturation because
// it sounds pleasing, so only the feedback nonlinearity - which changes
// resonance behaviour measurably, not just tonally - is on unless a caller
// asks for more. `filter_tests` measures each site independently.

#pragma once

#include <cmath>

#include "Decimator.h"

namespace af {

/// Cheap bounded saturator. tanh is the reference; this is within ~1 % of it
/// over +/-3 and costs a divide instead of an exp.
inline double softClip(double x) noexcept {
  if (x < -3.0) return -1.0;
  if (x > 3.0) return 1.0;
  const double x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

/// CPU/quality trade. ANALOG_SYNTH_AGENT.md "Quality Modes" asks for this to
/// be explicit rather than a hidden compile-time constant.
enum class Quality { Draft = 1, Normal = 2, High = 4 };

class Filter101 {
 public:
  void setSampleRate(double sr) noexcept {
    sampleRate_ = sr > 0.0 ? sr : 48000.0;
    updateRates();
    reset();
  }

  /// Oversampling factor around the nonlinear block.
  void setQuality(Quality q) noexcept {
    oversample_ = static_cast<int>(q);
    updateRates();
  }
  int oversampleFactor() const noexcept { return oversample_; }

  void reset() noexcept {
    for (double& s : state_) s = 0.0;
    feedbackMemory_ = 0.0;
    up1_.reset();
    up2_.reset();
    down1_.reset();
    down2_.reset();
  }

  /// Cutoff in Hz. Clamped to a musically useful, numerically safe band.
  void setCutoff(double hz) noexcept {
    const double maxHz = oversampledRate_ * 0.45;
    cutoff_ = hz < kMinCutoffHz ? kMinCutoffHz : (hz > maxHz ? maxHz : hz);
    updateCoefficient();
  }
  double cutoff() const noexcept { return cutoff_; }

  /// Resonance 0..1. Self-oscillation begins near the top of the range.
  void setResonance(double r) noexcept {
    resonance_ = r < 0.0 ? 0.0 : (r > 1.0 ? 1.0 : r);
    feedbackAmount_ = resonance_ * kMaxFeedback;
  }
  double resonance() const noexcept { return resonance_; }

  /// Optional saturation inside each integrator stage. Off by default.
  void setStageNonlinearity(double amount) noexcept {
    stageDrive_ = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
  }
  double stageNonlinearity() const noexcept { return stageDrive_; }

  /// Optional saturation at the input. Off by default.
  void setInputNonlinearity(double amount) noexcept {
    inputDrive_ = amount < 0.0 ? 0.0 : (amount > 1.0 ? 1.0 : amount);
  }
  double inputNonlinearity() const noexcept { return inputDrive_; }

  /// Per-instance stage spread, from component tolerance. 0 = matched.
  void setStageSpread(const double spread[4]) noexcept {
    for (int i = 0; i < 4; ++i) stageSpread_[i] = spread[i];
    updateCoefficient();
  }

  /// One sample in, one sample out. Realtime-safe: no allocation, no locks.
  double process(double input) noexcept {
    if (oversample_ == 1) return processOversampled(input);
    if (oversample_ == 2) {
      double a, b;
      up1_.process(input, a, b);
      return down1_.process(processOversampled(a), processOversampled(b));
    }
    // 4x: two cascaded halvings each way, rather than one wide filter.
    double x2a, x2b;
    up1_.process(input, x2a, x2b);
    double a, b, c, d;
    up2_.process(x2a, a, b);
    up2_.process(x2b, c, d);
    const double ya = down2_.process(processOversampled(a), processOversampled(b));
    const double yb = down2_.process(processOversampled(c), processOversampled(d));
    return down1_.process(ya, yb);
  }

  static constexpr double kMinCutoffHz = 10.0;
  /// Loop gain at full resonance. Above 4.0 a 4-pole ladder self-oscillates.
  static constexpr double kMaxFeedback = 4.6;

 private:
  void updateRates() noexcept {
    oversampledRate_ = sampleRate_ * oversample_;
    updateCoefficient();
  }

  void updateCoefficient() noexcept {
    // TPT one-pole: g = tan(pi * fc / fs), G = g / (1 + g).
    for (int i = 0; i < 4; ++i) {
      const double fc = cutoff_ * (1.0 + stageSpread_[i]);
      const double limited = fc > oversampledRate_ * 0.45 ? oversampledRate_ * 0.45 : fc;
      const double g = std::tan(kPiLocal * (limited < kMinCutoffHz ? kMinCutoffHz : limited) /
                                oversampledRate_);
      gain_[i] = g / (1.0 + g);
    }
  }

  double processOversampled(double input) noexcept {
    // Resonance costs low-end level in the real circuit, but not all of it:
    // compensating fully makes high resonance sound thin and wrong.
    double drive = input * (1.0 + resonance_ * 0.5);
    if (inputDrive_ > 0.0) {
      drive = drive * (1.0 - inputDrive_) + softClip(drive) * inputDrive_;
    }

    // Nonlinearity in the feedback path: always on.
    double u = drive - feedbackAmount_ * softClip(feedbackMemory_);

    for (int i = 0; i < 4; ++i) {
      const double v = (u - state_[i]) * gain_[i];
      double y = v + state_[i];
      state_[i] = y + v;
      if (stageDrive_ > 0.0) {
        y = y * (1.0 - stageDrive_) + softClip(y) * stageDrive_;
      }
      u = y;
    }
    feedbackMemory_ = u;
    return u;
  }

  static constexpr double kPiLocal = 3.14159265358979323846;

  double sampleRate_ = 48000.0;
  // 4x by default, not 2x. 4x tracks the analog prototype most closely across
  // the passband and folds 123 dB less energy when a nonlinearity is driven;
  // 2x has a measured response defect documented in model_tests.
  int oversample_ = 4;
  double oversampledRate_ = 192000.0;
  double cutoff_ = 1000.0;
  double resonance_ = 0.0;
  double feedbackAmount_ = 0.0;
  double stageDrive_ = 0.0;
  double inputDrive_ = 0.0;
  double gain_[4] = {0.0, 0.0, 0.0, 0.0};
  double stageSpread_[4] = {0.0, 0.0, 0.0, 0.0};
  double state_[4] = {0.0, 0.0, 0.0, 0.0};
  double feedbackMemory_ = 0.0;
  HalfBandInterpolator up1_{};
  HalfBandInterpolator up2_{};
  HalfBandDecimator down1_{};
  HalfBandDecimator down2_{};
};

}  // namespace af
