// What AnalogFoundry 101's parameter values mean, in words.
//
// One place for the names, so the host's automation lanes (PluginProcessor)
// and the editor (PluginUI) can never disagree: a wave the host calls "Square"
// is "Square" on screen, and a matrix slot reads "LFO 1 -> Cutoff +35 %".

#pragma once

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "../model/Voice101.h"

namespace af {
namespace labels {

inline constexpr const char* kOscWaves[] = {"Saw", "Pulse", "Triangle", "Sine"};
inline constexpr const char* kLfoWaves[] = {"Sine", "Triangle", "Saw", "Square", "S&H"};
inline constexpr const char* kDivisionNames[] = {"",     "1/32", "1/16T", "1/16", "1/8T",  "1/16D", "1/8",
                                                "1/4T", "1/8D", "1/4",   "1/2",  "1 bar", "2 bars", "4 bars"};
inline constexpr const char* kSources[] = {"None", "Amp Env", "Filter Env", "LFO 1",       "LFO 2", "Velocity",
                                           "Key",  "Mod Wheel", "Aftertouch", "Note Random", "Env 3", "Constant"};
inline constexpr const char* kDests[] = {"None",        "Cutoff",      "Pitch",       "Osc 1 Pitch", "Osc 2 Pitch",
                                         "Osc 3 Pitch", "Pulse Width", "Resonance",   "Amp",         "Osc 1 Level",
                                         "Osc 2 Level", "Osc 3 Level", "Noise Level", "Sub Level",   "LFO 1 Rate",
                                         "LFO 2 Rate",  "Fine",        "Osc 1 Pan",   "Osc 2 Pan",   "Osc 3 Pan",
                                         "Noise Pan",   "Pan",         "Osc 1 Tilt",  "Osc 2 Tilt",  "Osc 3 Tilt"};
inline constexpr const char* kFilterModes[] = {"Low-pass", "High-pass", "Band-pass"};
inline constexpr const char* kFilterSlopes[] = {"12 dB", "18 dB", "24 dB"};

static_assert(sizeof(kSources) / sizeof(kSources[0]) == kSrcCount, "a matrix source without a name");
static_assert(sizeof(kDests) / sizeof(kDests[0]) == kDstCount, "a matrix destination without a name");
static_assert(sizeof(kDivisionNames) / sizeof(kDivisionNames[0]) == af::kLfoDivisions + 1, "a sync division without a name");

/// "Sine", "Square 1/8D", "Saw 1/4 retrig".
inline std::string lfoMode(double value) {
  const LfoMode m = decodeLfoMode(value);
  std::string s = kLfoWaves[m.wave];
  if (m.division > 0) {
    s += " ";
    s += kDivisionNames[m.division];
  }
  if (m.retrigger) s += " retrig";
  return s;
}

/// "LFO 1 -> Cutoff +35 %", or "empty".
inline std::string modSlot(double value) {
  const ModSlot m = unpackModSlot(value);
  if (m.source == kSrcNone || m.dest == kDstNone || m.amount == 0.0) return "empty";
  char amount[16];
  std::snprintf(amount, sizeof amount, "%+.0f %%", m.amount * 100.0);
  return std::string(kSources[m.source]) + " -> " + kDests[m.dest] + " " + amount;
}

inline bool is(const char* a, const char* b) { return std::strcmp(a, b) == 0; }

/// A parameter's value as the editor shows it.
inline std::string value(const char* id, const char* unit, double v) {
  char buf[48];
  if (is(id, "osc2_wave") || is(id, "osc3_wave")) return kOscWaves[std::lround(v) & 3];
  if (is(id, "lfo1_wave") || is(id, "lfo2_wave")) return lfoMode(v);
  if (is(id, "filter_mode")) {
    const long m = std::lround(v);
    return kFilterModes[m < 0 ? 0 : (m > 2 ? 2 : m)];
  }
  if (is(id, "filter_poles")) {
    const long p = std::lround(v);
    return kFilterSlopes[(p < 2 ? 2 : (p > 4 ? 4 : p)) - 2];
  }
  if (is(id, "fenv_separate") || is(id, "legato_glide")) return v >= 0.5 ? "On" : "Off";
  if (std::strncmp(id, "mod", 3) == 0 && std::strlen(id) == 4) return modSlot(v);
  if (is(id, "unison") || is(id, "voices") || is(id, "osc2_oct") || is(id, "osc3_oct") || is(id, "osc2_semi") ||
      is(id, "osc3_semi")) {
    std::snprintf(buf, sizeof buf, "%ld", std::lround(v));
    return buf;
  }
  if (is(unit, "s")) {
    if (v < 1.0) std::snprintf(buf, sizeof buf, "%.0f ms", v * 1000.0);
    else std::snprintf(buf, sizeof buf, "%.2f s", v);
    return buf;
  }
  if (is(unit, "Hz")) {
    if (v >= 1000.0) std::snprintf(buf, sizeof buf, "%.2f kHz", v / 1000.0);
    else if (v >= 10.0) std::snprintf(buf, sizeof buf, "%.0f Hz", v);
    else std::snprintf(buf, sizeof buf, "%.2f Hz", v);
    return buf;
  }
  if (unit[0] != '\0') {
    std::snprintf(buf, sizeof buf, "%.1f %s", v, unit);
    return buf;
  }
  std::snprintf(buf, sizeof buf, "%.2f", v);
  return buf;
}

}  // namespace labels
}  // namespace af
