'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.Generator = (function () {
  var UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
  var NUMBERS = '0123456789';

  var DEFAULT_OPTIONS = Object.freeze({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    symbolChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  });

  function secureRandomInt(max) {
    if (max <= 0) return 0;

    var array = new Uint32Array(1);
    var limit = Math.floor(0xffffffff / max) * max;

    do {
      crypto.getRandomValues(array);
    } while (array[0] >= limit);

    return array[0] % max;
  }

  function randomCharFrom(pool) {
    return pool[secureRandomInt(pool.length)];
  }

  function secureShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = secureRandomInt(i + 1);
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function generate(options) {
    var opts = Object.assign({}, DEFAULT_OPTIONS, options || {});

    var pool = '';
    var categories = [];

    if (opts.uppercase) {
      pool += UPPERCASE;
      categories.push(UPPERCASE);
    }
    if (opts.lowercase) {
      pool += LOWERCASE;
      categories.push(LOWERCASE);
    }
    if (opts.numbers) {
      pool += NUMBERS;
      categories.push(NUMBERS);
    }
    if (opts.symbols && opts.symbolChars) {
      pool += opts.symbolChars;
      categories.push(opts.symbolChars);
    }

    if (pool.length === 0) {
      console.error('[PassSafer:Generator] No character pool selected.');
      return '';
    }

    var length = Math.max(opts.length, categories.length);
    var result = [];

    for (var c = 0; c < categories.length; c++) {
      result.push(randomCharFrom(categories[c]));
    }

    while (result.length < length) {
      result.push(randomCharFrom(pool));
    }

    secureShuffle(result);

    return result.join('');
  }

  function getStrength(password) {
    if (!password) {
      return { score: 0, label: 'Very weak', color: '#e74c3c' };
    }

    var score = 0;

    if (password.length >= 8) score++;
    if (password.length >= 14) score++;
    if (password.length >= 20) score++;

    var hasUpper = /[A-Z]/.test(password);
    var hasLower = /[a-z]/.test(password);
    var hasDigit = /[0-9]/.test(password);
    var hasSymbol = /[^A-Za-z0-9]/.test(password);

    var variety =
      (hasUpper ? 1 : 0) +
      (hasLower ? 1 : 0) +
      (hasDigit ? 1 : 0) +
      (hasSymbol ? 1 : 0);

    if (variety >= 3) score++;
    if (variety >= 4) score++;

    var repeatedPattern = /(.)\1{2,}/;
    if (repeatedPattern.test(password)) {
      score = Math.max(0, score - 1);
    }

    score = Math.min(4, Math.max(0, score));

    var levels = [
      { label: 'Very weak', color: '#e74c3c' },
      { label: 'Weak', color: '#f39c12' },
      { label: 'Medium', color: '#f39c12' },
      { label: 'Strong', color: '#2ecc71' },
      { label: 'Very strong', color: '#2ecc71' },
    ];

    return {
      score: score,
      label: levels[score].label,
      color: levels[score].color,
    };
  }

  return {
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    generate: generate,
    getStrength: getStrength,
  };
})();
