// VST3 wrapper for the AnalogFoundry 101 voice.
//
// Deliberately thin. All it does is translate the host's world - MIDI events,
// parameter indices, sample buffers - into calls on `af::Voice101`, which
// knows nothing about plugins. Everything musical lives in the DSP core, and
// that separation is what lets the same engine run under the offline
// renderer and the test harness.
//
// The host's parameter list is generated from `af::parameterTable()`, the
// same table the preset format uses, so automation and project recall cannot
// drift apart.

#include <cstring>
#include <string>

#include "DistrhoPlugin.hpp"

#include "../model/Preset.h"
#include "../model/Voice101.h"

START_NAMESPACE_DISTRHO

class AnalogFoundry101 : public Plugin {
 public:
  AnalogFoundry101()
      : Plugin(static_cast<uint32_t>(af::parameterTable().size()), kProgramCount, 0) {
    voice_.setSampleRate(getSampleRate());
    loadProgram(0);
  }

 protected:
  // ------------------------------------------------------------- identity

  const char* getLabel() const override { return "AnalogFoundry101"; }

  const char* getDescription() const override {
    return "Monophonic virtual-analogue synthesiser modelled on a 101-style "
           "architecture: band-limited saw/pulse/sub/noise through a four-pole "
           "resonant low-pass with a nonlinear feedback path.";
  }

  const char* getMaker() const override { return "AnalogFoundry"; }
  const char* getHomePage() const override { return DISTRHO_PLUGIN_URI; }
  const char* getLicense() const override { return "ISC"; }
  uint32_t getVersion() const override { return d_version(0, 4, 0); }  // 0.4: oscillators 2-3, LFO 2, matrix, bend

  /// Stable across releases: changing it makes hosts lose existing projects.
  int64_t getUniqueId() const override { return d_cconst('A', 'F', '1', '1'); }

  // ----------------------------------------------------------- parameters

  void initParameter(uint32_t index, Parameter& parameter) override {
    const auto& table = af::parameterTable();
    if (index >= table.size()) return;
    const auto& d = table[index];
    parameter.hints = kParameterIsAutomatable;
    // A voice count is a whole number: the host should step it, not sweep it.
    if (std::strcmp(d.id, "unison") == 0) parameter.hints |= kParameterIsInteger;
    // On/off switches: a host should show and automate them as toggles.
    if (std::strcmp(d.id, "fenv_separate") == 0 || std::strcmp(d.id, "legato_glide") == 0 ||
        std::strcmp(d.id, "lfo1_retrig") == 0 || std::strcmp(d.id, "lfo2_retrig") == 0)
      parameter.hints |= kParameterIsBoolean;
    // Choices show their names, so an automation lane reads "Saw", not "0".
    static const char* const kOscWaves[] = {"Saw", "Pulse", "Triangle", "Sine"};
    static const char* const kLfoWaves[] = {"Sine", "Triangle", "Saw", "Square", "S&H"};
    static const char* const kSources[] = {"None", "Amp Env", "Filter Env", "LFO 1", "LFO 2",
                                           "Velocity", "Key", "Mod Wheel", "Aftertouch", "Note Random"};
    static const char* const kDests[] = {"None", "Cutoff", "Pitch", "Osc 1 Pitch", "Osc 2 Pitch",
                                         "Osc 3 Pitch", "Pulse Width", "Resonance", "Amp", "Osc 1 Level",
                                         "Osc 2 Level", "Osc 3 Level", "Noise Level", "Sub Level",
                                         "LFO 1 Rate", "LFO 2 Rate", "Fine"};
    const std::string id = d.id;
    const auto ends = [&](const char* tail) {
      const size_t n = std::strlen(tail);
      return id.size() >= n && id.compare(id.size() - n, n, tail) == 0;
    };
    if (ends("_oct") || ends("_semi")) parameter.hints |= kParameterIsInteger;
    if (id == "osc2_wave" || id == "osc3_wave") setChoices(parameter, kOscWaves, 4);
    else if (id == "lfo1_wave" || id == "lfo2_wave") setChoices(parameter, kLfoWaves, 5);
    else if (ends("_src")) setChoices(parameter, kSources, 10);
    else if (ends("_dst")) setChoices(parameter, kDests, 17);
    parameter.name = d.name;
    parameter.symbol = d.id;
    parameter.unit = d.unit;
    parameter.ranges.def = static_cast<float>(d.defaultValue);
    parameter.ranges.min = static_cast<float>(d.minimum);
    parameter.ranges.max = static_cast<float>(d.maximum);
  }

  float getParameterValue(uint32_t index) const override {
    const auto& table = af::parameterTable();
    if (index >= table.size()) return 0.0f;
    return static_cast<float>(params_.*(table[index].member));
  }

  void setParameterValue(uint32_t index, float value) override {
    const auto& table = af::parameterTable();
    if (index >= table.size()) return;
    params_.*(table[index].member) = static_cast<double>(value);
    // A host may send anything, including values from a project saved by a
    // later version. Clamp rather than trust.
    params_ = af::clampToRanges(params_);
    voice_.setParameters(params_);
  }

  // ------------------------------------------------------------- programs

  void initProgramName(uint32_t index, String& name) override {
    static const char* const kNames[kProgramCount] = {"Init", "101 Bass", "Acid Lead",
                                                      "Sub Pluck"};
    name = index < kProgramCount ? kNames[index] : "Init";
  }

  void loadProgram(uint32_t index) override {
    af::Voice101Parameters p;  // starts at the table defaults
    switch (index) {
      case 1:  // 101 Bass
        p.sawLevel = 1.0;
        p.subLevel = 0.65;
        p.pulseLevel = 0.25;
        p.pulseWidth = 0.42;
        p.cutoffHz = 420.0;
        p.resonance = 0.42;
        p.envToCutoff = 0.55;
        p.keyboardTracking = 0.3;
        p.attack = 0.002;
        p.decay = 0.30;
        p.sustain = 0.27;
        p.release = 0.12;
        break;
      case 2:  // Acid Lead
        p.sawLevel = 1.0;
        p.cutoffHz = 300.0;
        p.resonance = 0.85;
        p.envToCutoff = 0.75;
        p.keyboardTracking = 0.5;
        p.attack = 0.001;
        p.decay = 0.18;
        p.sustain = 0.0;
        p.release = 0.08;
        p.glideSeconds = 0.06;
        break;
      case 3:  // Sub Pluck
        p.sawLevel = 0.3;
        p.subLevel = 1.0;
        p.cutoffHz = 180.0;
        p.resonance = 0.15;
        p.envToCutoff = 0.4;
        p.attack = 0.001;
        p.decay = 0.22;
        p.sustain = 0.0;
        p.release = 0.06;
        break;
      default:
        break;
    }
    params_ = af::clampToRanges(p);
    voice_.setParameters(params_);
  }

  // ----------------------------------------------------------- processing

  void sampleRateChanged(double newSampleRate) override {
    voice_.setSampleRate(newSampleRate);
    voice_.setParameters(params_);
  }

  void activate() override { voice_.reset(); }

  void run(const float**, float** outputs, uint32_t frames, const MidiEvent* midiEvents,
           uint32_t midiEventCount) override {
    float* left = outputs[0];
    float* right = outputs[1];

    uint32_t eventIndex = 0;
    for (uint32_t frame = 0; frame < frames; ++frame) {
      // Apply every event timed at or before this frame, so note timing is
      // sample-accurate rather than quantised to the buffer.
      while (eventIndex < midiEventCount && midiEvents[eventIndex].frame <= frame) {
        handleMidi(midiEvents[eventIndex]);
        ++eventIndex;
      }
      const float sample = static_cast<float>(voice_.process());
      left[frame] = sample;
      right[frame] = sample;  // the voice is mono; a stereo stage comes later
    }
    // Events past the end of the buffer still belong to this block.
    while (eventIndex < midiEventCount) {
      handleMidi(midiEvents[eventIndex]);
      ++eventIndex;
    }
  }

 private:
  static constexpr uint32_t kProgramCount = 4;

  static void setChoices(Parameter& parameter, const char* const* labels, uint8_t count) {
    parameter.hints |= kParameterIsInteger;
    parameter.enumValues.count = count;
    parameter.enumValues.restrictedMode = true;
    auto* values = new ParameterEnumerationValue[count];
    for (uint8_t i = 0; i < count; ++i) {
      values[i].label = labels[i];
      values[i].value = static_cast<float>(i);
    }
    parameter.enumValues.values = values;
  }

  void handleMidi(const MidiEvent& event) {
    if (event.size == 2) {  // channel pressure is the one two-byte message we read
      handlePressure(event);
      return;
    }
    if (event.size < 3) return;
    const uint8_t status = event.data[0] & 0xF0;
    const uint8_t note = event.data[1] & 0x7F;
    const uint8_t velocity = event.data[2] & 0x7F;
    if (status == 0x90 && velocity > 0) {
      voice_.noteOn(note, velocity / 127.0);
    } else if (status == 0x80 || (status == 0x90 && velocity == 0)) {
      voice_.noteOff(note);
    } else if (status == 0xB0) {
      // Here `note` is the controller number and `velocity` its value.
      if (note == 123) voice_.allNotesOff();       // a host's panic must always silence the synth
      else if (note == 120) voice_.allSoundOff();
      else if (note == 1) voice_.setModWheel(velocity / 127.0);
    } else if (status == 0xE0) {
      const int value14 = (static_cast<int>(event.data[2] & 0x7F) << 7) | (event.data[1] & 0x7F);
      voice_.setPitchBend((value14 - 8192) / 8192.0);
    }
  }

  void handlePressure(const MidiEvent& event) {
    if (event.size >= 2 && (event.data[0] & 0xF0) == 0xD0) voice_.setAftertouch((event.data[1] & 0x7F) / 127.0);
  }

  af::Voice101 voice_;
  af::Voice101Parameters params_;

  DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AnalogFoundry101)
};

Plugin* createPlugin() { return new AnalogFoundry101(); }

END_NAMESPACE_DISTRHO
