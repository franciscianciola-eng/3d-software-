// Central shared state. Modules import { app } and communicate through app.events.
import { Emitter, toast } from './utils.js';

export const app = {
  events: new Emitter(),

  // three.js handles — filled by viewport.init()
  renderer: null,
  scene: null,
  camera: null,
  orbit: null,
  tc: null,            // TransformControls
  contentGroup: null,  // holds ONLY user items (clean for export)

  items: [],           // top-level user objects
  selected: null,
  multi: new Set(),    // additional selected items (shift+click)
  undo: null,          // UndoStack, set by main.js

  mocap: [],           // motion library: {id, name, clip, sourceRoot, duration}
  _mocapId: 1,

  // registered callbacks that run every frame with (dt)
  tickers: [],

  // when set, viewport picking defers to this (auto-rig joint editing)
  pickOverride: null,

  uniqueName(base) {
    base = (base || 'Object').trim() || 'Object';
    const names = new Set(this.items.map(i => i.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  },

  addItem(obj, opts = {}) {
    const { select = true, undoable = true } = opts;
    obj.name = this.uniqueName(obj.name);
    obj.userData.isItem = true;
    if (!obj.userData.clips) obj.userData.clips = [];
    if (!obj.userData.keys) obj.userData.keys = [];
    this.contentGroup.add(obj);
    this.items.push(obj);
    this.events.emit('items-changed');
    if (select) this.select(obj);
    if (undoable && this.undo) {
      this.undo.push({
        label: `Add ${obj.name}`,
        undo: () => this.removeItem(obj, { undoable: false }),
        redo: () => this.addItem(obj, { select: true, undoable: false }),
      });
    }
    return obj;
  },

  removeItem(obj, opts = {}) {
    const { undoable = true } = opts;
    const idx = this.items.indexOf(obj);
    if (idx === -1) return;
    if (this.multi.delete(obj)) this.events.emit('multi-changed');
    if (this.selected === obj) this.select(null, { keepMulti: true });
    this.items.splice(idx, 1);
    this.contentGroup.remove(obj);
    this.events.emit('item-removed', obj);
    this.events.emit('items-changed');
    if (undoable && this.undo) {
      this.undo.push({
        label: `Delete ${obj.name}`,
        undo: () => this.addItem(obj, { select: true, undoable: false }),
        redo: () => this.removeItem(obj, { undoable: false }),
      });
    }
  },

  select(obj, opts = {}) {
    if (!opts.keepMulti && this.multi.size) {
      this.multi.clear();
      this.events.emit('multi-changed');
    }
    if (this.selected === obj) return;
    this.selected = obj;
    this.events.emit('selection-changed', obj);
  },

  /** shift+click: add/remove an item from the extended selection */
  toggleMulti(obj) {
    if (!obj) return;
    if (!this.selected) { this.select(obj); return; }
    if (obj === this.selected) return;
    if (this.multi.has(obj)) this.multi.delete(obj);
    else this.multi.add(obj);
    this.events.emit('multi-changed');
  },

  /** primary + shift-selected items, in scene order */
  selectedItems() {
    return this.items.filter(i => i === this.selected || this.multi.has(i));
  },

  addMocap(name, clip, sourceRoot) {
    const entry = {
      id: this._mocapId++,
      name,
      clip,
      sourceRoot,
      duration: clip.duration,
    };
    this.mocap.push(entry);
    this.events.emit('mocap-changed');
    return entry;
  },

  removeMocap(entry) {
    const i = this.mocap.indexOf(entry);
    if (i !== -1) {
      this.mocap.splice(i, 1);
      this.events.emit('mocap-changed');
    }
  },

  getClips(item) {
    return item?.userData?.clips || [];
  },

  addClipToItem(item, name, clip, opts = {}) {
    const clips = this.getClips(item);
    let n = name; let k = 2;
    while (clips.some(c => c.name === n)) n = `${name} ${k++}`;
    clip.name = n;
    clips.push({ name: n, clip });
    this.events.emit('clips-changed', item);
    if (opts.undoable !== false && this.undo) {
      const rec = clips[clips.length - 1];
      this.undo.push({
        label: `Add animation ${n}`,
        undo: () => {
          const i = clips.indexOf(rec);
          if (i !== -1) clips.splice(i, 1);
          this.events.emit('clips-changed', item);
        },
        redo: () => { clips.push(rec); this.events.emit('clips-changed', item); },
      });
    }
    return clips.length - 1;
  },

  error(msg, err) {
    console.error(msg, err || '');
    toast(`⚠️ ${msg}`, 'bad', 5200);
  },
};
