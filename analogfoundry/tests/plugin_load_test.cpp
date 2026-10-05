// Milestone 1: prove the built VST3 actually loads and advertises itself.
//
// "The plugin builds" is weaker than it sounds - a VST3 can compile, link and
// still be rejected by a host for exporting the wrong entry points or
// returning an empty factory. This does what a host does first: load the
// module, call GetPluginFactory, and read the class list back.
//
// It does not need the Steinberg SDK. IPluginFactory is a COM-style
// interface with a fixed vtable layout, so the few slots needed here are
// declared directly. That keeps the project free of the SDK's
// GPLv3-or-proprietary licence, which is the whole reason DPF was chosen.
//
// Windows-only; on other platforms it reports that it was skipped rather
// than failing, so the suite stays green on a Linux CI runner.

#include <cstdio>
#include <cstring>
#include <string>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include "../src/model/Preset.h"
#endif

namespace {

int gFailures = 0;
int gChecks = 0;

void check(bool condition, const std::string& what, const std::string& detail = "") {
  ++gChecks;
  if (!condition) {
    ++gFailures;
    std::printf("  FAIL  %-54s %s\n", what.c_str(), detail.c_str());
  }
}

#if defined(_WIN32)

/// Steinberg's PClassInfo, as the ABI lays it out.
struct PClassInfo {
  char cid[16];
  int32_t cardinality;
  char category[32];
  char name[64];
};

/// Steinberg's PFactoryInfo.
struct PFactoryInfo {
  char vendor[64];
  char url[256];
  char email[128];
  int32_t flags;
};

struct IPluginFactory;

/// Only the slots this test calls, in their ABI order: the three IUnknown
/// methods, then the factory's own.
struct IPluginFactoryVtbl {
  int32_t(__stdcall* queryInterface)(IPluginFactory*, const char*, void**);
  uint32_t(__stdcall* addRef)(IPluginFactory*);
  uint32_t(__stdcall* release)(IPluginFactory*);
  int32_t(__stdcall* getFactoryInfo)(IPluginFactory*, PFactoryInfo*);
  int32_t(__stdcall* countClasses)(IPluginFactory*);
  int32_t(__stdcall* getClassInfo)(IPluginFactory*, int32_t, PClassInfo*);
  int32_t(__stdcall* createInstance)(IPluginFactory*, const char*, const char*, void**);
};


struct IPluginFactory {
  IPluginFactoryVtbl* vtbl;
};

/// IEditController's ParameterInfo.
struct ParameterInfo {
  uint32_t id;
  int16_t title[128];
  int16_t shortTitle[128];
  int16_t units[128];
  int32_t stepCount;
  double defaultNormalized;
  int32_t unitId;
  int32_t flags;
};

/// COM-compatible IIDs (Windows byte order), from the VST3 SDK.
const unsigned char kIComponent[16] = {0x31, 0xFF, 0x31, 0xE8, 0xD5, 0xF2, 0x01, 0x43,
                                       0x92, 0x8E, 0xBB, 0xEE, 0x25, 0x69, 0x78, 0x02};
const unsigned char kIEditController[16] = {0xE3, 0xBB, 0xD7, 0xDC, 0x42, 0x77, 0x8D, 0x44,
                                            0xA8, 0x74, 0xAA, 0xCC, 0x97, 0x9C, 0x75, 0x9E};

/// Call slot `n` of a COM object's vtable.
template <typename Fn>
Fn slot(void* object, int n) {
  return reinterpret_cast<Fn>((*reinterpret_cast<void***>(object))[n]);
}

std::string narrow(const int16_t* s) {
  std::string out;
  for (int i = 0; i < 128 && s[i] != 0; ++i) out += static_cast<char>(s[i]);
  return out;
}

/// Parameter ids are part of every saved Set: a host stores values and
/// automation by id, and DPF's VST3 ids are positions. Parameter i must keep
/// id 2081 + i, forever. (0.5's first editor build let DPF put two internal parameters in
/// front; every older Set's settings landed two places up.)
void checkParameterIds(IPluginFactory* factory, const char* cid) {
  void* component = nullptr;
  factory->vtbl->createInstance(factory, cid, reinterpret_cast<const char*>(kIComponent), &component);
  check(component != nullptr, "factory creates the component");
  if (component == nullptr) return;
  slot<int32_t(__stdcall*)(void*, void*)>(component, 3)(component, nullptr);  // initialize
  void* controller = nullptr;
  slot<int32_t(__stdcall*)(void*, const char*, void**)>(component, 0)(
      component, reinterpret_cast<const char*>(kIEditController), &controller);
  check(controller != nullptr, "the component is its own edit controller (no separate controller)");
  if (controller != nullptr) {
    const auto& table = af::parameterTable();
    const int32_t count = slot<int32_t(__stdcall*)(void*)>(controller, 8)(controller);
    check(count >= static_cast<int32_t>(table.size()), "controller lists every parameter", std::to_string(count));
    // DPF lists its own parameters first: the program (1) and 16 x 130 MIDI CC
    // slots. Ours follow from id 2081, the layout every Set saved with 0.4 or
    // earlier holds. The UI build that moved them to 2083 is what this catches.
    const uint32_t kFirstId = 2081;
    std::string firstBad;
    int32_t start = -1;
    for (int32_t k = 0; k < count && start < 0; ++k) {
      ParameterInfo info;
      std::memset(&info, 0, sizeof info);
      slot<int32_t(__stdcall*)(void*, int32_t, ParameterInfo*)>(controller, 9)(controller, k, &info);
      if (narrow(info.title) == table[0].name) start = k;
    }
    check(start >= 0, "controller lists the first parameter by name", table[0].name);
    for (size_t i = 0; start >= 0 && i < table.size() && start + static_cast<int32_t>(i) < count; ++i) {
      ParameterInfo info;
      std::memset(&info, 0, sizeof info);
      slot<int32_t(__stdcall*)(void*, int32_t, ParameterInfo*)>(controller, 9)(controller, start + static_cast<int32_t>(i), &info);
      if (firstBad.empty() && (info.id != kFirstId + i || narrow(info.title) != table[i].name))
        firstBad = "parameter " + std::to_string(i) + ": id " + std::to_string(info.id) + " \"" + narrow(info.title) +
                   "\", want id " + std::to_string(kFirstId + i) + " \"" + table[i].name + "\"";
    }
    check(firstBad.empty(), "parameter i keeps id 2081 + i (the saved-Set layout)", firstBad);
    slot<uint32_t(__stdcall*)(void*)>(controller, 2)(controller);
  }
  slot<int32_t(__stdcall*)(void*)>(component, 4)(component);  // terminate
  slot<uint32_t(__stdcall*)(void*)>(component, 2)(component);
}

using GetFactoryProc = IPluginFactory*(__stdcall*)();
using InitDllProc = bool(__stdcall*)();
using ExitDllProc = bool(__stdcall*)();

int runWindows(const char* path) {
  HMODULE module = ::LoadLibraryA(path);
  check(module != nullptr, "VST3 module loads",
        module ? "" : "LoadLibrary error " + std::to_string(::GetLastError()));
  if (module == nullptr) return 1;

  auto initDll = reinterpret_cast<InitDllProc>(
      reinterpret_cast<void*>(::GetProcAddress(module, "InitDll")));
  auto getFactory = reinterpret_cast<GetFactoryProc>(
      reinterpret_cast<void*>(::GetProcAddress(module, "GetPluginFactory")));
  auto exitDll = reinterpret_cast<ExitDllProc>(
      reinterpret_cast<void*>(::GetProcAddress(module, "ExitDll")));

  check(initDll != nullptr, "exports InitDll");
  check(getFactory != nullptr, "exports GetPluginFactory");
  check(exitDll != nullptr, "exports ExitDll");
  if (getFactory == nullptr) {
    ::FreeLibrary(module);
    return 1;
  }

  if (initDll != nullptr) initDll();

  IPluginFactory* factory = getFactory();
  check(factory != nullptr && factory->vtbl != nullptr, "GetPluginFactory returns a factory");
  if (factory == nullptr || factory->vtbl == nullptr) {
    ::FreeLibrary(module);
    return 1;
  }

  PFactoryInfo info;
  std::memset(&info, 0, sizeof(info));
  factory->vtbl->getFactoryInfo(factory, &info);
  check(info.vendor[0] != '\0', "factory names a vendor", info.vendor);
  std::printf("        vendor: %s\n", info.vendor);

  const int32_t classes = factory->vtbl->countClasses(factory);
  check(classes > 0, "factory advertises at least one class",
        std::to_string(classes) + " classes");

  bool foundAudioModule = false;
  char audioModuleCid[16] = {};
  for (int32_t i = 0; i < classes; ++i) {
    PClassInfo ci;
    std::memset(&ci, 0, sizeof(ci));
    if (factory->vtbl->getClassInfo(factory, i, &ci) != 0) continue;
    std::printf("        class %d: \"%s\" category \"%s\"\n", i, ci.name, ci.category);
    if (std::strcmp(ci.category, "Audio Module Class") == 0) {
      foundAudioModule = true;
      std::memcpy(audioModuleCid, ci.cid, 16);
    }
    if (std::strstr(ci.name, "AnalogFoundry") != nullptr ||
        std::strstr(ci.name, "101") != nullptr) {
      check(true, "class name identifies this plugin", ci.name);
    }
  }
  check(foundAudioModule, "advertises an Audio Module Class (what a host loads)");
  if (foundAudioModule) checkParameterIds(factory, audioModuleCid);

  factory->vtbl->release(factory);
  if (exitDll != nullptr) exitDll();
  ::FreeLibrary(module);
  return 0;
}

#endif  // _WIN32

}  // namespace

int main(int argc, char** argv) {
  std::printf("AnalogFoundry 101 - plugin load test (M1)\n\n");
#if defined(_WIN32)
  if (argc < 2) {
    std::printf("  usage: plugin_load_test <path to AnalogFoundry101.vst3 binary>\n");
    return 2;
  }
  std::printf("  module: %s\n", argv[1]);
  runWindows(argv[1]);
  std::printf("\n%d checks, %d failures\n", gChecks, gFailures);
  return gFailures == 0 ? 0 : 1;
#else
  (void)argc;
  (void)argv;
  std::printf("  skipped: this loader is Windows-only\n");
  return 0;
#endif
}
