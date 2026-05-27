/**
 * PassSafer – Passwort-Generator (Content Script)
 *
 * Erzeugt kryptographisch sichere Passwörter mit konfigurierbarer
 * Länge und Zeichenauswahl. Verwendet ausschließlich
 * crypto.getRandomValues – niemals Math.random.
 */

'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.Generator = (function () {
  // ── Zeichenvorräte ─────────────────────────────────────────────────

  var UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
  var NUMBERS   = '0123456789';

  /** Standard-Optionen für die Passwort-Generierung */
  var DEFAULT_OPTIONS = Object.freeze({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
    symbolChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  });

  // ── Interne Hilfsfunktionen ────────────────────────────────────────

  /**
   * Gibt eine kryptographisch sichere Zufallszahl im Bereich [0, max) zurück.
   * Nutzt Rejection-Sampling, um Modulo-Bias zu vermeiden.
   *
   * @param {number} max – Obere Grenze (exklusiv)
   * @returns {number}
   */
  function secureRandomInt(max) {
    if (max <= 0) return 0;

    var array = new Uint32Array(1);
    // Größter Wert, der ohne Bias durch max teilbar ist
    var limit = Math.floor(0xFFFFFFFF / max) * max;

    do {
      crypto.getRandomValues(array);
    } while (array[0] >= limit);

    return array[0] % max;
  }

  /**
   * Wählt ein zufälliges Zeichen aus einem String.
   *
   * @param {string} pool – Zeichenvorrat
   * @returns {string} Ein einzelnes Zeichen
   */
  function randomCharFrom(pool) {
    return pool[secureRandomInt(pool.length)];
  }

  /**
   * Fisher-Yates-Shuffle mit kryptographisch sicherem Zufall.
   *
   * @param {Array} arr – Array, das in-place gemischt wird
   * @returns {Array} Dasselbe Array (gemischt)
   */
  function secureShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = secureRandomInt(i + 1);
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  // ── Öffentliche API ────────────────────────────────────────────────

  /**
   * Erzeugt ein sicheres Passwort.
   *
   * @param {Object} [options]                – Überschreibungen für DEFAULT_OPTIONS
   * @param {number} [options.length]         – Gewünschte Passwortlänge
   * @param {boolean} [options.uppercase]     – Großbuchstaben einschließen
   * @param {boolean} [options.lowercase]     – Kleinbuchstaben einschließen
   * @param {boolean} [options.numbers]       – Ziffern einschließen
   * @param {boolean} [options.symbols]       – Sonderzeichen einschließen
   * @param {string}  [options.symbolChars]   – Erlaubte Sonderzeichen
   * @returns {string} Das generierte Passwort
   */
  function generate(options) {
    var opts = Object.assign({}, DEFAULT_OPTIONS, options || {});

    // Zeichenpool zusammenstellen
    var pool = '';
    var categories = []; // Paare [pool, istAktiv] für Diversity-Garantie

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

    // Garantierte Diversität: mindestens ein Zeichen pro aktivierter Kategorie
    for (var c = 0; c < categories.length; c++) {
      result.push(randomCharFrom(categories[c]));
    }

    // Restliche Zeichen aus dem gesamten Pool füllen
    while (result.length < length) {
      result.push(randomCharFrom(pool));
    }

    // Mischen, damit die garantierten Zeichen nicht am Anfang stehen
    secureShuffle(result);

    return result.join('');
  }

  /**
   * Bewertet die Stärke eines Passworts.
   *
   * @param {string} password – Zu bewertendes Passwort
   * @returns {{ score: number, label: string, color: string }}
   */
  function getStrength(password) {
    if (!password) {
      return { score: 0, label: 'Sehr schwach', color: '#dc2626' };
    }

    var score = 0;

    // Punkte für Länge
    if (password.length >= 8)  score++;
    if (password.length >= 14) score++;
    if (password.length >= 20) score++;

    // Zeichenvielfalt prüfen
    var hasUpper  = /[A-Z]/.test(password);
    var hasLower  = /[a-z]/.test(password);
    var hasDigit  = /[0-9]/.test(password);
    var hasSymbol = /[^A-Za-z0-9]/.test(password);

    var variety = (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) +
                  (hasDigit ? 1 : 0) + (hasSymbol ? 1 : 0);

    if (variety >= 3) score++;
    if (variety >= 4) score++;

    // Abzug für viele aufeinanderfolgende Wiederholungen
    var repeatedPattern = /(.)\1{2,}/; // 3+ gleiche Zeichen hintereinander
    if (repeatedPattern.test(password)) {
      score = Math.max(0, score - 1);
    }

    // Score auf 0-4 begrenzen
    score = Math.min(4, Math.max(0, score));

    var levels = [
      { label: 'Very weak', color: '#dc2626' },  // 0 – Rot
      { label: 'Weak',      color: '#f97316' },   // 1 – Orange
      { label: 'Medium',    color: '#eab308' },   // 2 – Gelb
      { label: 'Strong',    color: '#22c55e' },    // 3 – Grün
      { label: 'Very strong', color: '#16a34a' },    // 4 – Dunkelgrün
    ];

    return {
      score: score,
      label: levels[score].label,
      color: levels[score].color,
    };
  }

  // ── Modul exportieren ──────────────────────────────────────────────

  return {
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    generate: generate,
    getStrength: getStrength,
  };
})();
