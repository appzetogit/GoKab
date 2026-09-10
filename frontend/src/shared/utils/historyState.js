const isPlainObject = (value) => {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const serializeError = (error, seen) => {
  const next = {
    name: String(error?.name || 'Error'),
    message: String(error?.message || ''),
  };

  if (error?.stack) {
    next.stack = String(error.stack);
  }

  if (error?.cause !== undefined) {
    next.cause = toHistorySafeState(error.cause, seen);
  }

  Object.entries(error || {}).forEach(([key, value]) => {
    const safeValue = toHistorySafeState(value, seen);
    if (safeValue !== undefined) {
      next[key] = safeValue;
    }
  });

  return next;
};

export const toHistorySafeState = (value, seen = new WeakMap()) => {
  if (value == null) {
    return value;
  }

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'bigint') {
    return String(value);
  }

  if (valueType === 'function' || valueType === 'symbol') {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (value instanceof RegExp) {
    return {
      __type: 'RegExp',
      source: value.source,
      flags: value.flags,
    };
  }

  if (value instanceof Error) {
    return serializeError(value, seen);
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.set(value, true);
    const entries = [];
    value.forEach((entryValue, entryKey) => {
      const safeKey = toHistorySafeState(entryKey, seen);
      const safeValue = toHistorySafeState(entryValue, seen);
      if (safeKey !== undefined && safeValue !== undefined) {
        entries.push([safeKey, safeValue]);
      }
    });
    seen.delete(value);

    return {
      __type: 'Map',
      entries,
    };
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.set(value, true);
    const values = Array.from(value)
      .map((item) => toHistorySafeState(item, seen))
      .filter((item) => item !== undefined);
    seen.delete(value);

    return {
      __type: 'Set',
      values,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.set(value, true);
    const next = value
      .map((item) => toHistorySafeState(item, seen))
      .filter((item) => item !== undefined);
    seen.delete(value);
    return next;
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.set(value, true);

    const base = {};
    if (!isPlainObject(value)) {
      base.__type = String(value?.constructor?.name || 'Object');
    }

    Object.entries(value).forEach(([key, entryValue]) => {
      const safeValue = toHistorySafeState(entryValue, seen);
      if (safeValue !== undefined) {
        base[key] = safeValue;
      }
    });

    seen.delete(value);
    return base;
  }

  return undefined;
};

const isDataCloneError = (error) =>
  error?.name === 'DataCloneError'
  || /could not be cloned|DataCloneError/i.test(String(error?.message || ''));

const wrapHistoryMethod = (historyObject, methodName) => {
  const original = historyObject?.[methodName];

  if (typeof original !== 'function' || original.__redigoHistorySafeWrapped) {
    return;
  }

  const wrapped = function wrappedHistoryState(state, unused, url) {
    try {
      return original.call(this, state, unused, url);
    } catch (error) {
      if (!isDataCloneError(error)) {
        throw error;
      }

      return original.call(this, toHistorySafeState(state), unused, url);
    }
  };

  wrapped.__redigoHistorySafeWrapped = true;
  historyObject[methodName] = wrapped;
};

export const installHistoryStateProtection = () => {
  if (typeof window === 'undefined' || !window.history) {
    return;
  }

  wrapHistoryMethod(window.history, 'pushState');
  wrapHistoryMethod(window.history, 'replaceState');
};
