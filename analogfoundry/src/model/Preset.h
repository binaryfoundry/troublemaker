// Parameter descriptions, preset serialisation and state recall.
//
// One table drives three things that must never disagree: the parameters a
// host sees for automation, the fields a preset saves, and the ranges the DSP
// is clamped to. Keeping them in separate places is how a plugin ends up
// recalling a project slightly wrong, so there is a single list here and
// everything else is generated from it.
//
// Milestone 9 asks for project recall, automation and a preset format. The
// format is plain text, one `name value` pair per line: trivially diffable,
// forward-compatible (unknown names are ignored, missing ones keep their
// default), and with no dependency on a JSON library in the audio plugin.

#pragma once

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "Voice101.h"

namespace af {

/// One automatable parameter: what a host needs, and what a preset stores.
struct ParameterDescriptor {
  const char* id;
  const char* name;
  const char* unit;
  double minimum;
  double maximum;
  double defaultValue;
  /// Where it lives in Voice101Parameters.
  double Voice101Parameters::*member;
};

/// The single source of truth. Order is the host's parameter order and must
/// stay stable: changing it would break automation in saved projects.
inline const std::vector<ParameterDescriptor>& parameterTable() {
  static const std::vector<ParameterDescriptor> table = {
      {"saw", "Saw Level", "", 0.0, 1.0, 1.0, &Voice101Parameters::sawLevel},
      {"pulse", "Pulse Level", "", 0.0, 1.0, 0.0, &Voice101Parameters::pulseLevel},
      {"sub", "Sub Level", "", 0.0, 1.0, 0.0, &Voice101Parameters::subLevel},
      {"noise", "Noise Level", "", 0.0, 1.0, 0.0, &Voice101Parameters::noiseLevel},
      {"pw", "Pulse Width", "", 0.02, 0.98, 0.5, &Voice101Parameters::pulseWidth},
      {"tune", "Tune", "st", -12.0, 12.0, 0.0, &Voice101Parameters::tuneSemitones},
      {"cutoff", "Cutoff", "Hz", 10.0, 20000.0, 2000.0, &Voice101Parameters::cutoffHz},
      {"resonance", "Resonance", "", 0.0, 1.0, 0.0, &Voice101Parameters::resonance},
      {"env_cutoff", "Env to Cutoff", "", 0.0, 1.0, 0.0, &Voice101Parameters::envToCutoff},
      {"lfo_cutoff", "LFO to Cutoff", "", 0.0, 1.0, 0.0, &Voice101Parameters::lfoToCutoff},
      {"track", "Key Tracking", "", 0.0, 1.0, 0.0, &Voice101Parameters::keyboardTracking},
      {"attack", "Attack", "s", 0.0, 10.0, 0.002, &Voice101Parameters::attack},
      {"decay", "Decay", "s", 0.0, 10.0, 0.3, &Voice101Parameters::decay},
      {"sustain", "Sustain", "", 0.0, 1.0, 0.0, &Voice101Parameters::sustain},
      {"release", "Release", "s", 0.0, 10.0, 0.1, &Voice101Parameters::release},
      {"lfo_rate", "LFO Rate", "Hz", 0.01, 50.0, 5.0, &Voice101Parameters::lfoRateHz},
      {"lfo_pitch", "LFO to Pitch", "st", 0.0, 12.0, 0.0, &Voice101Parameters::lfoToPitch},
      {"lfo_pw", "LFO to PW", "", 0.0, 1.0, 0.0, &Voice101Parameters::lfoToPulseWidth},
      {"glide", "Glide", "s", 0.0, 5.0, 0.0, &Voice101Parameters::glideSeconds},
      {"stage_drive", "Filter Stage Drive", "", 0.0, 1.0, 0.0,
       &Voice101Parameters::filterStageDrive},
      {"input_drive", "Filter Input Drive", "", 0.0, 1.0, 0.0,
       &Voice101Parameters::filterInputDrive},
      {"level", "Output Level", "", 0.0, 1.0, 0.8, &Voice101Parameters::outputLevel},
      // Appended, never inserted: hosts address parameters by position, so
      // anything added goes after the last entry (saved projects keep working).
      {"unison", "Unison Voices", "", 1.0, 7.0, 1.0, &Voice101Parameters::unisonVoices},
      {"unison_detune", "Unison Detune", "ct", 0.0, 50.0, 0.0,
       &Voice101Parameters::unisonDetuneCents},
      // 0.3: expression. Each default is the 101 path, so older presets and
      // projects sound exactly as they did.
      {"vel_amp", "Velocity > Amp", "", 0.0, 1.0, 0.0, &Voice101Parameters::velocityToAmp},
      {"vel_cutoff", "Velocity > Cutoff", "", 0.0, 1.0, 0.0, &Voice101Parameters::velocityToCutoff},
      {"fenv_separate", "Filter Env Separate", "", 0.0, 1.0, 0.0,
       &Voice101Parameters::filterEnvSeparate},
      {"fenv_attack", "Filter Attack", "s", 0.0, 10.0, 0.002, &Voice101Parameters::filterAttack},
      {"fenv_decay", "Filter Decay", "s", 0.0, 10.0, 0.3, &Voice101Parameters::filterDecay},
      {"fenv_sustain", "Filter Sustain", "", 0.0, 1.0, 0.0, &Voice101Parameters::filterSustain},
      {"fenv_release", "Filter Release", "s", 0.0, 10.0, 0.1, &Voice101Parameters::filterRelease},
      {"vib_fade", "Vibrato Fade-In", "s", 0.0, 5.0, 0.0, &Voice101Parameters::vibratoFadeIn},
      {"drift", "Pitch Drift", "ct", 0.0, 30.0, 0.0, &Voice101Parameters::driftCents},
      {"legato_glide", "Legato Glide Only", "", 0.0, 1.0, 0.0, &Voice101Parameters::legatoGlide},
      // 0.4: oscillators 2 and 3, LFO 2 and waveforms, pitch bend, and the
      // modulation matrix. Each default is the 0.3 path.
      {"osc2_level", "Osc 2 Level", "", 0.0, 1.0, 0.0, &Voice101Parameters::osc2Level},
      {"osc2_wave", "Osc 2 Wave", "", 0.0, 3.0, 0.0, &Voice101Parameters::osc2Wave},
      {"osc2_oct", "Osc 2 Octave", "", -3.0, 3.0, 0.0, &Voice101Parameters::osc2Octave},
      {"osc2_semi", "Osc 2 Semitone", "st", -12.0, 12.0, 0.0, &Voice101Parameters::osc2Semi},
      {"osc2_fine", "Osc 2 Fine", "ct", -100.0, 100.0, 0.0, &Voice101Parameters::osc2Fine},
      {"osc3_level", "Osc 3 Level", "", 0.0, 1.0, 0.0, &Voice101Parameters::osc3Level},
      {"osc3_wave", "Osc 3 Wave", "", 0.0, 3.0, 0.0, &Voice101Parameters::osc3Wave},
      {"osc3_oct", "Osc 3 Octave", "", -3.0, 3.0, 0.0, &Voice101Parameters::osc3Octave},
      {"osc3_semi", "Osc 3 Semitone", "st", -12.0, 12.0, 0.0, &Voice101Parameters::osc3Semi},
      {"osc3_fine", "Osc 3 Fine", "ct", -100.0, 100.0, 0.0, &Voice101Parameters::osc3Fine},
      // LFO modes pack wave + 5 * retrigger + 10 * sync division (Voice101.h LfoMode).
      {"lfo1_wave", "LFO 1 Mode", "", 0.0, 139.0, 0.0, &Voice101Parameters::lfo1Wave},
      {"lfo2_rate", "LFO 2 Rate", "Hz", 0.01, 50.0, 2.0, &Voice101Parameters::lfo2RateHz},
      {"lfo2_wave", "LFO 2 Mode", "", 0.0, 139.0, 0.0, &Voice101Parameters::lfo2Wave},
      {"bend_range", "Pitch Bend Range", "st", 0.0, 24.0, 2.0, &Voice101Parameters::pitchBendRange},
      {"mod1", "Mod 1", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod1},
      {"mod2", "Mod 2", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod2},
      {"mod3", "Mod 3", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod3},
      {"mod4", "Mod 4", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod4},
      {"mod5", "Mod 5", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod5},
      {"mod6", "Mod 6", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod6},
      {"mod7", "Mod 7", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod7},
      {"mod8", "Mod 8", "", 0.0, 3740186.0, 10000.0, &Voice101Parameters::mod8},
      // 0.5: stereo, polyphony, a third envelope and filter modes. Each default
      // is the 0.4 path. (63 parameters: Live lists a plugin's only up to 64.)
      {"stereo", "Stereo Spread", "", 0.0, 1.0, 0.0, &Voice101Parameters::stereoSpread},
      {"voices", "Voices", "", 1.0, 8.0, 1.0, &Voice101Parameters::voices},
      {"env3_attack", "Env 3 Attack", "s", 0.0, 10.0, 0.002, &Voice101Parameters::env3Attack},
      {"env3_decay", "Env 3 Decay", "s", 0.0, 10.0, 0.3, &Voice101Parameters::env3Decay},
      {"env3_sustain", "Env 3 Sustain", "", 0.0, 1.0, 0.0, &Voice101Parameters::env3Sustain},
      {"env3_release", "Env 3 Release", "s", 0.0, 10.0, 0.1, &Voice101Parameters::env3Release},
      {"filter_mode", "Filter Mode", "", 0.0, 2.0, 0.0, &Voice101Parameters::filterMode},
      // 0.6: the low-pass ladder's slope. 24 dB is the 0.5 path. 64 parameters, Live's
      // limit: the next one has to replace or pack an existing one.
      {"filter_poles", "Filter Slope", "", 2.0, 4.0, 4.0, &Voice101Parameters::filterPoles},
  };
  return table;
}

/// Clamp every parameter into its declared range. A host can send anything,
/// including values from a project saved by a future version.
inline Voice101Parameters clampToRanges(Voice101Parameters p) {
  for (const auto& d : parameterTable()) {
    double& value = p.*(d.member);
    if (!std::isfinite(value)) value = d.defaultValue;
    if (value < d.minimum) value = d.minimum;
    if (value > d.maximum) value = d.maximum;
  }
  return p;
}

/// Normalised 0..1, which is what VST3 and most hosts automate in.
inline double toNormalised(const ParameterDescriptor& d, double value) {
  const double span = d.maximum - d.minimum;
  if (span <= 0.0) return 0.0;
  const double t = (value - d.minimum) / span;
  return t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t);
}

inline double fromNormalised(const ParameterDescriptor& d, double normalised) {
  const double t = normalised < 0.0 ? 0.0 : (normalised > 1.0 ? 1.0 : normalised);
  return d.minimum + t * (d.maximum - d.minimum);
}

/// Serialise to the preset text format.
inline std::string savePreset(const Voice101Parameters& p) {
  std::string out = "analogfoundry101 1\n";
  char line[128];
  for (const auto& d : parameterTable()) {
    std::snprintf(line, sizeof(line), "%s %.9g\n", d.id, p.*(d.member));
    out += line;
  }
  return out;
}

/// Parse the preset text format. Unknown names are ignored and missing ones
/// keep their default, so an old preset still loads into a newer build and a
/// newer preset degrades gracefully into an older one.
inline Voice101Parameters loadPreset(const std::string& text) {
  Voice101Parameters p;
  for (const auto& d : parameterTable()) p.*(d.member) = d.defaultValue;
  bool retrig1 = false, retrig2 = false;

  size_t pos = 0;
  while (pos < text.size()) {
    size_t end = text.find('\n', pos);
    if (end == std::string::npos) end = text.size();
    const std::string line = text.substr(pos, end - pos);
    pos = end + 1;
    if (line.empty() || line[0] == '#') continue;

    const size_t space = line.find(' ');
    if (space == std::string::npos) continue;
    const std::string key = line.substr(0, space);
    const std::string value = line.substr(space + 1);
    // 0.4 kept LFO retrigger as its own parameter; 0.5 packs it into the mode.
    if (key == "lfo1_retrig" || key == "lfo2_retrig") {
      if (std::atof(value.c_str()) >= 0.5) (key[3] == '1' ? retrig1 : retrig2) = true;
      continue;
    }
    for (const auto& d : parameterTable()) {
      if (key == d.id) {
        p.*(d.member) = std::atof(value.c_str());
        break;
      }
    }
  }
  if (retrig1 && decodeLfoMode(p.lfo1Wave).retrigger == false) p.lfo1Wave += 5.0;
  if (retrig2 && decodeLfoMode(p.lfo2Wave).retrigger == false) p.lfo2Wave += 5.0;
  return clampToRanges(p);
}

}  // namespace af
