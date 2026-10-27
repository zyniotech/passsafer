(function () {
  'use strict';

  const ns = window.PassSafer;
  if (!ns) {
    console.error('[PassSafer] Namespace window.PassSafer missing.');
    return;
  }

  const { DomainUtils, StorageClient, FieldDetection, Autofill, Generator, UI } = ns;

  const requiredModules = { DomainUtils, StorageClient, FieldDetection, Autofill, Generator, UI };
  for (const [name, mod] of Object.entries(requiredModules)) {
    if (!mod) {
      console.error(`[PassSafer] Required module "${name}" not loaded.`);
      return;
    }
  }

  const processedFields = new WeakSet();
  const fieldGroupMap = new WeakMap();
  const originalAutocompletes = new WeakMap();

  let lastEnteredUsername = '';
  let savePromptShown = false;
  let lastSubmitTimestamp = 0;

  const currentDomain = DomainUtils.getCurrentDomain();
  const currentHostname = DomainUtils.getCurrentHostname
    ? DomainUtils.getCurrentHostname()
    : currentDomain;

  let lastKnownUrl = location.href;

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function preserveOriginalAutocomplete(field) {
    if (!field || typeof field.getAttribute !== 'function') return;
    if (!field.hasAttribute('data-ps-orig-autocomplete')) {
      field.setAttribute('data-ps-orig-autocomplete', field.getAttribute('autocomplete') || '');
    }
    if (!originalAutocompletes.has(field)) {
      originalAutocompletes.set(field, field.getAttribute('autocomplete'));
    }
  }

  function suppressNativeAutocomplete(field) {
    if (!field) return;
    preserveOriginalAutocomplete(field);
    field.setAttribute('autocomplete', 'one-time-code');
  }

  function restoreNativeAutocomplete(field) {
    if (!field || !originalAutocompletes.has(field)) return;
    const orig = originalAutocompletes.get(field);
    if (orig === null || orig === '') {
      field.removeAttribute('autocomplete');
    } else {
      field.setAttribute('autocomplete', orig);
    }
  }

  function scanAndAttach() {
    let formGroups;
    try {
      formGroups = FieldDetection.findLoginForms();
    } catch (err) {
      console.warn('[PassSafer] findLoginForms() error:', err);
      return;
    }

    if (!formGroups || formGroups.length === 0) return;

    for (const group of formGroups) {
      const pwList =
        Array.isArray(group.passwordFields) && group.passwordFields.length > 0
          ? group.passwordFields
          : group.passwordField
            ? [group.passwordField]
            : [];

      const fieldsToProcess = [
        ...pwList,
        ...(group.usernameField ? [group.usernameField] : []),
      ];

      for (const field of fieldsToProcess) {
        if (!field) continue;
        fieldGroupMap.set(field, group);
        preserveOriginalAutocomplete(field);

        if (processedFields.has(field)) continue;
        processedFields.add(field);

        if (field === group.usernameField) {
          field.addEventListener(
            'input',
            () => {
              const val = (field.value || '').trim();
              if (val) {
                lastEnteredUsername = val;
              }
            },
            { passive: true }
          );
        }

        if (FieldDetection.isPasswordField(field)) {
          field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !UI.isDropdownVisible()) {
              const activeGroup = fieldGroupMap.get(field) || group;
              const currentPws =
                activeGroup.passwordFields && activeGroup.passwordFields.length > 0
                  ? activeGroup.passwordFields
                  : [field];
              handleSubmitAction(activeGroup.usernameField, currentPws);
            }
          });
        }

        field.addEventListener(
          'focus',
          () => {
            suppressNativeAutocomplete(field);
            const activeGroup = fieldGroupMap.get(field) || group;
            handleFieldFocus(field, activeGroup);
          },
          { passive: true }
        );

        field.addEventListener(
          'click',
          () => {
            if (!UI.isDropdownVisible()) {
              suppressNativeAutocomplete(field);
              const activeGroup = fieldGroupMap.get(field) || group;
              handleFieldFocus(field, activeGroup);
            }
          },
          { passive: true }
        );

        field.addEventListener(
          'blur',
          () => {
            restoreNativeAutocomplete(field);
            setTimeout(() => {
              if (document.activeElement && fieldGroupMap.has(document.activeElement)) {
                return;
              }
              UI.closeDropdown();
            }, 160);
          },
          { passive: true }
        );
      }
    }
  }

  async function handleFieldFocus(anchorElement, group) {
    try {
      const ignoredResponse = await StorageClient.checkIgnored(currentDomain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      const queryTarget = currentHostname || currentDomain;
      const loginsResponse = await StorageClient.getLogins(queryTarget);
      const credentials =
        loginsResponse && Array.isArray(loginsResponse.credentials)
          ? loginsResponse.credentials
          : [];

      const isSignup =
        group.formType === 'signup' || FieldDetection.isSignupForm(group.form || anchorElement);

      const showGen = isSignup && FieldDetection.isPasswordField(anchorElement);

      UI.showDropdown(anchorElement, credentials, {
        showGenerator: showGen,

        onSelect(selected) {
          if (!selected) return;
          if (selected.username) {
            lastEnteredUsername = selected.username;
          }
          Autofill.fillCredentials(
            group.usernameField,
            group.passwordField,
            selected.username,
            selected.password
          );
          if (Array.isArray(group.passwordFields) && group.passwordFields.length > 1 && selected.password) {
            Autofill.fillAllPasswordFields(group.passwordFields, selected.password);
          }
        },

        onGenerate() {
          const generated = Generator.generate();
          const pwFields =
            Array.isArray(group.passwordFields) && group.passwordFields.length > 0
              ? group.passwordFields
              : group.form
                ? FieldDetection.findPasswordFields(group.form)
                : group.passwordField
                  ? [group.passwordField]
                  : [anchorElement];
          Autofill.fillAllPasswordFields(pwFields, generated);
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] Dropdown error:', err);
    }
  }

  async function autoShowCredentials() {
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (UI.isDropdownVisible()) return;

      const ignoredResponse = await StorageClient.checkIgnored(currentDomain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      const queryTarget = currentHostname || currentDomain;
      const loginsResponse = await StorageClient.getLogins(queryTarget);
      const credentials =
        loginsResponse && Array.isArray(loginsResponse.credentials)
          ? loginsResponse.credentials
          : [];

      if (credentials.length === 0) return;

      let formGroups;
      try {
        formGroups = FieldDetection.findLoginForms();
      } catch (_) {
        return;
      }
      if (!formGroups || formGroups.length === 0) return;

      const loginGroup = formGroups.find((g) => g.formType !== 'signup') || formGroups[0];
      const anchorField = loginGroup.usernameField || loginGroup.passwordField;
      if (!anchorField || !anchorField.isConnected) return;

      const rect = anchorField.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      suppressNativeAutocomplete(anchorField);
      if (loginGroup.passwordField) {
        suppressNativeAutocomplete(loginGroup.passwordField);
      }

      UI.showDropdown(anchorField, credentials, {
        showGenerator: false,
        onSelect(selected) {
          if (!selected) return;
          if (selected.username) {
            lastEnteredUsername = selected.username;
          }
          Autofill.fillCredentials(
            loginGroup.usernameField,
            loginGroup.passwordField,
            selected.username,
            selected.password
          );
        },
      });

      savePromptShown = false;

      const onTyping = (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          return;
        }
        UI.closeDropdown();
        document.removeEventListener('keydown', onTyping, true);
      };
      document.addEventListener('keydown', onTyping, true);
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] autoShowCredentials error:', err);
    }
  }

  function resolveSubmittedUsername(usernameField, passwordFields) {
    if (usernameField && usernameField.value && usernameField.value.trim()) {
      return usernameField.value.trim();
    }
    if (passwordFields && passwordFields.length > 0) {
      const found = FieldDetection.findUsernameForPassword(passwordFields[0], true);
      if (found && found.value && found.value.trim()) {
        return found.value.trim();
      }
    }
    return lastEnteredUsername || '';
  }

  async function handleSubmitAction(usernameField, passwordFields) {
    const now = Date.now();
    if (now - lastSubmitTimestamp < 400) return;

    const validPwFields = (passwordFields || []).filter((f) => f && f.value);
    const password = validPwFields.length > 0 ? validPwFields[0].value : '';

    if (!password) {
      if (usernameField && usernameField.value && usernameField.value.trim()) {
        lastEnteredUsername = usernameField.value.trim();
      }
      return;
    }

    lastSubmitTimestamp = now;
    const username = resolveSubmittedUsername(usernameField, passwordFields);
    const domain = currentDomain;

    try {
      const ignoredResponse = await StorageClient.checkIgnored(domain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      const result = await StorageClient.checkExists(domain, username, password);

      if (result && result.shouldSave) {
        const pendingPayload = {
          domain,
          username,
          password,
          isUpdate: !!result.isUpdate,
        };

        await StorageClient.setPendingSave(pendingPayload);
        detectAjaxSuccess(usernameField, validPwFields, pendingPayload);
      }
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] Submit handling error:', err);
    }
  }

  function detectAjaxSuccess(_usernameField, passwordFields, pendingData) {
    setTimeout(async () => {
      if (savePromptShown) return;

      if (hasLoginErrorIndicators()) {
        await StorageClient.setPendingSave(null);
        return;
      }

      let fieldsStillVisible = false;
      for (const field of passwordFields) {
        if (field.isConnected) {
          const rect = field.getBoundingClientRect();
          const style = window.getComputedStyle(field);
          if (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          ) {
            fieldsStillVisible = true;
            break;
          }
        }
      }

      const isTestEnv =
        !currentDomain ||
        currentDomain === 'localhost' ||
        window.location.protocol === 'file:';
      const urlChanged = location.href !== lastKnownUrl;

      if (!fieldsStillVisible || urlChanged || isTestEnv) {
        await StorageClient.setPendingSave(null);

        if (savePromptShown) return;
        savePromptShown = true;

        UI.showSaveBanner({
          domain: pendingData.domain,
          username: pendingData.username,
          password: pendingData.password,
          isUpdate: pendingData.isUpdate,

          onSave() {
            StorageClient.saveLogin(
              pendingData.domain,
              pendingData.username,
              pendingData.password,
              pendingData.isUpdate
            )
              .then(() => {
                UI.showToast(pendingData.isUpdate ? 'Password updated!' : 'Password saved!');
              })
              .catch((err) => console.warn('[PassSafer] Save error:', err));
          },
          onDismiss() {},
          onNever() {
            StorageClient.ignoreSite(pendingData.domain).catch((err) =>
              console.warn('[PassSafer] Ignore error:', err)
            );
          },
        });
      }
    }, 1500);
  }

  function attachSubmitListeners() {
    const forms = document.querySelectorAll('form');
    forms.forEach((form) => {
      if (processedFields.has(form)) return;
      processedFields.add(form);

      form.addEventListener(
        'submit',
        () => {
          const pwFields = FieldDetection.findPasswordFields(form);
          const allFormPws =
            pwFields.length > 0
              ? pwFields
              : Array.from(form.querySelectorAll('input[type="password"], input[data-ps-password="true"]'));
          const usernameField =
            allFormPws.length > 0
              ? FieldDetection.findUsernameForPassword(allFormPws[0], true)
              : Array.from(form.querySelectorAll('input')).find((inp) => FieldDetection.isUsernameField(inp));

          handleSubmitAction(usernameField, allFormPws);
        },
        true
      );
    });

    attachButtonClickListeners();
  }

  function attachButtonClickListeners() {
    const loginTextPattern =
      /\b(log\s*in|sign\s*in|sign\s*up|register|create\s*account|anmelden|einloggen|registrieren|konto\s*erstellen|weiter|continue|next|submit)\b/i;

    const candidates = document.querySelectorAll(
      'button[type="submit"], input[type="submit"], button, [role="button"], a'
    );

    candidates.forEach((el) => {
      if (processedFields.has(el)) return;

      const isSubmitType = el.type === 'submit';
      const textContent = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
      const matchesText = textContent.length < 60 && loginTextPattern.test(textContent);

      if (!isSubmitType && !matchesText) return;

      processedFields.add(el);

      el.addEventListener(
        'click',
        () => {
          const form = el.closest('form');
          let pwFields;
          let usernameField;

          if (form) {
            pwFields = FieldDetection.findPasswordFields(form);
            if (pwFields.length === 0) {
              pwFields = Array.from(
                form.querySelectorAll('input[type="password"], input[data-ps-password="true"]')
              );
            }
            usernameField =
              pwFields.length > 0
                ? FieldDetection.findUsernameForPassword(pwFields[0], true)
                : Array.from(form.querySelectorAll('input')).find((inp) =>
                    FieldDetection.isUsernameField(inp)
                  );
          } else {
            pwFields = FieldDetection.findPasswordFields(document);
            if (pwFields.length === 0) {
              pwFields = Array.from(
                document.querySelectorAll('input[type="password"], input[data-ps-password="true"]')
              );
            }
            usernameField =
              pwFields.length > 0
                ? FieldDetection.findUsernameForPassword(pwFields[0], true)
                : Array.from(document.querySelectorAll('input')).find((inp) =>
                    FieldDetection.isUsernameField(inp)
                  );
          }

          handleSubmitAction(usernameField, pwFields);
        },
        true
      );
    });
  }

  async function checkForPendingSave() {
    try {
      const response = await StorageClient.getPendingSave();
      const pendingData = response ? response.pending : null;
      if (!pendingData || !pendingData.domain) return;

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (hasLoginErrorIndicators()) {
        return;
      }

      const ignoredResponse = await StorageClient.checkIgnored(pendingData.domain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      if (savePromptShown) return;
      savePromptShown = true;

      UI.showSaveBanner({
        domain: pendingData.domain,
        username: pendingData.username,
        password: pendingData.password,
        isUpdate: !!pendingData.isUpdate,

        onSave() {
          StorageClient.saveLogin(
            pendingData.domain,
            pendingData.username,
            pendingData.password,
            !!pendingData.isUpdate
          )
            .then(() => {
              UI.showToast(pendingData.isUpdate ? 'Password updated!' : 'Password saved!');
            })
            .catch((err) => console.warn('[PassSafer] Save error:', err));
        },

        onDismiss() {},

        onNever() {
          StorageClient.ignoreSite(pendingData.domain).catch((err) =>
            console.warn('[PassSafer] Ignore error:', err)
          );
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] checkForPendingSave() error:', err);
    }
  }

  function hasLoginErrorIndicators() {
    const errorPattern =
      /\b(error|invalid|incorrect|failed|wrong|falsch|ungültig|fehler|fehlgeschlagen)\b/i;

    const candidates = document.querySelectorAll(
      '[class*="error" i], [class*="alert" i], [class*="message" i], ' +
        '[class*="notification" i], [role="alert"], ' +
        '.error, .alert-danger, .alert-error, .form-error'
    );

    for (const el of candidates) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 500 && errorPattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  const debouncedScan = debounce(() => {
    scanAndAttach();
    attachSubmitListeners();

    if (location.href !== lastKnownUrl) {
      lastKnownUrl = location.href;
      savePromptShown = false;
    }
  }, 250);

  function startObserver() {
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      const shouldRescan = mutations.some(
        (m) =>
          (m.addedNodes && m.addedNodes.length > 0) ||
          m.type === 'attributes'
      );
      if (shouldRescan) {
        debouncedScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'type'],
    });
  }

  function initialize() {
    try {
      scanAndAttach();
      attachSubmitListeners();
      checkForPendingSave();
      autoShowCredentials();
      startObserver();
    } catch (err) {
      console.error('[PassSafer] Initialization error:', err);
    }
  }

  if (document.body) {
    initialize();
  } else {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  }
})();
