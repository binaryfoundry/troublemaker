// Half-band decimation for the oversampled nonlinear block.
//
// This exists because a test caught the previous approach being worse than
// useless. Decimation was a pair of one-pole averagers - about 12 dB/octave -
// and at 4x oversampling the nonlinearity generates harmonics up to 96 kHz
// that such a filter cannot remove before they fold. The measured result was
// that 4x oversampling aliased *more* than 1x: the opposite of the point.
//
// A half-band FIR is the right tool for decimating by two. Its cutoff sits at
// exactly a quarter of the input rate, which is the fold point, and almost
// half its taps are zero by construction so the cost is about half the tap
// count suggests. Factors above two cascade stages rather than widening one
// filter, because a single FIR covering a 4x transition would need several
// hundred taps for the same stopband.

#pragma once

#include <cmath>

namespace af {

/// Decimate by two with a windowed-sinc half-band FIR.
class HalfBandDecimator {
 public:
  HalfBandDecimator() noexcept { design(); }

  void reset() noexcept {
    for (double& v : history_) v = 0.0;
    writeIndex_ = 0;
  }

  /// Two input samples in, one output sample out.
  double process(double first, double second) noexcept {
    push(first);
    push(second);
    // Convolve. Zero taps are skipped: in a half-band filter every even tap
    // either side of centre is zero.
    double acc = 0.0;
    for (int i = 0; i < kTaps; ++i) {
      const double c = coefficients_[i];
      if (c == 0.0) continue;
      const int index = (writeIndex_ - 1 - i + kTaps * 2) % kTaps;
      acc += c * history_[index];
    }
    return acc;
  }

  static constexpr int kTaps = 127;

  /// Tap `i`, so the interpolator can share this design.
  double coefficient(int i) const noexcept { return coefficients_[i]; }

 private:
  void push(double x) noexcept {
    history_[writeIndex_] = x;
    writeIndex_ = (writeIndex_ + 1) % kTaps;
  }

  static double sinc(double x) noexcept {
    if (std::fabs(x) < 1.0e-12) return 1.0;
    const double px = kPiLocal * x;
    return std::sin(px) / px;
  }

  /// Modified Bessel function of the first kind, order 0. Series form; it is
  /// evaluated once at construction, never on the audio thread.
  static double besselI0(double x) noexcept {
    double sum = 1.0;
    double term = 1.0;
    for (int k = 1; k < 40; ++k) {
      term *= (x * 0.5) / static_cast<double>(k);
      sum += term * term;
    }
    return sum;
  }

  void design() noexcept {
    // Kaiser, not Blackman-Harris. A test caught the reason: Blackman-Harris
    // over 63 taps has such a wide main lobe that the transition band reached
    // down into the audio range, and the passband roll-off compounded across
    // the two cascaded stages used at 4x. A 12 kHz corner measured -21.9 dB
    // instead of -12. Kaiser lets the stopband and the transition width be
    // traded deliberately: beta 9 gives roughly -90 dB with a transition
    // narrow enough to keep the passband flat to about 0.45 of the output
    // Nyquist.
    const int centre = kTaps / 2;
    const double beta = 9.0;
    const double denom = besselI0(beta);
    double sum = 0.0;
    for (int n = 0; n < kTaps; ++n) {
      const double offset = static_cast<double>(n - centre);
      // Ideal half-band: cutoff at a quarter of the input rate.
      double h = 0.5 * sinc(0.5 * offset);
      const double r = 2.0 * static_cast<double>(n) / static_cast<double>(kTaps - 1) - 1.0;
      const double inside = 1.0 - r * r;
      h *= besselI0(beta * std::sqrt(inside < 0.0 ? 0.0 : inside)) / denom;
      // Force the exact zeros a half-band filter has by construction; the
      // window leaves tiny non-zero values there otherwise.
      if (offset != 0.0 && std::fabs(std::fmod(offset, 2.0)) < 1.0e-9) h = 0.0;
      coefficients_[n] = h;
      sum += h;
    }
    // Unity DC gain.
    for (double& c : coefficients_) c /= sum;
  }

  static constexpr double kPiLocal = 3.14159265358979323846;

  double coefficients_[kTaps] = {};
  double history_[kTaps] = {};
  int writeIndex_ = 0;
};

/// Interpolate by two with the same half-band design.
///
/// The partner to HalfBandDecimator, and not an optional refinement. Holding
/// the input constant across the oversampled steps (zero-order hold) seems
/// harmless but is a crude upsampler: a test measured a 12 kHz corner landing
/// at -21.9 dB instead of -12 at 4x, because the staircase is a poor stand-in
/// for the real signal once the frequency approaches the base Nyquist.
/// Zero-stuffing and filtering properly is what makes oversampling
/// transparent rather than merely expensive.
class HalfBandInterpolator {
 public:
  void reset() noexcept {
    for (double& v : history_) v = 0.0;
    writeIndex_ = 0;
  }

  /// One input sample in, two output samples out.
  void process(double input, double& first, double& second) noexcept {
    // Zero-stuff: the input sample, then a zero. Gain of 2 compensates for
    // the energy the stuffing removes.
    push(input);
    first = 2.0 * convolve();
    push(0.0);
    second = 2.0 * convolve();
  }

 private:
  static constexpr int kTaps = HalfBandDecimator::kTaps;

  void push(double x) noexcept {
    history_[writeIndex_] = x;
    writeIndex_ = (writeIndex_ + 1) % kTaps;
  }

  double convolve() noexcept {
    double acc = 0.0;
    for (int i = 0; i < kTaps; ++i) {
      const double c = prototype_.coefficient(i);
      if (c == 0.0) continue;
      const int index = (writeIndex_ - 1 - i + kTaps * 2) % kTaps;
      acc += c * history_[index];
    }
    return acc;
  }

  HalfBandDecimator prototype_{};  ///< reused purely for its coefficients
  double history_[kTaps] = {};
  int writeIndex_ = 0;
};

}  // namespace af
