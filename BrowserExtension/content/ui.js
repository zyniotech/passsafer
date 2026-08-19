/**
 * PassSafer UI Modul — content/ui.js
 * ====================================
 * Rendert alle PassSafer-Oberflächen (Dropdown, Banner, Toast) innerhalb von
 * Shadow DOM, damit Styles nicht mit der Host-Seite kollidieren.
 *
 * Namespace: window.PassSafer.UI
 * Kein ES-Module-Syntax — wird als Content Script via manifest.json geladen.
 */

'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.UI = (() => {

  // ─── Konstanten ──────────────────────────────────────────────────────────────

  const COLORS = {
    bg:          '#2d2d2d',
    bgHover:     '#363636',
    border:      '#404040',
    accent:      '#ff8c00',
    accentHover: '#ff9f26',
    text:        '#e5e5e5',
    textMuted:   '#888888',
    success:     '#22c55e',
    warning:     '#eab308',
    danger:      '#e74c3c'
  };

  const FONT_STACK =
    "'DM Sans', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif";

  // Icon-URLs über chrome.runtime.getURL (Web-Accessible-Resources)
  const ICON_16 = chrome.runtime.getURL('icons/icon16.png');
  const ICON_48 = chrome.runtime.getURL('icons/icon48.png');

  // ─── State ───────────────────────────────────────────────────────────────────

  /** @type {HTMLElement|null} Aktuell sichtbarer Dropdown-Host */
  let _activeDropdown = null;

  /** @type {HTMLElement|null} Aktuell sichtbares Banner-Host */
  let _activeBanner = null;

  /** Globale Listener, die beim Schliessen entfernt werden müssen */
  let _dropdownCleanups = [];

  // ─── Hilfsfunktionen ────────────────────────────────────────────────────────

  /**
   * Escapet HTML-Sonderzeichen, um XSS zu verhindern.
   * @param {string} str
   * @returns {string}
   */
  function _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

  /**
   * Generates a favicon URL for a given domain using Google's Favicon service.
   * @param {string} domain 
   * @returns {string|null}
   */
  function getFaviconUrl(domain) {
    if (!domain) return null;
    try {
        let domainStr = domain.toString();
        let d = domainStr.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
        if (!d) return null;
        
        let targetUrl = domainStr.startsWith('http') ? domainStr : 'https://' + d;
        if (!d.includes('.')) {
            targetUrl = domainStr.startsWith('https') ? 'https://' + d : 'http://' + d;
        }

        const url = new URL(chrome.runtime.getURL("/_favicon/"));
        url.searchParams.set("pageUrl", targetUrl);
        url.searchParams.set("size", "64");
        return url.toString();
    } catch (err) {
        console.error('[getFaviconUrl] error:', err);
        return null;
    }
  }

  // ─── Gemeinsame Styles ──────────────────────────────────────────────────────

  /**
   * Erzeugt das gemeinsame Dropdown-Stylesheet als <style>-Element.
   */
  function _buildDropdownStyles() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      @keyframes ps-fadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .ps-dropdown {
        font-family: ${FONT_STACK};
        background: ${COLORS.bg};
        border: 1px solid ${COLORS.border};
        border-radius: 10px;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45),
                    0 2px 8px rgba(0, 0, 0, 0.25);
        overflow: hidden;
        max-height: 300px;
        overflow-y: auto;
        animation: ps-fadeIn 150ms ease-out both;
        color: ${COLORS.text};
        -webkit-font-smoothing: antialiased;
      }

      /* Benutzerdefinierte Scrollbar */
      .ps-dropdown::-webkit-scrollbar { width: 6px; }
      .ps-dropdown::-webkit-scrollbar-track { background: transparent; }
      .ps-dropdown::-webkit-scrollbar-thumb {
        background: ${COLORS.border};
        border-radius: 3px;
      }
      .ps-dropdown::-webkit-scrollbar-thumb:hover {
        background: ${COLORS.textMuted};
      }

      .ps-dropdown-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid ${COLORS.border};
        user-select: none;
      }
      .ps-dropdown-header img {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      .ps-dropdown-header span {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: ${COLORS.textMuted};
        text-transform: uppercase;
      }

      .ps-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        transition: background-color 120ms ease;
        user-select: none;
      }
      .ps-dropdown-item:hover {
        background: ${COLORS.bgHover};
      }
      .ps-dropdown-item:active {
        background: ${COLORS.border};
      }

      .ps-item-icon {
        font-size: 18px;
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: rgba(249, 115, 22, 0.1);
      }

      .ps-item-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .ps-item-username {
        font-size: 13px;
        font-weight: 600;
        color: ${COLORS.text};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .ps-item-domain {
        font-size: 11px;
        color: ${COLORS.textMuted};
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ps-dropdown-divider {
        height: 1px;
        background: ${COLORS.border};
        margin: 2px 0;
      }

      .ps-generate-item .ps-item-icon {
        background: rgba(76, 217, 100, 0.1);
      }
      .ps-generate-item .ps-item-username {
        color: ${COLORS.success};
      }
    `;
  }

  /**
   * Erzeugt das Banner-Stylesheet als String.
   */
  function _buildBannerStyles() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      @keyframes ps-slideIn {
        from { transform: translateX(120%); opacity: 0.5; }
        to   { transform: translateX(0);    opacity: 1; }
      }
      @keyframes ps-slideOut {
        from { transform: translateX(0);    opacity: 1; }
        to   { transform: translateX(120%); opacity: 0; }
      }
      @keyframes ps-checkPop {
        0%   { transform: scale(0); opacity: 0; }
        60%  { transform: scale(1.15); }
        100% { transform: scale(1); opacity: 1; }
      }

      .ps-banner {
        font-family: ${FONT_STACK};
        width: 360px;
        background: linear-gradient(135deg, ${COLORS.bg}, #121212);
        border: 1px solid ${COLORS.border};
        border-radius: 12px;
        padding: 18px;
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.5),
                    0 4px 12px rgba(0, 0, 0, 0.3);
        color: ${COLORS.text};
        animation: ps-slideIn 400ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        -webkit-font-smoothing: antialiased;
      }
      .ps-banner.ps-slide-out {
        animation: ps-slideOut 350ms ease-in both;
      }

      .ps-banner-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .ps-banner-header img {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
      }
      .ps-banner-header span {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.2px;
      }

      .ps-banner-desc {
        font-size: 13px;
        color: ${COLORS.textMuted};
        line-height: 1.45;
        margin-bottom: 14px;
      }

      .ps-banner-field {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid ${COLORS.border};
        border-radius: 8px;
        padding: 9px 12px;
        font-size: 13px;
        color: ${COLORS.text};
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 38px;
      }
      .ps-banner-field-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        color: ${COLORS.textMuted};
        letter-spacing: 0.6px;
        margin-bottom: 6px;
      }
      .ps-banner-field-value {
        font-size: 13px;
        color: ${COLORS.text};
        word-break: break-all;
        flex: 1;
        font-family: inherit;
      }

      .ps-reveal-btn {
        background: none;
        border: none;
        color: ${COLORS.textMuted};
        cursor: pointer;
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        flex-shrink: 0;
        transition: color 120ms ease, background 120ms ease;
      }
      .ps-reveal-btn:hover {
        color: ${COLORS.text};
        background: rgba(255, 255, 255, 0.08);
      }

      .ps-banner-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
      }

      .ps-btn-primary {
        flex: 1;
        padding: 10px 18px;
        background: linear-gradient(135deg, ${COLORS.accent}, #ea580c);
        border: none;
        border-radius: 8px;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 3px 10px rgba(249, 115, 22, 0.3);
        transition: transform 80ms ease, box-shadow 120ms ease, opacity 120ms ease;
        letter-spacing: 0.2px;
        font-family: ${FONT_STACK};
      }
      .ps-btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 5px 14px rgba(249, 115, 22, 0.4);
      }
      .ps-btn-primary:active {
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(249, 115, 22, 0.25);
      }

      .ps-btn-dismiss {
        padding: 10px 14px;
        background: transparent;
        border: none;
        color: ${COLORS.textMuted};
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        transition: color 120ms ease, background 120ms ease;
        font-family: ${FONT_STACK};
      }
      .ps-btn-dismiss:hover {
        color: ${COLORS.text};
        background: rgba(255, 255, 255, 0.06);
      }

      .ps-btn-never {
        display: block;
        text-align: center;
        margin-top: 10px;
        background: none;
        border: none;
        color: ${COLORS.textMuted};
        font-size: 11px;
        cursor: pointer;
        opacity: 0.6;
        transition: opacity 120ms ease;
        font-family: ${FONT_STACK};
        width: 100%;
      }
      .ps-btn-never:hover {
        opacity: 1;
        text-decoration: underline;
      }

      /* Erfolgs-Zustand nach dem Speichern */
      .ps-success-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 18px 0 10px;
        gap: 8px;
      }
      .ps-success-check {
        font-size: 32px;
        animation: ps-checkPop 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
        color: ${COLORS.success};
      }
      .ps-success-text {
        font-size: 14px;
        font-weight: 700;
        color: ${COLORS.success};
        letter-spacing: 0.3px;
      }
    `;
  }

  /**
   * Erzeugt das Toast-Stylesheet als String.
   */
  function _buildToastStyles() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      @keyframes ps-toastIn {
        from { opacity: 0; transform: translateY(12px) scale(0.95); }
        to   { opacity: 1; transform: translateY(0)    scale(1); }
      }
      @keyframes ps-toastOut {
        from { opacity: 1; transform: translateY(0)    scale(1); }
        to   { opacity: 0; transform: translateY(8px)  scale(0.95); }
      }

      .ps-toast {
        font-family: ${FONT_STACK};
        padding: 10px 20px;
        border-radius: 100px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
        animation: ps-toastIn 200ms ease-out both;
        -webkit-font-smoothing: antialiased;
        pointer-events: none;
        user-select: none;
      }
      .ps-toast.ps-toast-out {
        animation: ps-toastOut 200ms ease-in both;
      }
      .ps-toast-success {
        background: ${COLORS.success};
        color: #ffffff;
      }
      .ps-toast-warning {
        background: ${COLORS.warning};
        color: #ffffff;
      }
    `;
  }

  // ─── Dropdown ───────────────────────────────────────────────────────────────

  /**
   * Positioniert den Dropdown-Host unter dem Anker-Element.
   * @param {HTMLElement} host
   * @param {HTMLElement} anchor
   */
  function _positionDropdown(host, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 280);

    host.style.position = 'fixed';
    host.style.left     = `${rect.left}px`;
    host.style.top      = `${rect.bottom + 4}px`;
    host.style.width    = `${width}px`;
    host.style.zIndex   = '2147483647';
  }

  /**
   * Zeigt das Autofill-Dropdown unterhalb eines Eingabefeldes an.
   *
   * @param {HTMLElement}   anchorElement  Das Eingabefeld, an dem das Dropdown angedockt wird
   * @param {Array<{username:string, password:string}>} credentials  Verfügbare Zugangsdaten
   * @param {Object}        options
   * @param {Function}      options.onSelect       Callback bei Auswahl eines Eintrags (cred)
   * @param {Function}      [options.onGenerate]   Callback für «Passwort generieren»
   * @param {boolean}       [options.showGenerator=false]
   * @param {boolean}       [options.isSignupForm=false]
   */
  function showDropdown(anchorElement, credentials, options = {}) {
    // Vorheriges Dropdown schliessen
    closeDropdown();

    const host = document.createElement('div');
    host.setAttribute('data-passsafer-dropdown', '');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    // Styles injizieren
    const styleEl = document.createElement('style');
    styleEl.textContent = _buildDropdownStyles();
    shadow.appendChild(styleEl);

    // Positionierung
    _positionDropdown(host, anchorElement);

    // ── Dropdown-Inhalt aufbauen ──

    const dropdown = document.createElement('div');
    dropdown.className = 'ps-dropdown';

    // Header
    const header = document.createElement('div');
    header.className = 'ps-dropdown-header';
    header.innerHTML = `<img src="${_escapeHtml(ICON_16)}" alt="" /><span>PassSafer</span>`;
    dropdown.appendChild(header);

    // Einträge
    credentials.forEach((cred, idx) => {
      const item = document.createElement('div');
      item.className = 'ps-dropdown-item';
      item.setAttribute('data-index', String(idx));
      
      const domain = cred.domain || cred.url || cred.link || '';
      const faviconUrl = getFaviconUrl(domain);
      const firstLetter = (cred.username || cred.app || '?').charAt(0).toUpperCase();
      
      const iconHtml = faviconUrl
        ? `<div class="ps-item-icon" style="background:transparent;padding:0;">
             <img src="${faviconUrl}" alt="" width="20" height="20"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
               style="border-radius:4px;object-fit:cover;display:block;">
             <span class="ps-item-icon-letter" style="display:none;font-weight:700;color:var(--accent);">${firstLetter}</span>
           </div>`
        : `<div class="ps-item-icon" style="font-weight:700;color:var(--accent);">${firstLetter}</div>`;
      
      item.innerHTML = `
        ${iconHtml}
        <div class="ps-item-details" style="display:flex; flex-direction:column; justify-content:center; overflow:hidden;">
          <span class="ps-item-username" style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${_escapeHtml(cred.app || cred.username || 'Saved Login')}</span>
        </div>
      `;

      // mousedown statt click — verhindert blur-Race-Condition auf dem Input
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof options.onSelect === 'function') {
          options.onSelect(cred);
        }
        closeDropdown();
      });

      dropdown.appendChild(item);
    });

    // Generator-Option (optional)
    if (options.showGenerator) {
      const divider = document.createElement('div');
      divider.className = 'ps-dropdown-divider';
      dropdown.appendChild(divider);

      const genItem = document.createElement('div');
      genItem.className = 'ps-dropdown-item ps-generate-item';
      genItem.innerHTML = `
        <div class="ps-item-icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:16px;height:16px;display:block'><circle cx='7.5' cy='15.5' r='5.5'/><path d='M21 2l-9.6 9.6'/><path d='M15.5 7.5l3 3L22 7l-3-3'/></svg></div>
        <div class="ps-item-info">
          <span class="ps-item-username">Generate strong password</span>
          <span class="ps-item-domain">20 characters, secure</span>
        </div>
      `;

      genItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof options.onGenerate === 'function') {
          options.onGenerate();
        }
        closeDropdown();
      });

      dropdown.appendChild(genItem);
    }

    shadow.appendChild(dropdown);

    // ── Event-Listener registrieren ──

    /** Escape-Taste schliesst Dropdown */
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
      }
    };

    /** Klick ausserhalb des Shadow DOM schliesst Dropdown */
    const onClickOutside = (e) => {
      // Klick innerhalb des Hosts ignorieren
      if (e.composedPath && e.composedPath().includes(host)) return;
      if (!e.composedPath && host.contains(e.target)) return;
      closeDropdown();
    };

    /** Bei Scroll/Resize: Dropdown neu positionieren oder schliessen */
    const onScrollOrResize = () => {
      // Prüfen ob das Anker-Element noch im Viewport ist
      const rect = anchorElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        closeDropdown();
      } else {
        _positionDropdown(host, anchorElement);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onClickOutside, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);

    // Cleanup-Funktionen speichern
    _dropdownCleanups = [
      () => document.removeEventListener('keydown', onKeyDown, true),
      () => document.removeEventListener('mousedown', onClickOutside, true),
      () => window.removeEventListener('scroll', onScrollOrResize, true),
      () => window.removeEventListener('resize', onScrollOrResize, true)
    ];

    _activeDropdown = host;
  }

  /**
   * Schliesst das aktive Dropdown und räumt Listener auf.
   */
  function closeDropdown() {
    if (_activeDropdown) {
      try {
        _activeDropdown.remove();
      } catch (_) { /* bereits entfernt */ }
      _activeDropdown = null;
    }
    // Alle globalen Listener entfernen
    _dropdownCleanups.forEach((fn) => {
      try { fn(); } catch (_) { /* ignorieren */ }
    });
    _dropdownCleanups = [];
  }

  // ─── Save / Update Banner ──────────────────────────────────────────────────

  /**
   * Zeigt ein Speichern-/Aktualisieren-Banner oben rechts auf der Seite.
   *
   * @param {Object}   data
   * @param {string}   data.domain
   * @param {string}   data.username
   * @param {string}   data.password
   * @param {boolean}  data.isUpdate
   * @param {Function} data.onSave
   * @param {Function} data.onDismiss
   * @param {Function} data.onNever
   */
  function showSaveBanner(data) {
    // Vorheriges Banner entfernen
    closeBanner();

    const host = document.createElement('div');
    host.setAttribute('data-passsafer-banner', '');
    host.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    // Styles
    const styleEl = document.createElement('style');
    styleEl.textContent = _buildBannerStyles();
    shadow.appendChild(styleEl);

    // ── Banner-Inhalt ──

    const banner = document.createElement('div');
    banner.className = 'ps-banner';

    const titleText = data.isUpdate
      ? 'Update password?'
      : 'Save in PassSafer?';

    const descText = data.isUpdate
      ? `Update password for <strong>${_escapeHtml(data.username)}</strong> on <strong>${_escapeHtml(data.domain)}</strong>?`
      : `Save credentials for <strong>${_escapeHtml(data.username)}</strong> on <strong>${_escapeHtml(data.domain)}</strong>?`;

    // Passwort-Maske erzeugen
    const maskedPw = '•'.repeat(Math.min(data.password.length, 24));

    banner.innerHTML = `
      <div class="ps-banner-header">
        <img src="${_escapeHtml(ICON_48)}" alt="" />
        <span>${_escapeHtml(titleText)}</span>
      </div>
      <div class="ps-banner-desc">${descText}</div>

      <div class="ps-banner-field-label">Username</div>
      <div class="ps-banner-field">
        <span class="ps-banner-field-value">${_escapeHtml(data.username)}</span>
      </div>

      <div class="ps-banner-field-label">Password</div>
      <div class="ps-banner-field">
        <span class="ps-banner-field-value ps-pw-display">${_escapeHtml(maskedPw)}</span>
        <button class="ps-reveal-btn" type="button" aria-label="Show password">Show</button>
      </div>

      <div class="ps-banner-actions">
        <button class="ps-btn-dismiss" type="button">Not now</button>
        <button class="ps-btn-primary" type="button">${data.isUpdate ? 'Update' : 'Save'}</button>
      </div>
      <button class="ps-btn-never" type="button">Never for this website</button>
    `;

    shadow.appendChild(banner);

    // ── Passwort Reveal ──

    let passwordRevealed = false;
    const revealBtn = shadow.querySelector('.ps-reveal-btn');
    const pwDisplay = shadow.querySelector('.ps-pw-display');

    if (revealBtn && pwDisplay) {
      revealBtn.addEventListener('click', () => {
        passwordRevealed = !passwordRevealed;
        pwDisplay.textContent = passwordRevealed
          ? data.password
          : maskedPw;
        revealBtn.textContent = passwordRevealed ? 'Hide' : 'Show';
      });
    }

    // ── Hilfsfunktion: Banner herausschieben und entfernen ──

    const _slideBannerOut = () => {
      banner.classList.add('ps-slide-out');
      setTimeout(() => {
        try { host.remove(); } catch (_) {}
        if (_activeBanner === host) _activeBanner = null;
      }, 400);
    };

    // ── Button-Events ──

    // Speichern / Aktualisieren
    const btnSave = shadow.querySelector('.ps-btn-primary');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof data.onSave === 'function') {
          data.onSave();
        }

        // Erfolgs-Zustand anzeigen
        banner.innerHTML = `
          <div class="ps-success-state">
            <div class="ps-success-check"><svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6L9 17l-5-5'/></svg></div>
            <div class="ps-success-text">Saved!</div>
          </div>
        `;

        setTimeout(_slideBannerOut, 1500);
      });
    }

    // Nicht jetzt
    const btnDismiss = shadow.querySelector('.ps-btn-dismiss');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => {
        if (typeof data.onDismiss === 'function') {
          data.onDismiss();
        }
        _slideBannerOut();
      });
    }

    // Nie für diese Website
    const btnNever = shadow.querySelector('.ps-btn-never');
    if (btnNever) {
      btnNever.addEventListener('click', () => {
        if (typeof data.onNever === 'function') {
          data.onNever();
        }
        _slideBannerOut();
      });
    }

    _activeBanner = host;
  }

  /**
   * Schliesst das aktive Banner und entfernt es aus dem DOM.
   */
  function closeBanner() {
    if (_activeBanner) {
      try {
        _activeBanner.remove();
      } catch (_) { /* bereits entfernt */ }
      _activeBanner = null;
    }
  }

  // ─── Toast ──────────────────────────────────────────────────────────────────

  /**
   * Zeigt eine temporäre Toast-Benachrichtigung unten in der Mitte an.
   * Verschwindet automatisch nach 2,5 Sekunden.
   *
   * @param {string} message  Anzuzeigender Text
   * @param {'success'|'warning'} [type='success']
   */
  function showToast(message, type = 'success') {
    const host = document.createElement('div');
    host.setAttribute('data-passsafer-toast', '');
    host.style.cssText =
      'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = _buildToastStyles();
    shadow.appendChild(styleEl);

    const toast = document.createElement('div');
    const typeClass = type === 'warning' ? 'ps-toast-warning' : 'ps-toast-success';
    toast.className = `ps-toast ${typeClass}`;
    toast.textContent = message;
    shadow.appendChild(toast);

    // Automatisch nach 2,5 s ausblenden
    setTimeout(() => {
      toast.classList.add('ps-toast-out');
      setTimeout(() => {
        try { host.remove(); } catch (_) {}
      }, 250);
    }, 2500);
  }

  /**
   * Returns true if a dropdown is currently visible.
   * @returns {boolean}
   */
  function isDropdownVisible() {
    return _activeDropdown !== null;
  }

  // ─── Öffentliches API ───────────────────────────────────────────────────────

  return {
    showDropdown,
    closeDropdown,
    isDropdownVisible,
    showSaveBanner,
    closeBanner,
    showToast,
    _escapeHtml
  };

})();
