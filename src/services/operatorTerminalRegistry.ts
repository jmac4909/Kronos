export interface OperatorTerminalBinding {
  sessionId: string;
  bindingId: string;
}

export type OperatorTerminalResolution<T extends object> =
  | { kind: 'resolved'; terminal: T; binding: OperatorTerminalBinding }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; bindingIds: string[] };

interface LiveTerminalBinding<T extends object> {
  terminal: T;
  binding: OperatorTerminalBinding;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;

/**
 * Keeps the deliberately ephemeral relationship between durable work-session
 * records and VS Code Terminal objects. The registry never creates, disposes,
 * reads from, writes to, or otherwise controls a terminal.
 */
export class OperatorTerminalRegistry<T extends object> {
  private readonly byTerminal = new WeakMap<T, OperatorTerminalBinding>();
  private readonly byBinding = new Map<string, LiveTerminalBinding<T>>();

  attach(terminal: T, binding: OperatorTerminalBinding): OperatorTerminalBinding {
    const normalized = normalizeBinding(binding);
    const key = bindingKey(normalized);

    const previousForTerminal = this.byTerminal.get(terminal);
    if (previousForTerminal) {
      this.byBinding.delete(bindingKey(previousForTerminal));
    }

    const previousForBinding = this.byBinding.get(key);
    if (previousForBinding && previousForBinding.terminal !== terminal) {
      this.byTerminal.delete(previousForBinding.terminal);
    }

    this.byTerminal.set(terminal, normalized);
    this.byBinding.set(key, { terminal, binding: normalized });
    return { ...normalized };
  }

  bindingForTerminal(terminal: T): OperatorTerminalBinding | undefined {
    const binding = this.byTerminal.get(terminal);
    return binding ? { ...binding } : undefined;
  }

  resolve(sessionId: string, bindingId?: string): OperatorTerminalResolution<T> {
    const safeSessionId = normalizeId(sessionId, 'work session id');
    if (bindingId !== undefined) {
      const safeBindingId = normalizeId(bindingId, 'terminal binding id');
      const live = this.byBinding.get(bindingKey({ sessionId: safeSessionId, bindingId: safeBindingId }));
      return live
        ? { kind: 'resolved', terminal: live.terminal, binding: { ...live.binding } }
        : { kind: 'missing' };
    }

    const matches = this.liveBindingsForSession(safeSessionId);
    if (matches.length === 0) { return { kind: 'missing' }; }
    if (matches.length > 1) {
      return {
        kind: 'ambiguous',
        bindingIds: matches.map(match => match.binding.bindingId).sort(),
      };
    }
    const match = matches[0];
    if (!match) { return { kind: 'missing' }; }
    return { kind: 'resolved', terminal: match.terminal, binding: { ...match.binding } };
  }

  detachTerminal(terminal: T): OperatorTerminalBinding | undefined {
    const binding = this.byTerminal.get(terminal);
    if (!binding) { return undefined; }
    this.byTerminal.delete(terminal);
    this.byBinding.delete(bindingKey(binding));
    return { ...binding };
  }

  detachBinding(sessionId: string, bindingId: string): OperatorTerminalBinding | undefined {
    const binding: OperatorTerminalBinding = {
      sessionId: normalizeId(sessionId, 'work session id'),
      bindingId: normalizeId(bindingId, 'terminal binding id'),
    };
    const key = bindingKey(binding);
    const live = this.byBinding.get(key);
    if (!live) { return undefined; }
    this.byBinding.delete(key);
    this.byTerminal.delete(live.terminal);
    return { ...live.binding };
  }

  detachSession(sessionId: string): OperatorTerminalBinding[] {
    const safeSessionId = normalizeId(sessionId, 'work session id');
    const detached: OperatorTerminalBinding[] = [];
    for (const live of this.liveBindingsForSession(safeSessionId)) {
      this.byBinding.delete(bindingKey(live.binding));
      this.byTerminal.delete(live.terminal);
      detached.push({ ...live.binding });
    }
    return detached.sort((left, right) => left.bindingId.localeCompare(right.bindingId));
  }

  listBindings(sessionId?: string): OperatorTerminalBinding[] {
    const safeSessionId = sessionId === undefined ? undefined : normalizeId(sessionId, 'work session id');
    return [...this.byBinding.values()]
      .map(live => live.binding)
      .filter(binding => safeSessionId === undefined || binding.sessionId === safeSessionId)
      .map(binding => ({ ...binding }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.bindingId.localeCompare(right.bindingId));
  }

  clear(): void {
    for (const live of this.byBinding.values()) {
      this.byTerminal.delete(live.terminal);
    }
    this.byBinding.clear();
  }

  private liveBindingsForSession(sessionId: string): Array<LiveTerminalBinding<T>> {
    return [...this.byBinding.values()].filter(live => live.binding.sessionId === sessionId);
  }
}

export function createOperatorTerminalRegistry<T extends object>(): OperatorTerminalRegistry<T> {
  return new OperatorTerminalRegistry<T>();
}

function normalizeBinding(binding: OperatorTerminalBinding): OperatorTerminalBinding {
  return {
    sessionId: normalizeId(binding.sessionId, 'work session id'),
    bindingId: normalizeId(binding.bindingId, 'terminal binding id'),
  };
}

function normalizeId(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return normalized;
}

function bindingKey(binding: OperatorTerminalBinding): string {
  return `${binding.sessionId}:${binding.bindingId}`;
}
