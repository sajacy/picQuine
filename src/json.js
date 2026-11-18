'use strict';
// Native JSON parsing, with a small pre-scan so duplicate keys cannot disappear
// silently.
const picQuineJSON = {
  equal(left, right) {
    if (left === right) {
      return true;
    }
    if (!left || !right || typeof left !== 'object' ||
        typeof right !== 'object' ||
        Array.isArray(left) !== Array.isArray(right)) {
      return false;
    }
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length &&
        keys.every(
            (key) => Object.hasOwn(right, key) &&
                picQuineJSON.equal(left[key], right[key]));
  },
  parse(text) {
    const stack = [];
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      const frame = stack.at(-1);
      if (char === '"') {
        const start = index;
        while (++index < text.length) {
          if (text[index] === '\\') {
            index++;
          } else if (text[index] === '"') {
            break;
          }
        }
        if (frame?.key) {
          const key = JSON.parse(text.slice(start, index + 1));
          if (frame.names.has(key)) {
            throw Error('Duplicate JSON key: ' + key);
          }
          frame.names.add(key);
          frame.key = false;
        }
      } else if (char === '{' || char === '[') {
        if (stack.length >= 100) {
          throw Error('JSON nesting exceeds 100 levels.');
        }
        stack.push(char === '{' ? {names: new Set(), key: true} : {});
      } else if (char === '}' || char === ']') {
        stack.pop();
      } else if (char === ',' && frame?.names) {
        frame.key = true;
      } else if (char === ':' && frame?.names) {
        frame.key = false;
      }
    }
    return JSON.parse(text, (_, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw Error('Non-finite JSON number.');
      }
      return value;
    });
  },
};
