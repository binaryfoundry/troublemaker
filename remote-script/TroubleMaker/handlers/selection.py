# -*- coding: utf-8 -*-
"""What the user currently has selected in Live.

Selection is the default context for prompts like "make this darker", so
these commands resolve "this" without the user naming anything.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int


def _view(ctx):
    return ctx.song.view


def get_selected_track(ctx, args):
    track = lom.safe(lambda: _view(ctx).selected_track, None)
    if track is None:
        raise errors.NothingSelected("No track is selected in Live.")
    return lom.serialize_track(ctx, track, ctx.song, with_clips=True, with_devices=True)


def get_selected_scene(ctx, args):
    scene = lom.safe(lambda: _view(ctx).selected_scene, None)
    if scene is None:
        raise errors.NothingSelected("No scene is selected in Live.")
    index = lom.index_of(ctx.song.scenes, scene)
    return lom.serialize_scene(ctx, scene, index)


def get_selected_clip(ctx, args):
    """Resolve the highlighted clip slot, which is how Live models 'this clip'."""
    view = _view(ctx)
    slot = lom.safe(lambda: view.highlighted_clip_slot, None)
    track = lom.safe(lambda: view.selected_track, None)
    if slot is None or track is None:
        raise errors.NothingSelected("No clip slot is highlighted in Live's Session view.")
    found = lom.index_of(lom.safe(lambda: list(track.clip_slots), []), slot)
    slot_index = found if found >= 0 else None
    if not slot.has_clip:
        raise errors.NothingSelected(
            "The highlighted clip slot on track '%s' is empty." % (track.name,),
            track_id=ctx.registry.handle_for(track),
            clip_slot=slot_index,
        )
    out = lom.serialize_clip(ctx, slot.clip, slot_index=slot_index)
    out["track_id"] = ctx.registry.handle_for(track)
    out["track_name"] = track.name
    out["clip_slot"] = slot_index
    return out


def get_selected_device(ctx, args):
    view = _view(ctx)
    track = lom.safe(lambda: view.selected_track, None)
    if track is None:
        raise errors.NothingSelected("No track is selected in Live.")
    device = lom.safe(lambda: track.view.selected_device, None)
    if device is None:
        raise errors.NothingSelected(
            "No device is selected on track '%s'." % (track.name,),
            track_id=ctx.registry.handle_for(track),
        )
    out = lom.serialize_device(ctx, device, with_parameters=True)
    out["track_id"] = ctx.registry.handle_for(track)
    out["track_name"] = track.name
    return out


def select_track(ctx, args):
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    _view(ctx).selected_track = track
    return {"track_id": ctx.registry.handle_for(track), "name": track.name}


def select_clip_slot(ctx, args):
    track, slot = lom.resolve_clip_slot(
        ctx, req_int(args, "track_id"), req_int(args, "clip_slot")
    )
    view = _view(ctx)
    view.selected_track = track
    view.highlighted_clip_slot = slot
    return {
        "track_id": ctx.registry.handle_for(track),
        "clip_slot": req_int(args, "clip_slot"),
    }


COMMANDS = {
    "live.get_selected_track": get_selected_track,
    "live.get_selected_scene": get_selected_scene,
    "live.get_selected_clip": get_selected_clip,
    "live.get_selected_device": get_selected_device,
    "live.select_track": select_track,
    "live.select_clip_slot": select_clip_slot,
}
