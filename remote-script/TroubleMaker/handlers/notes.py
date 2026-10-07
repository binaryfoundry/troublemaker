# -*- coding: utf-8 -*-
"""MIDI note reading and editing.

Live 11 exposes a note-id API (get_notes_extended / add_new_notes /
apply_note_modifications / remove_notes_extended) which lets the agent edit
individual notes in place - exactly what "preserve existing material" needs.
The pre-11 tuple API is kept as a fallback so the script degrades instead of
breaking, but note ids are unavailable there and the bridge says so through
get_capabilities.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_float, req_list, opt_float, opt_int, opt_bool

PITCH_MIN = 0
PITCH_MAX = 127
VELOCITY_MIN = 0.0
VELOCITY_MAX = 127.0
MAX_NOTES_PER_CALL = 8192


# ---------------------------------------------------------------------------
# API detection
# ---------------------------------------------------------------------------


def _extended(clip):
    return hasattr(clip, "get_notes_extended") and hasattr(clip, "add_new_notes")


def _note_spec_class():
    import Live

    return Live.Clip.MidiNoteSpecification


def _full_span(clip):
    """A time span guaranteed to cover the whole clip, loop included."""
    end = max(float(clip.length), float(clip.loop_end), float(clip.end_marker))
    return 0.0, end + 1.0


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _serialize_extended(note):
    out = {
        "note_id": int(note.note_id),
        "pitch": int(note.pitch),
        "start": round(float(note.start_time), 6),
        "duration": round(float(note.duration), 6),
        "velocity": round(float(note.velocity), 4),
        "mute": bool(note.mute),
    }
    for attr, key in (
        ("probability", "probability"),
        ("velocity_deviation", "velocity_deviation"),
        ("release_velocity", "release_velocity"),
    ):
        try:
            out[key] = round(float(getattr(note, attr)), 4)
        except Exception:
            pass
    return out


def _serialize_legacy(tup):
    pitch, start, duration, velocity, mute = tup
    return {
        "note_id": None,
        "pitch": int(pitch),
        "start": round(float(start), 6),
        "duration": round(float(duration), 6),
        "velocity": round(float(velocity), 4),
        "mute": bool(mute),
    }


def _read_all(clip):
    """Return (serialized_notes, raw_vector_or_None)."""
    start, span = _full_span(clip)
    if _extended(clip):
        vector = clip.get_notes_extended(PITCH_MIN, 128, start, span)
        return [_serialize_extended(n) for n in vector], vector
    raw = clip.get_notes(start, PITCH_MIN, span, 128)
    return [_serialize_legacy(t) for t in raw], None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_note(entry, index, require_full=True):
    if not isinstance(entry, dict):
        raise errors.InvalidArgument("notes[%d] must be an object." % (index,))

    def number(key, default=None, required=False):
        if key not in entry or entry[key] is None:
            if required:
                raise errors.InvalidArgument("notes[%d] is missing '%s'." % (index, key))
            return default
        value = entry[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise errors.InvalidArgument("notes[%d].%s must be a number." % (index, key))
        return float(value)

    pitch = number("pitch", required=require_full)
    start = number("start", required=require_full)
    duration = number("duration", required=require_full)
    velocity = number("velocity", default=100.0 if require_full else None)

    if pitch is not None:
        if pitch != int(pitch) or not (PITCH_MIN <= pitch <= PITCH_MAX):
            raise errors.InvalidArgument(
                "notes[%d].pitch must be an integer in 0-127 (got %r)." % (index, entry.get("pitch"))
            )
        pitch = int(pitch)
    if start is not None and start < 0.0:
        raise errors.InvalidArgument(
            "notes[%d].start must be >= 0 beats (got %r)." % (index, start)
        )
    if duration is not None and duration <= 0.0:
        raise errors.InvalidArgument(
            "notes[%d].duration must be greater than 0 beats (got %r)." % (index, duration)
        )
    if velocity is not None and not (VELOCITY_MIN <= velocity <= VELOCITY_MAX):
        raise errors.InvalidArgument(
            "notes[%d].velocity must be within 0-127 (got %r)." % (index, velocity)
        )

    mute = entry.get("mute", False if require_full else None)
    if mute is not None and not isinstance(mute, bool):
        raise errors.InvalidArgument("notes[%d].mute must be a boolean." % (index,))

    probability = number("probability")
    if probability is not None and not (0.0 <= probability <= 1.0):
        raise errors.InvalidArgument("notes[%d].probability must be within 0.0-1.0." % (index,))

    return {
        "pitch": pitch,
        "start": start,
        "duration": duration,
        "velocity": velocity,
        "mute": mute,
        "probability": probability,
    }


def _validate_batch(notes, require_full=True):
    if len(notes) > MAX_NOTES_PER_CALL:
        raise errors.InvalidArgument(
            "Too many notes in one call (%d); the limit is %d."
            % (len(notes), MAX_NOTES_PER_CALL)
        )
    return [_validate_note(n, i, require_full) for i, n in enumerate(notes)]


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def get_notes(ctx, args):
    track, clip, ref = lom.resolve_clip_ref(ctx, args, midi=True)
    notes, _ = _read_all(clip)

    from_time = opt_float(args, "from_time")
    time_span = opt_float(args, "time_span")
    from_pitch = opt_int(args, "from_pitch")
    pitch_span = opt_int(args, "pitch_span")
    if from_time is not None or time_span is not None:
        lo = from_time if from_time is not None else 0.0
        hi = lo + time_span if time_span is not None else float("inf")
        notes = [n for n in notes if lo <= n["start"] < hi]
    if from_pitch is not None or pitch_span is not None:
        lo = from_pitch if from_pitch is not None else 0
        hi = lo + pitch_span if pitch_span is not None else 128
        notes = [n for n in notes if lo <= n["pitch"] < hi]

    notes.sort(key=lambda n: (n["start"], n["pitch"]))
    result = {
        "track_id": ctx.registry.handle_for(track),
        "clip_id": ctx.registry.handle_for(clip),
        "length_beats": float(clip.length),
        "loop_start": float(clip.loop_start),
        "loop_end": float(clip.loop_end),
        # Where playback starts and whether it loops: needed to map an
        # Arrangement clip's notes onto the timeline.
        "start_marker": lom.safe(lambda: float(clip.start_marker), 0.0),
        "end_marker": lom.safe(lambda: float(clip.end_marker), float(clip.length)),
        "looping": lom.safe(lambda: bool(clip.looping), False),
        "note_count": len(notes),
        "has_note_ids": _extended(clip),
        "notes": notes,
    }
    result.update(ref)
    return result


def _add(clip, validated):
    if _extended(clip):
        spec_class = _note_spec_class()
        specs = []
        for note in validated:
            kwargs = {
                "pitch": note["pitch"],
                "start_time": note["start"],
                "duration": note["duration"],
                "velocity": note["velocity"] if note["velocity"] is not None else 100.0,
                "mute": bool(note["mute"]),
            }
            if note["probability"] is not None:
                try:
                    specs.append(spec_class(probability=note["probability"], **kwargs))
                    continue
                except TypeError:
                    pass
            specs.append(spec_class(**kwargs))
        clip.add_new_notes(tuple(specs))
        return
    tuples = tuple(
        (
            note["pitch"],
            note["start"],
            note["duration"],
            note["velocity"] if note["velocity"] is not None else 100.0,
            bool(note["mute"]),
        )
        for note in validated
    )
    clip.set_notes(tuples)


def _clear_all(clip):
    start, span = _full_span(clip)
    if hasattr(clip, "remove_notes_extended"):
        clip.remove_notes_extended(PITCH_MIN, 128, start, span)
    else:
        clip.remove_notes(start, PITCH_MIN, span, 128)


def add_notes(ctx, args):
    track, slot, clip = lom.resolve_midi_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    validated = _validate_batch(req_list(args, "notes"))
    before = len(_read_all(clip)[0])
    _add(clip, validated)
    after, _ = _read_all(clip)
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
        "notes_added": len(validated),
        "note_count_before": before,
        "note_count": len(after),
    }


def replace_notes(ctx, args):
    """Delete everything in the clip and write the supplied notes."""
    track, slot, clip = lom.resolve_midi_clip(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    validated = _validate_batch(req_list(args, "notes"))
    before = len(_read_all(clip)[0])
    _clear_all(clip)
    if validated:
        _add(clip, validated)
    after, _ = _read_all(clip)
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
        "notes_removed": before,
        "notes_written": len(validated),
        "note_count": len(after),
    }


def remove_notes(ctx, args):
    """Remove notes by id, or by a time/pitch window. One or the other."""
    track_id = req_int(args, "track_id")
    slot_index = req_int(args, "clip_slot")
    track, slot, clip = lom.resolve_midi_clip(ctx, track_id, slot_index)
    before_notes, vector = _read_all(clip)
    before = len(before_notes)

    note_ids = args.get("note_ids")
    if note_ids is not None:
        if not isinstance(note_ids, list):
            raise errors.InvalidArgument("'note_ids' must be an array of integers.")
        if not _extended(clip):
            raise errors.Unsupported(
                "This Live version has no note ids; remove notes by time/pitch window instead."
            )
        wanted = set(int(n) for n in note_ids)
        known = set(n["note_id"] for n in before_notes)
        missing = sorted(wanted - known)
        if missing:
            raise errors.NoteNotFound(
                "Clip does not contain note ids %s." % (missing,),
                available_note_ids=sorted(known),
            )
        # There is no remove-by-id call, so rewrite the survivors.
        survivors = [n for n in before_notes if n["note_id"] not in wanted]
        _clear_all(clip)
        if survivors:
            _add(clip, _validate_batch(survivors))
    else:
        from_time = opt_float(args, "from_time", 0.0)
        time_span = opt_float(args, "time_span", _full_span(clip)[1])
        from_pitch = opt_int(args, "from_pitch", PITCH_MIN)
        pitch_span = opt_int(args, "pitch_span", 128)
        if time_span <= 0:
            raise errors.InvalidArgument("'time_span' must be greater than 0.")
        if pitch_span <= 0:
            raise errors.InvalidArgument("'pitch_span' must be greater than 0.")
        if hasattr(clip, "remove_notes_extended"):
            clip.remove_notes_extended(from_pitch, pitch_span, from_time, time_span)
        else:
            clip.remove_notes(from_time, from_pitch, time_span, pitch_span)

    after, _ = _read_all(clip)
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": slot_index,
        "notes_removed": before - len(after),
        "note_count": len(after),
    }


def update_notes(ctx, args):
    """Modify existing notes in place, addressed by note_id.

    This is the command that keeps musical identity intact: pitches, ids and
    untouched notes survive the edit.
    """
    track, clip, ref = lom.resolve_clip_ref(ctx, args, midi=True)
    updates = req_list(args, "updates")
    if not updates:
        result = {"track_id": ctx.registry.handle_for(track), "notes_updated": 0}
        result.update(ref)
        return result

    for index, update in enumerate(updates):
        if not isinstance(update, dict) or "note_id" not in update:
            raise errors.InvalidArgument("updates[%d] must be an object with 'note_id'." % (index,))
        _validate_note(update, index, require_full=False)

    by_id = {}
    for index, update in enumerate(updates):
        note_id = update["note_id"]
        if not isinstance(note_id, int) or isinstance(note_id, bool):
            raise errors.InvalidArgument("updates[%d].note_id must be an integer." % (index,))
        by_id[note_id] = update

    if _extended(clip):
        start, span = _full_span(clip)
        vector = clip.get_notes_extended(PITCH_MIN, 128, start, span)
        present = set()
        for note in vector:
            update = by_id.get(int(note.note_id))
            if update is None:
                continue
            present.add(int(note.note_id))
            if update.get("pitch") is not None:
                note.pitch = int(update["pitch"])
            if update.get("start") is not None:
                note.start_time = float(update["start"])
            if update.get("duration") is not None:
                note.duration = float(update["duration"])
            if update.get("velocity") is not None:
                note.velocity = float(update["velocity"])
            if update.get("mute") is not None:
                note.mute = bool(update["mute"])
            if update.get("probability") is not None:
                try:
                    note.probability = float(update["probability"])
                except Exception:
                    pass
        missing = sorted(set(by_id.keys()) - present)
        if missing:
            raise errors.NoteNotFound(
                "Clip does not contain note ids %s; read the clip again - ids "
                "change when notes are deleted and re-added." % (missing,),
                available_note_ids=sorted(int(n.note_id) for n in vector),
            )
        clip.apply_note_modifications(vector)
        updated = len(present)
    else:
        raise errors.Unsupported(
            "This Live version has no note ids, so notes cannot be updated in "
            "place. Read the notes, change them, and call live.replace_notes."
        )

    after, _ = _read_all(clip)
    result = {
        "track_id": ctx.registry.handle_for(track),
        "notes_updated": updated,
        "note_count": len(after),
    }
    result.update(ref)
    return result


COMMANDS = {
    "live.get_notes": get_notes,
    "live.add_notes": add_notes,
    "live.replace_notes": replace_notes,
    "live.remove_notes": remove_notes,
    "live.update_notes": update_notes,
}
