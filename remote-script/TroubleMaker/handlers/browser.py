# -*- coding: utf-8 -*-
"""Live's browser: find sounds, kits, devices and samples, and load them.

Control surfaces may walk the browser tree and load an item onto the
selected track - the same path Push uses. Loading a Drum Rack preset gives a
playable kit; loading a sample onto a MIDI track gives a Simpler.

The tree is large (the sample library alone holds thousands of items) and
walking it runs on Live's thread, so every search has a node budget and
reports when it ran out rather than stalling Live.
"""

from .. import errors
from .. import lom
from ..dispatch import req_int, req_str, opt_int, opt_str

CATEGORIES = (
    "drums",
    "instruments",
    "sounds",
    "samples",
    "audio_effects",
    "midi_effects",
    "packs",
    "user_library",
    "current_project",
    "plugins",
    "clips",
)

DEFAULT_BUDGET = 4000
MAX_BUDGET = 20000


def _browser(ctx):
    app = ctx.app
    browser = lom.safe(lambda: app.browser, None) if app is not None else None
    if browser is None or not hasattr(browser, "load_item"):
        raise errors.Unsupported("This Live version does not expose its browser to Remote Scripts.")
    return browser


def _roots(browser, category):
    if category == "user_folders":
        return list(lom.safe(lambda: browser.user_folders, []))
    if category not in CATEGORIES:
        raise errors.InvalidArgument(
            "Unknown browser category %r." % (category,),
            available=list(CATEGORIES) + ["user_folders"],
        )
    root = lom.safe(lambda: getattr(browser, category), None)
    if root is None:
        raise errors.Unsupported("Live's browser has no %r category here." % (category,))
    return [root]


def _children(item):
    return list(lom.safe(lambda: item.children, []))


def _top_level(roots, category):
    """What a path's first name is matched against: a category's contents,
    or the user folders themselves."""
    if category == "user_folders":
        return roots
    return [c for r in roots for c in _children(r)]


def _describe(item, path):
    return {
        "name": str(item.name),
        "path": path,
        "uri": lom.safe(lambda: str(item.uri), None),
        "is_loadable": bool(lom.safe(lambda: item.is_loadable, False)),
        "is_folder": bool(lom.safe(lambda: item.is_folder, False)),
        "is_device": bool(lom.safe(lambda: item.is_device, False)),
    }


def _walk_to(roots, path):
    """Follow a list of names from a category root; None if any step is missing."""
    level = roots
    found = None
    for index, name in enumerate(path):
        wanted = str(name).strip().lower()
        found = None
        for item in level:
            if str(item.name).strip().lower() == wanted:
                found = item
                break
        if found is None:
            return None, index
        level = _children(found)
    return found, len(path)


def browse(ctx, args):
    """List one folder, or search a category by name.

    With `query`: breadth-first search for items whose name contains every
    word of the query. Without: the children of `path` (or the roots).
    """
    browser = _browser(ctx)
    category = req_str(args, "category").strip().lower()
    roots = _roots(browser, category)
    path = list(args.get("path") or [])
    limit = opt_int(args, "limit", 50)
    query = opt_str(args, "query")

    if path:
        start, reached = _walk_to(_top_level(roots, category), path)
        if start is None:
            raise errors.InvalidArgument(
                "No item %r under %s/%s." % (path[reached], category, "/".join(path[:reached]))
            )
        level = [(c, path + [str(c.name)]) for c in _children(start)]
    else:
        level = [(c, [str(c.name)]) for c in _top_level(roots, category)]

    if not query:
        return {
            "category": category,
            "path": path,
            "items": [_describe(item, p) for item, p in level[:limit]],
            "truncated": len(level) > limit,
        }

    words = [w for w in query.strip().lower().split() if w]
    budget = min(opt_int(args, "budget", DEFAULT_BUDGET), MAX_BUDGET)
    matches = []
    visited = 0
    queue = list(level)
    while queue and visited < budget and len(matches) < limit:
        item, item_path = queue.pop(0)
        visited += 1
        name = str(item.name).lower()
        if all(w in name for w in words):
            matches.append(_describe(item, item_path))
        if lom.safe(lambda: item.is_folder, False) or not lom.safe(lambda: item.is_loadable, False):
            queue.extend((c, item_path + [str(c.name)]) for c in _children(item))
    return {
        "category": category,
        "query": query,
        "items": matches,
        "visited": visited,
        "exhausted_budget": bool(queue) and visited >= budget,
    }


def load_browser_item(ctx, args):
    """Select a track and load a browser item onto it, by category and path."""
    browser = _browser(ctx)
    track = lom.resolve_track(ctx, req_int(args, "track_id"))
    category = req_str(args, "category").strip().lower()
    path = list(args.get("path") or [])
    if not path:
        raise errors.InvalidArgument("Give the item's path, as live.browse returns it.")
    item, reached = _walk_to(_top_level(_roots(browser, category), category), path)
    if item is None:
        raise errors.InvalidArgument(
            "No item %r under %s/%s." % (path[reached], category, "/".join(path[:reached]))
        )
    if not lom.safe(lambda: item.is_loadable, False):
        raise errors.InvalidArgument("'%s' is a folder, not something Live can load." % (item.name,))

    before = len(list(track.devices))
    ctx.song.view.selected_track = track
    try:
        browser.load_item(item)
    except Exception as exc:
        raise errors.LiveError("Live refused to load '%s': %s" % (item.name, exc))
    devices = list(track.devices)
    return {
        "track_id": ctx.registry.handle_for(track),
        "loaded": _describe(item, path),
        "device_count_before": before,
        "devices": [
            {"device_id": ctx.registry.handle_for(d), "name": str(d.name), "class_name": lom.safe(lambda: str(d.class_name), None)}
            for d in devices
        ],
    }


def get_drum_pads(ctx, args):
    """The filled pads of a Drum Rack: MIDI note and pad name."""
    track, device = lom.resolve_device(ctx, req_int(args, "track_id"), req_int(args, "device_id"))
    if not lom.safe(lambda: device.can_have_drum_pads, False):
        raise errors.InvalidArgument("'%s' is not a Drum Rack." % (device.name,))
    pads = []
    for pad in lom.safe(lambda: list(device.drum_pads), []):
        if not list(lom.safe(lambda: pad.chains, [])):
            continue
        pads.append({"note": int(pad.note), "name": str(pad.name)})
    return {
        "track_id": ctx.registry.handle_for(track),
        "device_id": ctx.registry.handle_for(device),
        "pads": pads,
    }


COMMANDS = {
    "live.browse": browse,
    "live.load_browser_item": load_browser_item,
    "live.get_drum_pads": get_drum_pads,
}
