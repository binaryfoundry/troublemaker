// A spectral tilt: a constant slope in dB per octave across the audio band, for
// an oscillator whose harmonics fall faster (or slower) than the ideal wave's.
// Serum's analog tables are this: its "AT Juno 106" saw is a saw tilted about
// -2 dB per octave (0.8 dB from it after the tilt, 5.3 dB before).
//
// A cascade of first-order shelves, one every half octave from 30 Hz to 18 kHz
// (capped below Nyquist). Each shelf falls 6 dB per octave between its pole and
// its zero, which sit a fraction of the half octave apart, so the cascade
// averages slope dB per octave with a small ripple. The gain is normalised at
// the note's fundamental: the note keeps its level and only its harmonics tilt.

#pragma once

#include <cmath>

namespace af {

class Tilt {
 public:
  static constexpr int kMaxSections = 22;
  static constexpr double kMaxSlope = 6.0;  ///< dB per octave, either way

  /// slope in dB per octave: negative darkens, 0 is a bypass.
  void configure(double slopeDbPerOctave, double sampleRate) noexcept {
    sampleRate_ = sampleRate;
    slope_ = slopeDbPerOctave < -kMaxSlope ? -kMaxSlope : (slopeDbPerOctave > kMaxSlope ? kMaxSlope : slopeDbPerOctave);
    sections_ = 0;
    if (slope_ == 0.0) return;
    // A shelf falls 6.02 dB per octave between its corners: alpha of each half
    // octave spent falling gives slope = -6.02 * alpha dB per octave.
    const double alpha = std::fabs(slope_) / 6.0206;
    const double top = std::fmin(18000.0, 0.45 * sampleRate);
    for (double f = 30.0; f < top && sections_ < kMaxSections; f *= std::sqrt(2.0)) {
      const double lo = f, hi = f * std::pow(2.0, 0.5 * alpha);
      // Darkening: the pole below the zero. Brightening: the zero below the pole.
      const double pole = slope_ < 0.0 ? lo : hi, zero = slope_ < 0.0 ? hi : lo;
      const double wp = std::tan(kPi * std::fmin(pole, 0.49 * sampleRate) / sampleRate);
      const double wz = std::tan(kPi * std::fmin(zero, 0.49 * sampleRate) / sampleRate);
      // (s/wz + 1) / (s/wp + 1) by the bilinear transform: unity at DC.
      const double a0 = 1.0 + 1.0 / wp;
      Section& s = section_[sections_++];
      s.b0 = (1.0 + 1.0 / wz) / a0;
      s.b1 = (1.0 - 1.0 / wz) / a0;
      s.a1 = (1.0 - 1.0 / wp) / a0;
    }
    fundamental_ = -1.0;
  }

  bool active() const noexcept { return sections_ > 0; }

  void reset() noexcept {
    for (auto& s : section_) s.z = 0.0;
  }

  /// Keep the fundamental at unity. Cheap when the pitch has not moved.
  void setFundamental(double hz) noexcept {
    if (!active() || hz <= 0.0) return;
    if (fundamental_ > 0.0 && std::fabs(hz / fundamental_ - 1.0) < 0.002) return;
    fundamental_ = hz;
    const double w = 2.0 * kPi * std::fmin(hz, 0.49 * sampleRate_) / sampleRate_;
    const double c = std::cos(w), sn = std::sin(w);
    double magnitude = 1.0;
    for (int i = 0; i < sections_; ++i) {
      const Section& s = section_[i];
      // |b0 + b1 e^-jw| / |1 + a1 e^-jw|
      const double nr = s.b0 + s.b1 * c, ni = -s.b1 * sn;
      const double dr = 1.0 + s.a1 * c, di = -s.a1 * sn;
      magnitude *= std::sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    gain_ = magnitude > 1e-9 ? 1.0 / magnitude : 1.0;
  }

  double process(double x) noexcept {
    for (int i = 0; i < sections_; ++i) {
      Section& s = section_[i];
      // Transposed direct form II, first order.
      const double y = s.b0 * x + s.z;
      s.z = s.b1 * x - s.a1 * y;
      x = y;
    }
    return x * gain_;
  }

 private:
  static constexpr double kPi = 3.14159265358979323846;
  struct Section {
    double b0 = 1.0, b1 = 0.0, a1 = 0.0, z = 0.0;
  };
  Section section_[kMaxSections]{};
  int sections_ = 0;
  double slope_ = 0.0, sampleRate_ = 48000.0, fundamental_ = -1.0, gain_ = 1.0;
};

}  // namespace af
