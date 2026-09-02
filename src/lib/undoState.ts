import type { DashboardState } from './chartState.ts';
import type { SharedMutation } from './sharedStateProtocol.ts';

export type UndoableMutation = Extract<SharedMutation, { kind: 'chart_patch' | 'filter_patch' }>;

export interface UndoFrame {
  state: DashboardState;
  resultingVersion: number;
  mutation: UndoableMutation;
}

export function addUndoFrame(frames: UndoFrame[], state: DashboardState, resultingVersion: number, mutation: UndoableMutation): UndoFrame[] {
  return [...frames, { state, resultingVersion, mutation }].slice(-10);
}

export function invalidateUndoFrames(frames: UndoFrame[], remoteVersion: number): UndoFrame[] {
  return frames.filter((frame) => frame.resultingVersion >= remoteVersion);
}

export function popUndoFrame(frames: UndoFrame[]): UndoFrame[] {
  return frames.slice(0, -1);
}
