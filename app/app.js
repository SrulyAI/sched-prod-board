import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.getElementById('status');

const rows = new Map(); // incident id -> <li>, kept across refreshes so acks and focus survive
const acked = new Map(); // incident id -> ackedAt

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

function ackButton(id) {
  const btn = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Acking…';
    try {
      const reply = await ack(id); // R2: acks this row's incident
      acked.set(id, reply.ackedAt);
      btn.replaceWith(ackedMark(reply.ackedAt));
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Ack';
      status.textContent = `Ack failed for ${id}. Try again.`;
    }
  });
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
function render(incidents) {
  const seen = new Set();
  let prev = null;
  for (const i of incidents) {
    seen.add(i.id);
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
    }
  }
  empty.hidden = incidents.length > 0;
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
    status.textContent = 'Could not reach the incident API. Retrying…';
  }
  setTimeout(refresh, Math.max(0, REFRESH_MS - (performance.now() - started))); // R4
}

refresh();
