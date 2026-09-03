import type { SharedMutation } from './sharedStateProtocol.ts';

export type UndoableMutation = Extract<SharedMutation, { kind: 'chart_patch' | 'chart_contract' | 'filter_patch' }>;

export interface UndoFrame<TState> {
  state: TState;
  resultingVersion: number;
  mutation: UndoableMutation;
}

export function addUndoFrame<TState>(frames: UndoFrame<TState>[], state: TState, resultingVersion: number, mutation: UndoableMutation): UndoFrame<TState>[] {
  return [...frames, { state, resultingVersion, mutation }].slice(-10);
}

export function invalidateUndoFrames<TState>(frames: UndoFrame<TState>[], remoteVersion: number): UndoFrame<TState>[] {
  return frames.filter((frame) => frame.resultingVersion >= remoteVersion);
}

export function popUndoFrame<TState>(frames: UndoFrame<TState>[]): UndoFrame<TState>[] {
  return frames.slice(0, -1);
}
