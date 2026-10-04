# AnalogFoundry 101 - DSP core, tests and offline renderer.
#
# Deliberately no plugin framework yet. ANALOG_SYNTH_AGENT.md requires the
# framework's licence to be reviewed before it is committed to, and every
# obvious candidate (JUCE, the Steinberg SDK) is GPLv3-or-commercial - which
# conflicts with the same document's rule about not casually importing GPL
# into a project meant to stay permissive. So the DSP core, which the document
# requires to be independent of the wrapper anyway, is built first and the
# framework decision is left open.
#
# Build (MSVC, found automatically by the Visual Studio generator):
#   cmake -S analogfoundry -B analogfoundry/build
#   cmake --build analogfoundry/build --config Release
#   analogfoundry/build/Release/dsp_tests.exe

cmake_minimum_required(VERSION 3.20)
project(AnalogFoundry101 VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The DSP core is header-only for now: every block is small and inlining
# across them matters more than build times at this size. If a block grows a
# lookup table or anything with real storage, give it a .cpp then.
add_library(af_dsp INTERFACE)
target_include_directories(af_dsp INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}/src")

if(MSVC)
  # /fp:precise, not /fp:fast - the determinism test compares renders exactly.
  add_compile_options(/W4 /fp:precise)
else()
  add_compile_options(-Wall -Wextra -ffp-contract=off)
endif()

add_executable(dsp_tests tests/dsp_tests.cpp)
target_link_libraries(dsp_tests PRIVATE af_dsp)

add_executable(model_tests tests/model_tests.cpp)
target_link_libraries(model_tests PRIVATE af_dsp)

add_executable(hardening_tests tests/hardening_tests.cpp)
target_link_libraries(hardening_tests PRIVATE af_dsp)

add_executable(plugin_load_test tests/plugin_load_test.cpp)

add_executable(bench tools/bench.cpp)
target_link_libraries(bench PRIVATE af_dsp)

add_executable(render_note tools/render_note.cpp)
target_link_libraries(render_note PRIVATE af_dsp)

# ---------------------------------------------------------------- the plugin
#
# Optional: the DSP core, tests and renderer all build without it. DPF is
# fetched separately (see README) rather than vendored, so a checkout without
# it still builds everything else.
option(AF_BUILD_PLUGIN "Build the VST3 plugin (requires external/dpf)" ON)

if(AF_BUILD_PLUGIN AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/external/dpf/CMakeLists.txt")
  add_subdirectory(external/dpf EXCLUDE_FROM_ALL)
  dpf_add_plugin(AnalogFoundry101
    TARGETS vst3 clap
    FILES_DSP src/plugin/PluginProcessor.cpp)
  target_include_directories(AnalogFoundry101 PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/src/plugin")
  target_compile_features(AnalogFoundry101 PUBLIC cxx_std_17)
  message(STATUS "AnalogFoundry: building VST3/CLAP via DPF")
  # TARGET_FILE is the binary inside the bundle, which is exactly what a host
  # dlopens - pointing at the bundle directory instead silently fails.
  add_test(NAME plugin_loads
           COMMAND plugin_load_test "$<TARGET_FILE:AnalogFoundry101-vst3>")
elseif(AF_BUILD_PLUGIN)
  message(STATUS "AnalogFoundry: external/dpf not present, skipping the plugin. "
                 "git clone --depth 1 https://github.com/DISTRHO/DPF.git analogfoundry/external/dpf")
endif()

enable_testing()
add_test(NAME dsp COMMAND dsp_tests)
add_test(NAME model COMMAND model_tests)
add_test(NAME hardening COMMAND hardening_tests)
