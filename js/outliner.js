// Scene list: select, rename (double-click), show/hide, delete.
import { app } from './app.js';
import { el } from './utils.js';
import { isRigged } from './autorig.js';

function iconFor(item) {
  if (isRigged(item)) return '🦴';
  let hasMesh = false;
  item.traverse(o => { if (o.isMesh) hasMesh = true; });
  return hasMesh ? '📦' : '⬚';
}

function rebuild() {
  const host = document.getElementById('outliner-list');
  const empty = document.getElementById('outliner-empty');
  const count = document.getElementById('outliner-count');
  host.innerHTML = '';
  empty.classList.toggle('hidden', app.items.length > 0);
  count.textContent = app.items.length ? `(${app.items.length})` : '';

  for (const item of app.items) {
    const row = el('div', 'out-row' + (item === app.selected ? ' sel' : '') + (item.visible ? '' : ' hidden-obj'));
    const icon = el('span', 'oicon', iconFor(item));
    const name = el('span', 'oname');
    name.textContent = item.name;
    name.title = `${item.name} — double-click to rename`;

    const eye = el('button', 'obtn', item.visible ? '👁' : '🚫');
    eye.title = 'Show / hide';
    eye.addEventListener('click', e => {
      e.stopPropagation();
      item.visible = !item.visible;
      if (!item.visible && app.selected === item) app.tc.detach();
      else if (item.visible && app.selected === item) app.tc.attach(item);
      rebuild();
    });

    const del = el('button', 'obtn', '🗑');
    del.title = 'Delete (Del)';
    del.addEventListener('click', e => {
      e.stopPropagation();
      app.removeItem(item);
    });

    row.append(icon, name, eye, del);
    row.addEventListener('click', () => app.select(item));
    row.addEventListener('dblclick', e => {
      if (e.target === eye || e.target === del) return;
      startRename(item, name);
    });
    host.appendChild(row);
  }
}

function startRename(item, nameEl) {
  const input = document.createElement('input');
  input.value = item.name;
  nameEl.innerHTML = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();
  const done = commit => {
    if (commit) {
      const before = item.name;
      const raw = input.value.trim();
      if (raw && raw !== before) {
        item.name = '';
        item.name = app.uniqueName(raw);
        const after = item.name;
        app.undo.push({
          label: 'Rename',
          undo: () => { item.name = before; app.events.emit('items-changed'); app.events.emit('selection-changed', app.selected); },
          redo: () => { item.name = after; app.events.emit('items-changed'); app.events.emit('selection-changed', app.selected); },
        });
      }
    }
    rebuild();
    app.events.emit('selection-changed', app.selected); // refresh props name field
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}

export function initOutliner() {
  app.events.on('items-changed', rebuild);
  app.events.on('selection-changed', rebuild);
  rebuild();
}
