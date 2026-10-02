/**
 * Capture the Master output to a file, inside Live.
 *
 * No Live version can export through its API. Live can record its own output,
 * though: an audio track whose input is "Resampling" hears everything reaching
 * the Master, after the Master chain. Recording a fixed length into one of its
 * clip slots produces a WAV on disk that QC can measure - the agentic
 * replacement for File > Export when the goal is evaluating a mix.
 *
 * It runs in real time: 16 bars at 128 BPM takes 30 seconds. For the final
 * delivery file, a proper export is still the right tool (it renders offline,
 * at the chosen bit depth, with dither).
 */

import { closeSync, existsSync, openSync, statSync } from 'node:fs';

import { BridgeError } from '../errors.js';
import type { LiveTransport } from '../transport.js';

export const CAPTURE_TRACK_NAME = 'TM Capture';

interface TrackSummary {
  track_id: number;
  name: string;
  type: string;
}

export interface CaptureOptions {
  bars?: number;
  seconds?: number;
  /** Launch this scene so the music plays during the capture. */
  scene_id?: number;
  /** Or play the Arrangement from this beat. */
  start_beat?: number;
}

export interface CaptureResult {
  file_path: string;
  track_id: number;
  clip_slot: number;
  length_beats: number;
  seconds: number;
  tempo: number;
}

interface SlotStatus {
  has_clip: boolean;
  is_recording: boolean;
  file_path: string | null;
}

const POLL_MS = 250;
const SETTLE_TIMEOUT_MS = 20_000;

export class MasterCapture {
  constructor(private readonly transport: LiveTransport) {}

  /** Find or create the capture track and route it to listen to the Master. */
  async prepare(): Promise<{ track_id: number; created: boolean }> {
    const { tracks } = (await this.transport.send('live.get_tracks')) as { tracks: TrackSummary[] };
    let track = tracks.find((t) => t.name === CAPTURE_TRACK_NAME && t.type === 'audio');
    let created = false;
    if (!track) {
      track = (await this.transport.send('live.create_audio_track', {
        name: CAPTURE_TRACK_NAME,
      })) as TrackSummary;
      created = true;
    }
    const routing = (await this.transport.send('live.get_input_routing', {
      track_id: track.track_id,
    })) as { current: string | null; available: string[] };
    const resampling = routing.available.find((r) => /resampl/i.test(r));
    if (!resampling) {
      throw new BridgeError(
        'UNSUPPORTED',
        `Live offers no Resampling input on '${CAPTURE_TRACK_NAME}'; the Master cannot be captured.`,
        { available_routings: routing.available },
      );
    }
    if (routing.current !== resampling) {
      await this.transport.send('live.set_input_routing', {
        track_id: track.track_id,
        routing: resampling,
      });
    }
    // Monitoring off: with Resampling as the input, monitoring would feed the
    // Master back into itself.
    await this.transport.send('live.set_monitoring', { track_id: track.track_id, state: 'off' });
    return { track_id: track.track_id, created };
  }

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    if (options.scene_id !== undefined && options.start_beat !== undefined) {
      throw new BridgeError('VALIDATION_FAILED', 'Give scene_id or start_beat, not both.');
    }
    const settings = (await this.transport.send('live.get_record_settings')) as {
      tempo: number;
      signature: [number, number];
    };
    const beatsPerBar = (settings.signature[0] * 4) / settings.signature[1];
    const lengthBeats =
      options.bars !== undefined
        ? options.bars * beatsPerBar
        : Math.max(beatsPerBar, Math.round(((options.seconds ?? 30) * settings.tempo) / 60));
    const seconds = (lengthBeats * 60) / settings.tempo;
    if (seconds > 600) {
      throw new BridgeError('VALIDATION_FAILED', `A ${seconds.toFixed(0)} s capture is too long; keep it under 10 minutes.`);
    }

    const { track_id: trackId } = await this.prepare();
    const slot = await this.emptySlot(trackId);

    await this.transport.send('live.set_track_arm', { track_id: trackId, enabled: true });
    try {
      let started = false;
      if (options.scene_id !== undefined) {
        // Scene and recording in one Live tick, so both launch on the same
        // bar. Sent separately, the scene starts at once while the recording
        // waits for the next bar, and the capture misses the first bar.
        try {
          await this.transport.send('live.record_with_scene', {
            track_id: trackId,
            clip_slot: slot,
            scene_id: options.scene_id,
            length_beats: lengthBeats,
          });
          started = true;
        } catch (error) {
          if (!(error instanceof BridgeError) || error.code !== 'UNKNOWN_COMMAND') throw error;
          // Older Remote Script: fall back to separate launches.
          await this.transport.send('live.fire_scene', { scene_id: options.scene_id });
        }
      } else if (options.start_beat !== undefined) {
        await this.transport.send('live.stop');
        await this.transport.send('live.set_song_time', { beat: options.start_beat });
        await this.transport.send('live.continue_playing');
      }
      if (!started) {
        await this.transport.send('live.record_clip', {
          track_id: trackId,
          clip_slot: slot,
          length_beats: lengthBeats,
        });
      }

      // Recording starts on the next launch-quantization boundary, so wait for
      // the clip to appear and then to stop recording, rather than a fixed time.
      const deadline = Date.now() + seconds * 1000 + SETTLE_TIMEOUT_MS;
      let status: SlotStatus | null = null;
      let sawRecording = false;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const current = (await this.transport.send('live.get_clip_slot_status', {
          track_id: trackId,
          clip_slot: slot,
        })) as SlotStatus;
        status = current;
        if (current.is_recording) sawRecording = true;
        if (sawRecording && current.has_clip && !current.is_recording) break;
      }
      if (!status?.has_clip || status.is_recording) {
        throw new BridgeError(
          'CAPTURE_FAILED',
          'The capture clip did not finish recording in time. Is the transport running, and is the ' +
            'Set producing sound?',
          { track_id: trackId, clip_slot: slot },
        );
      }
      if (!status.file_path) {
        throw new BridgeError('CAPTURE_FAILED', 'Live recorded the clip but reported no file path.');
      }
      // Live loops a freshly recorded Session clip straight into playback and
      // holds its file exclusively while the clip is loaded. Stop it first,
      // let Live finish writing the file, and only then remove the clip -
      // removing it mid-finalisation leaves the file unfinished and locked.
      // The WAV itself stays in the project's Samples/Recorded folder.
      await this.transport.send('live.stop_clip', { track_id: trackId });
      await this.transport.send('live.stop');
      await waitUntilFinalised(status.file_path);
      await this.transport.send('live.delete_clip', { track_id: trackId, clip_slot: slot });
      await waitUntilReadable(status.file_path);
      return {
        file_path: status.file_path,
        track_id: trackId,
        clip_slot: slot,
        length_beats: lengthBeats,
        seconds: Math.round(seconds * 10) / 10,
        tempo: settings.tempo,
      };
    } finally {
      // Always leave the Set safe: stop playback and disarm the capture track.
      await this.transport.send('live.stop').catch(() => undefined);
      await this.transport.send('live.set_track_arm', { track_id: trackId, enabled: false }).catch(() => undefined);
    }
  }

  private async emptySlot(trackId: number): Promise<number> {
    const { clip_slots } = (await this.transport.send('live.get_clip_slots', { track_id: trackId })) as {
      clip_slots: Array<{ slot: number; has_clip: boolean }>;
    };
    const free = clip_slots.find((s) => !s.has_clip);
    if (free) return free.slot;
    // Every slot is used by earlier captures: add a scene for another row.
    await this.transport.send('live.create_scene', {});
    return clip_slots.length;
  }
}

/**
 * Wait until Live has finished writing a recording: its size has stopped
 * changing and Live has written the .asd analysis file it creates once a
 * recording is complete. Both can be checked while Live holds the file.
 */
async function waitUntilFinalised(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const size = existsSync(path) ? statSync(path).size : -1;
    if (size !== lastSize) {
      lastSize = size;
      stableSince = Date.now();
    }
    if (size > 0 && existsSync(`${path}.asd`) && Date.now() - stableSince >= 750) return;
    await sleep(POLL_MS);
  }
  // Not fatal on its own: the readability check that follows decides.
}

/** Wait for Live to release a file it has just finished writing. */
async function waitUntilReadable(path: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      closeSync(openSync(path, 'r'));
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new BridgeError(
          'CAPTURE_FAILED',
          `Live still holds ${path} open: ${(error as Error).message}`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
