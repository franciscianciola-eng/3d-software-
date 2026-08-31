// Simple command-stack undo/redo. Commands: { label, undo(), redo() }.
export class UndoStack {
  constructor(limit = 120) {
    this.limit = limit;
    this.stack = [];
    this.index = -1; // last applied command
    this.onChange = null;
  }
  push(cmd) {
    this.stack.length = this.index + 1;
    this.stack.push(cmd);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    this.onChange?.();
  }
  canUndo() { return this.index >= 0; }
  canRedo() { return this.index < this.stack.length - 1; }
  undo() {
    if (!this.canUndo()) return null;
    const cmd = this.stack[this.index--];
    try { cmd.undo(); } catch (e) { console.error('undo failed', e); }
    this.onChange?.();
    return cmd;
  }
  redo() {
    if (!this.canRedo()) return null;
    const cmd = this.stack[++this.index];
    try { cmd.redo(); } catch (e) { console.error('redo failed', e); }
    this.onChange?.();
    return cmd;
  }
}

import * as THREE from 'three';
import { app } from './app.js';

/** Push an undo entry for a transform change on an object. */
export function pushTransformUndo(obj, before, label = 'Transform') {
  const after = snapshotTransform(obj);
  if (transformsEqual(before, after)) return;
  app.undo.push({
    label,
    undo: () => { applyTransform(obj, before); app.events.emit('transform-changed', obj); },
    redo: () => { applyTransform(obj, after); app.events.emit('transform-changed', obj); },
  });
}

export function snapshotTransform(obj) {
  return {
    position: obj.position.clone(),
    quaternion: obj.quaternion.clone(),
    scale: obj.scale.clone(),
  };
}

export function applyTransform(obj, t) {
  obj.position.copy(t.position);
  obj.quaternion.copy(t.quaternion);
  obj.scale.copy(t.scale);
}

function transformsEqual(a, b) {
  return a.position.distanceToSquared(b.position) < 1e-14 &&
    a.scale.distanceToSquared(b.scale) < 1e-14 &&
    Math.abs(a.quaternion.dot(b.quaternion)) > 1 - 1e-10;
}
