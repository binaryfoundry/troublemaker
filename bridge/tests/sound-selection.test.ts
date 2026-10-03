/**
 * Ableton_Sound_Selection_Expert.md as code: briefs and shortlists. Names
 * below are real Core Library items seen in Live's browser.
 */

import { describe, expect, it } from 'vitest';

import { rankCandidates, selectionKnowledge, soundBrief } from '../../agent/src/sound-selection.js';
import { shortlistSounds } from '../../bridge/src/workflows.js';

const item = (path: string[], category = 'sounds') => ({ name: path.at(-1)!, category, path });

describe('sound brief', () => {
  it('turns a role and genre into searches, keep and reject words and what to judge', () => {
    const brief = soundBrief('kick', { genre: 'deep_house', character: ['short'] });
    expect(brief.searches).toContainEqual(['drums', 'kick']);
    expect(brief.keep).toEqual(expect.arrayContaining(['short', 'warm', 'round']));
    expect(brief.reject).toEqual(expect.arrayContaining(['harsh', 'distorted']));
    expect(brief.evaluate).toContain('relationship with the bass');
    expect(brief.pair).toMatch(/Never finalise a kick without the bass/);
    expect(brief.need).toMatch(/short kick for deep house/);
  });

  it('follows the document\u2019s priority order: identity first, decoration last', () => {
    const p = selectionKnowledge().priority;
    expect(p.indexOf('kick')).toBeLessThan(p.indexOf('hats'));
    expect(p.at(-1)).toBe('fx');
  });

  it('refuses unknown roles and genres with the known ones', () => {
    expect(() => soundBrief('kazoo')).toThrow(/Known/);
    expect(() => soundBrief('kick', { genre: 'polka' })).toThrow(/Known/);
  });
});

describe('shortlist', () => {
  const pads = [
    item(['Pad', 'After Glow Pad.adg']),
    item(['Pad', 'Abilene Winter Pad.adg']),
    item(['Pad', 'Warm Felt Pad.adg']),
    item(['Ambient & Evolving', 'Wave Evolve Pad.adg']),
    item(['Ambient & Evolving', 'Noisy Pad.adv']),
    item(['Synth Lead', 'Disto Lead.adg']),
    item(['Pad', 'Harsh Distorted Pad.adg']),
  ];

  it('ranks candidates on the brief, drops rejected ones and caps each folder at two', () => {
    const brief = soundBrief('chords', { genre: 'deep_house' });
    const list = rankCandidates(pads, brief);
    expect(list[0]!.name).toBe('Warm Felt Pad.adg');
    expect(list.map((c) => c.name)).not.toContain('Harsh Distorted Pad.adg');
    expect(list.filter((c) => c.path[0] === 'Pad').length).toBeLessThanOrEqual(2);
    expect(list.length).toBeLessThanOrEqual(8);
  });

  it('searches Live\u2019s browser for each brief search and ranks what comes back', async () => {
    const calls: string[] = [];
    const client = {
      async post(command: string, args: Record<string, unknown> = {}) {
        calls.push(`${command}:${args.category}:${args.query}`);
        if (args.category === 'instruments') throw new Error('no such category');
        return {
          items: [
            { name: 'Kick 808 Long.wav', path: ['Drum Hits', 'Kick', 'Kick 808 Long.wav'], is_loadable: true, is_folder: false },
            { name: 'Kick Deep Round.wav', path: ['Drum Hits', 'Kick', 'Kick Deep Round.wav'], is_loadable: true, is_folder: false },
            { name: 'Kick', path: ['Drum Hits', 'Kick'], is_loadable: false, is_folder: true },
          ],
        };
      },
    };
    const brief = soundBrief('kick', { genre: 'deep_house' });
    const found = await shortlistSounds(client, brief, 5);
    expect(calls.length).toBe(brief.searches.length);
    expect(found.shortlist[0]!.name).toBe('Kick Deep Round.wav');
    expect(found.shortlist.every((c) => !c.name.endsWith('Kick'))).toBe(true);
  });
});
