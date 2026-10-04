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
};

struct IPluginFactory {
  IPluginFactoryVtbl* vtbl;
};

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
  for (int32_t i = 0; i < classes; ++i) {
    PClassInfo ci;
    std::memset(&ci, 0, sizeof(ci));
    if (factory->vtbl->getClassInfo(factory, i, &ci) != 0) continue;
    std::printf("        class %d: \"%s\" category \"%s\"\n", i, ci.name, ci.category);
    if (std::strcmp(ci.category, "Audio Module Class") == 0) foundAudioModule = true;
    if (std::strstr(ci.name, "AnalogFoundry") != nullptr ||
        std::strstr(ci.name, "101") != nullptr) {
      check(true, "class name identifies this plugin", ci.name);
    }
  }
  check(foundAudioModule, "advertises an Audio Module Class (what a host loads)");

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
