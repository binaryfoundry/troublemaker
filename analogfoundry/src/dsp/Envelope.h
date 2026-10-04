// ADSR, VCA and parameter smoothing.
//
// The envelope uses exponential segments rather than linear ramps, because
// the analogue original charges a capacitor through a resistor and that curve
// is audible in the attack of a plucked bass. "Time" is defined as the time to
// cross 99 % of the way to the target, so a stated 300 ms decay measurably
// takes 300 ms - `envelope_tests` asserts exactly that, since an exponential
// that only asymptotes would otherwise let any coefficient pass.

#pragma once

#include <cmath>

namespace af {

/// Exponential ADSR. Deterministic and allocation-free.
class Envelope {
 public:
  enum class Stage { Idle, Attack, Decay, Sustain, Release };

  void setSampleRate(double sr) noexcept {
    sampleRate_ = sr > 0.0 ? sr : 48000.0;
    updateAll();
  }

  void setAttack(double seconds) noexcept { attackSeconds_ = clampTime(seconds); updateAll(); }
  void setDecay(double seconds) noexcept { decaySeconds_ = clampTime(seconds); updateAll(); }
  void setRelease(double seconds) noexcept { releaseSeconds_ = clampTime(seconds); updateAll(); }
  void setSustain(double level) noexcept {
    sustain_ = level < 0.0 ? 0.0 : (level > 1.0 ? 1.0 : level);
  }

  double sustain() const noexcept { return sustain_; }
  Stage stage() const noexcept { return stage_; }
  double value() const noexcept { return value_; }
  bool isActive() const noexcept { return stage_ != Stage::Idle; }

  void noteOn() noexcept { stage_ = Stage::Attack; }

  void noteOff() noexcept {
    if (stage_ != Stage::Idle) stage_ = Stage::Release;
  }

  void reset() noexcept {
    stage_ = Stage::Idle;
    value_ = 0.0;
  }

  double tick() noexcept {
    switch (stage_) {
      case Stage::Idle:
        value_ = 0.0;
        break;
      case Stage::Attack:
        // Aim past 1.0 so the curve crosses it in finite time rather than
        // creeping towards it; that is what makes a fast attack feel fast.
        value_ += attackCoeff_ * (kAttackTarget - value_);
        if (value_ >= 1.0) {
          value_ = 1.0;
          stage_ = Stage::Decay;
        }
        break;
      case Stage::Decay:
        value_ += decayCoeff_ * (sustain_ - value_);
        if (std::fabs(value_ - sustain_) < kEpsilon) {
          value_ = sustain_;
          stage_ = Stage::Sustain;
        }
        break;
      case Stage::Sustain:
        value_ = sustain_;
        break;
      case Stage::Release:
        value_ += releaseCoeff_ * (0.0 - value_);
        if (value_ < kEpsilon) {
          value_ = 0.0;
          stage_ = Stage::Idle;
        }
        break;
    }
    return value_;
  }

 private:
  static constexpr double kEpsilon = 1.0e-5;
  /// Attack aims here so it reaches 1.0 in the stated time.
  static constexpr double kAttackTarget = 1.2;

  static double clampTime(double s) noexcept { return s < 0.0 ? 0.0 : (s > 60.0 ? 60.0 : s); }

  /// Per-sample coefficient reaching `fraction` of the way to the target in
  /// `seconds`. `decay` and `release` asymptote, so they use 99 %.
  double coefficientFor(double seconds, double exponent) const noexcept {
    if (seconds <= 0.0) return 1.0;
    const double samples = seconds * sampleRate_;
    if (samples < 1.0) return 1.0;
    return 1.0 - std::exp(-exponent / samples);
  }

  void updateAll() noexcept {
    // Attack aims at kAttackTarget but *ends* when it crosses 1.0, so its
    // exponent must be the one that puts the curve at 1.0 - not at 99 % of
    // 1.2 - after the stated time. Using the 99 % exponent here made a 50 ms
    // attack finish in 19.5 ms, which the envelope test caught.
    attackCoeff_ = coefficientFor(attackSeconds_, kAttackExponent);
    decayCoeff_ = coefficientFor(decaySeconds_, kNinetyNinePercent);
    releaseCoeff_ = coefficientFor(releaseSeconds_, kNinetyNinePercent);
  }

  /// -ln(0.01): the exponent that puts 99 % inside the stated time.
  static constexpr double kNinetyNinePercent = 4.605170185988091;
  /// ln(kAttackTarget / (kAttackTarget - 1)) = ln(6): reaches exactly 1.0.
  static constexpr double kAttackExponent = 1.791759469228055;

  double sampleRate_ = 48000.0;
  double attackSeconds_ = 0.002;
  double decaySeconds_ = 0.3;
  double releaseSeconds_ = 0.1;
  double sustain_ = 0.0;
  double attackCoeff_ = 1.0;
  double decayCoeff_ = 1.0;
  double releaseCoeff_ = 1.0;
  double value_ = 0.0;
  Stage stage_ = Stage::Idle;
};

/// Explicit VCA block. Kept separate from the final multiply so that a
/// measured level-dependent nonlinearity can be added later without touching
/// the voice. For now it is deliberately linear: the document warns against
/// exaggerating VCA distortion, and nothing has been measured to justify any.
class Vca {
 public:
  void setSampleRate(double sr) noexcept {
    sampleRate_ = sr > 0.0 ? sr : 48000.0;
    // ~1 ms of smoothing removes clicks from abrupt gain changes without
    // audibly softening the envelope.
    smoothing_ = 1.0 - std::exp(-1.0 / (0.001 * sampleRate_));
  }

  void reset() noexcept { smoothedGain_ = 0.0; }

  double process(double input, double gain) noexcept {
    smoothedGain_ += smoothing_ * (gain - smoothedGain_);
    return input * smoothedGain_;
  }

 private:
  double sampleRate_ = 48000.0;
  double smoothing_ = 1.0;
  double smoothedGain_ = 0.0;
};

/// One-pole smoother for control values that would otherwise step.
class ParameterSmoother {
 public:
  void configure(double sampleRate, double timeSeconds) noexcept {
    const double sr = sampleRate > 0.0 ? sampleRate : 48000.0;
    coeff_ = timeSeconds <= 0.0 ? 1.0 : 1.0 - std::exp(-1.0 / (timeSeconds * sr));
  }

  void snapTo(double v) noexcept { value_ = v; }
  double value() const noexcept { return value_; }

  double next(double target) noexcept {
    value_ += coeff_ * (target - value_);
    return value_;
  }

 private:
  double coeff_ = 1.0;
  double value_ = 0.0;
};

}  // namespace af
