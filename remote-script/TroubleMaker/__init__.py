# -*- coding: utf-8 -*-
"""Live Remote Script entry point.

Live calls create_instance() once, when the user picks "TroubleMaker" as a
Control Surface in Preferences > Link/Tempo/MIDI.
"""

from .TroubleMaker import TroubleMaker


def create_instance(c_instance):
    return TroubleMaker(c_instance)
