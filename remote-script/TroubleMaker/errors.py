# -*- coding: utf-8 -*-
"""Structured errors for the TroubleMaker Live bridge.

Errors must be *useful to an agent*: a stable code, a human-readable message,
and - where it helps recovery - the set of valid alternatives.
"""


class BridgeError(Exception):
    """Base class for all errors the dispatcher converts into a response."""

    code = "INTERNAL_ERROR"

    def __init__(self, message, **details):
        Exception.__init__(self, message)
        self.message = message
        self.details = {k: v for k, v in details.items() if v is not None}

    def to_dict(self):
        payload = {"code": self.code, "message": self.message}
        payload.update(self.details)
        return payload


class BadRequest(BridgeError):
    code = "BAD_REQUEST"


class UnknownCommand(BridgeError):
    code = "UNKNOWN_COMMAND"


class InvalidArgument(BridgeError):
    code = "INVALID_ARGUMENT"


class TrackNotFound(BridgeError):
    code = "TRACK_NOT_FOUND"


class SceneNotFound(BridgeError):
    code = "SCENE_NOT_FOUND"


class ClipSlotNotFound(BridgeError):
    code = "CLIP_SLOT_NOT_FOUND"


class ClipNotFound(BridgeError):
    code = "CLIP_NOT_FOUND"


class NotAMidiClip(BridgeError):
    code = "NOT_A_MIDI_CLIP"


class NotAMidiTrack(BridgeError):
    code = "NOT_A_MIDI_TRACK"


class DeviceNotFound(BridgeError):
    code = "DEVICE_NOT_FOUND"


class ParameterNotFound(BridgeError):
    code = "PARAMETER_NOT_FOUND"


class NoteNotFound(BridgeError):
    code = "NOTE_NOT_FOUND"


class NothingSelected(BridgeError):
    code = "NOTHING_SELECTED"


class ObjectGone(BridgeError):
    code = "OBJECT_GONE"


class Unsupported(BridgeError):
    """The running Live edition/version cannot do this. Never fake it."""

    code = "UNSUPPORTED"


class LiveError(BridgeError):
    """Live itself refused the operation."""

    code = "LIVE_ERROR"
