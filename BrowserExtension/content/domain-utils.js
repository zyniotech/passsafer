window.PassSafer = window.PassSafer || {};

window.PassSafer.DomainUtils = (() => {
  'use strict';

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
    'co.za',
    'com.mx',
    'com.sg',
    'com.hk',
    'com.tw',
    'co.at',
    'or.at',
  ]);

  function normalizeHost(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
      const urlStr = trimmed.includes('://') ? trimmed : 'https://' + trimmed;
      return new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch (_) {
      return trimmed
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .split('/')[0]
        .split('?')[0]
        .split('#')[0]
        .split(':')[0]
        .replace(/^www\./, '')
        .replace(/\.$/, '');
    }
  }

  function getBaseDomain(hostname) {
    const host = normalizeHost(hostname);
    if (!host) return '';

    const parts = host.split('.');
    if (parts.length <= 2) {
      return host;
    }

    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (TWO_PART_TLDS.has(lastTwo)) {
      return parts.slice(-3).join('.');
    }

    return parts.slice(-2).join('.');
  }

  function domainsMatch(domain1, domain2) {
    const base1 = getBaseDomain(domain1);
    const base2 = getBaseDomain(domain2);
    return Boolean(base1 && base2 && base1 === base2);
  }

  function getCurrentDomain() {
    if (window.location.protocol === 'file:') {
      return 'localhost';
    }
    return getBaseDomain(window.location.hostname) || 'localhost';
  }

  function getCurrentHostname() {
    if (window.location.protocol === 'file:') {
      return 'localhost';
    }
    return normalizeHost(window.location.hostname) || getCurrentDomain();
  }

  return {
    normalizeHost,
    getBaseDomain,
    domainsMatch,
    getCurrentDomain,
    getCurrentHostname,
  };
})();
