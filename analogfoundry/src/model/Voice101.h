// The 101-style monophonic voice: the signal path from ANALOG_SYNTH_AGENT.md
// "First Product", wired up.
//
//   MIDI -> pitch/glide -> VCO (saw | pulse | sub | noise) -> mixer
//        -> 4-pole resonant low-pass -> VCA -> out
//
// Modulation: envelope -> filter and VCA; LFO -> pitch, pulse width, filter;
// keyboard -> pitch and filter tracking.
//
// Optional unison (not on the 101, off by default): up to 7 detuned copies of
// the saw and pulse feed the same filter. The sub stays on the centre VCO.
//
// Optional expression (not on the 101, all off by default): velocity to the
// VCA and the cutoff, a filter envelope with its own ADSR, a vibrato that
// fades in after each note starts, slow pitch drift, and glide on overlapping
// notes only. Each is the untouched 101 path when off.
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

  // Unison: an extension beyond the 101, which has one VCO. Detuned copies of
  // the saw and pulse are summed into the same filter, as a supersaw feeds a
  // ladder. Off by default (1 voice, 0 cents), and off is the untouched
  // single-oscillator path. Stored as doubles because the parameter table
  // addresses doubles; the voice count is rounded.
  double unisonVoices = 1.0;       ///< 1..7
  double unisonDetuneCents = 0.0;  ///< outermost voices sit at +/- this

  // Expression: extensions beyond the 101, all off by default. Switches are
  // doubles (>= 0.5 is on) because the parameter table addresses doubles.
  double velocityToAmp = 0.0;      ///< 0..1: at 1, velocity 0 is silent
  double velocityToCutoff = 0.0;   ///< 0..1: at 1, velocity 0 sits kVelocityCutoffOctaves lower
  double filterEnvSeparate = 0.0;  ///< on: the filter envelope uses the filter* times below
  double filterAttack = 0.002;
  double filterDecay = 0.3;
  double filterSustain = 0.0;
  double filterRelease = 0.1;
  double vibratoFadeIn = 0.0;  ///< seconds for LFO-to-pitch to reach full depth after a note starts
  double driftCents = 0.0;     ///< slow pitch wander, peak cents
  double legatoGlide = 0.0;    ///< on: glide only between overlapping notes
};

class Voice101 {
 public:
  void setSampleRate(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    oscillator_.setSampleRate(sampleRate_);
    for (auto& o : unison_) o.setSampleRate(sampleRate_);
    filter_.setSampleRate(sampleRate_);
    amplitudeEnvelope_.setSampleRate(sampleRate_);
    filterEnvelope_.setSampleRate(sampleRate_);
    vca_.setSampleRate(sampleRate_);
    cutoffSmoother_.configure(sampleRate_, 0.005);
    velocitySmoother_.configure(sampleRate_, 0.003);
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
    for (auto& o : unison_) o.setPulseWidth(p.pulseWidth);
    configureUnison();
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
    // A separate filter envelope (not on the 101) lets the tone close while
    // the note sustains - the CamelPhat lead: amp sustain high, filter sustain 0.
    const bool own = p.filterEnvSeparate >= 0.5;
    filterEnvelope_.setAttack(own ? p.filterAttack : p.attack);
    filterEnvelope_.setDecay(own ? p.filterDecay : p.decay);
    filterEnvelope_.setSustain(own ? p.filterSustain : p.sustain);
    filterEnvelope_.setRelease(own ? p.filterRelease : p.release);
  }

  const Voice101Parameters& parameters() const noexcept { return params_; }

  void reset() noexcept {
    oscillator_.reset();
    // Fixed, spread starting phases: detuned voices that all began at phase 0
    // would sum coherently - up to sqrt(N) louder - until they drifted apart.
    // Golden-ratio steps keep them apart from the first sample, deterministically.
    for (int i = 0; i < kMaxUnisonExtra; ++i) unison_[i].reset(wrap01(0.6180339887498949 * (i + 1)));
    filter_.reset();
    amplitudeEnvelope_.reset();
    filterEnvelope_.reset();
    vca_.reset();
    noise_.reset();
    lfoPhase_ = 0.0;
    driftPhaseA_ = 0.0;
    driftPhaseB_ = 0.37;
    velocity_ = 1.0;
    velocitySmoother_.snapTo(1.0);
    vibratoTime_ = 0.0;
    currentNote_ = -1;
    gliding_ = false;
    held_ = false;
    currentFrequency_ = 0.0;
    targetFrequency_ = 0.0;
    cutoffSmoother_.snapTo(params_.cutoffHz);
  }

  /// Monophonic note-on with last-note priority.
  void noteOn(int midiNote, double velocity = 1.0) noexcept {
    const double target = noteToHz(midiNote);
    const bool overlapping = held_;
    velocity_ = velocity < 0.0 ? 0.0 : (velocity > 1.0 ? 1.0 : velocity);
    targetFrequency_ = target;
    if (currentFrequency_ <= 0.0) {
      currentFrequency_ = target;  // first note of a phrase never glides
    }
    const bool legatoOnly = params_.legatoGlideOnly || params_.legatoGlide >= 0.5;
    const bool shouldGlide = params_.glideSeconds > 0.0 && (!legatoOnly || overlapping);
    gliding_ = shouldGlide;
    if (!shouldGlide) currentFrequency_ = target;

    // Legato: an overlapping note does not retrigger the envelopes, which is
    // what makes a glide sound like one gesture rather than two notes.
    // The vibrato fade-in restarts with the envelopes, so a slur keeps singing.
    if (!overlapping) {
      amplitudeEnvelope_.noteOn();
      filterEnvelope_.noteOn();
      vibratoTime_ = 0.0;
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
    double vibrato = lfo * params_.lfoToPitch;
    if (params_.vibratoFadeIn > 0.0) {
      // Squared ramp: nothing at first, then the vibrato blooms, as a singer's does.
      const double t = vibratoTime_ / params_.vibratoFadeIn;
      vibrato *= t >= 1.0 ? 1.0 : t * t;
      vibratoTime_ += 1.0 / sampleRate_;
    }
    double semitones = params_.tuneSemitones + params_.octave * 12.0 + vibrato;
    if (params_.driftCents > 0.0) {
      // Two slow sines at an irrational-ish ratio: a wander that does not repeat.
      driftPhaseA_ = wrap01(driftPhaseA_ + 0.31 / sampleRate_);
      driftPhaseB_ = wrap01(driftPhaseB_ + 0.19 / sampleRate_);
      semitones += params_.driftCents / 100.0 * 0.5 *
                   (std::sin(2.0 * kPi * driftPhaseA_) + std::sin(2.0 * kPi * driftPhaseB_));
    }
    // Drift multiplies the final frequency; it is exactly 1.0 when disabled,
    // which is what keeps the determinism test meaningful by default.
    const double frequency = currentFrequency_ * std::pow(2.0, semitones / 12.0) *
                             variationEngine_.tickPitchMultiplier();
    oscillator_.setFrequency(frequency);

    if (params_.lfoToPulseWidth != 0.0) {
      const double pw = 0.5 + lfo * 0.45 * params_.lfoToPulseWidth;
      oscillator_.setPulseWidth(pw);
      for (int i = 0; i < unisonExtra_; ++i) unison_[i].setPulseWidth(pw);
    }

    oscillator_.tick();
    for (int i = 0; i < unisonExtra_; ++i) {
      unison_[i].setFrequency(frequency * unisonRatio_[i]);
      unison_[i].tick();
    }

    // --- Mixer. Summed as the hardware mixer does, not averaged, but each
    // source is first scaled to a common RMS (Calibration.h) so that moving a
    // slider changes timbre without also changing loudness or filter drive.
    double mixed;
    if (unisonExtra_ == 0) {
      mixed = oscillator_.saw() * params_.sawLevel * OscillatorCalibration::sawGain() +
              oscillator_.pulse() * params_.pulseLevel * OscillatorCalibration::pulseGain() +
              oscillator_.subOctaveDown() * params_.subLevel * OscillatorCalibration::subGain() +
              noise_.next() * params_.noiseLevel * OscillatorCalibration::noiseGain();
    } else {
      // Detuned voices are uncorrelated, so their sum grows as sqrt(N): scale
      // by 1/sqrt(N) and the stack sits at a single saw's level, keeping the
      // mixer's calibration. The sub stays on the centre oscillator, in tune.
      double saw = unisonUsesCentre_ ? oscillator_.saw() : 0.0;
      double pulse = unisonUsesCentre_ ? oscillator_.pulse() : 0.0;
      for (int i = 0; i < unisonExtra_; ++i) {
        saw += unison_[i].saw();
        pulse += unison_[i].pulse();
      }
      mixed = saw * unisonGain_ * params_.sawLevel * OscillatorCalibration::sawGain() +
              pulse * unisonGain_ * params_.pulseLevel * OscillatorCalibration::pulseGain() +
              oscillator_.subOctaveDown() * params_.subLevel * OscillatorCalibration::subGain() +
              noise_.next() * params_.noiseLevel * OscillatorCalibration::noiseGain();
    }
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
    double octaves = envelope * params_.envToCutoff * kEnvCutoffOctaves +
                     lfo * params_.lfoToCutoff * kLfoCutoffOctaves;
    // Full velocity leaves the cutoff where the patch puts it; softer is darker.
    if (params_.velocityToCutoff > 0.0)
      octaves += params_.velocityToCutoff * (velocity_ - 1.0) * kVelocityCutoffOctaves;
    cutoff *= std::pow(2.0, octaves);
    filter_.setCutoff(cutoffSmoother_.next(cutoff));

    const double filtered = filter_.process(mixed);

    // --- VCA
    double amplitude = amplitudeEnvelope_.tick();
    if (params_.velocityToAmp > 0.0)
      amplitude *= velocitySmoother_.next(1.0 - params_.velocityToAmp * (1.0 - velocity_));
    return vca_.process(filtered, amplitude) * params_.outputLevel;
  }

  static double noteToHz(int midiNote) noexcept {
    return 440.0 * std::pow(2.0, (midiNote - 69) / 12.0);
  }

  /// How far a full envelope opens the filter, in octaves.
  static constexpr double kEnvCutoffOctaves = 6.0;
  static constexpr double kLfoCutoffOctaves = 2.0;
  /// How far velocity 0 lowers the cutoff at full velocity-to-cutoff, in octaves.
  static constexpr double kVelocityCutoffOctaves = 4.0;

  static constexpr int kMaxUnison = 7;
  /// Voices beyond the centre oscillator. An even count has no centre voice
  /// in the stack, so up to 6 extra oscillators cover every count up to 7.
  static constexpr int kMaxUnisonExtra = 6;

  /// How many oscillators the saw/pulse stack is using now (1 = unison off).
  int unisonVoiceCount() const noexcept { return unisonExtra_ + (unisonUsesCentre_ ? 1 : 0); }

 private:
  /// Voice positions spread evenly across [-detune, +detune]. An odd count
  /// keeps the centre oscillator in the stack; an even count is symmetric
  /// without it. Zero detune means identical copies, which add only level,
  /// so it falls back to the single-oscillator path.
  void configureUnison() noexcept {
    long n = std::lround(params_.unisonVoices);
    n = n < 1 ? 1 : (n > kMaxUnison ? kMaxUnison : n);
    if (!(params_.unisonDetuneCents > 0.01)) n = 1;
    if (n == 1) {
      unisonExtra_ = 0;
      unisonUsesCentre_ = true;
      unisonGain_ = 1.0;
      return;
    }
    unisonUsesCentre_ = (n % 2) == 1;
    const long centre = (n - 1) / 2;
    int k = 0;
    for (long j = 0; j < n; ++j) {
      if (unisonUsesCentre_ && j == centre) continue;
      const double position = -1.0 + 2.0 * static_cast<double>(j) / static_cast<double>(n - 1);
      unisonRatio_[k++] = std::pow(2.0, position * params_.unisonDetuneCents / 1200.0);
    }
    unisonExtra_ = k;
    unisonGain_ = 1.0 / std::sqrt(static_cast<double>(n));
  }

  double sampleRate_ = 48000.0;
  Voice101Parameters params_{};
  Oscillator oscillator_{};
  Oscillator unison_[kMaxUnisonExtra]{};
  double unisonRatio_[kMaxUnisonExtra]{};
  int unisonExtra_ = 0;
  bool unisonUsesCentre_ = true;
  double unisonGain_ = 1.0;
  NoiseGenerator noise_{};
  Filter101 filter_{};
  Envelope amplitudeEnvelope_{};
  Envelope filterEnvelope_{};
  Vca vca_{};
  ParameterSmoother cutoffSmoother_{};
  ParameterSmoother velocitySmoother_{};
  AnalogVariation variation_{};
  VariationEngine variationEngine_{};
  double lfoPhase_ = 0.0;
  double driftPhaseA_ = 0.0;
  double driftPhaseB_ = 0.37;
  double velocity_ = 1.0;
  double vibratoTime_ = 0.0;
  double currentFrequency_ = 0.0;
  double targetFrequency_ = 0.0;
  int currentNote_ = -1;
  bool gliding_ = false;
  bool held_ = false;
};

}  // namespace af
