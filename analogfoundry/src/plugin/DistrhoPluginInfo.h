// DPF build configuration for AnalogFoundry 101.
//
// DPF was chosen over JUCE and the Steinberg SDK for one reason that
// ANALOG_SYNTH_AGENT.md makes decisive: it is ISC licensed and ships its own
// VST3 implementation, so neither the framework nor the SDK imposes GPL on
// this project. See THIRD_PARTY.md for the comparison.

#pragma once

#define DISTRHO_PLUGIN_BRAND "AnalogFoundry"
#define DISTRHO_PLUGIN_NAME "AnalogFoundry 101"
#define DISTRHO_PLUGIN_URI "https://example.invalid/analogfoundry/101"

// A synth: MIDI in, stereo out, no audio input.
#define DISTRHO_PLUGIN_IS_SYNTH 1
#define DISTRHO_PLUGIN_HAS_UI 1
#define DISTRHO_UI_USE_NANOVG 1
#define DISTRHO_UI_DEFAULT_WIDTH 900
#define DISTRHO_UI_DEFAULT_HEIGHT 470
#define DISTRHO_UI_USER_RESIZABLE 0
// The editor reaches the plugin directly, in one VST3 component. Without this DPF
// gives a UI build a separate controller and puts two internal parameters (buffer
// size, sample rate) ahead of ours. VST3 parameter ids are positions, so every
// AF101 parameter moved up two and every saved Set's values and automation landed
// on the wrong controls (Threshold's shimmer level envelope drove Stage Drive).
// Parameter ids are part of the saved-Set format: never let them move.
#define DISTRHO_PLUGIN_WANT_DIRECT_ACCESS 1
#define DISTRHO_PLUGIN_NUM_INPUTS 0
#define DISTRHO_PLUGIN_NUM_OUTPUTS 2
#define DISTRHO_PLUGIN_WANT_MIDI_INPUT 1
#define DISTRHO_PLUGIN_WANT_MIDI_OUTPUT 0
#define DISTRHO_PLUGIN_WANT_PROGRAMS 1
#define DISTRHO_PLUGIN_WANT_STATE 0
#define DISTRHO_PLUGIN_WANT_TIMEPOS 1

#define DISTRHO_PLUGIN_VST3_CATEGORIES "Instrument|Synth"
#define DISTRHO_PLUGIN_CLAP_FEATURES "instrument", "synthesizer", "stereo"

// Reverse-DNS and stable for the life of the plugin: a host keys saved state
// off it. Omitting it is a hard compile error in DPF's CLAP backend, which a
// clean rebuild caught - building only the vst3 target had hidden it.
#define DISTRHO_PLUGIN_CLAP_ID "com.analogfoundry.101"
