// Small shared helpers: events, toasts, formatting, drag-to-adjust number fields.

export class Emitter {
  constructor() { this._m = new Map(); }
  on(evt, fn) {
    if (!this._m.has(evt)) this._m.set(evt, new Set());
    this._m.get(evt).add(fn);
    return () => this._m.get(evt)?.delete(fn);
  }
  emit(evt, ...args) {
    const set = this._m.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(`[event ${evt}]`, e); }
    }
  }
}

export function toast(msg, kind = '', ms = 3600) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms - 350);
  setTimeout(() => el.remove(), ms);
}

export function fmt(n, digits = 3) {
  if (!isFinite(n)) return '0';
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, '') || '0';
}

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function basename(path) {
  return path.split(/[\\/]/).pop();
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/**
 * Build a numeric input whose label (or the input itself) can be dragged
 * horizontally to adjust the value — Blender style, but discoverable.
 * opts: { value, step, min, max, digits, onInput(v), onCommit(before, after) }
 */
export function bindNumberDrag(input, labelEl, opts) {
  const o = Object.assign({ step: 0.01, digits: 3 }, opts);
  let before = null;

  const clamp = v => {
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    return v;
  };
  const parse = () => {
    const v = parseFloat(String(input.value).replace(',', '.'));
    return isFinite(v) ? v : 0;
  };

  input.addEventListener('focus', () => { before = parse(); input.select(); });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (isFinite(v)) o.onInput?.(clamp(v));
  });
  const commit = () => {
    let v = clamp(parse());
    input.value = fmt(v, o.digits);
    o.onInput?.(v);
    if (before !== null && Math.abs(before - v) > 1e-9) o.onCommit?.(before, v);
    before = null;
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { input.blur(); }
    else if (e.key === 'Escape') {
      if (before !== null) { input.value = fmt(before, o.digits); o.onInput?.(before); }
      before = null; input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const dir = e.key === 'ArrowUp' ? 1 : -1;
      const mult = e.shiftKey ? 10 : 1;
      if (before === null) before = parse();
      const v = clamp(parse() + dir * o.step * mult);
      input.value = fmt(v, o.digits);
      o.onInput?.(v);
    }
    e.stopPropagation();
  });

  // drag on label to slide the value
  if (labelEl) {
    labelEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      const startX = e.clientX;
      const startV = parse();
      let moved = false;
      const dragBefore = startV;
      labelEl.setPointerCapture(e.pointerId);
      const onMove = ev => {
        const dx = ev.clientX - startX;
        if (Math.abs(dx) > 2) moved = true;
        const mult = ev.shiftKey ? 10 : (ev.altKey ? 0.1 : 1);
        const v = clamp(startV + dx * o.step * mult);
        input.value = fmt(v, o.digits);
        o.onInput?.(v);
      };
      const onUp = () => {
        labelEl.removeEventListener('pointermove', onMove);
        labelEl.removeEventListener('pointerup', onUp);
        if (moved) {
          const v = clamp(parse());
          if (Math.abs(dragBefore - v) > 1e-9) o.onCommit?.(dragBefore, v);
        }
      };
      labelEl.addEventListener('pointermove', onMove);
      labelEl.addEventListener('pointerup', onUp);
    });
  }

  return {
    set(v) { if (document.activeElement !== input) input.value = fmt(v, o.digits); },
  };
}
