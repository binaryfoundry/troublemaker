# -*- coding: utf-8 -*-
"""Command registry and request dispatch.

This layer is deliberately mechanical. It resolves objects, calls the Live
API, serializes the result, and converts every failure into a structured
error. It holds no musical opinion whatsoever - that belongs in the agent.
"""

import traceback

from . import errors


class Context(object):
    """Everything a handler is allowed to touch."""

    def __init__(self, song, registry, log, surface):
        self.song = song
        self.registry = registry
        self.log = log
        self.surface = surface

    @property
    def app(self):
        try:
            import Live

            return Live.Application.get_application()
        except Exception:
            return None


class Dispatcher(object):
    def __init__(self, ctx):
        self.ctx = ctx
        self._commands = {}

    def register(self, name, fn):
        if name in self._commands:
            raise RuntimeError("duplicate command %r" % (name,))
        self._commands[name] = fn

    def register_module(self, module):
        for name, fn in module.COMMANDS.items():
            self.register(name, fn)

    @property
    def command_names(self):
        return sorted(self._commands.keys())

    def handle(self, request):
        """Turn one request dict into one response dict. Never raises."""
        if not isinstance(request, dict):
            return _error_response(None, errors.BadRequest("Request must be a JSON object."))
        request_id = request.get("id")
        name = request.get("command")
        args = request.get("args")
        if args is None:
            args = {}
        if not isinstance(name, str):
            return _error_response(
                request_id, errors.BadRequest("Request is missing a string 'command' field.")
            )
        if not isinstance(args, dict):
            return _error_response(
                request_id, errors.BadRequest("Request field 'args' must be a JSON object.")
            )
        fn = self._commands.get(name)
        if fn is None:
            return _error_response(
                request_id,
                errors.UnknownCommand(
                    "No such command: %s" % (name,), available_commands=self.command_names
                ),
            )
        try:
            result = fn(self.ctx, args)
        except errors.BridgeError as exc:
            self.ctx.log("ERROR %s -> %s: %s" % (name, exc.code, exc.message))
            return _error_response(request_id, exc)
        except RuntimeError as exc:
            # Live raises bare RuntimeError for deleted objects and for
            # operations it refuses (e.g. creating a track past the Intro
            # edition's track limit).
            self.ctx.log("LIVE ERROR %s: %s" % (name, exc))
            return _error_response(
                request_id, errors.LiveError("Live refused the operation: %s" % (exc,))
            )
        except Exception as exc:
            self.ctx.log("UNHANDLED %s: %s\n%s" % (name, exc, traceback.format_exc()))
            return _error_response(
                request_id,
                errors.BridgeError("Unhandled error in %s: %r" % (name, exc)),
            )
        return {"id": request_id, "ok": True, "result": result}


def _error_response(request_id, exc):
    return {"id": request_id, "ok": False, "error": exc.to_dict()}


# ---------------------------------------------------------------------------
# Argument coercion - the bridge validates too, but the Live side refuses to
# trust anything that reaches it over a socket.
# ---------------------------------------------------------------------------


def req_int(args, key):
    if key not in args:
        raise errors.InvalidArgument("Missing required argument '%s'." % (key,))
    value = args[key]
    if isinstance(value, bool) or not isinstance(value, int):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        raise errors.InvalidArgument("Argument '%s' must be an integer." % (key,))
    return value


def opt_int(args, key, default=None):
    if key not in args or args[key] is None:
        return default
    return req_int(args, key)


def req_float(args, key):
    if key not in args:
        raise errors.InvalidArgument("Missing required argument '%s'." % (key,))
    value = args[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise errors.InvalidArgument("Argument '%s' must be a number." % (key,))
    return float(value)


def opt_float(args, key, default=None):
    if key not in args or args[key] is None:
        return default
    return req_float(args, key)


def req_str(args, key):
    if key not in args:
        raise errors.InvalidArgument("Missing required argument '%s'." % (key,))
    value = args[key]
    if not isinstance(value, str):
        raise errors.InvalidArgument("Argument '%s' must be a string." % (key,))
    return value


def opt_str(args, key, default=None):
    if key not in args or args[key] is None:
        return default
    return req_str(args, key)


def opt_bool(args, key, default=None):
    if key not in args or args[key] is None:
        return default
    value = args[key]
    if not isinstance(value, bool):
        raise errors.InvalidArgument("Argument '%s' must be a boolean." % (key,))
    return value


def req_list(args, key):
    if key not in args:
        raise errors.InvalidArgument("Missing required argument '%s'." % (key,))
    value = args[key]
    if not isinstance(value, list):
        raise errors.InvalidArgument("Argument '%s' must be an array." % (key,))
    return value
