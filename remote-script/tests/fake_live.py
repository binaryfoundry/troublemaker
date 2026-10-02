# -*- coding: utf-8 -*-
"""A fake Live Object Model.

Enough of Live's API surface to run the real handlers outside Ableton. It
models the behaviour the handlers actually depend on, including the parts
that bite: attribute access on a deleted object raises RuntimeError, and the
Live 11 note API hands out note objects carrying ids.
"""

import sys
import types


class Removed(RuntimeError):
    """What Live raises when you touch an object the user deleted."""


class LiveObject(object):
    def __init__(self, parent=None):
        self._alive = True
        self._parent = parent
        self._live_ptr = next(_pointers)

    def _check(self):
        if not self._alive:
            raise Removed("Call to a removed/deleted object")

    @property
    def canonical_parent(self):
        self._check()
        return self._parent

    def _destroy(self):
        self._alive = False


def _pointer_source():
    value = 1000
    while True:
        value += 8
        yield value


_pointers = _pointer_source()


class DeviceParameter(LiveObject):
    def __init__(self, name, value, minimum, maximum, parent=None, quantized=False, unit="",
                 display=None):
        LiveObject.__init__(self, parent)
        self._display = display
        self._name = name
        self._value = float(value)
        self.min = float(minimum)
        self.max = float(maximum)
        self.is_quantized = quantized
        self.is_enabled = True
        self.unit = unit

    @property
    def name(self):
        self._check()
        return self._name

    @property
    def original_name(self):
        return self._name

    @property
    def value(self):
        self._check()
        return self._value

    @value.setter
    def value(self, new_value):
        self._check()
        if new_value < self.min or new_value > self.max:
            raise RuntimeError("value out of range")
        self._value = float(new_value)

    def str_for_value(self, value):
        if self._display is not None:
            return self._display(value)
        return "%.2f %s" % (value, self.unit) if self.unit else "%.2f" % (value,)


class MixerDevice(LiveObject):
    def __init__(self, parent, send_count=1):
        LiveObject.__init__(self, parent)
        self.volume = DeviceParameter("Volume", 0.85, 0.0, 1.0, self, unit="dB")
        self.panning = DeviceParameter("Pan", 0.0, -1.0, 1.0, self)
        self.sends = [
            DeviceParameter("Send %s" % chr(65 + i), 0.0, 0.0, 1.0, self)
            for i in range(send_count)
        ]


class Device(LiveObject):
    def __init__(self, name, class_name, parameters, parent=None):
        LiveObject.__init__(self, parent)
        self._name = name
        self.class_name = class_name
        self.type = 1
        self.is_active = True
        self.parameters = parameters
        for parameter in parameters:
            parameter._parent = self

    @property
    def name(self):
        self._check()
        return self._name


def auto_filter(parent=None):
    return Device(
        "Auto Filter",
        "AutoFilter",
        [
            DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True),
            DeviceParameter("Frequency", 1200.0, 30.0, 19999.0, unit="Hz"),
            DeviceParameter("Resonance", 0.3, 0.0, 1.25),
            DeviceParameter("Drive", 0.0, 0.0, 24.0, unit="dB"),
        ],
        parent,
    )


def _db_display(lo, hi):
    """Normalized 0..1 native value shown as a linear dB range - the way
    many Live parameters store values internally."""
    return lambda v: "%.1f dB" % (lo + (hi - lo) * v)


def _hz_display(lo, hi):
    def show(v):
        hz = lo * (hi / lo) ** v
        return "%.2f kHz" % (hz / 1000.0) if hz >= 1000 else "%.1f Hz" % (hz,)
    return show


def _ms_display(lo, hi):
    return lambda v: "%.2f ms" % (lo * (hi / lo) ** v)


def master_chain():
    """Utility -> EQ Eight -> Glue -> Saturator -> Limiter, Live 11 style:
    the Limiter has no True Peak mode."""
    utility = Device("Utility", "StereoGain", [
        DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True),
        DeviceParameter("Gain", 0.5, 0.0, 1.0, display=_db_display(-35.0, 35.0)),
        DeviceParameter("Stereo Width", 0.25, 0.0, 1.0,
                        display=lambda v: "%.0f %%" % (v * 400.0)),
    ])
    eq_params = [DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True)]
    for band in range(1, 9):
        eq_params.append(DeviceParameter("%d Filter On A" % band, 0.0, 0.0, 1.0, quantized=True,
                                         display=lambda v: "On" if v else "Off"))
        eq_params.append(DeviceParameter("%d Frequency A" % band, 0.5, 0.0, 1.0,
                                         display=_hz_display(10.0, 22000.0)))
        eq_params.append(DeviceParameter("%d Gain A" % band, 0.0, -15.0, 15.0, unit="dB"))
    eq = Device("EQ Eight", "Eq8", eq_params)
    glue = Device("Glue Compressor", "GlueCompressor", [
        DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True),
        DeviceParameter("Threshold", 1.0, 0.0, 1.0, display=_db_display(-40.0, 0.0)),
        DeviceParameter("Ratio", 0.0, 0.0, 2.0, quantized=True,
                        display=lambda v: ["2", "4", "10"][int(round(v))]),
        DeviceParameter("Attack", 3.0, 0.0, 5.0, quantized=True,
                        display=lambda v: ["0.01 ms", "0.1 ms", "0.3 ms", "1.00 ms", "3.00 ms",
                                           "10.0 ms"][int(round(v))] if v < 5 else "30.0 ms"),
        DeviceParameter("Range", 1.0, 0.0, 1.0, display=_db_display(-70.0, 0.0)),
        # Live 12 shows release as bare seconds and 'A' (auto) at the top.
        DeviceParameter("Release", 0.5, 0.0, 1.0,
                        display=lambda v: "A" if v > 0.95 else ("%.1f" % (0.1 + v * 1.1)).lstrip("0")),
        DeviceParameter("Makeup", 0.0, 0.0, 1.0, display=_db_display(0.0, 20.0)),
        DeviceParameter("Dry/Wet", 1.0, 0.0, 1.0, display=lambda v: "%.0f %%" % (v * 100)),
    ])
    saturator = Device("Saturator", "Saturator", [
        DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True),
        DeviceParameter("Drive", 0.0, -36.0, 36.0, unit="dB"),
        DeviceParameter("Output", 0.0, -36.0, 0.0, unit="dB"),
        DeviceParameter("Dry/Wet", 1.0, 0.0, 1.0, display=lambda v: "%.0f %%" % (v * 100)),
    ])
    limiter = Device("Limiter", "Limiter", [
        DeviceParameter("Mode", 0.0, 0.0, 1.0, quantized=True,
                        display=lambda v: "True Peak" if v >= 0.5 else "Standard"),
        DeviceParameter("Device On", 1.0, 0.0, 1.0, quantized=True),
        DeviceParameter("Gain", 0.0, 0.0, 1.0, display=_db_display(0.0, 24.0)),
        DeviceParameter("Ceiling", 1.0, 0.0, 1.0, display=_db_display(-24.0, 0.0)),
        DeviceParameter("Release", 0.5, 0.0, 1.0, display=_ms_display(1.0, 3000.0)),
        DeviceParameter("Rate", 0.5, 0.0, 1.0,
                        display=lambda v: ["8", "4", "2", "1", "1/2", "1/4", "1/8", "1/16",
                                           "1/32", "1/64"][min(9, int(v * 10))]),
    ])
    return [utility, eq, glue, saturator, limiter]


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------


class MidiNoteSpecification(object):
    def __init__(self, pitch=60, start_time=0.0, duration=1.0, velocity=100.0, mute=False,
                 probability=1.0):
        self.pitch = pitch
        self.start_time = start_time
        self.duration = duration
        self.velocity = velocity
        self.mute = mute
        self.probability = probability


class MidiNote(object):
    def __init__(self, note_id, pitch, start_time, duration, velocity, mute, probability=1.0):
        self.note_id = note_id
        self.pitch = pitch
        self.start_time = start_time
        self.duration = duration
        self.velocity = velocity
        self.mute = mute
        self.probability = probability
        self.velocity_deviation = 0.0
        self.release_velocity = 64.0


class Clip(LiveObject):
    def __init__(self, length, parent=None, name="", is_midi=True):
        LiveObject.__init__(self, parent)
        self._name = name
        self.is_midi_clip = is_midi
        self.length = float(length)
        self.start_marker = 0.0
        self.end_marker = float(length)
        self.looping = True
        self.loop_start = 0.0
        self.loop_end = float(length)
        self.is_playing = False
        self.signature_numerator = 4
        self.signature_denominator = 4
        self._notes = []
        self._next_note_id = 1
        self._envelopes = {}

    @property
    def name(self):
        self._check()
        return self._name

    @name.setter
    def name(self, value):
        self._check()
        self._name = value

    # -- Live 11 note API --------------------------------------------------

    def get_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        self._check()
        return [
            note
            for note in self._notes
            if from_pitch <= note.pitch < from_pitch + pitch_span
            and from_time <= note.start_time < from_time + time_span
        ]

    def add_new_notes(self, specifications):
        self._check()
        for spec in specifications:
            self._notes.append(
                MidiNote(
                    self._next_note_id,
                    spec.pitch,
                    spec.start_time,
                    spec.duration,
                    spec.velocity,
                    spec.mute,
                    getattr(spec, "probability", 1.0),
                )
            )
            self._next_note_id += 1

    def apply_note_modifications(self, notes):
        self._check()
        by_id = {note.note_id: note for note in notes}
        for index, existing in enumerate(self._notes):
            replacement = by_id.get(existing.note_id)
            if replacement is not None:
                self._notes[index] = replacement

    def remove_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        self._check()
        self._notes = [
            note
            for note in self._notes
            if not (
                from_pitch <= note.pitch < from_pitch + pitch_span
                and from_time <= note.start_time < from_time + time_span
            )
        ]

    # -- automation --------------------------------------------------------

    def automation_envelope(self, parameter):
        self._check()
        return self._envelopes.get(parameter._live_ptr)

    def create_automation_envelope(self, parameter):
        self._check()
        envelope = AutomationEnvelope(parameter)
        self._envelopes[parameter._live_ptr] = envelope
        return envelope


class AutomationEnvelope(object):
    def __init__(self, parameter):
        self.parameter = parameter
        self.steps = []

    def insert_step(self, time, length, value):
        self.steps.append((time, length, value))

    def value_at_time(self, time):
        best = self.parameter.value
        for start, length, value in self.steps:
            if start <= time < start + length:
                best = value
        return best

    def clear(self):
        self.steps = []

    def clear_range(self, start, end):
        self.steps = [s for s in self.steps if not (start <= s[0] < end)]


class ClipSlot(LiveObject):
    def __init__(self, parent=None):
        LiveObject.__init__(self, parent)
        self.clip = None
        self.has_stop_button = True

    @property
    def has_clip(self):
        self._check()
        return self.clip is not None

    def create_clip(self, length):
        self._check()
        if self.clip is not None:
            raise RuntimeError("slot already holds a clip")
        self.clip = Clip(length, self)

    def delete_clip(self):
        self._check()
        if self.clip is None:
            raise RuntimeError("slot is empty")
        self.clip._destroy()
        self.clip = None

    def fire(self, record_length=None):
        self._check()
        if record_length is not None:
            # Recording into an empty slot: the clip appears and records.
            track = self._parent
            if self.clip is None and track is not None and track.arm:
                self.clip = Clip(record_length, self, is_midi=not track.has_midi_input is False)
                self.clip.is_midi_clip = bool(track.has_midi_input)
                self.clip.is_recording = True
                self.clip.file_path = "C:/Samples/Recorded/capture-%d.wav" % (self.clip._live_ptr,)
            return
        if self.clip is not None:
            self.clip.is_playing = True

    @property
    def is_triggered(self):
        return False


class RoutingType(object):
    def __init__(self, display_name):
        self.display_name = display_name


class TrackView(object):
    def __init__(self, track):
        self.track = track
        self.selected_device = track.devices[0] if track.devices else None


class Track(LiveObject):
    def __init__(self, name, is_midi=True, slots=8, devices=None, parent=None, sends=1):
        LiveObject.__init__(self, parent)
        self._name = name
        self.has_midi_input = is_midi
        self.clip_slots = [ClipSlot(self) for _ in range(slots)]
        self.devices = devices or []
        for device in self.devices:
            device._parent = self
        self.mixer_device = MixerDevice(self, sends)
        self.mute = False
        self.solo = False
        self.arm = False
        self.can_be_armed = slots > 0
        self.arrangement_clips = []
        self.current_monitoring_state = 1
        self.available_input_routing_types = (
            [RoutingType("Ext. In"), RoutingType("Resampling"), RoutingType("No Input")]
            if not is_midi else [RoutingType("All Ins"), RoutingType("No Input")]
        )
        self.input_routing_type = self.available_input_routing_types[0]
        self.output_meter_left = 0.42
        self.output_meter_right = 0.40
        self.output_meter_level = 0.42
        self.is_grouped = False
        self.color_index = 1
        self.view = TrackView(self)

    @property
    def name(self):
        self._check()
        return self._name

    @name.setter
    def name(self, value):
        self._check()
        self._name = value

    def duplicate_clip_to_arrangement(self, clip, time):
        self._check()
        placed = Clip(clip.length, self, name=clip.name, is_midi=clip.is_midi_clip)
        placed.start_time = float(time)
        placed.end_time = float(time) + clip.length
        self.arrangement_clips.append(placed)

    def delete_clip(self, clip):
        self.arrangement_clips = [c for c in self.arrangement_clips if c is not clip]

    def stop_all_clips(self):
        self._check()
        for slot in self.clip_slots:
            if slot.clip is not None:
                slot.clip.is_playing = False


class Scene(LiveObject):
    def __init__(self, name, parent=None):
        LiveObject.__init__(self, parent)
        self._name = name
        self.is_empty = True
        self.is_triggered = False
        self.tempo = -1.0

    @property
    def name(self):
        self._check()
        return self._name

    @name.setter
    def name(self, value):
        self._check()
        self._name = value

    def fire(self):
        self.is_triggered = True


class SongView(object):
    def __init__(self, song):
        self.song = song
        self.selected_track = song.tracks[0] if song.tracks else None
        self.selected_scene = song.scenes[0] if song.scenes else None
        self.highlighted_clip_slot = (
            self.selected_track.clip_slots[0] if self.selected_track else None
        )


class Song(LiveObject):
    """A small but realistic Set: a MIDI drum track, a bass with a filter,
    an audio track, one return and a master."""

    def __init__(self):
        LiveObject.__init__(self)
        self.tempo = 124.0
        self.signature_numerator = 4
        self.signature_denominator = 4
        self.is_playing = False
        self.record_mode = False
        self.current_song_time = 0.0
        self.metronome = False
        self.loop = False
        self.can_undo = True
        self.can_redo = False

        drums = Track("Drums", is_midi=True, parent=self)
        bass = Track("Bass", is_midi=True, devices=[auto_filter()], parent=self)
        audio = Track("Vocal", is_midi=False, parent=self)
        self.tracks = [drums, bass, audio]
        self.return_tracks = [Track("A Reverb", is_midi=False, slots=0, parent=self)]
        self.master_track = Track("Master", is_midi=False, slots=0, parent=self,
                                  devices=master_chain())
        self.scenes = [Scene("Intro", self), Scene("Drop", self)]
        self.view = SongView(self)

        # Give the bass a straight eighth-note figure to edit.
        bass.clip_slots[0].create_clip(4.0)
        clip = bass.clip_slots[0].clip
        clip.name = "Bass Main"
        specs = [
            MidiNoteSpecification(pitch=41, start_time=i * 0.5, duration=0.45, velocity=100)
            for i in range(8)
        ]
        clip.add_new_notes(specs)

        self.undo_calls = 0
        self.redo_calls = 0

    def create_midi_track(self, index):
        self._check()
        if len(self.tracks) >= 16:
            raise RuntimeError("Live Intro supports at most 16 tracks")
        self.tracks.insert(index, Track("%d-MIDI" % (index + 1), is_midi=True, parent=self))

    def create_return_track(self):
        self._check()
        self.return_tracks.append(Track("%s-Return" % chr(65 + len(self.return_tracks)),
                                        is_midi=False, slots=0, parent=self))

    def create_audio_track(self, index):
        self._check()
        if len(self.tracks) >= 16:
            raise RuntimeError("Live Intro supports at most 16 tracks")
        self.tracks.insert(index, Track("%d-Audio" % (index + 1), is_midi=False, parent=self))

    def create_scene(self, index):
        self._check()
        position = len(self.scenes) if index == -1 else index
        self.scenes.insert(position, Scene("%d" % (position + 1), self))

    def start_playing(self):
        self.is_playing = True

    def stop_playing(self):
        self.is_playing = False

    def continue_playing(self):
        self.is_playing = True

    def stop_all_clips(self):
        for track in self.tracks:
            track.stop_all_clips()

    def undo(self):
        self.undo_calls += 1

    def redo(self):
        self.redo_calls += 1


# ---------------------------------------------------------------------------
# Wrappers - real Live returns a NEW Python object on every attribute access
# ---------------------------------------------------------------------------


def _unwrap(value):
    return object.__getattribute__(value, "_target") if isinstance(value, Wrapper) else value


def _wrap(value):
    if isinstance(value, LiveObject):
        return Wrapper(value)
    if isinstance(value, list):
        return [_wrap(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_wrap(v) for v in value)
    return value


class Wrapper(object):
    """A transient proxy, so code that compares wrappers with `is` or relies
    on id() breaks here exactly as it would inside Live."""

    def __init__(self, target):
        object.__setattr__(self, "_target", target)

    def __getattr__(self, name):
        value = getattr(object.__getattribute__(self, "_target"), name)
        if callable(value) and not isinstance(value, LiveObject):
            def call(*args, **kwargs):
                args = [_unwrap(a) for a in args]
                kwargs = dict((k, _unwrap(v)) for k, v in kwargs.items())
                return _wrap(value(*args, **kwargs))
            return call
        return _wrap(value)

    def __setattr__(self, name, value):
        setattr(object.__getattribute__(self, "_target"), name, _unwrap(value))

    def __eq__(self, other):
        return _unwrap(self) is _unwrap(other)

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return hash(id(_unwrap(self)))


# ---------------------------------------------------------------------------
# Module stubs, installed before the Remote Script is imported
# ---------------------------------------------------------------------------


class _Application(object):
    def get_major_version(self):
        return 11

    def get_minor_version(self):
        return 3

    def get_bugfix_version(self):
        return 21


def install_stubs():
    """Put fake 'Live' and '_Framework' modules on sys.path."""
    live = types.ModuleType("Live")

    clip_module = types.ModuleType("Live.Clip")
    clip_module.Clip = Clip
    clip_module.MidiNoteSpecification = MidiNoteSpecification
    clip_module.MidiNote = MidiNote

    application_module = types.ModuleType("Live.Application")
    application_module.get_application = lambda: _Application()

    track_module = types.ModuleType("Live.Track")
    track_module.Track = Track

    live.Clip = clip_module
    live.Application = application_module
    live.Track = track_module
    sys.modules["Live.Track"] = track_module

    sys.modules["Live"] = live
    sys.modules["Live.Clip"] = clip_module
    sys.modules["Live.Application"] = application_module

    framework = types.ModuleType("_Framework")
    control_surface_module = types.ModuleType("_Framework.ControlSurface")

    class ControlSurface(object):
        def __init__(self, c_instance):
            self._c_instance = c_instance

        def song(self):
            return self._c_instance.song()

        def component_guard(self):
            class _Guard(object):
                def __enter__(self_inner):
                    return None

                def __exit__(self_inner, *args):
                    return False

            return _Guard()

        def show_message(self, message):
            pass

        def update_display(self):
            pass

        def disconnect(self):
            pass

    control_surface_module.ControlSurface = ControlSurface
    framework.ControlSurface = control_surface_module
    sys.modules["_Framework"] = framework
    sys.modules["_Framework.ControlSurface"] = control_surface_module
    return live
