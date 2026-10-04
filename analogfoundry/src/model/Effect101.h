// Milestone 10: the filter/VCA model as an audio effect.
//
// The same Filter101 and Vca that the voice uses, driven by external audio
// instead of the internal oscillators - so a sampler, a wavetable synth or a
// drum bus can be put through the 101 filter without the 101 oscillators.
//
// Nothing is duplicated: if the filter model improves, this improves with it.
// That reuse is the whole point of the milestone, and it is why the DSP blocks
// were kept free of any voice-specific state.
//
// Movement comes from an envelope follower (the filter opens with the input)
// and/or an LFO, because an effect has no note events to run an ADSR from.

#pragma once

#include <cmath>

#include "../dsp/Envelope.h"
#include "../dsp/Filter101.h"
#include "Calibration.h"

namespace af {

struct Effect101Parameters {
  double cutoffHz = 1200.0;
  double resonance = 0.0;

  /// Envelope follower -> cutoff, in octaves at full follower output.
  double followerToCutoff = 0.0;
  /// Follower attack/release in seconds.
  double followerAttack = 0.005;
  double followerRelease = 0.12;

  /// LFO -> cutoff, in octaves.
  double lfoToCutoff = 0.0;
  double lfoRateHz = 1.0;

  /// Optional filter nonlinearity sites, as on the voice.
  double stageDrive = 0.0;
  double inputDrive = 0.0;

  /// Dry/wet so the effect can be blended, 0..1.
  double mix = 1.0;
  double outputLevel = 1.0;
};

class Effect101 {
 public:
  void setSampleRate(double sr) noexcept {
    sampleRate_ = sr > 0.0 ? sr : 48000.0;
    filter_.setSampleRate(sampleRate_);
    cutoffSmoother_.configure(sampleRate_, 0.005);
    updateFollowerCoefficients();
    reset();
  }

  void setQuality(Quality q) noexcept { filter_.setQuality(q); }

  void setParameters(const Effect101Parameters& p) noexcept {
    params_ = p;
    filter_.setResonance(p.resonance);
    filter_.setStageNonlinearity(p.stageDrive);
    filter_.setInputNonlinearity(p.inputDrive);
    updateFollowerCoefficients();
  }

  void reset() noexcept {
    filter_.reset();
    follower_ = 0.0;
    lfoPhase_ = 0.0;
    cutoffSmoother_.snapTo(params_.cutoffHz);
  }

  double process(double input) noexcept {
    // Envelope follower: fast up, slower down, as a diode detector behaves.
    const double rectified = std::fabs(input);
    const double coeff = rectified > follower_ ? attackCoeff_ : releaseCoeff_;
    follower_ += coeff * (rectified - follower_);

    lfoPhase_ += params_.lfoRateHz / sampleRate_;
    if (lfoPhase_ >= 1.0) lfoPhase_ -= 1.0;
    const double lfo = std::sin(2.0 * kPiLocal * lfoPhase_);

    const double octaves = follower_ * params_.followerToCutoff + lfo * params_.lfoToCutoff;
    const double cutoff = params_.cutoffHz * std::pow(2.0, octaves);
    filter_.setCutoff(cutoffSmoother_.next(cutoff));

    const double wet = filter_.process(input);
    const double mix = params_.mix < 0.0 ? 0.0 : (params_.mix > 1.0 ? 1.0 : params_.mix);
    return (input * (1.0 - mix) + wet * mix) * params_.outputLevel;
  }

  /// Current follower value, for tests and metering.
  double followerLevel() const noexcept { return follower_; }

 private:
  void updateFollowerCoefficients() noexcept {
    auto coeff = [this](double seconds) {
      if (seconds <= 0.0) return 1.0;
      const double samples = seconds * sampleRate_;
      return samples < 1.0 ? 1.0 : 1.0 - std::exp(-4.605170185988091 / samples);
    };
    attackCoeff_ = coeff(params_.followerAttack);
    releaseCoeff_ = coeff(params_.followerRelease);
  }

  static constexpr double kPiLocal = 3.14159265358979323846;

  double sampleRate_ = 48000.0;
  Effect101Parameters params_{};
  Filter101 filter_{};
  ParameterSmoother cutoffSmoother_{};
  double follower_ = 0.0;
  double attackCoeff_ = 1.0;
  double releaseCoeff_ = 1.0;
  double lfoPhase_ = 0.0;
};

}  // namespace af
