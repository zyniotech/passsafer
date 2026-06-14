/**
 * PassSafer – Autofill-Modul (Content Script)
 *
 * Füllt Anmeldedaten in Login- und Registrierungsformulare ein.
 * Verwendet native Setter und Framework-kompatible Events,
 * damit React / Vue / Angular die Wertänderungen erkennen.
 */

'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.Autofill = (function () {
  // ── Hilfsfunktion ──────────────────────────────────────────────────

  /**
   * Setzt den Wert eines <input>-Elements so, dass auch
   * Framework-gesteuerte Inputs die Änderung registrieren.
   *
   * @param {HTMLInputElement} element  – Ziel-Input
   * @param {string}          value    – Einzutragender Wert
   */
  function setNativeValue(element, value) {
    if (!element) {
      console.warn('[PassSafer:Autofill] setNativeValue: Kein Element übergeben.');
      return;
    }

    // Nativen Setter verwenden, damit React & Co. den Wert akzeptieren
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;

    nativeInputValueSetter.call(element, value);

    // Standard-Events für Formularbindungen
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Tastatur-Events für Frameworks, die auf keydown/keyup hören
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // ── Öffentliche API ────────────────────────────────────────────────

  /**
   * Füllt Benutzername und Passwort in die übergebenen Felder ein.
   *
   * @param {HTMLInputElement|null} usernameField – Benutzername-Feld (kann null sein)
   * @param {HTMLInputElement|null} passwordField – Passwort-Feld   (kann null sein)
   * @param {string}               username      – Benutzername
   * @param {string}               password      – Passwort
   * @returns {boolean} true bei Erfolg
   */
  function fillCredentials(usernameField, passwordField, username, password) {
    try {
      if (usernameField && username) {
        usernameField.focus();
        setNativeValue(usernameField, username);
      }

      if (passwordField && password) {
        passwordField.focus();
        setNativeValue(passwordField, password);
      }

      return true;
    } catch (err) {
      console.error('[PassSafer:Autofill] fillCredentials fehlgeschlagen:', err);
      return false;
    }
  }

  /**
   * Füllt mehrere Passwort-Felder mit demselben Wert
   * (z. B. bei Registrierungsformularen mit Passwort-Bestätigung).
   *
   * @param {HTMLInputElement[]} fields   – Array von Passwort-Inputs
   * @param {string}             password – Das einzutragende Passwort
   * @returns {boolean} true bei Erfolg
   */
  function fillAllPasswordFields(fields, password) {
    try {
      if (!Array.isArray(fields) || fields.length === 0) {
        console.warn('[PassSafer:Autofill] fillAllPasswordFields: Keine Felder übergeben.');
        return false;
      }

      for (const field of fields) {
        setNativeValue(field, password);
      }

      return true;
    } catch (err) {
      console.error('[PassSafer:Autofill] fillAllPasswordFields fehlgeschlagen:', err);
      return false;
    }
  }

  // ── Modul exportieren ──────────────────────────────────────────────

  return {
    setNativeValue: setNativeValue,
    fillCredentials: fillCredentials,
    fillAllPasswordFields: fillAllPasswordFields,
  };
})();
