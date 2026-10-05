// Offline renderer: a patch on the command line, a WAV on disk.
//
// This is the "standalone renderer / command-line test harness" that
// ANALOG_SYNTH_AGENT.md asks the DSP core to stay usable from. It is also how
// the engine reaches Ableton today: the bridge cannot insert plugins, so a
// rendered WAV loaded into Simpler is the working path until the VST3 wrapper
// exists.
//
//   render_note --note 45 --seconds 2.0 --out bass.wav --saw 1.0 --sub 0.6 \
//               --cutoff 600 --res 0.5 --env-cutoff 0.6 --decay 0.3 --sustain 0.2
//
// Writes 24-bit stereo (dual mono) at 48 kHz unless told otherwise.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "../src/model/Preset.h"
#include "../src/model/Synth101.h"
#include "../src/model/Voice101.h"

namespace {

struct Args {
  int note = 45;
  double velocity = 1.0;  ///< 0..1
  double seconds = 2.0;
  double noteSeconds = -1.0;  ///< defaults to 60 % of `seconds`
  double sampleRate = 48000.0;
  double normaliseDbfs = -3.0;
  bool normalise = true;
  std::string out = "render.wav";
  af::Voice101Parameters p{};
  std::vector<int> chord;   ///< extra notes played with `note` (needs --voices > 1)
  double bpm = 0.0;         ///< > 0: the transport plays at this tempo from beat 0
};

bool matches(const char* a, const char* b) { return std::strcmp(a, b) == 0; }

void writeLittleEndian(std::vector<unsigned char>& bytes, unsigned long value, int width) {
  for (int i = 0; i < width; ++i) bytes.push_back((value >> (8 * i)) & 0xFFu);
}

/// 24-bit stereo WAV. 24-bit because the renders feed a sampler and the extra
/// headroom costs nothing offline.
bool writeWav(const std::string& path, const std::vector<double>& left, const std::vector<double>& right,
              double sampleRate) {
  const int channels = 2;
  const int bits = 24;
  const unsigned long frames = static_cast<unsigned long>(left.size());
  const unsigned long dataBytes = frames * channels * (bits / 8);

  std::vector<unsigned char> header;
  const char* riff = "RIFF";
  header.insert(header.end(), riff, riff + 4);
  writeLittleEndian(header, 36 + dataBytes, 4);
  const char* wave = "WAVEfmt ";
  header.insert(header.end(), wave, wave + 8);
  writeLittleEndian(header, 16, 4);          // fmt chunk size
  writeLittleEndian(header, 1, 2);           // PCM
  writeLittleEndian(header, channels, 2);
  writeLittleEndian(header, static_cast<unsigned long>(sampleRate), 4);
  writeLittleEndian(header, static_cast<unsigned long>(sampleRate) * channels * (bits / 8), 4);
  writeLittleEndian(header, channels * (bits / 8), 2);  // block align
  writeLittleEndian(header, bits, 2);
  const char* data = "data";
  header.insert(header.end(), data, data + 4);
  writeLittleEndian(header, dataBytes, 4);

  std::FILE* f = std::fopen(path.c_str(), "wb");
  if (f == nullptr) return false;
  std::fwrite(header.data(), 1, header.size(), f);

  std::vector<unsigned char> body;
  body.reserve(dataBytes);
  for (size_t i = 0; i < left.size(); ++i) {
    for (double sample : {left[i], right[i]}) {
      const double clipped = sample < -1.0 ? -1.0 : (sample > 1.0 ? 1.0 : sample);
      const long value = static_cast<long>(clipped * 8388607.0);
      writeLittleEndian(body, static_cast<unsigned long>(value) & 0xFFFFFFu, 3);
    }
  }
  std::fwrite(body.data(), 1, body.size(), f);
  std::fclose(f);
  return true;
}

void usage() {
  std::printf(
      "render_note - offline render of the AnalogFoundry 101 voice\n\n"
      "  --out FILE        output WAV (default render.wav)\n"
      "  --note N          MIDI note (default 45 = A1, 110 Hz)\n"
      "  --seconds S       total length (default 2.0)\n"
      "  --gate S          how long the key is held (default 60%% of --seconds)\n"
      "  --rate HZ         sample rate (default 48000)\n"
      "  --no-normalise    keep the raw level instead of peaking at -3 dBFS\n\n"
      "  --saw L --pulse L --sub L --noise L     mixer levels 0..1\n"
      "  --pw W            pulse width 0.02..0.98\n"
      "  --octave N        range switch -2..2\n"
      "  --cutoff HZ --res R                     filter\n"
      "  --env-cutoff A    envelope to cutoff 0..1\n"
      "  --lfo-cutoff A --lfo-pitch SEMI --lfo-pw A --lfo-rate HZ\n"
      "  --track A         keyboard tracking 0..1\n"
      "  --attack S --decay S --sustain L --release S\n"
      "  --glide S         portamento time\n"
      "  --preset FILE     load an AF101 preset first; later flags override it\n"
      "  --velocity V      note velocity 0..1 (default 1)\n"
      "  --chord N,N,...   more notes with --note (needs --voices 2..8)\n"
      "  --voices N        1 = mono 101 (default), 2..8 = polyphonic\n"
      "  --stereo S        stereo unison spread 0..1 (needs --unison > 1)\n"
      "  --bpm B           play the transport at B from beat 0 (synced LFOs follow it)\n"
      "  --unison N        unison voices 1..7 (off by default)\n"
      "  --detune CENTS    unison detune: the outermost voices sit at +/- this\n"
      "  --level L         output level\n");
}

}  // namespace

int main(int argc, char** argv) {
  Args a;
  for (int i = 1; i < argc; ++i) {
    const char* k = argv[i];
    auto value = [&]() -> double {
      if (i + 1 >= argc) {
        std::fprintf(stderr, "ERROR: %s needs a value\n", k);
        std::exit(2);
      }
      return std::atof(argv[++i]);
    };
    if (matches(k, "--help") || matches(k, "-h")) { usage(); return 0; }
    else if (matches(k, "--out")) { if (i + 1 >= argc) { usage(); return 2; } a.out = argv[++i]; }
    else if (matches(k, "--note")) a.note = static_cast<int>(value());
    else if (matches(k, "--velocity")) a.velocity = value();
    else if (matches(k, "--preset")) {
      if (i + 1 >= argc) { usage(); return 2; }
      std::FILE* f = std::fopen(argv[++i], "rb");
      if (!f) { std::fprintf(stderr, "cannot read preset %s\n", argv[i]); return 2; }
      std::string text;
      char buf[4096];
      size_t n;
      while ((n = std::fread(buf, 1, sizeof buf, f)) > 0) text.append(buf, n);
      std::fclose(f);
      a.p = af::loadPreset(text);  // later flags still override
    }
    else if (matches(k, "--seconds")) a.seconds = value();
    else if (matches(k, "--gate")) a.noteSeconds = value();
    else if (matches(k, "--rate")) a.sampleRate = value();
    else if (matches(k, "--no-normalise")) a.normalise = false;
    else if (matches(k, "--saw")) a.p.sawLevel = value();
    else if (matches(k, "--pulse")) a.p.pulseLevel = value();
    else if (matches(k, "--sub")) a.p.subLevel = value();
    else if (matches(k, "--noise")) a.p.noiseLevel = value();
    else if (matches(k, "--pw")) a.p.pulseWidth = value();
    else if (matches(k, "--octave")) a.p.octave = static_cast<int>(value());
    else if (matches(k, "--tune")) a.p.tuneSemitones = value();
    else if (matches(k, "--cutoff")) a.p.cutoffHz = value();
    else if (matches(k, "--res")) a.p.resonance = value();
    else if (matches(k, "--env-cutoff")) a.p.envToCutoff = value();
    else if (matches(k, "--lfo-cutoff")) a.p.lfoToCutoff = value();
    else if (matches(k, "--lfo-pitch")) a.p.lfoToPitch = value();
    else if (matches(k, "--lfo-pw")) a.p.lfoToPulseWidth = value();
    else if (matches(k, "--lfo-rate")) a.p.lfoRateHz = value();
    else if (matches(k, "--track")) a.p.keyboardTracking = value();
    else if (matches(k, "--attack")) a.p.attack = value();
    else if (matches(k, "--decay")) a.p.decay = value();
    else if (matches(k, "--sustain")) a.p.sustain = value();
    else if (matches(k, "--release")) a.p.release = value();
    else if (matches(k, "--glide")) a.p.glideSeconds = value();
    else if (matches(k, "--unison")) a.p.unisonVoices = value();
    else if (matches(k, "--detune")) a.p.unisonDetuneCents = value();
    else if (matches(k, "--level")) a.p.outputLevel = value();
    else if (matches(k, "--stereo")) a.p.stereoSpread = value();
    else if (matches(k, "--voices")) a.p.voices = value();
    else if (matches(k, "--bpm")) a.bpm = value();
    else if (matches(k, "--chord")) {
      if (i + 1 >= argc) { usage(); return 2; }
      std::string list = argv[++i];
      size_t pos = 0;
      while (pos < list.size()) {
        const size_t comma = list.find(',', pos);
        a.chord.push_back(std::atoi(list.substr(pos, comma - pos).c_str()));
        if (comma == std::string::npos) break;
        pos = comma + 1;
      }
    }
    else {
      std::fprintf(stderr, "ERROR: unknown option %s (try --help)\n", k);
      return 2;
    }
  }
  if (a.noteSeconds < 0.0) a.noteSeconds = a.seconds * 0.6;

  af::Synth101 voice;
  voice.setSampleRate(a.sampleRate);
  voice.setParameters(a.p);
  voice.reset();
  if (a.bpm > 0.0) voice.setTransport(a.bpm, 0.0, true);
  voice.noteOn(a.note, a.velocity);
  for (int n : a.chord) voice.noteOn(n, a.velocity);

  const long total = static_cast<long>(a.seconds * a.sampleRate);
  const long gate = static_cast<long>(a.noteSeconds * a.sampleRate);
  std::vector<double> out, outR;
  out.reserve(static_cast<size_t>(total));
  outR.reserve(static_cast<size_t>(total));
  double peak = 0.0;
  for (long i = 0; i < total; ++i) {
    if (i == gate) {
      voice.noteOff(a.note);
      for (int n : a.chord) voice.noteOff(n);
    }
    double l, r;
    voice.processStereo(l, r);
    peak = std::fmax(peak, std::fmax(std::fabs(l), std::fabs(r)));
    out.push_back(l);
    outR.push_back(r);
  }

  if (a.normalise && peak > 1.0e-9) {
    const double target = std::pow(10.0, a.normaliseDbfs / 20.0);
    const double gain = target / peak;
    for (double& s : out) s *= gain;
    for (double& s : outR) s *= gain;
    peak = target;
  }

  if (!writeWav(a.out, out, outR, a.sampleRate)) {
    std::fprintf(stderr, "ERROR: could not write %s\n", a.out.c_str());
    return 1;
  }
  // The path goes into JSON: escape backslashes (Windows paths) and quotes.
  std::string outJson;
  for (char ch : a.out) {
    if (ch == '\\' || ch == '"') outJson += '\\';
    outJson += ch;
  }
  std::printf("{\"out\":\"%s\",\"frames\":%ld,\"sample_rate\":%g,\"peak_dbfs\":%.2f}\n",
              outJson.c_str(), static_cast<long>(out.size()), a.sampleRate,
              20.0 * std::log10(peak > 1e-12 ? peak : 1e-12));
  return 0;
}
