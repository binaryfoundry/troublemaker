// AnalogFoundry 101's editor: every parameter as text, and the modulation
// matrix in words.
//
// The point is legibility, not a skeuomorphic panel. A packed matrix slot is a
// number like 2,240,449 to the host; here it reads "LFO 1 -> Cutoff +35 %".
// Everything is drawn with NanoVG and DPF's shared font, so the editor needs no
// image or font files of its own.
//
//   drag up/down on a value      change it (Shift: finer)
//   scroll on a value            step it
//   right-click a value          back to its default
//   click a slot's source/dest   next one (right-click: previous)
//   drag a slot's amount bar     set the amount, -100 % .. +100 %
//   right-click a slot           empty it

#include <string>
#include <vector>

#include "DistrhoUI.hpp"
#include "Labels.h"
#include "../model/Preset.h"

START_NAMESPACE_DISTRHO

namespace {

constexpr float kHeader = 46.0f;
constexpr float kMargin = 14.0f;
constexpr float kRow = 21.0f;
constexpr float kColumn = 196.0f;
constexpr int kRowsPerColumn = 19;
constexpr float kMatrixX = kMargin + 3 * kColumn + 18.0f;
constexpr float kMatrixW = DISTRHO_UI_DEFAULT_WIDTH - kMatrixX - kMargin;
constexpr float kSlotH = 48.0f;

bool isSlot(const char* id) { return std::strncmp(id, "mod", 3) == 0 && std::strlen(id) == 4; }

/// Parameters that move in whole steps: choices, switches and counts.
bool isStepped(const char* id) {
  using af::labels::is;
  return is(id, "osc2_wave") || is(id, "osc3_wave") || is(id, "lfo1_wave") || is(id, "lfo2_wave") ||
         is(id, "filter_mode") || is(id, "filter_poles") || is(id, "fenv_separate") || is(id, "legato_glide") || is(id, "unison") ||
         is(id, "voices") || is(id, "osc2_oct") || is(id, "osc3_oct") || is(id, "osc2_semi") || is(id, "osc3_semi");
}

}  // namespace

class AnalogFoundryUI : public UI {
 public:
  AnalogFoundryUI() : UI(DISTRHO_UI_DEFAULT_WIDTH, DISTRHO_UI_DEFAULT_HEIGHT) {
    loadSharedResources();
    const auto& table = af::parameterTable();
    values_.resize(table.size());
    for (size_t i = 0; i < table.size(); ++i) {
      values_[i] = static_cast<float>(table[i].defaultValue);
      if (isSlot(table[i].id)) slots_.push_back(static_cast<uint32_t>(i));
      else rows_.push_back(static_cast<uint32_t>(i));
    }
    const double scale = getScaleFactor();
    if (scale != 1.0) setSize(DISTRHO_UI_DEFAULT_WIDTH * scale, DISTRHO_UI_DEFAULT_HEIGHT * scale);
  }

 protected:
  void parameterChanged(uint32_t index, float value) override {
    if (index >= values_.size() || values_[index] == value) return;
    values_[index] = value;
    repaint();
  }

  void onNanoDisplay() override {
    const float s = scale();
    const auto& table = af::parameterTable();

    beginPath();
    rect(0, 0, getWidth(), getHeight());
    fillColor(24, 25, 28);
    fill();

    fontFace(NANOVG_DEJAVU_SANS_TTF);
    fontSize(17.0f * s);
    textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
    fillColor(235, 168, 64);
    text(kMargin * s, 22.0f * s, "AnalogFoundry 101", nullptr);
    fontSize(12.0f * s);
    fillColor(150, 150, 155);
    text(178.0f * s, 23.0f * s, summary().c_str(), nullptr);

    // Parameters, in the table's order: three columns of name and value.
    fontSize(12.0f * s);
    for (size_t r = 0; r < rows_.size(); ++r) {
      const uint32_t index = rows_[r];
      const auto& d = table[index];
      const float x = (kMargin + static_cast<float>(r / kRowsPerColumn) * kColumn) * s;
      const float y = (kHeader + static_cast<float>(r % kRowsPerColumn) * kRow) * s;
      const float w = (kColumn - 10.0f) * s, h = (kRow - 3.0f) * s;
      const bool active = drag_.kind == Drag::kValue && drag_.index == index;
      beginPath();
      roundedRect(x, y, w, h, 3.0f * s);
      fillColor(active ? 52 : 34, active ? 50 : 35, active ? 44 : 39);
      fill();
      // How far through its range, as a thin bar under the text.
      const float t = static_cast<float>((values_[index] - d.minimum) / (d.maximum - d.minimum));
      beginPath();
      rect(x, y + h - 2.0f * s, w * (t < 0 ? 0 : (t > 1 ? 1 : t)), 2.0f * s);
      fillColor(235, 168, 64, 150);
      fill();
      textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
      fillColor(170, 170, 176);
      text(x + 6.0f * s, y + h * 0.5f, d.name, nullptr);
      textAlign(ALIGN_RIGHT | ALIGN_MIDDLE);
      fillColor(240, 240, 240);
      text(x + w - 6.0f * s, y + h * 0.5f, af::labels::value(d.id, d.unit, values_[index]).c_str(), nullptr);
    }

    // The matrix, in words.
    const float mx = kMatrixX * s, mw = kMatrixW * s;
    textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
    fontSize(13.0f * s);
    fillColor(235, 168, 64);
    text(mx, (kHeader - 10.0f) * s, "Modulation matrix", nullptr);
    fontSize(12.0f * s);
    for (size_t k = 0; k < slots_.size(); ++k) {
      const af::ModSlot m = af::unpackModSlot(values_[slots_[k]]);
      const bool empty = m.source == af::kSrcNone || m.dest == af::kDstNone || m.amount == 0.0;
      const float y = (kHeader + static_cast<float>(k) * kSlotH) * s;
      beginPath();
      roundedRect(mx, y, mw, (kSlotH - 6.0f) * s, 4.0f * s);
      fillColor(34, 35, 39);
      fill();
      char number[4];
      std::snprintf(number, sizeof number, "%d", static_cast<int>(k + 1));
      fillColor(110, 110, 116);
      text(mx + 8.0f * s, y + 12.0f * s, number, nullptr);
      fillColor(empty ? 110 : 240, empty ? 110 : 240, empty ? 116 : 240);
      text(mx + sourceX() * s, y + 12.0f * s, af::labels::kSources[m.source], nullptr);
      fillColor(110, 110, 116);
      text(mx + (destX() - 18.0f) * s, y + 12.0f * s, "->", nullptr);
      fillColor(empty ? 110 : 240, empty ? 110 : 240, empty ? 116 : 240);
      text(mx + destX() * s, y + 12.0f * s, af::labels::kDests[m.dest], nullptr);
      // Amount: a bar from the centre, left for negative, right for positive.
      const float bx = mx + sourceX() * s, bw = mw - (sourceX() + 54.0f) * s, by = y + 26.0f * s;
      beginPath();
      rect(bx, by, bw, 8.0f * s);
      fillColor(46, 47, 52);
      fill();
      const float centre = bx + bw * 0.5f, end = centre + static_cast<float>(m.amount) * bw * 0.5f;
      beginPath();
      rect(end < centre ? end : centre, by, std::fabs(end - centre), 8.0f * s);
      fillColor(m.amount < 0 ? 96 : 235, m.amount < 0 ? 160 : 168, m.amount < 0 ? 230 : 64);
      fill();
      char amount[16];
      std::snprintf(amount, sizeof amount, "%+.0f %%", m.amount * 100.0);
      textAlign(ALIGN_RIGHT | ALIGN_MIDDLE);
      fillColor(200, 200, 205);
      text(mx + mw - 8.0f * s, by + 4.0f * s, amount, nullptr);
      textAlign(ALIGN_LEFT | ALIGN_MIDDLE);
    }
  }

  bool onMouse(const MouseEvent& ev) override {
    if (!ev.press) {
      if (drag_.kind != Drag::kNone) editParameter(drag_.index, false);
      drag_ = Drag{};
      repaint();
      return true;
    }
    const float s = scale();
    const float x = static_cast<float>(ev.pos.getX()) / s, y = static_cast<float>(ev.pos.getY()) / s;
    const bool right = ev.button == kMouseButtonRight;

    int row = -1;
    if (rowAt(x, y, row)) {
      const uint32_t index = rows_[static_cast<size_t>(row)];
      if (right) {
        set(index, static_cast<float>(af::parameterTable()[index].defaultValue), true);
        return true;
      }
      if (ev.button != kMouseButtonLeft) return false;
      drag_ = Drag{Drag::kValue, index, y, values_[index]};
      editParameter(index, true);
      repaint();
      return true;
    }

    int slot = -1;
    if (slotAt(x, y, slot)) {
      const uint32_t index = slots_[static_cast<size_t>(slot)];
      af::ModSlot m = af::unpackModSlot(values_[index]);
      const float local = x - kMatrixX;
      const float top = kHeader + static_cast<float>(slot) * kSlotH;
      if (y - top >= 20.0f) {  // the amount bar
        if (right) {
          set(index, static_cast<float>(af::kModSlotEmpty), true);
          return true;
        }
        drag_ = Drag{Drag::kAmount, index, y, values_[index]};
        editParameter(index, true);
        setAmount(index, x);
        return true;
      }
      const int step = right ? -1 : 1;
      if (local >= destX() - 18.0f) m.dest = (m.dest + step + af::kDstCount) % af::kDstCount;
      else m.source = (m.source + step + af::kSrcCount) % af::kSrcCount;
      // A route just made audible starts at +50 %, so the click is heard.
      if (m.amount == 0.0 && m.source != af::kSrcNone && m.dest != af::kDstNone) m.amount = 0.5;
      set(index, static_cast<float>(af::packModSlot(m.source, m.dest, m.amount)), true);
      return true;
    }
    return false;
  }

  bool onMotion(const MotionEvent& ev) override {
    if (drag_.kind == Drag::kNone) return false;
    const float s = scale();
    const float x = static_cast<float>(ev.pos.getX()) / s, y = static_cast<float>(ev.pos.getY()) / s;
    if (drag_.kind == Drag::kAmount) {
      setAmount(drag_.index, x);
      return true;
    }
    const auto& d = af::parameterTable()[drag_.index];
    const double range = d.maximum - d.minimum;
    const double dy = static_cast<double>(drag_.startY - y);
    double v;
    if (isStepped(d.id)) v = drag_.startValue + std::round(dy / 8.0);
    else v = drag_.startValue + dy / ((ev.mod & kModifierShift) ? 2000.0 : 200.0) * range;
    set(drag_.index, static_cast<float>(v), false);
    return true;
  }

  bool onScroll(const ScrollEvent& ev) override {
    const float s = scale();
    int row = -1;
    if (!rowAt(static_cast<float>(ev.pos.getX()) / s, static_cast<float>(ev.pos.getY()) / s, row)) return false;
    const uint32_t index = rows_[static_cast<size_t>(row)];
    const auto& d = af::parameterTable()[index];
    const double step = isStepped(d.id) ? 1.0 : (d.maximum - d.minimum) / 100.0;
    set(index, static_cast<float>(values_[index] + (ev.delta.getY() > 0 ? step : -step)), true);
    return true;
  }

 private:
  struct Drag {
    enum Kind { kNone, kValue, kAmount } kind = kNone;
    uint32_t index = 0;
    float startY = 0.0f;
    float startValue = 0.0f;
  };

  static float sourceX() { return 24.0f; }
  static float destX() { return 128.0f; }

  float scale() const { return static_cast<float>(getWidth()) / DISTRHO_UI_DEFAULT_WIDTH; }

  bool rowAt(float x, float y, int& row) const {
    if (y < kHeader || x < kMargin || x >= kMargin + 3 * kColumn) return false;
    const int column = static_cast<int>((x - kMargin) / kColumn);
    const int r = static_cast<int>((y - kHeader) / kRow);
    if (r >= kRowsPerColumn) return false;
    row = column * kRowsPerColumn + r;
    return row < static_cast<int>(rows_.size());
  }

  bool slotAt(float x, float y, int& slot) const {
    if (x < kMatrixX || x >= kMatrixX + kMatrixW || y < kHeader) return false;
    slot = static_cast<int>((y - kHeader) / kSlotH);
    return slot < static_cast<int>(slots_.size());
  }

  void setAmount(uint32_t index, float x) {
    af::ModSlot m = af::unpackModSlot(values_[index]);
    const float bx = kMatrixX + sourceX(), bw = kMatrixW - (sourceX() + 54.0f);
    double a = (x - bx) / bw * 2.0 - 1.0;
    a = a < -1.0 ? -1.0 : (a > 1.0 ? 1.0 : a);
    if (std::fabs(a) < 0.02) a = 0.0;  // a detent at the centre
    set(index, static_cast<float>(af::packModSlot(m.source, m.dest, a)), false);
  }

  /// Clamp, store, tell the host. `gesture` wraps a single change in its own edit.
  void set(uint32_t index, float value, bool gesture) {
    const auto& d = af::parameterTable()[index];
    double v = value < d.minimum ? d.minimum : (value > d.maximum ? d.maximum : value);
    if (isStepped(d.id) || isSlot(d.id)) v = std::round(v);
    values_[index] = static_cast<float>(v);
    if (gesture) editParameter(index, true);
    setParameterValue(index, values_[index]);
    if (gesture) editParameter(index, false);
    repaint();
  }

  /// "8 voices · stereo 0.60 · band-pass", from the live values.
  std::string summary() const {
    const auto& table = af::parameterTable();
    double voices = 1, stereo = 0, mode = 0, unison = 1;
    for (size_t i = 0; i < table.size(); ++i) {
      if (af::labels::is(table[i].id, "voices")) voices = values_[i];
      if (af::labels::is(table[i].id, "stereo")) stereo = values_[i];
      if (af::labels::is(table[i].id, "filter_mode")) mode = values_[i];
      if (af::labels::is(table[i].id, "unison")) unison = values_[i];
    }
    char buf[96];
    const long v = std::lround(voices);
    std::snprintf(buf, sizeof buf, "%s  |  unison %ld%s  |  %s  |  0.5", v > 1 ? (std::to_string(v) + " voices").c_str() : "mono",
                  std::lround(unison), stereo > 0 && unison > 1 ? ", stereo" : "",
                  af::labels::kFilterModes[std::lround(mode) < 0 ? 0 : (std::lround(mode) > 2 ? 2 : std::lround(mode))]);
    return buf;
  }

  std::vector<float> values_;
  std::vector<uint32_t> rows_;
  std::vector<uint32_t> slots_;
  Drag drag_;

  DISTRHO_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AnalogFoundryUI)
};

UI* createUI() { return new AnalogFoundryUI(); }

END_NAMESPACE_DISTRHO
