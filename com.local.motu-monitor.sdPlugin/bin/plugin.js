import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const stateFile = path.join(os.homedir(), 'Library', 'Application Support', 'MOTU Monitor Control', 'state.json');

const ID = { busMute: 1028, pad: 5003, outputTrim: 5000, mainTrim: 5011, mono: 5018 };
const INDEX = { mainBus: 0, phonesBus: 10, mic1: 0, phonesL: 10, phonesR: 11 };
const ACTION = {
  mainMute: 'com.local.motu-monitor.mute',
  phonesMute: 'com.local.motu-monitor.phones-mute',
  mic1Pad: 'com.local.motu-monitor.mic1-mute',
  mono: 'com.local.motu-monitor.mono',
  dim: 'com.local.motu-monitor.dim',
  monitorUp: 'com.local.motu-monitor.monitor-up',
  monitorDown: 'com.local.motu-monitor.monitor-down',
  phonesUp: 'com.local.motu-monitor.phones-up',
  phonesDown: 'com.local.motu-monitor.phones-down'
};

function savedState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { return { dimActive: false, dimBaseline: null, dimTarget: null }; }
}

function byteFrame(id, index, value) {
  const b = Buffer.alloc(7);
  b.writeUInt16BE(id, 0);
  b.writeUInt16BE(index, 2);
  b.writeUInt16BE(1, 4);
  b[6] = Math.max(0, Math.min(255, Math.round(value)));
  return b;
}

class MotuBridge {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.observerOpen = false;
    this.controlOpen = false;
    this.got = { mainTrim: false, phonesTrim: false, mono: false, mainMute: false, phonesMute: false, mic1Pad: false };
    this.mainTrim = null;
    this.phonesTrim = null;
    this.mono = false;
    this.mainMute = false;
    this.phonesMute = false;
    this.mic1Pad = false;
    this.pending = { mainTrim: null, phonesTrim: null, mono: null, mainMute: null, phonesMute: null, mic1Pad: null, dim: null };
    Object.assign(this, savedState());
  }

  get connected() {
    return this.observerOpen && this.controlOpen && Object.values(this.got).every(Boolean);
  }

  snapshot() {
    return {
      connected: this.connected,
      mono: this.mono,
      mute: this.mainMute,
      mainMute: this.mainMute,
      phonesMute: this.phonesMute,
      mic1Pad: this.mic1Pad,
      dim: Boolean(this.dimActive),
      mainAttenuationDb: this.mainTrim,
      phonesAttenuationDb: this.phonesTrim,
      dimDb: config.dimDb,
      volumeStepDb: config.volumeStepDb,
      deviceUrl: config.deviceUrl
    };
  }

  start() { this.connect(); }

  connect() {
    clearTimeout(this.reconnectTimer);
    for (const s of [this.observer, this.control]) { try { s?.terminate(); } catch {} }
    this.observerOpen = this.controlOpen = false;
    for (const k of Object.keys(this.got)) this.got[k] = false;
    this.onStatus(this.snapshot());
    this.observer = new WebSocket(config.deviceUrl);
    this.control = new WebSocket(config.deviceUrl);
    this.observer.binaryType = 'nodebuffer';
    this.observer.on('open', () => {
      this.observerOpen = true;
      this.onStatus(this.snapshot());
      setTimeout(() => {
        if (this.observerOpen && this.controlOpen && !this.got.mono) this.send(ID.mono, 0, 0);
      }, 1200);
    });
    this.control.on('open', () => { this.controlOpen = true; this.onStatus(this.snapshot()); });
    this.observer.on('message', raw => this.receive(Buffer.from(raw)));
    const failed = () => this.reconnect();
    this.observer.on('close', failed);
    this.control.on('close', failed);
    this.observer.on('error', () => {});
    this.control.on('error', () => {});
  }

  reconnect() {
    this.observerOpen = this.controlOpen = false;
    this.onStatus(this.snapshot());
    if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 1500);
  }

  receive(data) {
    if (data.length < 5) return;
    const id = data.readUInt16BE(0), index = data.readUInt16BE(2), value = data[4];
    if (id === ID.mono && index === 0) return this.acceptBool('mono', value);
    if (id === ID.busMute && index === INDEX.mainBus) return this.acceptBool('mainMute', value);
    if (id === ID.busMute && index === INDEX.phonesBus) return this.acceptBool('phonesMute', value);
    if (id === ID.pad && index === INDEX.mic1) return this.acceptBool('mic1Pad', value);
    if (id === ID.outputTrim && index === INDEX.phonesL) {
      this.got.phonesTrim = true;
      this.phonesTrim = value;
      if (this.pending.phonesTrim === value) this.pending.phonesTrim = null;
      return this.onStatus(this.snapshot());
    }
    if (id === ID.mainTrim && index === 0) {
      this.got.mainTrim = true;
      this.mainTrim = value;
      if (this.pending.mainTrim === value) this.pending.mainTrim = null;
      if (this.pending.dim && value === this.pending.dim.expected) {
        this.dimActive = this.pending.dim.active;
        this.pending.dim = null;
        this.persistDim();
      } else if (this.dimActive && value !== this.dimTarget) {
        this.clearDim();
      } else if (!this.pending.dim && !this.dimActive && this.dimTarget !== null) {
        this.dimBaseline = this.dimTarget = null;
        this.persistDim();
      }
      return this.onStatus(this.snapshot());
    }
  }

  acceptBool(key, value) {
    this.got[key] = true;
    this[key] = Boolean(value);
    if (this.pending[key] === this[key]) this.pending[key] = null;
    this.onStatus(this.snapshot());
  }

  persistDim() {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ dimActive: Boolean(this.dimActive), dimBaseline: this.dimBaseline, dimTarget: this.dimTarget }, null, 2));
  }

  clearDim() {
    this.dimActive = false;
    this.dimBaseline = this.dimTarget = null;
    this.pending.dim = null;
    this.persistDim();
  }

  canWrite() { return this.connected && this.control?.readyState === WebSocket.OPEN; }
  send(id, index, value) { this.control.send(byteFrame(id, index, value)); }

  toggle(key, id, index) {
    if (!this.canWrite() || this.pending[key] !== null) return false;
    this.pending[key] = !this[key];
    this.send(id, index, this.pending[key] ? 1 : 0);
    return true;
  }

  toggleMono() { return this.toggle('mono', ID.mono, 0); }
  toggleMainMute() { return this.toggle('mainMute', ID.busMute, INDEX.mainBus); }
  togglePhonesMute() { return this.toggle('phonesMute', ID.busMute, INDEX.phonesBus); }
  toggleMic1Pad() { return this.toggle('mic1Pad', ID.pad, INDEX.mic1); }

  adjustMain(direction) {
    if (!this.canWrite()) return false;
    const base = this.pending.mainTrim ?? this.mainTrim;
    if (!Number.isFinite(base)) return false;
    if (this.dimActive || this.pending.dim) this.clearDim();
    const target = Math.max(0, Math.min(100, base - direction * Number(config.volumeStepDb)));
    this.pending.mainTrim = target;
    this.send(ID.mainTrim, 0, target);
    return true;
  }

  adjustPhones(direction) {
    if (!this.canWrite()) return false;
    const base = this.pending.phonesTrim ?? this.phonesTrim;
    if (!Number.isFinite(base)) return false;
    const target = Math.max(0, Math.min(100, base - direction * Number(config.volumeStepDb)));
    this.pending.phonesTrim = target;
    this.send(ID.outputTrim, INDEX.phonesL, target);
    this.send(ID.outputTrim, INDEX.phonesR, target);
    return true;
  }

  toggleDim() {
    if (!this.canWrite() || this.pending.dim) return false;
    if (!this.dimActive) {
      this.dimBaseline = this.mainTrim;
      this.dimTarget = Math.min(100, this.mainTrim + Number(config.dimDb));
      this.pending.dim = { active: true, expected: this.dimTarget };
      this.persistDim();
      this.send(ID.mainTrim, 0, this.dimTarget);
    } else {
      if (!Number.isFinite(this.dimBaseline)) return false;
      this.pending.dim = { active: false, expected: this.dimBaseline };
      this.send(ID.mainTrim, 0, this.dimBaseline);
    }
    return true;
  }
}

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const sdPort = arg('-port'), pluginUUID = arg('-pluginUUID'), registerEvent = arg('-registerEvent') || 'registerPlugin';
const contexts = new Map();
let deck = null;
function deckSend(m) { if (deck?.readyState === WebSocket.OPEN) deck.send(JSON.stringify(m)); }

function view(action, s) {
  if (action === ACTION.mainMute) return ['MAIN MUTE', s.mainMute];
  if (action === ACTION.phonesMute) return ['PH MUTE', s.phonesMute];
  if (action === ACTION.mic1Pad) return ['MIC 1 PAD', s.mic1Pad];
  if (action === ACTION.mono) return ['MONO', s.mono];
  if (action === ACTION.dim) return [`DIM\n−${s.dimDb} dB`, s.dim];
  if (action === ACTION.monitorUp) return [`MON +\n−${s.mainAttenuationDb ?? '—'} dB`, false];
  if (action === ACTION.monitorDown) return [`MON −\n−${s.mainAttenuationDb ?? '—'} dB`, false];
  if (action === ACTION.phonesUp) return [`PH +\n−${s.phonesAttenuationDb ?? '—'} dB`, false];
  if (action === ACTION.phonesDown) return [`PH −\n−${s.phonesAttenuationDb ?? '—'} dB`, false];
  return ['MOTU', false];
}

function render(context, action, status) {
  const [label, active] = view(action, status);
  const title = status.connected ? label : `${label.split('\n')[0]}\n离线`;
  deckSend({ event: 'setState', context, payload: { state: active ? 1 : 0 } });
  deckSend({ event: 'setTitle', context, payload: { title, target: 0 } });
}
function renderAll(status) { for (const [context, action] of contexts) render(context, action, status); }

const bridge = new MotuBridge(renderAll);
bridge.start();

function run(action) {
  if (action === ACTION.mainMute) return bridge.toggleMainMute();
  if (action === ACTION.phonesMute) return bridge.togglePhonesMute();
  if (action === ACTION.mic1Pad) return bridge.toggleMic1Pad();
  if (action === ACTION.mono) return bridge.toggleMono();
  if (action === ACTION.dim) return bridge.toggleDim();
  if (action === ACTION.monitorUp) return bridge.adjustMain(1);
  if (action === ACTION.monitorDown) return bridge.adjustMain(-1);
  if (action === ACTION.phonesUp) return bridge.adjustPhones(1);
  if (action === ACTION.phonesDown) return bridge.adjustPhones(-1);
  return false;
}

if (sdPort && pluginUUID) {
  deck = new WebSocket(`ws://127.0.0.1:${sdPort}`);
  deck.on('open', () => deckSend({ event: registerEvent, uuid: pluginUUID }));
  deck.on('message', raw => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.event === 'willAppear') { contexts.set(m.context, m.action); render(m.context, m.action, bridge.snapshot()); }
    else if (m.event === 'willDisappear') contexts.delete(m.context);
    else if (m.event === 'keyDown' && !run(m.action)) deckSend({ event: 'showAlert', context: m.context });
  });
}

const endpoints = new Map([
  ['/mute/toggle', () => bridge.toggleMainMute()], ['/main-mute/toggle', () => bridge.toggleMainMute()],
  ['/phones-mute/toggle', () => bridge.togglePhonesMute()],
  ['/mic1-pad/toggle', () => bridge.toggleMic1Pad()], ['/mic1-mute/toggle', () => bridge.toggleMic1Pad()],
  ['/mono/toggle', () => bridge.toggleMono()], ['/dim/toggle', () => bridge.toggleDim()],
  ['/monitor/up', () => bridge.adjustMain(1)], ['/monitor/down', () => bridge.adjustMain(-1)],
  ['/phones/up', () => bridge.adjustPhones(1)], ['/phones/down', () => bridge.adjustPhones(-1)]
]);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${config.httpPort}`);
  const action = endpoints.get(url.pathname);
  let ok = true;
  if (action) ok = action();
  else if (!['/', '/status', '/health'].includes(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found' }));
  }
  res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok, ...bridge.snapshot() }));
});
server.on('error', e => console.error('HTTP bridge:', e.message));
server.listen(Number(config.httpPort), '127.0.0.1');
