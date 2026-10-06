# -*- coding: utf-8 -*-
"""Live Object Model access: stable handles, liveness checks, serialization.

Track/scene/device indices in Live are *positional* - inserting a track
renumbers everything after it - and names are mutable and non-unique. The
agent must never key off either. This module hands out monotonically
increasing integer handles that stay attached to one Live object for as long
as that object exists, and refuses to resolve a handle whose object is gone.
"""

from . import errors


def is_alive(obj):
    """True if the Live object still exists.

    Live raises RuntimeError on any attribute access against an object the
    user has deleted, so a cheap probe is the only reliable test.
    """
    if obj is None:
        return False
    try:
        obj.canonical_parent
        return True
    except AttributeError:
        pass
    except Exception:
        return False
    try:
        obj.name
        return True
    except Exception:
        return False


def _identity_key(obj):
    """A key that is stable for the lifetime of one Live object.

    Must not depend on the Python wrapper: Live creates a new one on every
    access. _live_ptr is the address of the underlying C++ object.
    """
    try:
        ptr = obj._live_ptr
        if ptr:
            return ("ptr", int(ptr))
    except Exception:
        pass
    return ("id", id(obj))


def same(a, b):
    """True if two wrappers refer to the same Live object."""
    if a is None or b is None:
        return False
    return a is b or _identity_key(a) == _identity_key(b)


def contains(collection, obj):
    return any(same(item, obj) for item in collection)


def index_of(collection, obj):
    """Position of obj in collection by underlying object, or -1."""
    for index, item in enumerate(collection):
        if same(item, obj):
            return index
    return -1


class ObjectRegistry(object):
    """Bidirectional map between integer handles and Live objects."""

    def __init__(self):
        self._by_key = {}
        self._by_handle = {}
        self._next_handle = 1

    def handle_for(self, obj):
        if obj is None:
            return None
        key = _identity_key(obj)
        handle = self._by_key.get(key)
        if handle is not None:
            # Live returns a fresh Python wrapper on every attribute access,
            # so identity of the wrapper means nothing; the underlying object
            # pointer is what is stable. Keep the newest wrapper.
            self._by_handle[handle] = obj
            return handle
        handle = self._next_handle
        self._next_handle += 1
        self._by_key[key] = handle
        self._by_handle[handle] = obj
        return handle

    def resolve(self, handle):
        """Return the live object for a handle, or None if unknown/dead."""
        obj = self._by_handle.get(handle)
        if obj is None:
            return None
        if not is_alive(obj):
            self._forget(handle)
            return None
        return obj

    def _forget(self, handle):
        obj = self._by_handle.pop(handle, None)
        if obj is not None:
            self._by_key.pop(_identity_key(obj), None)

    def prune(self):
        """Drop handles whose objects Live has destroyed."""
        for handle in list(self._by_handle.keys()):
            if not is_alive(self._by_handle[handle]):
                self._forget(handle)


# ---------------------------------------------------------------------------
# Resolution helpers
# ---------------------------------------------------------------------------


def all_tracks(song):
    return tuple(song.tracks) + tuple(song.return_tracks) + (song.master_track,)


def track_kind(track, song):
    if contains(song.return_tracks, track):
        return "return"
    if same(track, song.master_track):
        return "master"
    if track.has_midi_input:
        return "midi"
    return "audio"


def resolve_track(ctx, track_id):
    """Resolve a track handle, with an actionable error listing real tracks."""
    track = ctx.registry.resolve(track_id)
    if track is None or not contains(all_tracks(ctx.song), track):
        raise errors.TrackNotFound(
            "No track with id %r exists in this Live Set." % (track_id,),
            available_tracks=[
                {"track_id": ctx.registry.handle_for(t), "name": t.name}
                for t in all_tracks(ctx.song)
            ],
        )
    return track


def resolve_midi_track(ctx, track_id):
    track = resolve_track(ctx, track_id)
    if not track.has_midi_input:
        raise errors.NotAMidiTrack(
            "Track '%s' is an audio track; it cannot hold MIDI clips." % (track.name,)
        )
    return track


def resolve_clip_slot(ctx, track_id, clip_slot):
    track = resolve_track(ctx, track_id)
    try:
        slots = list(track.clip_slots)
    except Exception:
        raise errors.ClipSlotNotFound(
            "Track '%s' has no clip slots (the master track has none)." % (track.name,)
        )
    if not isinstance(clip_slot, int) or clip_slot < 0 or clip_slot >= len(slots):
        raise errors.ClipSlotNotFound(
            "Track '%s' has %d clip slots; slot %r is out of range."
            % (track.name, len(slots), clip_slot),
            slot_count=len(slots),
        )
    return track, slots[clip_slot]


def resolve_clip(ctx, track_id, clip_slot):
    track, slot = resolve_clip_slot(ctx, track_id, clip_slot)
    if not slot.has_clip:
        raise errors.ClipNotFound(
            "Track '%s' clip slot %d is empty." % (track.name, clip_slot),
            occupied_slots=[i for i, s in enumerate(track.clip_slots) if s.has_clip],
        )
    return track, slot, slot.clip


def resolve_arrangement_clip(ctx, track_id, index):
    """The index-th clip on the track's Arrangement timeline, in the order
    live.get_arrangement_clips reports.

    Editing an Arrangement clip in place keeps any edit made only there, which
    clearing and re-placing from the Session clip would overwrite.
    """
    track = resolve_track(ctx, track_id)
    clips = safe(lambda: list(track.arrangement_clips), None)
    if clips is None:
        raise errors.Unsupported("This Live version does not expose Arrangement clips.")
    if isinstance(index, bool) or not isinstance(index, int):
        raise errors.InvalidArgument("'arrangement_index' must be an integer.")
    if index < 0 or index >= len(clips):
        raise errors.ClipNotFound(
            "Track '%s' has %d Arrangement clips; index %d is out of range."
            % (track.name, len(clips), index),
            clip_count=len(clips),
        )
    return track, clips[index]


def resolve_clip_ref(ctx, args, midi=False):
    """A clip named by 'clip_slot' (Session) or 'arrangement_index'
    (Arrangement) - exactly one. Returns (track, clip, ref) where ref echoes
    the address for the response."""
    track_id = args.get("track_id")
    has_slot = args.get("clip_slot") is not None
    has_arr = args.get("arrangement_index") is not None
    if has_slot == has_arr:
        raise errors.InvalidArgument(
            "Give 'clip_slot' (Session) or 'arrangement_index' (Arrangement), not both."
        )
    if has_arr:
        track, clip = resolve_arrangement_clip(ctx, track_id, args["arrangement_index"])
        ref = {"arrangement_index": args["arrangement_index"]}
        where = "Arrangement clip %d" % (args["arrangement_index"],)
    else:
        track, _slot, clip = resolve_clip(ctx, track_id, args["clip_slot"])
        ref = {"clip_slot": args["clip_slot"]}
        where = "clip slot %d" % (args["clip_slot"],)
    if midi and not clip.is_midi_clip:
        raise errors.NotAMidiClip(
            "Track '%s' %s holds an audio clip; note editing needs a MIDI clip."
            % (track.name, where)
        )
    return track, clip, ref


def resolve_midi_clip(ctx, track_id, clip_slot):
    track, slot, clip = resolve_clip(ctx, track_id, clip_slot)
    if not clip.is_midi_clip:
        raise errors.NotAMidiClip(
            "Track '%s' clip slot %d holds an audio clip; note editing needs a MIDI clip."
            % (track.name, clip_slot)
        )
    return track, slot, clip


def resolve_scene(ctx, scene_id):
    scene = ctx.registry.resolve(scene_id)
    if scene is None or not contains(ctx.song.scenes, scene):
        raise errors.SceneNotFound(
            "No scene with id %r exists in this Live Set." % (scene_id,),
            available_scenes=[
                {"scene_id": ctx.registry.handle_for(s), "name": s.name}
                for s in ctx.song.scenes
            ],
        )
    return scene


def resolve_device(ctx, track_id, device_id):
    track = resolve_track(ctx, track_id)
    device = ctx.registry.resolve(device_id)
    if device is None or not contains(track.devices, device):
        raise errors.DeviceNotFound(
            "Track '%s' has no device with id %r." % (track.name, device_id),
            available_devices=[
                {"device_id": ctx.registry.handle_for(d), "name": d.name}
                for d in track.devices
            ],
        )
    return track, device


def resolve_parameter(ctx, track_id, device_id, parameter_id=None, parameter_name=None):
    track, device = resolve_device(ctx, track_id, device_id)
    params = tuple(device.parameters)
    if parameter_id is not None:
        param = ctx.registry.resolve(parameter_id)
        if param is not None and contains(params, param):
            return track, device, param
    if parameter_name is not None:
        wanted = str(parameter_name).strip().lower()
        for p in params:
            if p.name.strip().lower() == wanted:
                return track, device, p
        for p in params:
            if wanted in p.name.strip().lower():
                return track, device, p
    wanted_repr = parameter_name if parameter_name is not None else parameter_id
    raise errors.ParameterNotFound(
        "Device '%s' does not expose a parameter matching %r." % (device.name, wanted_repr),
        available_parameters=[p.name for p in params],
    )


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def serialize_parameter(ctx, param):
    """Normalized parameter view: native value plus a 0..1 normalized value."""
    minimum = safe(lambda: float(param.min), 0.0)
    maximum = safe(lambda: float(param.max), 1.0)
    value = safe(lambda: float(param.value), 0.0)
    span = maximum - minimum
    normalized = (value - minimum) / span if span else 0.0
    return {
        "parameter_id": ctx.registry.handle_for(param),
        "name": safe(lambda: param.name, "?"),
        "original_name": safe(lambda: param.original_name, None),
        "value": value,
        "normalized": round(normalized, 6),
        "min": minimum,
        "max": maximum,
        "is_quantized": safe(lambda: bool(param.is_quantized), False),
        "display_value": safe(lambda: str(param.str_for_value(param.value)), None),
        "display_min": safe(lambda: str(param.str_for_value(param.min)), None),
        "display_max": safe(lambda: str(param.str_for_value(param.max)), None),
        # 'overridden' means a write switched this parameter's automation off
        # until live.re_enable_automation; Back to Arrangement does not undo it.
        "automation_state": _AUTOMATION_STATES.get(safe(lambda: int(param.automation_state), None)),
    }


_AUTOMATION_STATES = {0: "none", 1: "playing", 2: "overridden"}


def serialize_device(ctx, device, with_parameters=False):
    out = {
        "device_id": ctx.registry.handle_for(device),
        "name": safe(lambda: device.name, "?"),
        "class_name": safe(lambda: device.class_name, None),
        "type": safe(lambda: str(device.type), None),
        "is_active": safe(lambda: bool(device.is_active), True),
        "parameter_count": safe(lambda: len(device.parameters), 0),
    }
    if with_parameters:
        out["parameters"] = [
            serialize_parameter(ctx, p) for p in safe(lambda: list(device.parameters), [])
        ]
    return out


def serialize_clip(ctx, clip, slot_index=None):
    out = {
        "clip_id": ctx.registry.handle_for(clip),
        "name": safe(lambda: clip.name, ""),
        "is_midi_clip": safe(lambda: bool(clip.is_midi_clip), False),
        "length_beats": safe(lambda: float(clip.length), 0.0),
        "start_marker": safe(lambda: float(clip.start_marker), 0.0),
        "end_marker": safe(lambda: float(clip.end_marker), 0.0),
        "looping": safe(lambda: bool(clip.looping), False),
        "loop_start": safe(lambda: float(clip.loop_start), 0.0),
        "loop_end": safe(lambda: float(clip.loop_end), 0.0),
        "is_playing": safe(lambda: bool(clip.is_playing), False),
        "signature_numerator": safe(lambda: int(clip.signature_numerator), 4),
        "signature_denominator": safe(lambda: int(clip.signature_denominator), 4),
    }
    if not out["is_midi_clip"]:
        out["file_path"] = safe(lambda: str(clip.file_path), None)
    if slot_index is not None:
        out["slot"] = slot_index
    return out


def serialize_track(ctx, track, song, with_clips=True, with_devices=True):
    out = {
        "track_id": ctx.registry.handle_for(track),
        "name": safe(lambda: track.name, "?"),
        "type": track_kind(track, song),
        "is_grouped": safe(lambda: bool(track.is_grouped), False),
        "muted": safe(lambda: bool(track.mute), False),
        "soloed": safe(lambda: bool(track.solo), False),
        "armed": safe(lambda: bool(track.arm), False),
        "color_index": safe(lambda: int(track.color_index), None),
    }
    mixer = safe(lambda: track.mixer_device, None)
    if mixer is not None:
        volume = safe(lambda: mixer.volume, None)
        if volume is not None:
            out["volume"] = serialize_parameter(ctx, volume)
        pan = safe(lambda: mixer.panning, None)
        if pan is not None:
            out["pan"] = serialize_parameter(ctx, pan)
        out["sends"] = [
            serialize_parameter(ctx, s) for s in safe(lambda: list(mixer.sends), [])
        ]
    if with_clips:
        clips = []
        for index, slot in enumerate(safe(lambda: list(track.clip_slots), [])):
            if safe(lambda: slot.has_clip, False):
                clips.append(serialize_clip(ctx, slot.clip, slot_index=index))
        out["clips"] = clips
    if with_devices:
        out["devices"] = [
            serialize_device(ctx, d) for d in safe(lambda: list(track.devices), [])
        ]
    return out


def serialize_scene(ctx, scene, index):
    return {
        "scene_id": ctx.registry.handle_for(scene),
        "index": index,
        "name": safe(lambda: scene.name, ""),
        "is_empty": safe(lambda: bool(scene.is_empty), True),
        "is_triggered": safe(lambda: bool(scene.is_triggered), False),
        "tempo": safe(lambda: float(scene.tempo), None),
    }
