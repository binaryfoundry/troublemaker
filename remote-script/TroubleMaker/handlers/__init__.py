# -*- coding: utf-8 -*-
"""Command handler modules, registered in this order."""

from . import song
from . import tracks
from . import clips
from . import notes
from . import scenes
from . import devices
from . import automation
from . import selection
from . import master
from . import capture

MODULES = (song, tracks, clips, notes, scenes, devices, automation, selection, master, capture)
