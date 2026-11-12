import { fetchIncidents, ack, resetCursor } from './api.js';

const REFRESH_MS = 2000; // R4

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.getElementById('status');

const rows = new Map(); // incident id -> <li>, kept across refreshes so acks and focus survive
const acked = new Map(); // incident id -> ackedAt
const incidents = new Map(); // incident id -> latest incident data (for the confirm's text)

// R5: viewer's local zone and the viewer's locale order (dd/mm for EU locales).
const timeFormat = new Intl.DateTimeFormat(navigator.languages?.[0] || navigator.language, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
});
const localTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFormat.format(d);
};

// Every incident field goes in as text, never as HTML.
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function ackedMark(at) {
  return el('span', { 'data-testid': 'acked', class: 'acked', title: at }, `acked ${localTime(at)}`);
}

// R2 (product, 2026-11-12): Ack asks to confirm, and the confirm names the incident id.
// The id is fixed when Ack is clicked; rows may keep moving (R1) while the confirm is open.
const confirmBox = document.querySelector('[data-testid="confirm"]');
const confirmText = confirmBox.querySelector('.confirm-text');
const confirmAck = confirmBox.querySelector('[data-testid="confirm-ack"]');
const confirmCancel = confirmBox.querySelector('[data-testid="confirm-cancel"]');
let pending = null; // incident id the open confirm names

function openConfirm(id) {
  if (pending) return; // one confirm at a time; a second Ack click does not replace the named id
  pending = id;
  const i = incidents.get(id);
  confirmBox.dataset.id = id;
  confirmText.textContent = i ? `Ack ${id}? ${i.service} · ${i.region} · ${i.summary}` : `Ack ${id}?`;
  confirmAck.textContent = `Ack ${id}`;
  confirmAck.disabled = false;
  confirmCancel.disabled = false;
  confirmBox.hidden = false;
  confirmCancel.focus(); // a stray Enter cancels, never acks
}

function closeConfirm() {
  pending = null;
  confirmBox.hidden = true;
  delete confirmBox.dataset.id;
}

confirmCancel.addEventListener('click', closeConfirm); // sends nothing
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pending && !confirmAck.disabled) closeConfirm();
});

confirmAck.addEventListener('click', async () => {
  const id = pending; // the id the confirm names, not the row under the pointer now
  if (!id) return;
  confirmAck.disabled = true;
  confirmCancel.disabled = true;
  confirmAck.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    rows.get(id)?.querySelector('[data-testid="ack"]')?.replaceWith(ackedMark(reply.ackedAt));
    closeConfirm();
  } catch (err) {
    console.error(err);
    confirmAck.disabled = false;
    confirmCancel.disabled = false;
    confirmAck.textContent = `Ack ${id}`;
    status.textContent = `Ack failed for ${id}. Try again.`;
  }
});

function ackButton(id) {
  const btn = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
  btn.addEventListener('click', () => openConfirm(id));
  return btn;
}

function buildRow(i) {
  const li = el('li', { 'data-testid': 'incident-row', 'data-id': i.id });
  li.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt }, localTime(i.openedAt)),
    acked.has(i.id) ? ackedMark(acked.get(i.id)) : ackButton(i.id),
  );
  return li;
}

function updateRow(li, i) {
  li.className = `row ${/^[\w-]+$/.test(i.severity) ? i.severity : ''}`;
  li.querySelector('.sev').textContent = i.severity;
  li.querySelector('.what').textContent = `${i.service} · ${i.region} · ${i.summary}`;
  const t = li.querySelector('time');
  t.setAttribute('datetime', i.openedAt);
  t.textContent = localTime(i.openedAt);
}

// R1: newest first, new ones on top. Existing rows are moved, not rebuilt.
function render(items) {
  const seen = new Set();
  let prev = null;
  for (const i of items) {
    seen.add(i.id);
    incidents.set(i.id, i);
    let li = rows.get(i.id);
    if (!li) {
      li = buildRow(i);
      rows.set(i.id, li);
    }
    updateRow(li, i);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== li) list.insertBefore(li, want);
    prev = li;
  }
  for (const [id, li] of rows) {
    if (!seen.has(id)) {
      li.remove();
      rows.delete(id);
      incidents.delete(id);
    }
  }
  empty.hidden = items.length > 0;
}

async function refresh() {
  const started = performance.now();
  try {
    const page = await fetchIncidents();
    render(page.incidents);
    loader.remove(); // R3: gone once incidents load
    status.textContent = `updated ${localTime(page.updatedAt)}`;
  } catch (err) {
    console.error(err);
    // A rejected cursor: the API says to poll again without `since`.
    if (String(err.message).startsWith('incidents: 400')) resetCursor();
    status.textContent = 'Could not reach the incident API. Retrying…';
  }
  setTimeout(refresh, Math.max(0, REFRESH_MS - (performance.now() - started))); // R4
}

refresh();
