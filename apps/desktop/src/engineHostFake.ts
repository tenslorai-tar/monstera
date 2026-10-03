import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENGINE_HOST_FRAME_MAX_BYTES, FrameDecoder, answerCrossesInFile, encodeFrame } from '@monstera/contract';
import {
  type HostTermination,
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
  JOB_UI_RESTRICTIONS_ALL,
} from '@monstera/kernel';
import type { ReaderMessage, SamplerMessage } from '@monstera/nodemode';
import { ok } from '@monstera/shared';

import type { PipeHandle, SecurityDescriptor } from './enginePipeFactory.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import type { EngineHostConnectionSurfaces } from './engineHostConnection.js';
import type { ReaderWorkerHandle } from './engineReaderChannel.js';
import type { CreatedProcess, JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { PendingWrite } from './hostWriteQueue.js';
import type { StopEvent } from './win32PipeSurface.js';

/**
 * The engine host's Win32 surfaces, faked — **one fake, two callers**.
 *
 * ## Why this is a module and not a helper inside one test file
 *
 * It was inside `engineHostConnection.test.ts`, where it was written and where
 * it is still exercised hardest. The second caller is the composition root's
 * cases, and the alternative to moving it was writing the fake again — which is
 * a second opinion about how this protocol behaves (B3a). Two fakes agree until
 * the day the ordering changes, at which point one file passes while the
 * product cannot talk to itself.
 *
 * Not a `.test.ts`, so vitest does not collect it. It declares no cases; a file
 * of fixtures that reported passes would be counting itself.
 *
 * ## What it models, and the one piece of modelling it does
 *
 * Every surface records its call and answers. The single behaviour it models is
 * that **the peer arrives when the process is resumed** — a suspended process
 * has not run a line, so it cannot have opened the pipe. Everything else is a
 * canned value, because the questions these surfaces are asked have answers
 * that do not depend on each other.
 */

export const FAKE_USER: UserSid = { __sid: 'user', value: 'S-1-5-21-1-2-3-1001' };
export const FAKE_CONTAINER: ContainerSid = { __sid: 'container', value: 'S-1-15-2-1-2-3' };
export const FAKE_PIPE_NAME = String.raw`\\.\pipe\monstera-test`;

const DESCRIPTOR: SecurityDescriptor = { __handle: 'security-descriptor' };
const INSTANCE: PipeHandle = { __handle: 'pipe' };
const STOP_EVENT: StopEvent = { __handle: 'stop-event' };
const PROCESS: ProcessHandle = { __handle: 'process' };
const THREAD: ThreadHandle = { __handle: 'thread' };
const ISSUED: PendingWrite = { __handle: 'pending-write' };
export const FAKE_JOB: JobHandle = { __handle: 'job' };
export const FAKE_CREATED: CreatedProcess = { pid: 4242, process: PROCESS, thread: THREAD };

/**
 * ONE call list across every surface, which is the point rather than a
 * convenience.
 *
 * Every property asserted against this is about ORDER or about how many times
 * something happened — the host created after the reader, the process
 * terminated before its handles close, one host surface built and not two —
 * and per-surface spies would let a composition that did them backwards pass
 * each of them individually.
 */
export interface HostHarness {
  readonly calls: string[];
  readonly surfaces: EngineHostConnectionSurfaces;
  readonly endings: HostTermination[];
  /** Posts a reader message, as the worker thread would. */
  readonly post: (message: ReaderMessage) => void;
  /**
   * Makes `resume` deliver `connected` SYNCHRONOUSLY, before the composer can
   * be listening. Models a host already at the pipe, and is how the latch in
   * `onConnected` is exercised rather than assumed.
   */
  readonly connectOnResume: () => void;
  /** Ends the reader thread, as an exit would. */
  readonly exit: (code: number) => void;
  /**
   * The memory sampler kills the host, as the worker does: its flag set first, then the process gone — modelled as
   * the reader ending, which is how a killed host's ending reaches the connection.
   */
  readonly samplerKills: () => void;
  /** The memory sampler reports that it could not watch the host. */
  readonly samplerFails: (detail: string) => void;
}

/**
 * A peer that answers, for callers that drive CHANNELS rather than the connect
 * sequence.
 *
 * `engineHostConnection.test.ts` needs none of this — its subject is the
 * ordering, and it asserts against `calls`. The composition root's subject is
 * what happens *after* a host exists: a containment verdict is asked for and
 * acted on, and a session is opened. Neither is reachable unless something
 * replies.
 *
 * **The frames are decoded with the shipped `FrameDecoder` and encoded with the
 * shipped `encodeFrame`.** A hand-rolled framing here would be a second opinion
 * about what a frame is (B3a), and it would agree with the real one right up
 * until the framing changed — at which point the tests would pass while the
 * product could not talk to itself.
 *
 * @param channel the channel the host was asked about
 * @param params what it was asked
 * @returns the answer's body, or `null` to leave the call outstanding — which
 *   is how *the host never replied* is expressed, and is a real state.
 */
export type FakePeer = (channel: string, params: unknown) => unknown;

export function hostHarness(
  failures: {
    pipe?: boolean;
    stopEvent?: boolean;
    worker?: boolean;
    host?: boolean;
    /** The process starts and never reaches the pipe. */
    connect?: boolean;
    /** Answers channel calls. Absent means nothing ever replies. */
    peer?: FakePeer;
    /** The write surface refuses every issue, as a dead pipe does. */
    write?: boolean;
    /**
     * What the host wrote to its inherited stdio before dying, or absent for
     * nothing.
     *
     * A STRING RATHER THAN A BOOLEAN, because the property under test is that
     * the host's own words reach the caller — and a flag would let a connection
     * that composed its own sentence pass. The case asserts this exact text
     * comes back.
     */
    said?: string;
    /** The memory sampler's thread cannot be started. */
    sampler?: boolean;
  } = {},
): HostHarness {
  const decoder = new FrameDecoder(ENGINE_HOST_FRAME_MAX_BYTES);
  // THE GRANTED AREA OF EACH SESSION THE PEER ISSUED, remembered from what the product SENT on the open that issued it —
  // never recomputed from a root, so the file routes land exactly where the product's own directories are.
  const areas = new Map<string, { readonly snapshot: string; readonly output: string }>();
  const openedArea = (params: unknown): { snapshot: string; output: string } | null => {
    const sent = params as { snapshotDirectory?: unknown; outputDirectory?: unknown } | null;
    return typeof sent?.snapshotDirectory === 'string' && typeof sent.outputDirectory === 'string'
      ? { snapshot: sent.snapshotDirectory, output: sent.outputDirectory }
      : null;
  };
  const areaOf = (session: unknown): { snapshot: string; output: string } => {
    const area = typeof session === 'string' ? areas.get(session) : undefined;
    if (area === undefined) throw new Error(`the fake peer holds no area for session ${JSON.stringify(session)}`);
    return area;
  };
  const writeAnswer = (params: unknown, name: string, body: unknown): number => {
    const bytes = new TextEncoder().encode(JSON.stringify(body));
    writeFileSync(join(areaOf((params as { session?: unknown }).session).output, name), bytes);
    return bytes.length;
  };
  const calls: string[] = [];
  const endings: HostTermination[] = [];
  let eager = false;
  const sinks: {
    message: ((message: ReaderMessage) => void)[];
    exit: ((code: number) => void)[];
  } = { message: [], exit: [] };

  const worker: ReaderWorkerHandle = {
    onMessage: (sink) => sinks.message.push(sink),
    onError: () => undefined,
    onExit: (sink) => sinks.exit.push(sink),
  };
  const sampler: { killed: boolean; sinks: ((message: SamplerMessage) => void)[] } = { killed: false, sinks: [] };

  const surfaces: EngineHostConnectionSurfaces = {
    sampler: {
      start: (pid, killAtBytes, intervalMs) => {
        calls.push(`sampler.start:${String(pid)}:${String(killAtBytes)}:${String(intervalMs)}`);
        if (failures.sampler === true) return null;
        return {
          killed: () => sampler.killed,
          onMessage: (sink) => sampler.sinks.push(sink),
          stop: () => calls.push('sampler.stop'),
        };
      },
    },
    pipes: {
      describe: () => {
        calls.push('pipe.describe');
        return DESCRIPTOR;
      },
      createInstance: () => {
        calls.push('pipe.createInstance');
        return failures.pipe === true ? null : INSTANCE;
      },
      freeDescriptor: () => calls.push('pipe.freeDescriptor'),
      close: () => calls.push('pipe.close'),
      lastError: () => 5,
    },
    reader: {
      createStopEvent: () => {
        calls.push('reader.createStopEvent');
        return failures.stopEvent === true ? null : STOP_EVENT;
      },
      signal: () => {
        calls.push('reader.signal');
        // THE READER ENDS ON ITS OWN, LATER, as the shipped one does (57–127 ms after the signal, measured 2026-10-01):
        // a fake that ended inside `signal`, or never, could not show a dispose arriving before the ending — the order
        // in which the shipped channel used to terminate the thread and abort the process.
        const ended = [...sinks.message];
        setImmediate(() => {
          for (const sink of ended) sink({ kind: 'ended', detail: 'stopped while waiting for bytes' });
        });
        return true;
      },
      closeEvent: () => calls.push('reader.closeEvent'),
      addressOf: () => '1234',
      startWorker: () => {
        calls.push('reader.startWorker');
        // A NEW READER THREAD HAS ITS OWN SINKS. Accumulating them across
        // rebuilds delivers one answer to every connection this harness has
        // ever made, which the client correctly reports as a response for an id
        // no call is waiting on — a protocol violation the fake invented.
        sinks.message.length = 0;
        sinks.exit.length = 0;
        return failures.worker === true ? null : worker;
      },
      lastError: () => 6,
    },
    writesFor: () => {
      calls.push('writes.for');
      return {
        issue: (frame): PendingWrite | null => {
          // THE WRITE IS WHERE THE REQUEST IS, so this is where a peer can see
          // one. Decoding happens even with no peer, because a frame this
          // cannot parse is a defect in the product's encoder and reporting it
          // as "nobody answered" would hide it behind a timeout.
          const complete = decoder.push(frame);
          if (!complete.ok) {
            throw new Error(
              'the fake peer could not decode a frame the product wrote: ' +
                JSON.stringify(complete.error),
            );
          }
          for (const payload of complete.value) {
            const request = JSON.parse(new TextDecoder().decode(payload)) as {
              id: string;
              channel: string;
              params?: unknown;
              paramsFile?: { session: string; name: string };
              answerInto?: string;
            };
            calls.push(`peer.request:${request.channel}`);
            // THE ROUTES THE PRODUCT DECLARED ARE HONOURED, as the host's runtime honours them (ADR-0125): params named
            // by a file are read from the snapshot directory main wrote them into, and a success asked for by file is
            // written into the output directory main will take it from. A fake that framed everything would be a
            // second opinion about the protocol, and the client refuses it as the peer it is.
            const params =
              request.paramsFile === undefined
                ? request.params
                : (JSON.parse(
                    readFileSync(join(areaOf(request.paramsFile.session).snapshot, request.paramsFile.name), 'utf8'),
                  ) as unknown);
            const opening = openedArea(params);
            const body = failures.peer?.(request.channel, params);
            if (body === null || body === undefined) continue;
            if (opening !== null) {
              const session = (body as { value?: { session?: unknown } }).value?.session;
              if (typeof session === 'string') areas.set(session, opening);
            }
            const envelope =
              request.answerInto !== undefined && answerCrossesInFile(body)
                ? { id: request.id, answerFile: { bytes: writeAnswer(params, request.answerInto, body) } }
                : { id: request.id, body };
            const answer = encodeFrame(new TextEncoder().encode(JSON.stringify(envelope)), ENGINE_HOST_FRAME_MAX_BYTES);
            // DELIVERED ON A MICROTASK, as the reader thread would: answering
            // inside `issue` returns the answer before the caller has awaited
            // its own promise, which is a shape the real transport cannot
            // produce and would let a composition that never awaited pass.
            queueMicrotask(() => {
              for (const sink of sinks.message) sink({ kind: 'chunk', bytes: answer });
            });
          }
          // A PENDING WRITE, NOT `null`. `null` means *the write was refused*,
          // which kills the connection — and it was this fake's answer from the
          // day it was written, harmlessly, because nothing sent a call through
          // it. The first caller that did got `GetLastError 7` and a dead host
          // (KKKK-7). `failures.write` is how a refusal is asked for now, so
          // the two states are distinguishable rather than the same value.
          return failures.write === true ? null : ISSUED;
        },
        collect: () => 'completed' as const,
        release: () => undefined,
        abandon: () => calls.push('writes.abandon'),
        lastError: () => 7,
      };
    },
    hostFor: () => {
      calls.push('host.surfaceBuilt');
      let appliedMemoryLimitBytes = 0;
      return {
        createSuspended: () => {
          calls.push('host.createSuspended');
          return ok(FAKE_CREATED);
        },
        createJob: () => {
          calls.push('host.createJob');
          return failures.host === true ? null : FAKE_JOB;
        },
        applyLimits: (_job, processMemoryLimitBytes) => {
          // REMEMBERED, so `readJobLimits` can answer with what was actually
          // asked for. A fake that returned a constant would make the
          // classifier's memory-limit comparison pass for any input, which is
          // the assertion that agrees with the bug.
          appliedMemoryLimitBytes = processMemoryLimitBytes;
          return true;
        },
        assignToJob: () => true,
        readJobMembership: () => 'in-job' as const,
        // A CONTAINED HOST BY DEFAULT, because every case in this fake's callers
        // is about something else and a fake reporting an uncontained host would
        // fail them all for the wrong reason. The cases that care replace these.
        readIntegrity: () => ({ kind: 'read', rid: INTEGRITY_LOW }) as const,
        readJobLimits: () =>
          ({
            kind: 'read',
            limitFlags:
              JOB_LIMIT_ACTIVE_PROCESS | JOB_LIMIT_PROCESS_MEMORY | JOB_LIMIT_KILL_ON_JOB_CLOSE,
            activeProcessLimit: 1,
            processMemoryLimitBytes: appliedMemoryLimitBytes,
            uiRestrictions: JOB_UI_RESTRICTIONS_ALL,
          }) as const,
        resume: () => {
          // THE PEER ARRIVES WHEN THE PROCESS IS RESUMED, which is the fake's
          // one piece of modelling and is where reality puts it: a suspended
          // process has not run a line, so it cannot have opened the pipe.
          //
          // Posted on a microtask by default, because that is the shape the
          // composer has to cope with — a `connected` delivered inside `resume`
          // arrives before the composer ever awaits, so every case would then be
          // proving the LATCH works rather than the wait. `connectOnResume`
          // selects that other shape deliberately, for the one case about it.
          const deliver = (): void => {
            for (const sink of sinks.message) sink({ kind: 'connected' });
          };
          if (eager) deliver();
          else if (failures.connect !== true) queueMicrotask(deliver);
          return 1;
        },
        terminate: () => calls.push('host.terminate'),
        close: (handle) => calls.push(`host.close:${handle.__handle}`),
        diagnostics: () => {
          calls.push('host.diagnostics');
          return failures.said ?? null;
        },
        discardDiagnostics: () => calls.push('host.discardDiagnostics'),
      };
    },
  };

  return {
    calls,
    surfaces,
    endings,
    post: (message) => {
      for (const sink of sinks.message) sink(message);
    },
    exit: (code) => {
      for (const sink of sinks.exit) sink(code);
    },
    connectOnResume: () => {
      eager = true;
    },
    samplerKills: () => {
      sampler.killed = true;
      for (const sink of sinks.message) sink({ kind: 'ended', detail: 'the pipe broke: the host is gone' });
    },
    samplerFails: (detail) => {
      for (const sink of sampler.sinks) sink({ kind: 'failed', detail });
    },
  };
}
