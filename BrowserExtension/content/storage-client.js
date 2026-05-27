/**
 * PassSafer – Storage-Client (Content Script)
 *
 * Kommuniziert mit dem Background-Service-Worker über
 * chrome.runtime.sendMessage und stellt asynchrone Methoden bereit:
 *   • getLogins      – Zugangsdaten für eine Domain abrufen
 *   • checkExists    – prüfen, ob ein Credential bereits existiert
 *   • saveLogin      – Zugangsdaten speichern / aktualisieren
 *   • ignoreSite     – eine Domain auf die Ignorier-Liste setzen
 *   • checkIgnored   – prüfen, ob eine Domain ignoriert wird
 *   • setPendingSave – ausstehende Speicherdaten zwischenspeichern
 *   • getPendingSave – ausstehende Speicherdaten abrufen
 *
 * WICHTIG: Kein ES-Module-Syntax – der globale Scope wird mit
 * anderen Content Scripts geteilt.
 */

// Globalen Namespace initialisieren, falls noch nicht vorhanden
window.PassSafer = window.PassSafer || {};

window.PassSafer.StorageClient = (() => {
  'use strict';

  // ── Interner Helper ──────────────────────────────────────────────

  /**
   * Verpackt chrome.runtime.sendMessage in ein Promise mit
   * Fehlerbehandlung für chrome.runtime.lastError.
   *
   * @param {object} message – die Nachricht, die an den Background gesendet wird
   * @returns {Promise<*>} – löst sich mit der Antwort auf oder wird bei Fehler rejected
   */
  function _sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          // chrome.runtime.lastError muss innerhalb des Callbacks geprüft werden,
          // damit Chrome den Fehler nicht als unbehandelten Fehler loggt.
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        // Fängt Fehler ab, die beim Aufruf von sendMessage selbst auftreten
        // (z. B. wenn der Extension-Kontext ungültig geworden ist).
        reject(error);
      }
    });
  }

  // ── Öffentliche API ──────────────────────────────────────────────

  /**
   * Ruft alle gespeicherten Zugangsdaten für eine bestimmte Domain ab.
   *
   * @param {string} domain – die Domain, für die Logins abgefragt werden
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function getLogins(domain) {
    return _sendMessage({
      action: 'get-logins-for-domain',
      domain,
    });
  }

  /**
   * Prüft, ob ein bestimmtes Credential bereits gespeichert ist.
   *
   * @param {string} domain   – die zugehörige Domain
   * @param {string} username – der Benutzername
   * @param {string} password – das Passwort
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function checkExists(domain, username, password) {
    return _sendMessage({
      action: 'check-if-credential-exists',
      domain,
      username,
      password,
    });
  }

  /**
   * Speichert oder aktualisiert ein Credential im Background-Storage.
   *
   * @param {string}  domain   – die zugehörige Domain
   * @param {string}  username – der Benutzername
   * @param {string}  password – das Passwort
   * @param {boolean} isUpdate – true, wenn ein bestehendes Credential aktualisiert wird
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function saveLogin(domain, username, password, isUpdate) {
    return _sendMessage({
      action: 'save-credential',
      domain,
      username,
      password,
      isUpdate,
    });
  }

  /**
   * Setzt eine Domain auf die Ignorier-Liste, sodass keine
   * Speicher-Aufforderungen mehr für diese Domain angezeigt werden.
   *
   * @param {string} domain – die zu ignorierende Domain
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function ignoreSite(domain) {
    return _sendMessage({
      action: 'ignore-site',
      domain,
    });
  }

  /**
   * Prüft, ob eine Domain auf der Ignorier-Liste steht.
   *
   * @param {string} domain – die zu prüfende Domain
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function checkIgnored(domain) {
    return _sendMessage({
      action: 'check-ignored',
      domain,
    });
  }

  /**
   * Speichert ausstehende Daten (z. B. erkannte Formular-Eingaben)
   * vorübergehend im Background, bis der Nutzer eine Entscheidung trifft.
   *
   * @param {object} data – die zwischenzuspeichernden Daten
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function setPendingSave(data) {
    return _sendMessage({
      action: 'set-pending-save',
      data,
    });
  }

  /**
   * Ruft die zuletzt zwischengespeicherten ausstehenden Daten ab.
   *
   * @returns {Promise<*>} Antwort des Background-Workers
   */
  async function getPendingSave() {
    return _sendMessage({
      action: 'get-pending-save',
    });
  }

  // ── Öffentliche API exportieren ──
  return {
    getLogins,
    checkExists,
    saveLogin,
    ignoreSite,
    checkIgnored,
    setPendingSave,
    getPendingSave,
  };
})();
