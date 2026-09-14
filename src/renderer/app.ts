import type { ScoutAgentEvent, ScoutState } from '../types/shared.ts';

declare global {
  interface Window {
    scout: {
      send(text: string): Promise<void>;
      abort(): Promise<void>;
      state(): Promise<ScoutState>;
      onEvent(cb: (payload: ScoutAgentEvent) => void): () => void;
    };
  }
}

const thread = document.getElementById('thread') as HTMLDivElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const modelBtn = document.getElementById('model-btn') as HTMLButtonElement;
const activity = document.getElementById('activity') as HTMLDivElement;
const convList = document.getElementById('conv-list') as HTMLUListElement;

const MODELS = ['gpt-5.2', 'claude-sonnet-4.6', 'gemini-3.6-pro'];
let modelIdx = 0;

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
  const node = el('div', `msg ${role}`);
  node.textContent = text;
  thread.appendChild(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

function logActivity(kind: string, text: string): void {
  activity.hidden = false;
  const line = el('div', 'activity-line');
  const k = el('span', 'activity-kind');
  k.textContent = kind;
  const t = el('span');
  t.textContent = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  line.append(k, t);
  activity.appendChild(line);
  activity.scrollTop = activity.scrollHeight;
}

let streaming: HTMLElement | null = null;
let streamText = '';
const hasBridge = typeof window.scout !== 'undefined';

function handleEvent(event: ScoutAgentEvent): void {
  switch (event.type) {
    case 'agent_start':
      setBusy(true);
      break;
    case 'message_start':
      if (event.role === 'assistant') {
        streaming = addMessage('assistant', '');
        streaming.classList.add('streaming');
        streamText = '';
      }
      break;
    case 'message_delta':
      streamText += event.text;
      if (streaming) {
        streaming.textContent = streamText;
        thread.scrollTop = thread.scrollHeight;
      }
      break;
    case 'message_end':
      if (streaming) {
        streaming.textContent = event.text;
        streaming.classList.remove('streaming');
        streaming = null;
      }
      break;
    case 'tool_call':
      logActivity('tool', `${event.name} ${JSON.stringify(event.args).slice(0, 100)}`);
      break;
    case 'tool_result':
      logActivity(event.ok ? 'done' : 'error', `${event.name}: ${event.summary}`);
      break;
    case 'agent_end':
      setBusy(false);
      break;
  }
}

function setBusy(busy: boolean): void {
  sendBtn.disabled = busy;
  stopBtn.hidden = !busy;
}

if (hasBridge) {
  window.scout.onEvent(handleEvent);
}

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text || sendBtn.disabled) return;
  input.value = '';
  addMessage('user', text);
  if (!hasBridge) {
    addMessage('assistant', '(no bridge — running outside Electron)');
    return;
  }
  try {
    await window.scout.send(text);
  } catch (err) {
    addMessage('assistant', `Error: ${(err as Error).message}`);
    setBusy(false);
  }
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => void window.scout.abort());
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
});

modelBtn.addEventListener('click', () => {
  modelIdx = (modelIdx + 1) % MODELS.length;
  modelBtn.textContent = `model: ${MODELS[modelIdx]} ▾`;
});

document.getElementById('new-conv')?.addEventListener('click', () => {
  thread.textContent = '';
  activity.textContent = '';
  activity.hidden = true;
  const li = el('li', 'conv-item active');
  li.textContent = `Conversation ${convList.children.length + 1}`;
  convList.querySelectorAll('.conv-item').forEach((n) => n.classList.remove('active'));
  convList.appendChild(li);
  input.focus();
});

// Restore state (e.g. after reload) then focus the composer.
if (hasBridge) {
  void window.scout.state().then((state) => {
    for (const m of state.messages) addMessage(m.role === 'user' ? 'user' : 'assistant', m.text);
    setBusy(state.busy);
    input.focus();
  });
}
