import { EventEmitter } from 'node:events';
import { getDb, save } from './store.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export const changed = () => bus.emit('change');
export const toast = (icon, title, text) => bus.emit('toast', { icon, title, text });

export function feed(agent, text) {
  const db = getDb();
  db.feed.unshift({ agent, text, at: Date.now() });
  if (db.feed.length > 80) db.feed.length = 80;
  save(); changed();
}
