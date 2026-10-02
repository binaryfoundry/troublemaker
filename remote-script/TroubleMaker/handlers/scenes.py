# -*- coding: utf-8 -*-
"""Scene enumeration, creation and launching."""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_str, opt_int


def get_scenes(ctx, args):
    return {
        "scenes": [lom.serialize_scene(ctx, s, i) for i, s in enumerate(ctx.song.scenes)]
    }


def get_scene(ctx, args):
    scene = lom.resolve_scene(ctx, req_int(args, "scene_id"))
    index = lom.index_of(ctx.song.scenes, scene)
    return lom.serialize_scene(ctx, scene, index)


def create_scene(ctx, args):
    song = ctx.song
    index = opt_int(args, "index", -1)
    if index != -1 and (index < 0 or index > len(song.scenes)):
        raise errors.InvalidArgument(
            "Scene index %d is out of range (0..%d)." % (index, len(song.scenes))
        )
    try:
        song.create_scene(index)
    except Exception as exc:
        raise errors.LiveError("Live refused to create a scene: %s" % (exc,))
    position = len(song.scenes) - 1 if index == -1 else index
    scene = song.scenes[position]
    name = args.get("name")
    if isinstance(name, str) and name.strip():
        scene.name = name
    return lom.serialize_scene(ctx, scene, position)


def rename_scene(ctx, args):
    scene = lom.resolve_scene(ctx, req_int(args, "scene_id"))
    scene.name = req_str(args, "name")
    index = lom.index_of(ctx.song.scenes, scene)
    return lom.serialize_scene(ctx, scene, index)


def fire_scene(ctx, args):
    scene = lom.resolve_scene(ctx, req_int(args, "scene_id"))
    scene.fire()
    return {"fired": True, "scene_id": ctx.registry.handle_for(scene)}


COMMANDS = {
    "live.get_scenes": get_scenes,
    "live.get_scene": get_scene,
    "live.create_scene": create_scene,
    "live.rename_scene": rename_scene,
    "live.fire_scene": fire_scene,
}
