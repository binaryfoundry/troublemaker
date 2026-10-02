# -*- coding: utf-8 -*-
"""Tests for the Live-side handlers, run against a fake Live Object Model.

Run with:  python remote-script/tests/test_handlers.py
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import fake_live  # noqa: E402

fake_live.install_stubs()

from TroubleMaker import handlers  # noqa: E402
from TroubleMaker.dispatch import Context, Dispatcher  # noqa: E402
from TroubleMaker.lom import ObjectRegistry  # noqa: E402


def build_dispatcher():
    song = fake_live.Song()
    registry = ObjectRegistry()
    ctx = Context(fake_live.Wrapper(song), registry, lambda message: None, None)
    dispatcher = Dispatcher(ctx)
    for module in handlers.MODULES:
        dispatcher.register_module(module)
    return dispatcher, song, registry


class HandlerTestCase(unittest.TestCase):
    def setUp(self):
        self.dispatcher, self.song, self.registry = build_dispatcher()

    def call(self, command, **args):
        response = self.dispatcher.handle({"id": "t", "command": command, "args": args})
        self.assertTrue(
            response["ok"],
            "%s failed: %s" % (command, response.get("error")),
        )
        return response["result"]

    def fail_call(self, command, **args):
        response = self.dispatcher.handle({"id": "t", "command": command, "args": args})
        self.assertFalse(response["ok"], "%s unexpectedly succeeded" % (command,))
        return response["error"]

    def track_id(self, name):
        for track in self.call("live.get_tracks")["tracks"]:
            if track["name"] == name:
                return track["track_id"]
        raise AssertionError("no track named %r" % (name,))


class TestDispatch(HandlerTestCase):
    def test_registers_every_command(self):
        self.assertGreater(len(self.dispatcher.command_names), 40)

    def test_unknown_command_lists_the_real_ones(self):
        error = self.fail_call("live.do_magic")
        self.assertEqual(error["code"], "UNKNOWN_COMMAND")
        self.assertIn("live.get_tempo", error["available_commands"])

    def test_rejects_a_request_that_is_not_an_object(self):
        response = self.dispatcher.handle(["not", "a", "dict"])
        self.assertEqual(response["error"]["code"], "BAD_REQUEST")

    def test_rejects_a_missing_command_name(self):
        response = self.dispatcher.handle({"id": "t", "args": {}})
        self.assertEqual(response["error"]["code"], "BAD_REQUEST")

    def test_echoes_the_request_id(self):
        response = self.dispatcher.handle({"id": "abc", "command": "ping", "args": {}})
        self.assertEqual(response["id"], "abc")

    def test_converts_an_unexpected_exception_into_an_error(self):
        def explode(ctx, args):
            raise ValueError("boom")

        self.dispatcher.register("test.explode", explode)
        error = self.fail_call("test.explode")
        self.assertEqual(error["code"], "INTERNAL_ERROR")


class TestSong(HandlerTestCase):
    def test_reads_and_writes_tempo(self):
        self.assertEqual(self.call("live.get_tempo")["bpm"], 124.0)
        self.assertEqual(self.call("live.set_tempo", bpm=126.5)["bpm"], 126.5)
        self.assertEqual(self.song.tempo, 126.5)

    def test_rejects_an_out_of_range_tempo(self):
        error = self.fail_call("live.set_tempo", bpm=5000)
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertEqual(self.song.tempo, 124.0)

    def test_rejects_a_non_numeric_tempo(self):
        self.assertEqual(self.fail_call("live.set_tempo", bpm="fast")["code"], "INVALID_ARGUMENT")

    def test_reports_capabilities_honestly(self):
        capabilities = self.call("live.get_capabilities")
        self.assertEqual(capabilities["live_version"], "11.3.21")
        self.assertTrue(capabilities["note_ids"])
        self.assertTrue(capabilities["clip_automation"])
        self.assertFalse(capabilities["arrangement_editing"])
        self.assertFalse(capabilities["audio_warping"])

    def test_project_state_omits_notes_to_keep_payloads_small(self):
        state = self.call("live.get_project_state")
        self.assertEqual(state["tempo"], 124.0)
        self.assertEqual(state["time_signature"], [4, 4])
        self.assertEqual(len(state["tracks"]), 3)
        serialized = repr(state)
        self.assertNotIn("note_id", serialized)
        bass = [t for t in state["tracks"] if t["name"] == "Bass"][0]
        self.assertEqual(len(bass["clips"]), 1)
        self.assertEqual(bass["clips"][0]["length_beats"], 4.0)

    def test_transport(self):
        self.assertTrue(self.call("live.play")["playing"])
        self.assertFalse(self.call("live.stop")["playing"])

    def test_time_signature_validation(self):
        self.call("live.set_time_signature", numerator=3, denominator=4)
        self.assertEqual(self.song.signature_numerator, 3)
        self.assertEqual(
            self.fail_call("live.set_time_signature", numerator=4, denominator=5)["code"],
            "INVALID_ARGUMENT",
        )

    def test_undo_reports_when_there_is_nothing_to_redo(self):
        self.call("live.undo")
        self.assertEqual(self.song.undo_calls, 1)
        self.assertEqual(self.fail_call("live.redo")["code"], "UNSUPPORTED")


class TestTracks(HandlerTestCase):
    def test_lists_tracks_with_stable_handles(self):
        first = self.call("live.get_tracks")["tracks"]
        second = self.call("live.get_tracks")["tracks"]
        self.assertEqual(
            [t["track_id"] for t in first], [t["track_id"] for t in second]
        )

    def test_handles_are_stable_across_reads_despite_fresh_wrappers(self):
        first = [t["track_id"] for t in self.call("live.get_tracks")["tracks"]]
        second = [t["track_id"] for t in self.call("live.get_tracks")["tracks"]]
        self.assertEqual(first, second)
        selected = self.call("live.get_selected_track")["track_id"]
        self.assertEqual(selected, first[0])
        self.assertEqual(self.call("live.get_track", track_id=first[1])["track_id"], first[1])

    def test_a_handle_survives_a_track_being_inserted_before_it(self):
        bass_id = self.track_id("Bass")
        self.call("live.create_midi_track", index=0, name="New")
        self.assertEqual(self.call("live.get_track", track_id=bass_id)["name"], "Bass")

    def test_unknown_track_lists_the_real_ones(self):
        error = self.fail_call("live.get_track", track_id=99999)
        self.assertEqual(error["code"], "TRACK_NOT_FOUND")
        self.assertIn("Bass", [t["name"] for t in error["available_tracks"]])

    def test_a_deleted_track_stops_resolving(self):
        bass_id = self.track_id("Bass")
        bass = self.song.tracks[1]
        self.song.tracks.remove(bass)
        bass._destroy()
        self.assertEqual(self.fail_call("live.get_track", track_id=bass_id)["code"],
                         "TRACK_NOT_FOUND")

    def test_reports_the_intro_track_limit(self):
        for _ in range(13):
            self.call("live.create_midi_track")
        error = self.fail_call("live.create_midi_track")
        self.assertEqual(error["code"], "LIVE_ERROR")
        self.assertIn("16 tracks", error["message"])

    def test_renames_a_track(self):
        bass_id = self.track_id("Bass")
        self.assertEqual(self.call("live.rename_track", track_id=bass_id, name="Sub")["name"],
                         "Sub")

    def test_sets_volume_by_normalized_value(self):
        bass_id = self.track_id("Bass")
        result = self.call("live.set_track_volume", track_id=bass_id, normalized=0.5)
        self.assertAlmostEqual(result["volume"]["value"], 0.5)
        self.assertAlmostEqual(result["volume"]["normalized"], 0.5)

    def test_rejects_a_normalized_value_outside_the_unit_interval(self):
        bass_id = self.track_id("Bass")
        self.assertEqual(
            self.fail_call("live.set_track_volume", track_id=bass_id, normalized=1.4)["code"],
            "INVALID_ARGUMENT",
        )

    def test_requires_a_value_or_a_normalized_value(self):
        bass_id = self.track_id("Bass")
        self.assertEqual(
            self.fail_call("live.set_track_volume", track_id=bass_id)["code"],
            "INVALID_ARGUMENT",
        )

    def test_rejects_an_out_of_range_send_index(self):
        bass_id = self.track_id("Bass")
        error = self.fail_call("live.set_track_send", track_id=bass_id, send_index=9,
                               normalized=0.5)
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertEqual(error["send_count"], 1)


class TestClips(HandlerTestCase):
    def setUp(self):
        HandlerTestCase.setUp(self)
        self.drums = self.track_id("Drums")
        self.bass = self.track_id("Bass")

    def test_creates_a_clip(self):
        clip = self.call("live.create_midi_clip", track_id=self.drums, clip_slot=0,
                         length_beats=16.0, name="Kick")
        self.assertEqual(clip["length_beats"], 16.0)
        self.assertEqual(clip["name"], "Kick")

    def test_refuses_to_overwrite_a_clip_without_being_told_to(self):
        error = self.fail_call("live.create_midi_clip", track_id=self.bass, clip_slot=0,
                               length_beats=4.0)
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertIn("replace_existing", error["message"])

    def test_replaces_a_clip_when_told_to(self):
        self.call("live.create_midi_clip", track_id=self.bass, clip_slot=0,
                  length_beats=8.0, replace_existing=True)
        self.assertEqual(self.call("live.get_clip", track_id=self.bass,
                                   clip_slot=0)["length_beats"], 8.0)

    def test_empty_slot_lists_the_occupied_ones(self):
        error = self.fail_call("live.get_clip", track_id=self.bass, clip_slot=3)
        self.assertEqual(error["code"], "CLIP_NOT_FOUND")
        self.assertEqual(error["occupied_slots"], [0])

    def test_out_of_range_slot_gives_the_slot_count(self):
        error = self.fail_call("live.get_clip", track_id=self.bass, clip_slot=999)
        self.assertEqual(error["code"], "CLIP_SLOT_NOT_FOUND")
        self.assertEqual(error["slot_count"], 8)

    def test_refuses_a_midi_clip_on_an_audio_track(self):
        vocal = self.track_id("Vocal")
        self.assertEqual(
            self.fail_call("live.create_midi_clip", track_id=vocal, clip_slot=0,
                           length_beats=4.0)["code"],
            "NOT_A_MIDI_TRACK",
        )

    def test_sets_a_loop_region_by_length(self):
        clip = self.call("live.set_clip_loop", track_id=self.bass, clip_slot=0,
                         start=0, length=16)
        self.assertEqual(clip["loop_end"], 16.0)

    def test_rejects_a_loop_that_ends_before_it_starts(self):
        self.assertEqual(
            self.fail_call("live.set_clip_loop", track_id=self.bass, clip_slot=0,
                           start=8, end=4)["code"],
            "INVALID_ARGUMENT",
        )

    def test_deletes_a_clip(self):
        self.call("live.delete_clip", track_id=self.bass, clip_slot=0)
        self.assertEqual(self.fail_call("live.get_clip", track_id=self.bass,
                                        clip_slot=0)["code"], "CLIP_NOT_FOUND")


class TestNotes(HandlerTestCase):
    def setUp(self):
        HandlerTestCase.setUp(self)
        self.bass = self.track_id("Bass")

    def notes(self):
        return self.call("live.get_notes", track_id=self.bass, clip_slot=0)["notes"]

    def test_reads_notes_with_ids_sorted_by_time(self):
        notes = self.notes()
        self.assertEqual(len(notes), 8)
        self.assertEqual([n["start"] for n in notes], [i * 0.5 for i in range(8)])
        self.assertTrue(all(isinstance(n["note_id"], int) for n in notes))

    def test_filters_by_time_window(self):
        result = self.call("live.get_notes", track_id=self.bass, clip_slot=0,
                           from_time=0.0, time_span=1.0)
        self.assertEqual(result["note_count"], 2)

    def test_adds_notes_without_disturbing_existing_ones(self):
        result = self.call("live.add_notes", track_id=self.bass, clip_slot=0,
                           notes=[{"pitch": 48, "start": 0.25, "duration": 0.2,
                                   "velocity": 90}])
        self.assertEqual(result["note_count_before"], 8)
        self.assertEqual(result["note_count"], 9)

    def test_replaces_every_note(self):
        result = self.call("live.replace_notes", track_id=self.bass, clip_slot=0,
                           notes=[{"pitch": 36, "start": 0, "duration": 0.25,
                                   "velocity": 120}])
        self.assertEqual(result["notes_removed"], 8)
        self.assertEqual(result["note_count"], 1)

    def test_replacing_with_nothing_empties_the_clip(self):
        self.assertEqual(
            self.call("live.replace_notes", track_id=self.bass, clip_slot=0,
                      notes=[])["note_count"],
            0,
        )

    def test_updates_notes_in_place_preserving_pitch_and_count(self):
        before = self.notes()
        updates = [{"note_id": before[1]["note_id"], "start": 0.75, "duration": 0.2}]
        result = self.call("live.update_notes", track_id=self.bass, clip_slot=0,
                           updates=updates)
        self.assertEqual(result["notes_updated"], 1)

        after = self.notes()
        self.assertEqual(len(after), len(before))
        self.assertEqual(sorted(n["pitch"] for n in after),
                         sorted(n["pitch"] for n in before))
        moved = [n for n in after if n["note_id"] == before[1]["note_id"]][0]
        self.assertEqual(moved["start"], 0.75)
        self.assertEqual(moved["duration"], 0.2)

    def test_updating_only_velocity_leaves_timing_alone(self):
        before = self.notes()
        self.call("live.update_notes", track_id=self.bass, clip_slot=0,
                  updates=[{"note_id": before[0]["note_id"], "velocity": 60}])
        after = self.notes()
        self.assertEqual(after[0]["velocity"], 60.0)
        self.assertEqual(after[0]["start"], before[0]["start"])

    def test_unknown_note_id_lists_the_real_ones(self):
        error = self.fail_call("live.update_notes", track_id=self.bass, clip_slot=0,
                               updates=[{"note_id": 99999, "velocity": 60}])
        self.assertEqual(error["code"], "NOTE_NOT_FOUND")
        self.assertEqual(len(error["available_note_ids"]), 8)

    def test_removes_notes_by_id(self):
        before = self.notes()
        result = self.call("live.remove_notes", track_id=self.bass, clip_slot=0,
                           note_ids=[before[0]["note_id"], before[1]["note_id"]])
        self.assertEqual(result["notes_removed"], 2)
        self.assertEqual(result["note_count"], 6)

    def test_removes_notes_by_window(self):
        result = self.call("live.remove_notes", track_id=self.bass, clip_slot=0,
                           from_time=0.0, time_span=1.0)
        self.assertEqual(result["notes_removed"], 2)

    def test_rejects_an_out_of_range_pitch(self):
        error = self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                               notes=[{"pitch": 200, "start": 0, "duration": 1}])
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertIn("0-127", error["message"])

    def test_rejects_a_zero_length_note(self):
        self.assertEqual(
            self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                           notes=[{"pitch": 40, "start": 0, "duration": 0}])["code"],
            "INVALID_ARGUMENT",
        )

    def test_rejects_a_negative_start(self):
        self.assertEqual(
            self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                           notes=[{"pitch": 40, "start": -1, "duration": 1}])["code"],
            "INVALID_ARGUMENT",
        )

    def test_rejects_an_out_of_range_velocity(self):
        self.assertEqual(
            self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                           notes=[{"pitch": 40, "start": 0, "duration": 1,
                                   "velocity": 300}])["code"],
            "INVALID_ARGUMENT",
        )

    def test_a_rejected_batch_writes_nothing(self):
        self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                       notes=[{"pitch": 40, "start": 0, "duration": 1},
                              {"pitch": 999, "start": 1, "duration": 1}])
        self.assertEqual(len(self.notes()), 8)

    def test_names_the_offending_note_index(self):
        error = self.fail_call("live.add_notes", track_id=self.bass, clip_slot=0,
                               notes=[{"pitch": 40, "start": 0, "duration": 1},
                                      {"pitch": 999, "start": 1, "duration": 1}])
        self.assertIn("notes[1]", error["message"])

    def test_refuses_note_editing_on_an_audio_clip(self):
        vocal = self.track_id("Vocal")
        self.song.tracks[2].clip_slots[0].create_clip(4.0)
        self.song.tracks[2].clip_slots[0].clip.is_midi_clip = False
        self.assertEqual(
            self.fail_call("live.get_notes", track_id=vocal, clip_slot=0)["code"],
            "NOT_A_MIDI_CLIP",
        )


class TestDevices(HandlerTestCase):
    def setUp(self):
        HandlerTestCase.setUp(self)
        self.bass = self.track_id("Bass")
        self.device = self.call("live.get_devices", track_id=self.bass)["devices"][0]

    def test_exposes_parameters_with_ranges_and_display_values(self):
        result = self.call("live.get_device_parameters", track_id=self.bass,
                           device_id=self.device["device_id"])
        frequency = [p for p in result["parameters"] if p["name"] == "Frequency"][0]
        self.assertEqual(frequency["min"], 30.0)
        self.assertEqual(frequency["max"], 19999.0)
        self.assertAlmostEqual(frequency["normalized"], (1200.0 - 30.0) / (19999.0 - 30.0), 5)
        self.assertIn("Hz", frequency["display_value"])

    def test_sets_a_parameter_by_name_and_reports_before_and_after(self):
        result = self.call("live.set_device_parameter", track_id=self.bass,
                           device_id=self.device["device_id"],
                           parameter_name="Frequency", value=800.0)
        self.assertEqual(result["before"]["value"], 1200.0)
        self.assertEqual(result["after"]["value"], 800.0)

    def test_sets_a_parameter_by_normalized_value(self):
        result = self.call("live.set_device_parameter", track_id=self.bass,
                           device_id=self.device["device_id"],
                           parameter_name="Resonance", normalized=0.5)
        self.assertAlmostEqual(result["after"]["value"], 0.625)

    def test_unknown_parameter_lists_the_real_ones(self):
        error = self.fail_call("live.set_device_parameter", track_id=self.bass,
                               device_id=self.device["device_id"],
                               parameter_name="Cutoff", value=1.0)
        self.assertEqual(error["code"], "PARAMETER_NOT_FOUND")
        self.assertIn("Frequency", error["available_parameters"])

    def test_rejects_a_value_outside_the_parameter_range(self):
        error = self.fail_call("live.set_device_parameter", track_id=self.bass,
                               device_id=self.device["device_id"],
                               parameter_name="Frequency", value=50000.0)
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertEqual(error["max"], 19999.0)

    def test_unknown_device_lists_the_real_ones(self):
        error = self.fail_call("live.get_device", track_id=self.bass, device_id=99999)
        self.assertEqual(error["code"], "DEVICE_NOT_FOUND")
        self.assertIn("Auto Filter", [d["name"] for d in error["available_devices"]])


class TestAutomation(HandlerTestCase):
    def setUp(self):
        HandlerTestCase.setUp(self)
        self.bass = self.track_id("Bass")
        self.device = self.call("live.get_devices", track_id=self.bass)["devices"][0]

    def test_writes_a_ramp_and_reads_it_back_rising(self):
        self.call("live.set_automation", track_id=self.bass, clip_slot=0,
                  device_id=self.device["device_id"], parameter_name="Frequency",
                  points=[{"beat": 0, "normalized": 0.2},
                          {"beat": 4, "normalized": 0.9}])
        curve = self.call("live.get_automation", track_id=self.bass, clip_slot=0,
                          device_id=self.device["device_id"],
                          parameter_name="Frequency", resolution=1.0)
        self.assertTrue(curve["has_envelope"])
        values = [p["value"] for p in curve["points"]]
        self.assertGreater(values[-1], values[0])

    def test_reports_no_envelope_before_one_is_written(self):
        curve = self.call("live.get_automation", track_id=self.bass, clip_slot=0,
                          device_id=self.device["device_id"], parameter_name="Resonance")
        self.assertFalse(curve["has_envelope"])
        self.assertEqual(curve["points"], [])

    def test_rejects_a_breakpoint_outside_the_parameter_range(self):
        error = self.fail_call("live.set_automation", track_id=self.bass, clip_slot=0,
                               device_id=self.device["device_id"],
                               parameter_name="Frequency",
                               points=[{"beat": 0, "value": 50000}])
        self.assertEqual(error["code"], "INVALID_ARGUMENT")

    def test_clears_an_envelope(self):
        self.call("live.set_automation", track_id=self.bass, clip_slot=0,
                  device_id=self.device["device_id"], parameter_name="Frequency",
                  points=[{"beat": 0, "normalized": 0.2}, {"beat": 4, "normalized": 0.9}])
        self.assertTrue(self.call("live.clear_automation", track_id=self.bass, clip_slot=0,
                                  device_id=self.device["device_id"],
                                  parameter_name="Frequency")["cleared"])


class TestSelection(HandlerTestCase):
    def test_resolves_the_selected_track(self):
        self.assertEqual(self.call("live.get_selected_track")["name"], "Drums")

    def test_reports_an_empty_highlighted_slot_rather_than_guessing(self):
        error = self.fail_call("live.get_selected_clip")
        self.assertEqual(error["code"], "NOTHING_SELECTED")
        self.assertEqual(error["clip_slot"], 0)

    def test_resolves_the_selected_clip_once_one_is_highlighted(self):
        bass = self.song.tracks[1]
        self.song.view.selected_track = bass
        self.song.view.highlighted_clip_slot = bass.clip_slots[0]
        clip = self.call("live.get_selected_clip")
        self.assertEqual(clip["name"], "Bass Main")
        self.assertEqual(clip["clip_slot"], 0)
        self.assertEqual(clip["track_name"], "Bass")

    def test_selection_round_trips_through_select_clip_slot(self):
        bass = self.track_id("Bass")
        self.call("live.select_clip_slot", track_id=bass, clip_slot=0)
        self.assertEqual(self.call("live.get_selected_clip")["track_id"], bass)


class TestScenes(HandlerTestCase):
    def test_lists_and_creates_scenes(self):
        self.assertEqual(len(self.call("live.get_scenes")["scenes"]), 2)
        created = self.call("live.create_scene", name="Breakdown")
        self.assertEqual(created["name"], "Breakdown")
        self.assertEqual(len(self.call("live.get_scenes")["scenes"]), 3)

    def test_unknown_scene_lists_the_real_ones(self):
        error = self.fail_call("live.fire_scene", scene_id=99999)
        self.assertEqual(error["code"], "SCENE_NOT_FOUND")
        self.assertIn("Intro", [s["name"] for s in error["available_scenes"]])


class TestEndToEndWorkflow(HandlerTestCase):
    """The MVP interaction from the plan, start to finish."""

    def test_syncopate_the_selected_bass_clip_preserving_pitches(self):
        bass_track = self.song.tracks[1]
        self.song.view.selected_track = bass_track
        self.song.view.highlighted_clip_slot = bass_track.clip_slots[0]

        selected = self.call("live.get_selected_clip")
        track_id, slot = selected["track_id"], selected["clip_slot"]

        before = self.call("live.get_notes", track_id=track_id, clip_slot=slot)["notes"]
        self.assertEqual(len(before), 8)

        # Push four on-grid notes onto the following sixteenth, and shorten them.
        updates = [
            {"note_id": before[i]["note_id"], "start": before[i]["start"] + 0.25,
             "duration": 0.27}
            for i in (1, 3, 5, 7)
        ]
        self.call("live.update_notes", track_id=track_id, clip_slot=slot, updates=updates)

        after = self.call("live.get_notes", track_id=track_id, clip_slot=slot)["notes"]
        self.assertEqual(len(after), len(before))
        self.assertEqual(sorted(n["pitch"] for n in after),
                         sorted(n["pitch"] for n in before))
        off_grid = [n for n in after if abs(n["start"] % 0.5) > 1e-6]
        self.assertEqual(len(off_grid), 4)


if __name__ == "__main__":
    unittest.main(verbosity=2)
