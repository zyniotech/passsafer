window.PassSafer = window.PassSafer || {};

window.PassSafer.StorageClient = (() => {
  'use strict';

  function _sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function getLogins(domain) {
    return _sendMessage({
      action: 'get-logins-for-domain',
      domain,
    });
  }

  async function checkExists(domain, username, password) {
    return _sendMessage({
      action: 'check-if-credential-exists',
      domain,
      username,
      password,
    });
  }

  async function saveLogin(domain, username, password, isUpdate) {
    return _sendMessage({
      action: 'save-credential',
      domain,
      username,
      password,
      isUpdate,
    });
  }

  async function ignoreSite(domain) {
    return _sendMessage({
      action: 'ignore-site',
      domain,
    });
  }

  async function checkIgnored(domain) {
    return _sendMessage({
      action: 'check-ignored',
      domain,
    });
  }

  async function setPendingSave(data) {
    return _sendMessage({
      action: 'set-pending-save',
      data,
    });
  }

  async function getPendingSave() {
    return _sendMessage({
      action: 'get-pending-save',
    });
  }

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
