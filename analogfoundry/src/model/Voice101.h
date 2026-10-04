// The 101-style monophonic voice: the signal path from ANALOG_SYNTH_AGENT.md
// "First Product", wired up.
//
//   MIDI -> pitch/glide -> VCO (saw | pulse | sub | noise) -> mixer
//        -> 4-pole resonant low-pass -> VCA -> out
//
// Modulation: envelope -> filter and VCA; LFO -> pitch, pulse width, filter;
// keyboard -> pitch and filter tracking.
//
// This header has no plugin, GUI or host dependency of any kind, which is the
// requirement that keeps the same engine usable from the offline renderer,
// the test harness and a future VST3 wrapper.

#pragma once

#include <cmath>
#include <cstdint>

#include "../dsp/Envelope.h"
#include "../dsp/Filter101.h"
#include "../dsp/Oscillator.h"
#include "Calibration.h"

namespace af {

/// Everything a caller can set. Plain data so a host, a test or a JSON tool
/// can fill it in without knowing anything about the DSP.
struct Voice101Parameters {
  // Mixer levels, 0..1.
  double sawLevel = 1.0;
  double pulseLevel = 0.0;
  double subLevel = 0.0;
  double noiseLevel = 0.0;

  // Oscillator.
  double pulseWidth = 0.5;
  double tuneSemitones = 0.0;
  int octave = 0;  ///< -2..+2, the range switch

  // Filter.
  double cutoffHz = 2000.0;
  double resonance = 0.0;
  double envToCutoff = 0.0;    ///< 0..1, how far the envelope opens the filter
  double lfoToCutoff = 0.0;    ///< 0..1
  double keyboardTracking = 0.0;  ///< 0..1, 1 = full note tracking

  // Envelope, seconds (sustain 0..1).
  double attack = 0.002;
  double decay = 0.3;
  double sustain = 0.0;
  double release = 0.1;

  // LFO.
  double lfoRateHz = 5.0;
  double lfoToPitch = 0.0;     ///< semitones of deviation
  double lfoToPulseWidth = 0.0;  ///< 0..1

  // Note handling.
  double glideSeconds = 0.0;
  bool legatoGlideOnly = false;  ///< glide only when a note overlaps the last

  // Optional filter nonlinearity sites. Off by default; see Filter101.h.
  double filterStageDrive = 0.0;
  double filterInputDrive = 0.0;

  double outputLevel = 0.8;
};

class Voice101 {
 public:
  void setSampleRate(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    oscillator_.setSampleRate(sampleRate_);
    filter_.setSampleRate(sampleRate_);
    amplitudeEnvelope_.setSampleRate(sampleRate_);
    filterEnvelope_.setSampleRate(sampleRate_);
    vca_.setSampleRate(sampleRate_);
    cutoffSmoother_.configure(sampleRate_, 0.005);
    variationEngine_.configure(variation_, sampleRate_);
    filter_.setStageSpread(variationEngine_.stageSpread());
    reset();
  }

  /// CPU/quality trade. Changes the filter's oversampling factor.
  void setQuality(Quality q) noexcept { filter_.setQuality(q); }

  /// Component tolerance, drift and circuit noise. Off unless asked for.
  void setVariation(const AnalogVariation& v) noexcept {
    variation_ = v;
    variationEngine_.configure(v, sampleRate_);
    filter_.setStageSpread(variationEngine_.stageSpread());
  }
  const AnalogVariation& variation() const noexcept { return variation_; }

  void setParameters(const Voice101Parameters& p) noexcept {
    params_ = p;
    oscillator_.setPulseWidth(p.pulseWidth);
    filter_.setResonance(p.resonance);
    filter_.setStageNonlinearity(p.filterStageDrive);
    filter_.setInputNonlinearity(p.filterInputDrive);
    amplitudeEnvelope_.setAttack(p.attack);
    amplitudeEnvelope_.setDecay(p.decay);
    amplitudeEnvelope_.setSustain(p.sustain);
    amplitudeEnvelope_.setRelease(p.release);
    // The filter envelope follows the amplitude envelope's shape. The 101
    // shares one envelope between filter and VCA; keeping two objects lets a
    // later model split them without changing this interface.
    filterEnvelope_.setAttack(p.attack);
    filterEnvelope_.setDecay(p.decay);
    filterEnvelope_.setSustain(p.sustain);
    filterEnvelope_.setRelease(p.release);
  }

  const Voice101Parameters& parameters() const noexcept { return params_; }

  void reset() noexcept {
    oscillator_.reset();
    filter_.reset();
    amplitudeEnvelope_.reset();
    filterEnvelope_.reset();
    vca_.reset();
    noise_.reset();
    lfoPhase_ = 0.0;
    currentNote_ = -1;
    gliding_ = false;
    held_ = false;
    currentFrequency_ = 0.0;
    targetFrequency_ = 0.0;
    cutoffSmoother_.snapTo(params_.cutoffHz);
  }

  /// Monophonic note-on with last-note priority.
  void noteOn(int midiNote, double /*velocity*/ = 1.0) noexcept {
    const double target = noteToHz(midiNote);
    const bool overlapping = held_;
    targetFrequency_ = target;
    if (currentFrequency_ <= 0.0) {
      currentFrequency_ = target;  // first note of a phrase never glides
    }
    const bool shouldGlide =
        params_.glideSeconds > 0.0 && (!params_.legatoGlideOnly || overlapping);
    gliding_ = shouldGlide;
    if (!shouldGlide) currentFrequency_ = target;

    // Legato: an overlapping note does not retrigger the envelopes, which is
    // what makes a glide sound like one gesture rather than two notes.
    if (!overlapping) {
      amplitudeEnvelope_.noteOn();
      filterEnvelope_.noteOn();
    }
    currentNote_ = midiNote;
    held_ = true;
  }

  void noteOff(int midiNote) noexcept {
    if (midiNote != currentNote_) return;  // a released older note is ignored
    held_ = false;
    amplitudeEnvelope_.noteOff();
    filterEnvelope_.noteOff();
  }

  bool isActive() const noexcept { return amplitudeEnvelope_.isActive(); }

  /// Produce one sample. Realtime-safe.
  double process() noexcept {
    // --- LFO (unipolar phase, bipolar output)
    lfoPhase_ = wrap01(lfoPhase_ + params_.lfoRateHz / sampleRate_);
    const double lfo = std::sin(2.0 * kPi * lfoPhase_);

    // --- Pitch: glide, range switch, fine tune, LFO
    if (gliding_ && params_.glideSeconds > 0.0) {
      // Reach 99 % of the interval within glideSeconds.
      const double coeff =
          1.0 - std::exp(-4.605170185988091 / (params_.glideSeconds * sampleRate_));
      currentFrequency_ += coeff * (targetFrequency_ - currentFrequency_);
      if (std::fabs(currentFrequency_ - targetFrequency_) < 0.01) {
        currentFrequency_ = targetFrequency_;
        gliding_ = false;
      }
    }
    const double semitones = params_.tuneSemitones + params_.octave * 12.0 +
                             lfo * params_.lfoToPitch;
    // Drift multiplies the final frequency; it is exactly 1.0 when disabled,
    // which is what keeps the determinism test meaningful by default.
    oscillator_.setFrequency(currentFrequency_ * std::pow(2.0, semitones / 12.0) *
                             variationEngine_.tickPitchMultiplier());

    if (params_.lfoToPulseWidth != 0.0) {
      oscillator_.setPulseWidth(0.5 + lfo * 0.45 * params_.lfoToPulseWidth);
    }

    oscillator_.tick();

    // --- Mixer. Summed as the hardware mixer does, not averaged, but each
    // source is first scaled to a common RMS (Calibration.h) so that moving a
    // slider changes timbre without also changing loudness or filter drive.
    double mixed = oscillator_.saw() * params_.sawLevel * OscillatorCalibration::sawGain() +
                   oscillator_.pulse() * params_.pulseLevel * OscillatorCalibration::pulseGain() +
                   oscillator_.subOctaveDown() * params_.subLevel * OscillatorCalibration::subGain() +
                   noise_.next() * params_.noiseLevel * OscillatorCalibration::noiseGain();
    mixed += variationEngine_.tickNoise();

    // --- Filter cutoff: base, envelope, LFO, keyboard tracking
    const double envelope = filterEnvelope_.tick();
    double cutoff = params_.cutoffHz;
    if (params_.keyboardTracking > 0.0 && currentFrequency_ > 0.0) {
      // Full tracking moves the cutoff with the note, relative to A2 (110 Hz).
      const double ratio = currentFrequency_ / 110.0;
      cutoff *= std::pow(ratio, params_.keyboardTracking);
    }
    // Envelope and LFO act in octaves, which is how the control voltage behaves.
    const double octaves = envelope * params_.envToCutoff * kEnvCutoffOctaves +
                           lfo * params_.lfoToCutoff * kLfoCutoffOctaves;
    cutoff *= std::pow(2.0, octaves);
    filter_.setCutoff(cutoffSmoother_.next(cutoff));

    const double filtered = filter_.process(mixed);

    // --- VCA
    const double amplitude = amplitudeEnvelope_.tick();
    return vca_.process(filtered, amplitude) * params_.outputLevel;
  }

  static double noteToHz(int midiNote) noexcept {
    return 440.0 * std::pow(2.0, (midiNote - 69) / 12.0);
  }

  /// How far a full envelope opens the filter, in octaves.
  static constexpr double kEnvCutoffOctaves = 6.0;
  static constexpr double kLfoCutoffOctaves = 2.0;

 private:
  double sampleRate_ = 48000.0;
  Voice101Parameters params_{};
  Oscillator oscillator_{};
  NoiseGenerator noise_{};
  Filter101 filter_{};
  Envelope amplitudeEnvelope_{};
  Envelope filterEnvelope_{};
  Vca vca_{};
  ParameterSmoother cutoffSmoother_{};
  AnalogVariation variation_{};
  VariationEngine variationEngine_{};
  double lfoPhase_ = 0.0;
  double currentFrequency_ = 0.0;
  double targetFrequency_ = 0.0;
  int currentNote_ = -1;
  bool gliding_ = false;
  bool held_ = false;
};

}  // namespace af
