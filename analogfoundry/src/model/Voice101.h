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
// Optional oscillators and modulation (0.4, not on the 101, off by default): two
// more oscillators (saw, pulse, triangle or sine, each with octave, semitone and
// fine tune) sharing the unison stack; a second LFO; LFO waveforms and retrigger;
// pitch bend, mod wheel and aftertouch; an 8-slot modulation matrix. Built so a
// Serum or Diva patch has somewhere to land (CAMELPHAT.md 6b).
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

  // Oscillators 2 and 3 (0.4). Level 0 is off, and off is the 0.3 path.
  // Waves: 0 saw, 1 pulse, 2 triangle, 3 sine.
  double osc2Level = 0.0, osc2Wave = 0.0, osc2Octave = 0.0, osc2Semi = 0.0, osc2Fine = 0.0;
  double osc3Level = 0.0, osc3Wave = 0.0, osc3Octave = 0.0, osc3Semi = 0.0, osc3Fine = 0.0;

  // LFOs (0.4). Waves: 0 sine, 1 triangle, 2 saw (rising), 3 square, 4 sample and hold.
  double lfo1Wave = 0.0, lfo1Retrigger = 0.0;
  double lfo2RateHz = 2.0, lfo2Wave = 0.0, lfo2Retrigger = 0.0;

  double pitchBendRange = 2.0;  ///< semitones at full bend

  // Modulation matrix (0.4): 8 slots of source -> destination * amount (-1..1).
  // Codes are stable (saved in presets and projects); see ModSource / ModDest.
  // Named fields, not arrays: the parameter table addresses members.
  double mod1Source = 0, mod1Dest = 0, mod1Amount = 0;
  double mod2Source = 0, mod2Dest = 0, mod2Amount = 0;
  double mod3Source = 0, mod3Dest = 0, mod3Amount = 0;
  double mod4Source = 0, mod4Dest = 0, mod4Amount = 0;
  double mod5Source = 0, mod5Dest = 0, mod5Amount = 0;
  double mod6Source = 0, mod6Dest = 0, mod6Amount = 0;
  double mod7Source = 0, mod7Dest = 0, mod7Amount = 0;
  double mod8Source = 0, mod8Dest = 0, mod8Amount = 0;
};

/// The matrix slots as member pointers, in order, for code that iterates them.
struct ModSlotFields {
  double Voice101Parameters::*source;
  double Voice101Parameters::*dest;
  double Voice101Parameters::*amount;
};
inline const ModSlotFields kModSlots[8] = {
    {&Voice101Parameters::mod1Source, &Voice101Parameters::mod1Dest, &Voice101Parameters::mod1Amount},
    {&Voice101Parameters::mod2Source, &Voice101Parameters::mod2Dest, &Voice101Parameters::mod2Amount},
    {&Voice101Parameters::mod3Source, &Voice101Parameters::mod3Dest, &Voice101Parameters::mod3Amount},
    {&Voice101Parameters::mod4Source, &Voice101Parameters::mod4Dest, &Voice101Parameters::mod4Amount},
    {&Voice101Parameters::mod5Source, &Voice101Parameters::mod5Dest, &Voice101Parameters::mod5Amount},
    {&Voice101Parameters::mod6Source, &Voice101Parameters::mod6Dest, &Voice101Parameters::mod6Amount},
    {&Voice101Parameters::mod7Source, &Voice101Parameters::mod7Dest, &Voice101Parameters::mod7Amount},
    {&Voice101Parameters::mod8Source, &Voice101Parameters::mod8Dest, &Voice101Parameters::mod8Amount},
};

/// Modulation sources. Envelopes, velocity, wheel and pressure are 0..1; LFOs,
/// key and the per-note random value are -1..1.
enum ModSource {
  kSrcNone = 0, kSrcAmpEnv, kSrcFilterEnv, kSrcLfo1, kSrcLfo2, kSrcVelocity,
  kSrcKey, kSrcModWheel, kSrcAftertouch, kSrcNoteRandom, kSrcCount
};

/// Modulation destinations. Amount 1 with a source at 1 moves each by: cutoff
/// 5 octaves; pitch 24 semitones; fine 100 cents; pulse width 0.45; resonance,
/// levels 1 (added, clamped); amp x2 (multiplied, clamped 0..2); LFO rate 4 octaves.
enum ModDest {
  kDstNone = 0, kDstCutoff, kDstPitch, kDstOsc1Pitch, kDstOsc2Pitch, kDstOsc3Pitch,
  kDstPulseWidth, kDstResonance, kDstAmp, kDstOsc1Level, kDstOsc2Level, kDstOsc3Level,
  kDstNoiseLevel, kDstSubLevel, kDstLfo1Rate, kDstLfo2Rate, kDstFine, kDstCount
};

class Voice101 {
 public:
  void setSampleRate(double sampleRate) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    oscillator_.setSampleRate(sampleRate_);
    for (auto& o : unison_) o.setSampleRate(sampleRate_);
    for (auto& e : extra_) {
      e.main.setSampleRate(sampleRate_);
      for (auto& o : e.unison) o.setSampleRate(sampleRate_);
    }
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
    for (auto& e : extra_) {
      e.main.setPulseWidth(p.pulseWidth);
      for (auto& o : e.unison) o.setPulseWidth(p.pulseWidth);
    }
    configureUnison();
    configureExtras();
    configureMatrix();
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
    // Oscillators 2 and 3 start at their own spread phases, so they never sum
    // coherently with oscillator 1 or with each other.
    for (int k = 0; k < 2; ++k) {
      extra_[k].main.reset(wrap01(0.25 + 0.37 * k));
      for (int i = 0; i < kMaxUnisonExtra; ++i)
        extra_[k].unison[i].reset(wrap01(0.25 + 0.37 * k + 0.6180339887498949 * (i + 1)));
    }
    lfo2Phase_ = 0.0;
    lfo1Hold_ = 0.0;
    lfo2Hold_ = 0.0;
    lfoRateMod_[0] = lfoRateMod_[1] = 0.0;
    noteRandom_ = 0.0;
    randomState_ = 0x2545f491u;
    modWheel_ = 0.0;
    aftertouch_ = 0.0;
    pitchBend_ = 0.0;
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
    heldCount_ = 0;
    gliding_ = false;
    held_ = false;
    currentFrequency_ = 0.0;
    targetFrequency_ = 0.0;
    cutoffSmoother_.snapTo(params_.cutoffHz);
  }

  /// Monophonic note-on with last-note priority. Held notes are remembered, so
  /// releasing the newest returns to the one still held (see noteOff).
  void noteOn(int midiNote, double velocity = 1.0) noexcept {
    const double clamped = velocity < 0.0 ? 0.0 : (velocity > 1.0 ? 1.0 : velocity);
    pushHeld(midiNote, clamped);
    startNote(midiNote, clamped, held_);
  }

  /// Release a note. Releasing an older note that is no longer sounding only
  /// forgets it. Releasing the sounding note returns, legato, to the newest note
  /// still held - the key a player is still pressing - or releases the voice.
  void noteOff(int midiNote) noexcept {
    if (!removeHeld(midiNote)) return;
    if (midiNote != currentNote_) return;  // an older note: nothing sounds differently
    if (heldCount_ > 0) {
      startNote(heldNotes_[heldCount_ - 1], heldVelocities_[heldCount_ - 1], true);
      return;
    }
    held_ = false;
    amplitudeEnvelope_.noteOff();
    filterEnvelope_.noteOff();
  }

  /// MIDI CC 123: every held note released, through the release stage.
  void allNotesOff() noexcept {
    heldCount_ = 0;
    if (!held_) return;
    held_ = false;
    amplitudeEnvelope_.noteOff();
    filterEnvelope_.noteOff();
  }

  /// MIDI CC 120: silence now, without a release - what a host's panic expects.
  void allSoundOff() noexcept { reset(); }

  bool isActive() const noexcept { return amplitudeEnvelope_.isActive(); }
  int heldNoteCount() const noexcept { return heldCount_; }

  /// Performance controls. Bend -1..1 (scaled by pitchBendRange); wheel and
  /// pressure 0..1, as matrix sources.
  void setPitchBend(double bend) noexcept { pitchBend_ = bend < -1.0 ? -1.0 : (bend > 1.0 ? 1.0 : bend); }
  void setModWheel(double v) noexcept { modWheel_ = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }
  void setAftertouch(double v) noexcept { aftertouch_ = v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

 private:
  /// Sound a note: pitch, glide and, unless it is legato, the envelopes.
  void startNote(int midiNote, double velocity, bool overlapping) noexcept {
    const double target = noteToHz(midiNote);
    velocity_ = velocity;
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
      if (params_.lfo1Retrigger >= 0.5) lfoPhase_ = 0.0;
      if (params_.lfo2Retrigger >= 0.5) lfo2Phase_ = 0.0;
    }
    // A fresh random value for every note, legato or not (Serum's NoteOn Rand).
    randomState_ ^= randomState_ << 13;
    randomState_ ^= randomState_ >> 17;
    randomState_ ^= randomState_ << 5;
    noteRandom_ = static_cast<double>(static_cast<int32_t>(randomState_)) * (1.0 / 2147483648.0);
    currentNote_ = midiNote;
    held_ = true;
  }

  /// The held-note stack, newest last. A repeated note moves to the top; when
  /// it is full the oldest is forgotten. Fixed size: no allocation on the
  /// audio thread.
  void pushHeld(int midiNote, double velocity) noexcept {
    removeHeld(midiNote);
    if (heldCount_ == kMaxHeldNotes) {
      for (int i = 1; i < kMaxHeldNotes; ++i) {
        heldNotes_[i - 1] = heldNotes_[i];
        heldVelocities_[i - 1] = heldVelocities_[i];
      }
      --heldCount_;
    }
    heldNotes_[heldCount_] = midiNote;
    heldVelocities_[heldCount_] = velocity;
    ++heldCount_;
  }

  bool removeHeld(int midiNote) noexcept {
    for (int i = 0; i < heldCount_; ++i) {
      if (heldNotes_[i] != midiNote) continue;
      for (int j = i + 1; j < heldCount_; ++j) {
        heldNotes_[j - 1] = heldNotes_[j];
        heldVelocities_[j - 1] = heldVelocities_[j];
      }
      --heldCount_;
      return true;
    }
    return false;
  }

 public:

  /// Produce one sample. Realtime-safe.
  double process() noexcept {
    // --- Envelopes first: the matrix reads them. (Their state does not depend
    // on the signal, so ticking them here changes no number.)
    const double envelope = filterEnvelope_.tick();
    double amplitude = amplitudeEnvelope_.tick();

    // --- LFOs (unipolar phase, bipolar output). A rate modulation uses the
    // previous sample's matrix value: the LFO cannot wait for itself.
    double rate1 = params_.lfoRateHz;
    if (lfoRateMod_[0] != 0.0) rate1 *= std::pow(2.0, lfoRateMod_[0] * 4.0);
    const double before1 = lfoPhase_;
    lfoPhase_ = wrap01(lfoPhase_ + rate1 / sampleRate_);
    const double lfo = lfoValue(params_.lfo1Wave, lfoPhase_, lfoPhase_ < before1, lfo1Hold_);
    double lfo2 = 0.0;
    if (lfo2Used_) {
      double rate2 = params_.lfo2RateHz;
      if (lfoRateMod_[1] != 0.0) rate2 *= std::pow(2.0, lfoRateMod_[1] * 4.0);
      const double before2 = lfo2Phase_;
      lfo2Phase_ = wrap01(lfo2Phase_ + rate2 / sampleRate_);
      lfo2 = lfoValue(params_.lfo2Wave, lfo2Phase_, lfo2Phase_ < before2, lfo2Hold_);
    }

    // --- Modulation matrix
    double mod[kDstCount] = {};
    if (matrixSlots_ > 0) {
      double source[kSrcCount] = {};
      source[kSrcAmpEnv] = amplitude;
      source[kSrcFilterEnv] = envelope;
      source[kSrcLfo1] = lfo;
      source[kSrcLfo2] = lfo2;
      source[kSrcVelocity] = velocity_;
      source[kSrcKey] = currentNote_ >= 0 ? (currentNote_ - 60) / 60.0 : 0.0;
      source[kSrcModWheel] = modWheel_;
      source[kSrcAftertouch] = aftertouch_;
      source[kSrcNoteRandom] = noteRandom_;
      for (int i = 0; i < matrixSlots_; ++i) mod[slotDest_[i]] += source[slotSource_[i]] * slotAmount_[i];
      lfoRateMod_[0] = mod[kDstLfo1Rate];
      lfoRateMod_[1] = mod[kDstLfo2Rate];
    }

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
    if (pitchBend_ != 0.0) semitones += pitchBend_ * params_.pitchBendRange;
    if (matrixSlots_ > 0) semitones += mod[kDstPitch] * 24.0 + mod[kDstFine];
    // Drift multiplies the final frequency; it is exactly 1.0 when disabled,
    // which is what keeps the determinism test meaningful by default.
    const double frequency = currentFrequency_ * std::pow(2.0, semitones / 12.0) *
                             variationEngine_.tickPitchMultiplier();
    const double frequency1 =
        mod[kDstOsc1Pitch] != 0.0 ? frequency * std::pow(2.0, mod[kDstOsc1Pitch] * 2.0) : frequency;
    oscillator_.setFrequency(frequency1);

    if (params_.lfoToPulseWidth != 0.0 || mod[kDstPulseWidth] != 0.0) {
      const double pw = 0.5 + lfo * 0.45 * params_.lfoToPulseWidth + mod[kDstPulseWidth] * 0.45;
      oscillator_.setPulseWidth(pw);
      for (int i = 0; i < unisonExtra_; ++i) unison_[i].setPulseWidth(pw);
      for (auto& e : extra_) {
        e.main.setPulseWidth(pw);
        for (int i = 0; i < unisonExtra_; ++i) e.unison[i].setPulseWidth(pw);
      }
    }

    oscillator_.tick();
    for (int i = 0; i < unisonExtra_; ++i) {
      unison_[i].setFrequency(frequency1 * unisonRatio_[i]);
      unison_[i].tick();
    }

    // --- Mixer. Summed as the hardware mixer does, not averaged, but each
    // source is first scaled to a common RMS (Calibration.h) so that moving a
    // slider changes timbre without also changing loudness or filter drive.
    double sawLevel = params_.sawLevel, pulseLevel = params_.pulseLevel;
    double subLevel = params_.subLevel, noiseLevel = params_.noiseLevel;
    if (matrixSlots_ > 0) {
      if (mod[kDstOsc1Level] != 0.0) {
        const double g = clamp(1.0 + mod[kDstOsc1Level], 0.0, 2.0);
        sawLevel *= g;
        pulseLevel *= g;
      }
      if (mod[kDstSubLevel] != 0.0) subLevel = clamp(subLevel + mod[kDstSubLevel], 0.0, 1.0);
      if (mod[kDstNoiseLevel] != 0.0) noiseLevel = clamp(noiseLevel + mod[kDstNoiseLevel], 0.0, 1.0);
    }
    double mixed;
    if (unisonExtra_ == 0) {
      mixed = oscillator_.saw() * sawLevel * OscillatorCalibration::sawGain() +
              oscillator_.pulse() * pulseLevel * OscillatorCalibration::pulseGain() +
              oscillator_.subOctaveDown() * subLevel * OscillatorCalibration::subGain() +
              noise_.next() * noiseLevel * OscillatorCalibration::noiseGain();
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
      mixed = saw * unisonGain_ * sawLevel * OscillatorCalibration::sawGain() +
              pulse * unisonGain_ * pulseLevel * OscillatorCalibration::pulseGain() +
              oscillator_.subOctaveDown() * subLevel * OscillatorCalibration::subGain() +
              noise_.next() * noiseLevel * OscillatorCalibration::noiseGain();
    }
    for (int k = 0; k < 2; ++k) {
      if (!extraUsed_[k]) continue;
      double level = k == 0 ? params_.osc2Level : params_.osc3Level;
      if (matrixSlots_ > 0) level = clamp(level + mod[k == 0 ? kDstOsc2Level : kDstOsc3Level], 0.0, 1.0);
      double f = frequency * extraRatio_[k];
      const double pitchMod = mod[k == 0 ? kDstOsc2Pitch : kDstOsc3Pitch];
      if (pitchMod != 0.0) f *= std::pow(2.0, pitchMod * 2.0);
      mixed += level * renderExtra(extra_[k], extraWave_[k], f);
    }
    mixed += variationEngine_.tickNoise();

    // --- Filter cutoff: base, envelope, LFO, keyboard tracking
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
    if (matrixSlots_ > 0) octaves += mod[kDstCutoff] * 5.0;
    cutoff *= std::pow(2.0, octaves);
    filter_.setCutoff(cutoffSmoother_.next(cutoff));
    if (resonanceModulated_) filter_.setResonance(clamp(params_.resonance + mod[kDstResonance], 0.0, 1.0));

    const double filtered = filter_.process(mixed);

    // --- VCA
    if (params_.velocityToAmp > 0.0)
      amplitude *= velocitySmoother_.next(1.0 - params_.velocityToAmp * (1.0 - velocity_));
    if (matrixSlots_ > 0 && mod[kDstAmp] != 0.0) amplitude *= clamp(1.0 + mod[kDstAmp], 0.0, 2.0);
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
  /// Notes remembered for last-note priority with return.
  static constexpr int kMaxHeldNotes = 16;

  /// How many oscillators the saw/pulse stack is using now (1 = unison off).
  int unisonVoiceCount() const noexcept { return unisonExtra_ + (unisonUsesCentre_ ? 1 : 0); }

 private:
  static double clamp(double v, double lo, double hi) noexcept { return v < lo ? lo : (v > hi ? hi : v); }

  /// One LFO sample. Wave 0 is the original sine, computed exactly as before.
  double lfoValue(double wave, double phase, bool wrapped, double& hold) noexcept {
    const int w = static_cast<int>(wave + 0.5);
    switch (w) {
      case 1: return phase < 0.5 ? 4.0 * phase - 1.0 : 3.0 - 4.0 * phase;
      case 2: return 2.0 * phase - 1.0;
      case 3: return phase < 0.5 ? 1.0 : -1.0;
      case 4:
        if (wrapped) {
          randomState_ ^= randomState_ << 13;
          randomState_ ^= randomState_ >> 17;
          randomState_ ^= randomState_ << 5;
          hold = static_cast<double>(static_cast<int32_t>(randomState_)) * (1.0 / 2147483648.0);
        }
        return hold;
      default: return std::sin(2.0 * kPi * phase);
    }
  }

  struct ExtraOscillator {
    Oscillator main;
    Oscillator unison[kMaxUnisonExtra];
  };

  static double waveOf(const Oscillator& o, int wave) noexcept {
    switch (wave) {
      case 1: return o.pulse() * OscillatorCalibration::pulseGain();
      case 2: return o.triangle() * OscillatorCalibration::triangleGain();
      case 3: return o.sine() * OscillatorCalibration::sineGain();
      default: return o.saw() * OscillatorCalibration::sawGain();
    }
  }

  /// Oscillator 2 or 3, through the same unison stack as oscillator 1.
  double renderExtra(ExtraOscillator& e, int wave, double frequency) noexcept {
    e.main.setFrequency(frequency);
    e.main.tick();
    if (unisonExtra_ == 0) return waveOf(e.main, wave);
    double sum = unisonUsesCentre_ ? waveOf(e.main, wave) : 0.0;
    for (int i = 0; i < unisonExtra_; ++i) {
      e.unison[i].setFrequency(frequency * unisonRatio_[i]);
      e.unison[i].tick();
      sum += waveOf(e.unison[i], wave);
    }
    return sum * unisonGain_;
  }

  void configureExtras() noexcept {
    const double level[2] = {params_.osc2Level, params_.osc3Level};
    const double wave[2] = {params_.osc2Wave, params_.osc3Wave};
    const double oct[2] = {params_.osc2Octave, params_.osc3Octave};
    const double semi[2] = {params_.osc2Semi, params_.osc3Semi};
    const double fine[2] = {params_.osc2Fine, params_.osc3Fine};
    for (int k = 0; k < 2; ++k) {
      extraWave_[k] = static_cast<int>(clamp(std::lround(wave[k]), 0, 3));
      extraRatio_[k] = std::pow(2.0, (std::lround(oct[k]) * 12.0 + semi[k] + fine[k] / 100.0) / 12.0);
      extraUsed_[k] = level[k] > 0.0;
    }
  }

  /// Compact the matrix to its active slots, so an empty matrix costs nothing.
  void configureMatrix() noexcept {
    matrixSlots_ = 0;
    resonanceModulated_ = false;
    lfo2Used_ = false;
    for (int i = 0; i < 8; ++i) {
      const long src = std::lround(params_.*(kModSlots[i].source));
      const long dst = std::lround(params_.*(kModSlots[i].dest));
      const double amount = params_.*(kModSlots[i].amount);
      if (src <= kSrcNone || src >= kSrcCount || dst <= kDstNone || dst >= kDstCount) continue;
      if (amount == 0.0) continue;
      slotSource_[matrixSlots_] = static_cast<int>(src);
      slotDest_[matrixSlots_] = static_cast<int>(dst);
      slotAmount_[matrixSlots_] = amount;
      if (dst == kDstResonance) resonanceModulated_ = true;
      if (src == kSrcLfo2) lfo2Used_ = true;
      ++matrixSlots_;
    }
    if (!resonanceModulated_) filter_.setResonance(params_.resonance);
    if (matrixSlots_ == 0) lfoRateMod_[0] = lfoRateMod_[1] = 0.0;
  }

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
  double lfo2Phase_ = 0.0;
  double lfo1Hold_ = 0.0, lfo2Hold_ = 0.0;
  double lfoRateMod_[2] = {0.0, 0.0};
  ExtraOscillator extra_[2]{};
  double extraRatio_[2] = {1.0, 1.0};
  int extraWave_[2] = {0, 0};
  bool extraUsed_[2] = {false, false};
  int slotSource_[8]{}, slotDest_[8]{};
  double slotAmount_[8]{};
  int matrixSlots_ = 0;
  bool resonanceModulated_ = false;
  bool lfo2Used_ = false;
  double noteRandom_ = 0.0;
  uint32_t randomState_ = 0x2545f491u;
  double modWheel_ = 0.0, aftertouch_ = 0.0, pitchBend_ = 0.0;
  double driftPhaseA_ = 0.0;
  double driftPhaseB_ = 0.37;
  double velocity_ = 1.0;
  double vibratoTime_ = 0.0;
  double currentFrequency_ = 0.0;
  double targetFrequency_ = 0.0;
  int currentNote_ = -1;
  int heldNotes_[kMaxHeldNotes]{};
  double heldVelocities_[kMaxHeldNotes]{};
  int heldCount_ = 0;
  bool gliding_ = false;
  bool held_ = false;
};

}  // namespace af
