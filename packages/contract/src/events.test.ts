import { describe, expect, it, vi } from 'vitest';

import { EVENTS, EVENT_IDS, MAX_EVENT_TEXT, checkEvent, subscribeToEvent } from './events.js';

/**
 * The second direction's discipline (ADR-0082): validated where it is sent, validated
 * again where it arrives, and dropped rather than thrown on when it is wrong.
 */

describe('the event registry', () => {
  it('declares the assistant’s two events and the window’s close request, and nothing else', () => {
    expect(EVENT_IDS).toStrictEqual(['ai.delta', 'ai.done', 'window.close-requested']);
  });

  it('carries nothing on a close request, and refuses anything added to it', () => {
    expect(EVENTS['window.close-requested'].safeParse({}).success).toBe(true);
    expect(EVENTS['window.close-requested'].safeParse({ docId: 'x' }).success).toBe(false);
  });

  it('bounds a delta’s text and refuses an empty one', () => {
    expect(EVENTS['ai.delta'].safeParse({ subscription: 'a', text: 'x'.repeat(MAX_EVENT_TEXT) }).success).toBe(true);
    expect(EVENTS['ai.delta'].safeParse({ subscription: 'a', text: 'x'.repeat(MAX_EVENT_TEXT + 1) }).success).toBe(false);
    // AN EMPTY DELTA IS NOT A DELTA: an event that says nothing costs a round trip and
    // tells a reader the answer is moving when it is not.
    expect(EVENTS['ai.delta'].safeParse({ subscription: 'a', text: '' }).success).toBe(false);
  });

  it('refuses a payload with anything extra on it, on both events', () => {
    expect(EVENTS['ai.delta'].safeParse({ subscription: 'a', text: 'x', path: 'C:/secret' }).success).toBe(false);
    expect(EVENTS['ai.done'].safeParse({ subscription: 'a', stopped: false, extra: 1 }).success).toBe(false);
  });

  it('refuses a subscription id that is not one the renderer could have minted', () => {
    for (const subscription of ['', 'has space', 'a'.repeat(65), 'semi;colon']) {
      expect(EVENTS['ai.done'].safeParse({ subscription, stopped: true }).success).toBe(false);
    }
  });
});

describe('checkEvent', () => {
  it('answers the parsed payload for a good one', () => {
    expect(checkEvent('ai.done', { subscription: 'abc', stopped: true })).toStrictEqual({
      subscription: 'abc',
      stopped: true,
    });
  });

  it('THROWS in main rather than putting a malformed event on the wire', () => {
    expect(() =>
      checkEvent('ai.delta', { subscription: 'abc', text: 'x'.repeat(MAX_EVENT_TEXT + 1) }),
    ).toThrow(/Refusing to send a malformed "ai\.delta"/u);
  });
});

describe('subscribeToEvent', () => {
  /** A transport that hands whatever the case pushes to the registered listener. */
  function transport(): {
    readonly subscribe: (channel: string, handler: (payload: unknown) => void) => () => void;
    push: (channel: string, payload: unknown) => void;
    readonly listening: () => number;
  } {
    const listeners = new Map<string, ((payload: unknown) => void)[]>();
    return {
      subscribe: (channel, handler) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
        return () => {
          listeners.set(channel, (listeners.get(channel) ?? []).filter((entry) => entry !== handler));
        };
      },
      push: (channel, payload) => {
        for (const handler of listeners.get(channel) ?? []) handler(payload);
      },
      listening: () => [...listeners.values()].reduce((count, entries) => count + entries.length, 0),
    };
  }

  it('hands the handler a validated payload', () => {
    const wire = transport();
    const seen: unknown[] = [];

    subscribeToEvent(wire.subscribe, 'ai.delta', (payload) => seen.push(payload));
    wire.push('ai.delta', { subscription: 'abc', text: 'hello' });

    expect(seen).toStrictEqual([{ subscription: 'abc', text: 'hello' }]);
  });

  it('DROPS a malformed event and reports it, rather than throwing into a callback', () => {
    const wire = transport();
    const seen: unknown[] = [];
    const malformed = vi.fn();

    subscribeToEvent(wire.subscribe, 'ai.delta', (payload) => seen.push(payload), malformed);
    expect(() => {
      wire.push('ai.delta', { subscription: 'abc' });
    }).not.toThrow();

    expect(seen).toStrictEqual([]);
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: the unsubscribe it answers actually stops the listening', () => {
    const wire = transport();
    const seen: unknown[] = [];

    const stop = subscribeToEvent(wire.subscribe, 'ai.done', (payload) => seen.push(payload));
    wire.push('ai.done', { subscription: 'abc', stopped: false });
    stop();
    wire.push('ai.done', { subscription: 'abc', stopped: true });

    // ONE, NOT TWO: an unsubscribe that answered a function doing nothing would leave the
    // second push in this list, and a subscription nobody can end is a leak per answer.
    expect(seen).toStrictEqual([{ subscription: 'abc', stopped: false }]);
    expect(wire.listening()).toBe(0);
  });
});
