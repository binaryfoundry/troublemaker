// AnalogFoundry 101 as an instrument: one to eight Voice101s.
//
// One voice (the default) is the monophonic 101 exactly - every call passes
// straight through to voices_[0], so its output is Voice101's bit for bit, with
// last-note priority, legato, glide and note memory. Two or more voices make it
// polyphonic: each note gets its own voice (a free one, else the one whose note
// is oldest), and the voices are summed. Pitch bend, wheel, pressure and the
// host transport go to every voice.

#pragma once

#include "Voice101.h"

namespace af {

class Synth101 {
 public:
  static constexpr int kMaxVoices = 8;

  void setSampleRate(double sr) noexcept {
    for (auto& v : voices_) v.setSampleRate(sr);
  }
  void setQuality(Quality q) noexcept {
    for (auto& v : voices_) v.setQuality(q);
  }
  void setVariation(const AnalogVariation& a) noexcept {
    for (auto& v : voices_) v.setVariation(a);
  }
  void setParameters(const Voice101Parameters& p) noexcept {
    long n = std::lround(p.voices);
    n = n < 1 ? 1 : (n > kMaxVoices ? kMaxVoices : n);
    if (n != count_) {
      // Changing the voice count releases what is playing on the voices that go.
      for (int i = static_cast<int>(n); i < kMaxVoices; ++i) voices_[i].allNotesOff();
      count_ = static_cast<int>(n);
    }
    for (auto& v : voices_) v.setParameters(p);
  }
  void reset() noexcept {
    for (auto& v : voices_) v.reset();
    for (auto& a : age_) a = 0;
    clock_ = 0;
  }

  void noteOn(int note, double velocity = 1.0) noexcept {
    if (count_ == 1) {
      voices_[0].noteOn(note, velocity);
      return;
    }
    // The same note again restarts its own voice; otherwise a silent voice; else
    // the voice whose note started longest ago.
    int pick = -1;
    for (int i = 0; i < count_ && pick < 0; ++i)
      if (voices_[i].currentNote() == note) pick = i;
    for (int i = 0; i < count_ && pick < 0; ++i)
      if (!voices_[i].isActive()) pick = i;
    if (pick < 0) {
      pick = 0;
      for (int i = 1; i < count_; ++i)
        if (age_[i] < age_[pick]) pick = i;
      voices_[pick].allNotesOff();  // a stolen voice starts its note fresh
    }
    age_[pick] = ++clock_;
    voices_[pick].noteOn(note, velocity);
  }

  void noteOff(int note) noexcept {
    if (count_ == 1) {
      voices_[0].noteOff(note);
      return;
    }
    for (int i = 0; i < count_; ++i)
      if (voices_[i].currentNote() == note) voices_[i].noteOff(note);
  }

  void allNotesOff() noexcept {
    for (auto& v : voices_) v.allNotesOff();
  }
  void allSoundOff() noexcept {
    for (auto& v : voices_) v.allSoundOff();
  }
  void setPitchBend(double b) noexcept {
    for (auto& v : voices_) v.setPitchBend(b);
  }
  void setModWheel(double w) noexcept {
    for (auto& v : voices_) v.setModWheel(w);
  }
  void setAftertouch(double a) noexcept {
    for (auto& v : voices_) v.setAftertouch(a);
  }
  void setTransport(double bpm, double beat, bool playing) noexcept {
    for (auto& v : voices_) v.setTransport(bpm, beat, playing);
  }

  double process() noexcept {
    if (count_ == 1) return voices_[0].process();
    double sum = 0.0;
    for (int i = 0; i < count_; ++i)
      if (voices_[i].isActive()) sum += voices_[i].process();
    return sum;
  }

  void processStereo(double& left, double& right) noexcept {
    if (count_ == 1) {
      voices_[0].processStereo(left, right);
      return;
    }
    left = right = 0.0;
    for (int i = 0; i < count_; ++i) {
      if (!voices_[i].isActive()) continue;
      double l, r;
      voices_[i].processStereo(l, r);
      left += l;
      right += r;
    }
  }

  int voiceCount() const noexcept { return count_; }
  int activeVoices() const noexcept {
    int n = 0;
    for (int i = 0; i < count_; ++i) n += voices_[i].isActive() ? 1 : 0;
    return n;
  }
  const Voice101& voice(int i) const noexcept { return voices_[i]; }

 private:
  Voice101 voices_[kMaxVoices]{};
  unsigned long age_[kMaxVoices]{};
  unsigned long clock_ = 0;
  int count_ = 1;
};

}  // namespace af
