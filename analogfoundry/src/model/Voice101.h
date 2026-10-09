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
// 0.5 (all off by default, and off is the 0.4 path): LFOs synced to the host's
// tempo and bar (a division packed into each LFO's mode), stereo unison (the
// stack panned across a second filter path), a third envelope as a matrix source,
// and high-pass and band-pass filter modes. Polyphony lives in Synth101.h.
//
// 0.7: pan in the matrix (all off by default, and off is the 0.6 path, bit for
// bit): each oscillator and the noise panned by LFO 1, LFO 2 or a constant, and the
// whole voice by any source. A panned oscillator runs the stereo filter path.
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

  // LFOs. Each LFO's mode packs wave, retrigger and tempo sync (see LfoMode):
  //   mode = wave + 5 * retrigger + 10 * division
  // Waves: 0 sine, 1 triangle, 2 saw (rising), 3 square, 4 sample and hold.
  // Division 0 is free-running at the LFO's rate in Hz; 1-13 are kLfoDivisionBeats.
  // 0-4 are 0.4's plain waves, so 0.4 values still mean the same thing.
  double lfo1Wave = 0.0;
  double lfo2RateHz = 2.0, lfo2Wave = 0.0;

  double pitchBendRange = 2.0;  ///< semitones at full bend

  // Modulation matrix (0.4): 8 slots, each ONE parameter packing source,
  // destination and amount (see packModSlot) - Live lists a plugin's parameters
  // only up to 64, and 24 separate matrix parameters took AF101 past it.
  // 10000 is an empty slot (no source, amount 0).
  double mod1 = 10000, mod2 = 10000, mod3 = 10000, mod4 = 10000;
  double mod5 = 10000, mod6 = 10000, mod7 = 10000, mod8 = 10000;

  // 0.5.
  double stereoSpread = 0.0;  ///< 0..1: unison voices panned across the field; 0 is mono, bit for bit
  double voices = 1.0;        ///< 1..8, read by Synth101: 1 is the monophonic 101
  double env3Attack = 0.002, env3Decay = 0.3, env3Sustain = 0.0, env3Release = 0.1;  ///< a matrix source
  double filterMode = 0.0;    ///< 0 the ladder low-pass, 1 high-pass (24 dB), 2 band-pass

  // 0.6.
  double filterPoles = 4.0;   ///< the low-pass ladder's output tap: 2, 3 or 4 poles (12/18/24 dB per octave)
};

/// Tempo-sync divisions, in beats (quarter notes).
inline constexpr double kLfoDivisionBeats[14] = {
    0.0,          // free
    0.125,        // 1/32
    1.0 / 6.0,    // 1/16 triplet
    0.25,         // 1/16
    1.0 / 3.0,    // 1/8 triplet
    0.375,        // dotted 1/16
    0.5,          // 1/8
    2.0 / 3.0,    // 1/4 triplet
    0.75,         // dotted 1/8
    1.0,          // 1/4
    2.0,          // 1/2
    4.0,          // 1 bar
    8.0,          // 2 bars
    16.0,         // 4 bars
};
constexpr int kLfoDivisions = 13;
constexpr double kLfoModeMax = 4 + 5 + 10 * kLfoDivisions;  // 139

struct LfoMode {
  int wave;
  bool retrigger;
  int division;  ///< 0 free, 1..13
};
inline LfoMode decodeLfoMode(double value) noexcept {
  long v = std::lround(value);
  v = v < 0 ? 0 : (v > static_cast<long>(kLfoModeMax) ? static_cast<long>(kLfoModeMax) : v);
  return {static_cast<int>(v % 5), ((v / 5) % 2) == 1, static_cast<int>(v / 10)};
}
inline double encodeLfoMode(int wave, bool retrigger, int division) noexcept {
  return wave + 5.0 * (retrigger ? 1 : 0) + 10.0 * division;
}

/// The matrix slots as member pointers, in order.
inline double Voice101Parameters::* const kModSlots[8] = {
    &Voice101Parameters::mod1, &Voice101Parameters::mod2, &Voice101Parameters::mod3, &Voice101Parameters::mod4,
    &Voice101Parameters::mod5, &Voice101Parameters::mod6, &Voice101Parameters::mod7, &Voice101Parameters::mod8,
};

/// Modulation sources. Envelopes (amp, filter and the third, kSrcModEnv),
/// velocity, wheel and pressure are 0..1; LFOs, key and the per-note random value
/// are -1..1; the constant (0.7) is 1, for a fixed offset such as a pan position.
enum ModSource {
  kSrcNone = 0, kSrcAmpEnv, kSrcFilterEnv, kSrcLfo1, kSrcLfo2, kSrcVelocity,
  kSrcKey, kSrcModWheel, kSrcAftertouch, kSrcNoteRandom, kSrcModEnv, kSrcConstant, kSrcCount
};

/// Modulation destinations. Amount 1 with a source at 1 moves each by: cutoff
/// 5 octaves; pitch 24 semitones; fine 100 cents; pulse width 0.45; resonance,
/// levels 1 (added, clamped); amp x2 (multiplied, clamped 0..2); LFO rate 4 octaves;
/// a pan (0.7) from the centre to one side (added, clamped -1..1).
enum ModDest {
  kDstNone = 0, kDstCutoff, kDstPitch, kDstOsc1Pitch, kDstOsc2Pitch, kDstOsc3Pitch,
  kDstPulseWidth, kDstResonance, kDstAmp, kDstOsc1Level, kDstOsc2Level, kDstOsc3Level,
  kDstNoiseLevel, kDstSubLevel, kDstLfo1Rate, kDstLfo2Rate, kDstFine,
  kDstOsc1Pan, kDstOsc2Pan, kDstOsc3Pan, kDstNoisePan, kDstPan, kDstCount
};

/// One matrix slot as a single parameter value:
///   (route) * 20001 + round((amount + 1) * 10000)
/// where route is source * 17 + destination for the 0.4 routes (sources 1-10,
/// destinations 1-16). Amount resolution is 1/10000; the largest value, 3,740,186,
/// survives a host's 32-bit normalised parameter (it rounds back to the same integer).
///
/// 0.7 adds the pans without changing that layout, because Live stores a slot by
/// its value: a new destination number or a wider range would move every saved
/// slot. They use the routes 0.4 ignored. Destination 0 with a source is that
/// source -> Pan; source 0 with destination d is kExtraRoutes[d].
struct ModSlot {
  int source;
  int dest;
  double amount;
};
constexpr double kModSlotEmpty = 10000.0;
constexpr double kModSlotMax = 3740186.0;  // (10 * 17 + 16) * 20001 + 20000
constexpr int kRouteBase = 17;
constexpr int kLegacySources = 11;  // kSrcNone..kSrcModEnv
constexpr int kLegacyDests = 17;    // kDstNone..kDstFine
struct ExtraRoute {
  int source;
  int dest;
};
inline constexpr ExtraRoute kExtraRoutes[] = {
    {kSrcNone, kDstNone},
    {kSrcLfo1, kDstOsc1Pan},     {kSrcLfo1, kDstOsc2Pan},     {kSrcLfo1, kDstOsc3Pan},     {kSrcLfo1, kDstNoisePan},
    {kSrcLfo2, kDstOsc1Pan},     {kSrcLfo2, kDstOsc2Pan},     {kSrcLfo2, kDstOsc3Pan},     {kSrcLfo2, kDstNoisePan},
    {kSrcConstant, kDstOsc1Pan}, {kSrcConstant, kDstOsc2Pan}, {kSrcConstant, kDstOsc3Pan}, {kSrcConstant, kDstNoisePan},
    {kSrcConstant, kDstPan},
};
constexpr int kExtraRouteCount = sizeof(kExtraRoutes) / sizeof(kExtraRoutes[0]);
static_assert(kExtraRouteCount <= kLegacyDests, "the extra routes use source 0's destination codes");

/// The route code for a source and destination, or -1 when the pair has none.
inline int modRoute(int source, int dest) noexcept {
  if (source <= kSrcNone || dest <= kDstNone) return source == kSrcNone && dest == kDstNone ? 0 : -1;
  if (source < kLegacySources && dest < kLegacyDests) return source * kRouteBase + dest;
  if (source < kLegacySources && dest == kDstPan) return source * kRouteBase;
  for (int d = 1; d < kExtraRouteCount; ++d)
    if (kExtraRoutes[d].source == source && kExtraRoutes[d].dest == dest) return d;
  return -1;
}
/// Whether a slot can hold this pair (the editor skips the ones it cannot).
inline bool modRouteExists(int source, int dest) noexcept { return modRoute(source, dest) >= 0; }

/// A pair with no route packs as an empty slot.
inline double packModSlot(int source, int dest, double amount) noexcept {
  const double a = amount < -1.0 ? -1.0 : (amount > 1.0 ? 1.0 : amount);
  const int route = modRoute(source, dest);
  if (route < 0) return kModSlotEmpty;
  return route * 20001.0 + std::round((a + 1.0) * 10000.0);
}
inline ModSlot unpackModSlot(double value) noexcept {
  const long v = std::lround(value < 0.0 ? 0.0 : (value > kModSlotMax ? kModSlotMax : value));
  const long route = v / 20001;
  int source = static_cast<int>(route / kRouteBase), dest = static_cast<int>(route % kRouteBase);
  if (source == kSrcNone) {
    const ExtraRoute e = dest < kExtraRouteCount ? kExtraRoutes[dest] : ExtraRoute{kSrcNone, kDstNone};
    source = e.source;
    dest = e.dest;
  } else if (dest == kDstNone) {
    dest = kDstPan;
  }
  return {source, dest, (v % 20001) / 10000.0 - 1.0};
}
inline void setModSlot(Voice101Parameters& p, int slot, int source, int dest, double amount) noexcept {
  p.*(kModSlots[slot]) = packModSlot(source, dest, amount);
}
inline ModSlot getModSlot(const Voice101Parameters& p, int slot) noexcept { return unpackModSlot(p.*(kModSlots[slot])); }


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
    filterR_.setSampleRate(sampleRate_);
    amplitudeEnvelope_.setSampleRate(sampleRate_);
    filterEnvelope_.setSampleRate(sampleRate_);
    modEnvelope_.setSampleRate(sampleRate_);
    vca_.setSampleRate(sampleRate_);
    vcaR_.setSampleRate(sampleRate_);
    cutoffSmoother_.configure(sampleRate_, 0.005);
    velocitySmoother_.configure(sampleRate_, 0.003);
    variationEngine_.configure(variation_, sampleRate_);
    filter_.setStageSpread(variationEngine_.stageSpread());
    filterR_.setStageSpread(variationEngine_.stageSpread());
    reset();
  }

  /// CPU/quality trade. Changes the filter's oversampling factor.
  void setQuality(Quality q) noexcept {
    filter_.setQuality(q);
    filterR_.setQuality(q);
  }

  /// Component tolerance, drift and circuit noise. Off unless asked for.
  void setVariation(const AnalogVariation& v) noexcept {
    variation_ = v;
    variationEngine_.configure(v, sampleRate_);
    filter_.setStageSpread(variationEngine_.stageSpread());
    filterR_.setStageSpread(variationEngine_.stageSpread());
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
    filterR_.setResonance(p.resonance);
    filterR_.setStageNonlinearity(p.filterStageDrive);
    filterR_.setInputNonlinearity(p.filterInputDrive);
    filter_.setOutputPoles(static_cast<int>(std::lround(p.filterPoles)));
    filterR_.setOutputPoles(static_cast<int>(std::lround(p.filterPoles)));
    modEnvelope_.setAttack(p.env3Attack);
    modEnvelope_.setDecay(p.env3Decay);
    modEnvelope_.setSustain(p.env3Sustain);
    modEnvelope_.setRelease(p.env3Release);
    lfoMode_[0] = decodeLfoMode(p.lfo1Wave);
    lfoMode_[1] = decodeLfoMode(p.lfo2Wave);
    stereo_ = (p.stereoSpread > 0.0 && unisonExtra_ > 0) || oscPanned_;
    filterMode_ = static_cast<int>(clamp(std::lround(p.filterMode), 0, 2));
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
    filterR_.reset();
    amplitudeEnvelope_.reset();
    filterEnvelope_.reset();
    modEnvelope_.reset();
    vca_.reset();
    vcaR_.reset();
    for (auto& f : svf_) f.reset();
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
    modEnvelope_.noteOff();
  }

  /// MIDI CC 123: every held note released, through the release stage.
  void allNotesOff() noexcept {
    heldCount_ = 0;
    if (!held_) return;
    held_ = false;
    amplitudeEnvelope_.noteOff();
    filterEnvelope_.noteOff();
    modEnvelope_.noteOff();
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

  /// The host's tempo and position, once per block. A synced LFO follows the
  /// beat while the transport plays (locked to the bar) and keeps the synced rate
  /// while it is stopped.
  void setTransport(double bpm, double beatPosition, bool playing) noexcept {
    bpm_ = bpm > 1.0 ? bpm : 120.0;
    beatPosition_ = beatPosition;
    playing_ = playing;
  }

  /// The voice's note, or -1 (Synth101 allocates voices by it).
  int currentNote() const noexcept { return held_ ? currentNote_ : -1; }

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
      modEnvelope_.noteOn();
      if (lfoMode_[0].retrigger) lfoPhase_ = 0.0;
      if (lfoMode_[1].retrigger) lfo2Phase_ = 0.0;
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

  /// Produce one sample. Realtime-safe. Mono: with stereo spread on, the left
  /// channel (use processStereo).
  double process() noexcept {
    double l, r;
    render(false, l, r);
    return l;
  }

  /// Produce one stereo sample. With stereo spread 0 (or no unison) and no pan
  /// in the matrix, both sides are process(), bit for bit.
  void processStereo(double& left, double& right) noexcept {
    if (!stereo_) {
      left = right = process();
    } else {
      render(true, left, right);
    }
    if (voicePanned_) {
      double gl, gr;
      panGains(voicePan_, gl, gr);
      left *= gl;
      right *= gr;
    }
  }

 private:
  /// One LFO's phase step: free-running in Hz, or synced to the host's beat.
  double stepLfo(int k, double& phase, double rateHz) noexcept {
    const LfoMode& m = lfoMode_[k];
    if (m.division == 0) {
      phase = wrap01(phase + rateHz / sampleRate_);
      return phase;
    }
    const double beats = kLfoDivisionBeats[m.division];
    if (playing_ && !m.retrigger) {
      // Locked to the bar: the same phase at the same beat, every pass.
      const double cycles = beatPosition_ / beats;
      phase = cycles - std::floor(cycles);
    } else {
      phase = wrap01(phase + (bpm_ / 60.0 / beats) / sampleRate_);
    }
    return phase;
  }

  void render(bool stereo, double& outL, double& outR) noexcept {
    // --- Envelopes first: the matrix reads them. (Their state does not depend
    // on the signal, so ticking them here changes no number.)
    const double envelope = filterEnvelope_.tick();
    double amplitude = amplitudeEnvelope_.tick();
    const double env3 = modEnvelope_.tick();

    // --- LFOs (unipolar phase, bipolar output). A rate modulation uses the
    // previous sample's matrix value: the LFO cannot wait for itself.
    double rate1 = params_.lfoRateHz;
    if (lfoRateMod_[0] != 0.0) rate1 *= std::pow(2.0, lfoRateMod_[0] * 4.0);
    const double before1 = lfoPhase_;
    stepLfo(0, lfoPhase_, rate1);
    const double lfo = lfoValue(lfoMode_[0].wave, lfoPhase_, lfoPhase_ < before1, lfo1Hold_);
    double lfo2 = 0.0;
    if (lfo2Used_) {
      double rate2 = params_.lfo2RateHz;
      if (lfoRateMod_[1] != 0.0) rate2 *= std::pow(2.0, lfoRateMod_[1] * 4.0);
      const double before2 = lfo2Phase_;
      stepLfo(1, lfo2Phase_, rate2);
      lfo2 = lfoValue(lfoMode_[1].wave, lfo2Phase_, lfo2Phase_ < before2, lfo2Hold_);
    }
    if (playing_) beatPosition_ += bpm_ / 60.0 / sampleRate_;

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
      source[kSrcModEnv] = env3;
      source[kSrcConstant] = 1.0;
      for (int i = 0; i < matrixSlots_; ++i) mod[slotDest_[i]] += source[slotSource_[i]] * slotAmount_[i];
      lfoRateMod_[0] = mod[kDstLfo1Rate];
      lfoRateMod_[1] = mod[kDstLfo2Rate];
      voicePan_ = mod[kDstPan];
    }
    // Per-oscillator pans (0.7): equal power, centre unity, as the unison stack pans.
    double osc1L = 1.0, osc1R = 1.0, noiseL = 1.0, noiseR = 1.0;
    double extraL[2] = {1.0, 1.0}, extraR[2] = {1.0, 1.0};
    if (stereo && oscPanned_) {
      panGains(mod[kDstOsc1Pan], osc1L, osc1R);
      panGains(mod[kDstNoisePan], noiseL, noiseR);
      panGains(mod[kDstOsc2Pan], extraL[0], extraR[0]);
      panGains(mod[kDstOsc3Pan], extraL[1], extraR[1]);
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
    double mixed = 0.0, mixedR = 0.0;
    if (!stereo) {
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
    } else {
      // Stereo: each unison voice is panned (equal power, centre = unity), the
      // centre voice, sub and noise sit in the middle. Two filter paths follow.
      double sawL = unisonUsesCentre_ ? oscillator_.saw() : 0.0;
      double pulseL = unisonUsesCentre_ ? oscillator_.pulse() : 0.0;
      double sawR = sawL, pulseR = pulseL;
      for (int i = 0; i < unisonExtra_; ++i) {
        const double sv = unison_[i].saw(), pv = unison_[i].pulse();
        sawL += sv * panL_[i];
        sawR += sv * panR_[i];
        pulseL += pv * panL_[i];
        pulseR += pv * panR_[i];
      }
      if (oscPanned_) {
        // The sub stays in the middle; oscillator 1's stack and the noise take their pans.
        const double sub = oscillator_.subOctaveDown() * subLevel * OscillatorCalibration::subGain();
        const double noise = noise_.next() * noiseLevel * OscillatorCalibration::noiseGain();
        mixed = (sawL * unisonGain_ * sawLevel * OscillatorCalibration::sawGain() +
                 pulseL * unisonGain_ * pulseLevel * OscillatorCalibration::pulseGain()) * osc1L +
                sub + noise * noiseL;
        mixedR = (sawR * unisonGain_ * sawLevel * OscillatorCalibration::sawGain() +
                  pulseR * unisonGain_ * pulseLevel * OscillatorCalibration::pulseGain()) * osc1R +
                 sub + noise * noiseR;
      } else {
        const double centre = oscillator_.subOctaveDown() * subLevel * OscillatorCalibration::subGain() +
                              noise_.next() * noiseLevel * OscillatorCalibration::noiseGain();
        mixed = sawL * unisonGain_ * sawLevel * OscillatorCalibration::sawGain() +
                pulseL * unisonGain_ * pulseLevel * OscillatorCalibration::pulseGain() + centre;
        mixedR = sawR * unisonGain_ * sawLevel * OscillatorCalibration::sawGain() +
                 pulseR * unisonGain_ * pulseLevel * OscillatorCalibration::pulseGain() + centre;
      }
    }
    for (int k = 0; k < 2; ++k) {
      if (!extraUsed_[k]) continue;
      double level = k == 0 ? params_.osc2Level : params_.osc3Level;
      if (matrixSlots_ > 0) level = clamp(level + mod[k == 0 ? kDstOsc2Level : kDstOsc3Level], 0.0, 1.0);
      double f = frequency * extraRatio_[k];
      const double pitchMod = mod[k == 0 ? kDstOsc2Pitch : kDstOsc3Pitch];
      if (pitchMod != 0.0) f *= std::pow(2.0, pitchMod * 2.0);
      if (!stereo) {
        mixed += level * renderExtra(extra_[k], extraWave_[k], f);
      } else {
        double l, r;
        renderExtraStereo(extra_[k], extraWave_[k], f, l, r);
        mixed += level * l * extraL[k];
        mixedR += level * r * extraR[k];
      }
    }
    const double circuitNoise = variationEngine_.tickNoise();
    mixed += circuitNoise;
    mixedR += circuitNoise;

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
    const double smoothed = cutoffSmoother_.next(cutoff);
    const double resonance = resonanceModulated_ ? clamp(params_.resonance + mod[kDstResonance], 0.0, 1.0) : params_.resonance;
    double filtered, filteredR = 0.0;
    if (filterMode_ == 0) {
      filter_.setCutoff(smoothed);
      if (resonanceModulated_) filter_.setResonance(resonance);
      filtered = filter_.process(mixed);
      if (stereo) {
        filterR_.setCutoff(smoothed);
        if (resonanceModulated_) filterR_.setResonance(resonance);
        filteredR = filterR_.process(mixedR);
      }
    } else {
      filtered = svfMode(0, mixed, smoothed, resonance);
      if (stereo) filteredR = svfMode(1, mixedR, smoothed, resonance);
    }

    // --- VCA
    if (params_.velocityToAmp > 0.0)
      amplitude *= velocitySmoother_.next(1.0 - params_.velocityToAmp * (1.0 - velocity_));
    if (matrixSlots_ > 0 && mod[kDstAmp] != 0.0) amplitude *= clamp(1.0 + mod[kDstAmp], 0.0, 2.0);
    outL = vca_.process(filtered, amplitude) * params_.outputLevel;
    outR = stereo ? vcaR_.process(filteredR, amplitude) * params_.outputLevel : outL;
  }

  /// High-pass (two cascaded 12 dB sections, 24 dB) or band-pass (one section,
  /// unity peak) - TPT state-variable filters at the base rate, for the modes
  /// the ladder does not have. side 0 = left/mono, 1 = right.
  double svfMode(int side, double x, double cutoffHz, double resonance) noexcept {
    const double fc = clamp(cutoffHz, 10.0, sampleRate_ * 0.45);
    const double k = 2.0 - 1.9 * resonance;  // res 0: Q 0.5; res 1: Q 10
    if (filterMode_ == 1) {
      const double y = svf_[side * 2].highpass(x, fc, k, sampleRate_);
      return svf_[side * 2 + 1].highpass(y, fc, k, sampleRate_);
    }
    return k * svf_[side * 2].bandpass(x, fc, k, sampleRate_);
  }

 public:

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

  /// A pan position, -1 left to 1 right, as equal-power gains with the centre at
  /// unity on both sides (the law the unison stack uses).
  static void panGains(double pan, double& left, double& right) noexcept {
    const double angle = (clamp(pan, -1.0, 1.0) + 1.0) * (kPi / 4.0);
    left = std::sqrt(2.0) * std::cos(angle);
    right = std::sqrt(2.0) * std::sin(angle);
  }

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

  /// Oscillator 2 or 3 in stereo: the stack panned as oscillator 1's is.
  void renderExtraStereo(ExtraOscillator& e, int wave, double frequency, double& l, double& r) noexcept {
    e.main.setFrequency(frequency);
    e.main.tick();
    l = r = unisonUsesCentre_ ? waveOf(e.main, wave) : 0.0;
    for (int i = 0; i < unisonExtra_; ++i) {
      e.unison[i].setFrequency(frequency * unisonRatio_[i]);
      e.unison[i].tick();
      const double v = waveOf(e.unison[i], wave);
      l += v * panL_[i];
      r += v * panR_[i];
    }
    l *= unisonGain_;
    r *= unisonGain_;
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
    oscPanned_ = voicePanned_ = false;
    voicePan_ = 0.0;
    for (int i = 0; i < 8; ++i) {
      const ModSlot slot = getModSlot(params_, i);
      const long src = slot.source, dst = slot.dest;
      const double amount = slot.amount;
      if (src <= kSrcNone || src >= kSrcCount || dst <= kDstNone || dst >= kDstCount) continue;
      if (amount == 0.0) continue;
      slotSource_[matrixSlots_] = static_cast<int>(src);
      slotDest_[matrixSlots_] = static_cast<int>(dst);
      slotAmount_[matrixSlots_] = amount;
      if (dst == kDstResonance) resonanceModulated_ = true;
      if (src == kSrcLfo2) lfo2Used_ = true;
      if (dst == kDstOsc1Pan || dst == kDstOsc2Pan || dst == kDstOsc3Pan || dst == kDstNoisePan) oscPanned_ = true;
      if (dst == kDstPan) voicePanned_ = true;
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
      // Pan follows detune position: the sharpest voice furthest right. Equal
      // power, scaled so a centred voice is unity on both sides.
      const double spread = clamp(params_.stereoSpread, 0.0, 1.0);
      const double angle = (position * spread + 1.0) * (kPi / 4.0);
      panL_[k] = std::sqrt(2.0) * std::cos(angle);
      panR_[k] = std::sqrt(2.0) * std::sin(angle);
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
  Filter101 filterR_{};  ///< the right side of stereo unison
  Envelope amplitudeEnvelope_{};
  Envelope filterEnvelope_{};
  Envelope modEnvelope_{};  ///< the third envelope, a matrix source only
  Vca vca_{};
  Vca vcaR_{};
  StateVariableFilter svf_[4]{};  ///< high/band-pass: two sections per side
  double panL_[kMaxUnisonExtra]{}, panR_[kMaxUnisonExtra]{};
  bool stereo_ = false;
  bool oscPanned_ = false;    ///< an oscillator or the noise has a pan route: the stereo path runs
  bool voicePanned_ = false;  ///< the whole voice has a pan route, applied after the VCA
  double voicePan_ = 0.0;
  int filterMode_ = 0;
  LfoMode lfoMode_[2] = {{0, false, 0}, {0, false, 0}};
  double bpm_ = 120.0, beatPosition_ = 0.0;
  bool playing_ = false;
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
