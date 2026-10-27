'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.UI = (() => {
  const COLORS = {
    bg: '#1e1e1e',
    bgHover: '#2a2a2a',
    border: '#383838',
    hoverOutline: '#b3b3b3D9',
    btnBg: '#2d2d2d',
    text: '#e5e5e5',
    textMuted: '#9a9a9a',
    success: '#2ecc71',
    warning: '#f39c12',
    danger: '#e74c3c',
  };

  const FONT_STACK =
    "'DM Sans', -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif";

  const ICON_16 = chrome.runtime.getURL('icons/icon16.png');
  const ICON_48 = chrome.runtime.getURL('icons/icon48.png');

  let _activeDropdown = null;
  let _activeBanner = null;
  let _dropdownCleanups = [];

  function _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getFaviconUrl(domain) {
    if (!domain) return null;
    try {
      const domainStr = domain.toString().trim();
      const d = domainStr
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .split('/')[0]
        .split('?')[0];
      if (!d || d === 'localhost') return null;

      let targetUrl = domainStr.startsWith('http') ? domainStr : 'https://' + d;
      if (!d.includes('.')) {
        targetUrl = domainStr.startsWith('https') ? 'https://' + d : 'http://' + d;
      }

      const url = new URL(chrome.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', targetUrl);
      url.searchParams.set('size', '64');
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  function _buildDropdownStyles() {
    return `
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
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55),
                    0 2px 8px rgba(0, 0, 0, 0.35);
        overflow: hidden;
        max-height: 300px;
        overflow-y: auto;
        animation: ps-fadeIn 140ms ease-out both;
        color: ${COLORS.text};
        -webkit-font-smoothing: antialiased;
        padding: 4px;
      }

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
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border-bottom: 1px solid ${COLORS.border};
        margin-bottom: 4px;
        user-select: none;
      }
      .ps-dropdown-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .ps-dropdown-header img {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
      .ps-dropdown-header span {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: ${COLORS.textMuted};
        text-transform: uppercase;
      }
      .ps-dropdown-hint {
        font-size: 10px;
        color: ${COLORS.textMuted};
        opacity: 0.75;
      }

      .ps-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 7px;
        border: 1px solid transparent;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
        user-select: none;
      }
      .ps-dropdown-item:hover,
      .ps-dropdown-item.ps-active {
        background: ${COLORS.bgHover};
        border-color: ${COLORS.hoverOutline} !important;
      }

      .ps-item-icon {
        font-size: 14px;
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 7px;
        background: #2b2b2b;
        border: 1px solid ${COLORS.border};
        color: ${COLORS.text};
      }

      .ps-item-info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        flex: 1;
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
        margin-top: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ps-dropdown-divider {
        height: 1px;
        background: ${COLORS.border};
        margin: 4px 2px;
      }

      .ps-generate-item .ps-item-icon {
        background: rgba(46, 204, 113, 0.12);
        border-color: rgba(46, 204, 113, 0.3);
        color: ${COLORS.success};
      }
      .ps-generate-item .ps-item-username {
        color: ${COLORS.success};
      }
    `;
  }

  function _buildBannerStyles() {
    return `
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
        background: ${COLORS.bg};
        border: 1px solid ${COLORS.border};
        border-radius: 12px;
        padding: 18px;
        box-shadow: 0 15px 40px rgba(0, 0, 0, 0.55),
                    0 4px 12px rgba(0, 0, 0, 0.35);
        color: ${COLORS.text};
        animation: ps-slideIn 350ms cubic-bezier(0.22, 1, 0.36, 1) both;
        -webkit-font-smoothing: antialiased;
      }
      .ps-banner.ps-slide-out {
        animation: ps-slideOut 300ms ease-in both;
      }

      .ps-banner-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      .ps-banner-header img {
        width: 26px;
        height: 26px;
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
        background: #262626;
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
        background: #303030;
        border: 1px solid transparent;
        color: ${COLORS.textMuted};
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 5px;
        margin-left: 8px;
        flex-shrink: 0;
        transition: color 120ms ease, border-color 120ms ease;
      }
      .ps-reveal-btn:hover {
        color: ${COLORS.text};
        border-color: ${COLORS.hoverOutline} !important;
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
        background: ${COLORS.btnBg};
        border: 1px solid ${COLORS.border};
        border-radius: 8px;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: border-color 120ms ease;
        letter-spacing: 0.2px;
        font-family: ${FONT_STACK};
      }
      .ps-btn-primary:hover {
        border-color: ${COLORS.hoverOutline} !important;
      }

      .ps-btn-dismiss {
        padding: 10px 14px;
        background: transparent;
        border: 1px solid transparent;
        color: ${COLORS.textMuted};
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        transition: color 120ms ease, border-color 120ms ease;
        font-family: ${FONT_STACK};
      }
      .ps-btn-dismiss:hover {
        color: ${COLORS.text};
        border-color: ${COLORS.hoverOutline} !important;
      }

      .ps-btn-never {
        display: block;
        text-align: center;
        margin-top: 10px;
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 4px;
        color: ${COLORS.textMuted};
        font-size: 11px;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 120ms ease, border-color 120ms ease;
        font-family: ${FONT_STACK};
        width: 100%;
      }
      .ps-btn-never:hover {
        opacity: 1;
        border-color: ${COLORS.hoverOutline} !important;
      }

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

  function _buildToastStyles() {
    return `
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

  function _positionDropdown(host, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 280);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const left = Math.max(8, Math.min(rect.left, maxLeft));

    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 220 && rect.top > 240;

    host.style.position = 'fixed';
    host.style.left = `${left}px`;
    if (placeAbove) {
      host.style.bottom = `${window.innerHeight - rect.top + 4}px`;
      host.style.top = 'auto';
    } else {
      host.style.top = `${rect.bottom + 4}px`;
      host.style.bottom = 'auto';
    }
    host.style.width = `${width}px`;
    host.style.zIndex = '2147483647';
  }

  function showDropdown(anchorElement, credentials, options = {}) {
    closeDropdown();

    const safeCredentials = Array.isArray(credentials) ? credentials : [];
    if (safeCredentials.length === 0 && !options.showGenerator) {
      return;
    }

    const host = document.createElement('div');
    host.setAttribute('data-passsafer-dropdown', '');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = _buildDropdownStyles();
    shadow.appendChild(styleEl);

    _positionDropdown(host, anchorElement);

    const dropdown = document.createElement('div');
    dropdown.className = 'ps-dropdown';

    const header = document.createElement('div');
    header.className = 'ps-dropdown-header';
    header.innerHTML = `
      <div class="ps-dropdown-header-left">
        <img src="${_escapeHtml(ICON_16)}" alt="" />
        <span>PassSafer</span>
      </div>
      <span class="ps-dropdown-hint">${safeCredentials.length > 0 ? `${safeCredentials.length} saved` : 'Generator'}</span>
    `;
    dropdown.appendChild(header);

    const interactiveItems = [];
    let activeIndex = -1;

    function setActiveItem(newIndex) {
      if (interactiveItems.length === 0) return;
      interactiveItems.forEach((entry, idx) => {
        if (idx === newIndex) {
          entry.el.classList.add('ps-active');
          entry.el.scrollIntoView({ block: 'nearest' });
        } else {
          entry.el.classList.remove('ps-active');
        }
      });
      activeIndex = newIndex;
    }

    safeCredentials.forEach((cred, idx) => {
      const item = document.createElement('div');
      item.className = 'ps-dropdown-item';
      item.setAttribute('data-index', String(idx));

      const domain = cred.domain || cred.url || cred.link || '';
      const faviconUrl = getFaviconUrl(domain);
      const userLabel = cred.username || cred.user || '';
      const appLabel = cred.app || '';
      const primaryText = userLabel || appLabel || 'Saved Login';
      const secondaryText =
        userLabel && appLabel && userLabel.toLowerCase() !== appLabel.toLowerCase()
          ? appLabel
          : domain;
      const firstLetter = (appLabel || userLabel || '?').charAt(0).toUpperCase();

      const iconHtml = faviconUrl
        ? `<div class="ps-item-icon" style="padding:0;">
             <img src="${_escapeHtml(faviconUrl)}" alt="" width="18" height="18"
               style="border-radius:4px;object-fit:cover;display:block;">
             <span class="ps-item-icon-letter" style="display:none;font-weight:700;">${_escapeHtml(firstLetter)}</span>
           </div>`
        : `<div class="ps-item-icon" style="font-weight:700;">${_escapeHtml(firstLetter)}</div>`;

      item.innerHTML = `
        ${iconHtml}
        <div class="ps-item-info">
          <span class="ps-item-username">${_escapeHtml(primaryText)}</span>
          ${secondaryText ? `<span class="ps-item-domain">${_escapeHtml(secondaryText)}</span>` : ''}
        </div>
      `;

      const imgEl = item.querySelector('img');
      if (imgEl) {
        imgEl.addEventListener('error', () => {
          imgEl.style.display = 'none';
          const fallbackSpan = item.querySelector('.ps-item-icon-letter');
          if (fallbackSpan) fallbackSpan.style.display = 'flex';
        });
      }

      const selectAction = () => {
        if (typeof options.onSelect === 'function') {
          options.onSelect({
            username: cred.username || cred.user || '',
            password: cred.password || cred.pass || '',
            raw: cred,
          });
        }
        closeDropdown();
      };

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectAction();
      });

      interactiveItems.push({ el: item, action: selectAction });
      dropdown.appendChild(item);
    });

    if (options.showGenerator) {
      if (safeCredentials.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'ps-dropdown-divider';
        dropdown.appendChild(divider);
      }

      const genItem = document.createElement('div');
      genItem.className = 'ps-dropdown-item ps-generate-item';
      genItem.innerHTML = `
        <div class="ps-item-icon"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='width:16px;height:16px;display:block'><circle cx='7.5' cy='15.5' r='5.5'/><path d='M21 2l-9.6 9.6'/><path d='M15.5 7.5l3 3L22 7l-3-3'/></svg></div>
        <div class="ps-item-info">
          <span class="ps-item-username">Generate strong password</span>
          <span class="ps-item-domain">20 characters, secure</span>
        </div>
      `;

      const generateAction = () => {
        if (typeof options.onGenerate === 'function') {
          options.onGenerate();
        }
        closeDropdown();
      };

      genItem.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        generateAction();
      });

      interactiveItems.push({ el: genItem, action: generateAction });
      dropdown.appendChild(genItem);
    }

    shadow.appendChild(dropdown);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeDropdown();
        return;
      }
      if (interactiveItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const nextIdx = activeIndex < interactiveItems.length - 1 ? activeIndex + 1 : 0;
        setActiveItem(nextIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const prevIdx = activeIndex > 0 ? activeIndex - 1 : interactiveItems.length - 1;
        setActiveItem(prevIdx);
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < interactiveItems.length) {
        e.preventDefault();
        e.stopPropagation();
        interactiveItems[activeIndex].action();
      }
    };

    const onClickOutside = (e) => {
      if (e.target === anchorElement) return;
      if (e.composedPath && e.composedPath().includes(host)) return;
      if (!e.composedPath && host.contains(e.target)) return;
      closeDropdown();
    };

    const onScrollOrResize = () => {
      const rect = anchorElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
        closeDropdown();
      } else {
        _positionDropdown(host, anchorElement);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onClickOutside, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize, true);

    _dropdownCleanups = [
      () => document.removeEventListener('keydown', onKeyDown, true),
      () => document.removeEventListener('mousedown', onClickOutside, true),
      () => window.removeEventListener('scroll', onScrollOrResize, true),
      () => window.removeEventListener('resize', onScrollOrResize, true),
    ];

    _activeDropdown = host;
  }

  function closeDropdown() {
    if (_activeDropdown) {
      try {
        _activeDropdown.remove();
      } catch (_) {}
      _activeDropdown = null;
    }
    _dropdownCleanups.forEach((fn) => {
      try {
        fn();
      } catch (_) {}
    });
    _dropdownCleanups = [];
  }

  function showSaveBanner(data) {
    closeBanner();

    const host = document.createElement('div');
    host.setAttribute('data-passsafer-banner', '');
    host.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = _buildBannerStyles();
    shadow.appendChild(styleEl);

    const banner = document.createElement('div');
    banner.className = 'ps-banner';

    const titleText = data.isUpdate ? 'Update password?' : 'Save in PassSafer?';
    const userDisplay = data.username || 'this account';

    const descText = data.isUpdate
      ? `Update password for <strong>${_escapeHtml(userDisplay)}</strong> on <strong>${_escapeHtml(data.domain)}</strong>?`
      : `Save credentials for <strong>${_escapeHtml(userDisplay)}</strong> on <strong>${_escapeHtml(data.domain)}</strong>?`;

    const maskedPw = '•'.repeat(Math.min((data.password || '').length, 24));

    banner.innerHTML = `
      <div class="ps-banner-header">
        <img src="${_escapeHtml(ICON_48)}" alt="" />
        <span>${_escapeHtml(titleText)}</span>
      </div>
      <div class="ps-banner-desc">${descText}</div>

      <div class="ps-banner-field-label">Username</div>
      <div class="ps-banner-field">
        <span class="ps-banner-field-value">${_escapeHtml(data.username || '—')}</span>
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

    let passwordRevealed = false;
    const revealBtn = shadow.querySelector('.ps-reveal-btn');
    const pwDisplay = shadow.querySelector('.ps-pw-display');

    if (revealBtn && pwDisplay) {
      revealBtn.addEventListener('click', () => {
        passwordRevealed = !passwordRevealed;
        pwDisplay.textContent = passwordRevealed ? data.password : maskedPw;
        revealBtn.textContent = passwordRevealed ? 'Hide' : 'Show';
      });
    }

    const _slideBannerOut = () => {
      banner.classList.add('ps-slide-out');
      setTimeout(() => {
        try {
          host.remove();
        } catch (_) {}
        if (_activeBanner === host) _activeBanner = null;
      }, 350);
    };

    const btnSave = shadow.querySelector('.ps-btn-primary');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof data.onSave === 'function') {
          data.onSave();
        }

        banner.innerHTML = `
          <div class="ps-success-state">
            <div class="ps-success-check"><svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6L9 17l-5-5'/></svg></div>
            <div class="ps-success-text">Saved!</div>
          </div>
        `;

        setTimeout(_slideBannerOut, 1400);
      });
    }

    const btnDismiss = shadow.querySelector('.ps-btn-dismiss');
    if (btnDismiss) {
      btnDismiss.addEventListener('click', () => {
        if (typeof data.onDismiss === 'function') {
          data.onDismiss();
        }
        _slideBannerOut();
      });
    }

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

  function closeBanner() {
    if (_activeBanner) {
      try {
        _activeBanner.remove();
      } catch (_) {}
      _activeBanner = null;
    }
  }

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

    setTimeout(() => {
      toast.classList.add('ps-toast-out');
      setTimeout(() => {
        try {
          host.remove();
        } catch (_) {}
      }, 250);
    }, 2500);
  }

  function isDropdownVisible() {
    return _activeDropdown !== null;
  }

  return {
    showDropdown,
    closeDropdown,
    isDropdownVisible,
    showSaveBanner,
    closeBanner,
    showToast,
    _escapeHtml,
  };
})();
