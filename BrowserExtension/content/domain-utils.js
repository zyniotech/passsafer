/**
 * PassSafer – Domain-Hilfsfunktionen (Content Script)
 *
 * Stellt Utility-Methoden zur Domainverarbeitung bereit:
 *   • getBaseDomain  – extrahiert die eTLD+1 aus einem Hostnamen
 *   • domainsMatch   – vergleicht zwei Domains anhand ihrer Basis-Domain
 *   • getCurrentDomain – gibt die Basis-Domain der aktuellen Seite zurück
 *
 * WICHTIG: Dieses Skript teilt sich den globalen Scope mit anderen
 * Content Scripts – daher kein ES-Module-Syntax (kein import/export).
 */

// Globalen Namespace initialisieren, falls noch nicht vorhanden
window.PassSafer = window.PassSafer || {};

window.PassSafer.DomainUtils = (() => {
  'use strict';

  // ── Bekannte zweiteilige TLDs (eTLD-Liste, häufigste Einträge) ──
  const TWO_PART_TLDS = new Set([
    'co.uk',
    'com.au',
    'co.jp',
    'com.br',
    'co.nz',
    'co.kr',
    'co.in',
    'org.uk',
    'net.au',
  ]);

  /**
   * Extrahiert die Basis-Domain (eTLD+1) aus einem Hostnamen.
   *
   * Beispiele:
   *   'sub.example.co.uk' → 'example.co.uk'
   *   'auth.github.com'   → 'github.com'
   *   'localhost'          → 'localhost'
   *
   * @param {string} hostname – der zu verarbeitende Hostname
   * @returns {string} die Basis-Domain in Kleinbuchstaben
   */
  function getBaseDomain(hostname) {
    if (!hostname || typeof hostname !== 'string') {
      return '';
    }

    // Alles in Kleinbuchstaben normalisieren
    const host = hostname.toLowerCase().trim();
    const parts = host.split('.');

    // Einzel-Label (z. B. "localhost") direkt zurückgeben
    if (parts.length <= 2) {
      return host;
    }

    // Prüfen, ob die letzten zwei Teile eine bekannte zweiteilige TLD bilden
    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;

    if (TWO_PART_TLDS.has(lastTwo)) {
      // Zweiteilige TLD → die letzten 3 Teile ergeben die Basis-Domain
      return parts.slice(-3).join('.');
    }

    // Standard-TLD → die letzten 2 Teile ergeben die Basis-Domain
    return parts.slice(-2).join('.');
  }

  /**
   * Vergleicht zwei Domains anhand ihrer Basis-Domain.
   *
   * @param {string} domain1 – erster Hostname / Domain
   * @param {string} domain2 – zweiter Hostname / Domain
   * @returns {boolean} true, wenn die Basis-Domains übereinstimmen
   */
  function domainsMatch(domain1, domain2) {
    return getBaseDomain(domain1) === getBaseDomain(domain2);
  }

  /**
   * Gibt die Basis-Domain der aktuellen Seite zurück.
   *
   * @returns {string} eTLD+1 des aktuellen window.location.hostname
   */
  function getCurrentDomain() {
    return getBaseDomain(window.location.hostname);
  }

  // ── Öffentliche API ──
  return {
    getBaseDomain,
    domainsMatch,
    getCurrentDomain,
  };
})();
