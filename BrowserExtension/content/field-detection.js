window.PassSafer = window.PassSafer || {};

window.PassSafer.FieldDetection = (() => {
  'use strict';

  const USERNAME_NAME_ID_PATTERNS = [
    'user', 'username', 'login', 'email', 'e-mail', 'mail',
    'account', 'identifier', 'signin', 'benutzername', 'benutzer',
    'anmeld', 'uid', 'logon', 'membre', 'utilisateur', 'usuario',
    'correo', 'phone', 'tel', 'mobile', 'handy', 'handle',
    'credential', 'principal', 'member', 'nickname', 'nick',
    'customer', 'kdnr', 'kundennummer', 'mitglied', 'person',
    'contact', 'auth', 'session', 'uname', 'loginid', 'userid',
    'accountname', 'emailaddress', 'emailaddr'
  ];

  const USERNAME_PLACEHOLDER_EXTRA = [
    'e-mail-adresse', 'deine e-mail', 'your email', 'enter email',
    'gib deine', 'entrez votre', 'ingrese', 'insira'
  ];
  const USERNAME_PLACEHOLDER_PATTERNS = [...USERNAME_NAME_ID_PATTERNS, ...USERNAME_PLACEHOLDER_EXTRA];

  const SEARCH_EXCLUSION_PATTERNS = [
    'search', 'query', 'filter', 'find', 'suche', 'recherche',
    'newsletter', 'subscribe', 'coupon', 'promo', 'voucher', 'comment'
  ];

  const OTP_EXCLUSION_PATTERNS = [
    'otp', 'totp', '2fa', 'mfa', 'verification', 'verify-code',
    'security-code', 'Passcode', 'captcha', 'cvv', 'cvc', 'csc', 'postal', 'zip'
  ];

  const SIGNUP_ACTION_PATTERNS = [
    'register', 'signup', 'sign-up', 'create', 'join', 'enroll',
    'inscription', 'registrar', 'cadastro', 'konto-erstellen'
  ];

  const SIGNUP_TEXT_PATTERNS = [
    'registrier', 'sign up', 'signup', 'create account',
    'konto erstellen', 'neues konto', 'register', 'join',
    'inscription', 'créer un compte', 'nueva cuenta', 'criar conta'
  ];
  const SIGNUP_TEXT_CONDITIONAL = ['anmelden'];

  const SIGNUP_BUTTON_PATTERNS = [
    'registrier', 'sign up', 'create', 'erstellen', 'join',
    'inscription', "s'inscrire", 'registrarse', 'cadastrar'
  ];
  const SIGNUP_BUTTON_CONDITIONAL = ['anmelden'];

  const LOGIN_CONTEXT_PATTERNS = [
    'login', 'log in', 'sign in', 'signin', 'anmelden', 'einloggen',
    'continue', 'weiter', 'next', 'account', 'konto', 'welcome back'
  ];

  const DATA_ATTR_USERNAME_PATTERNS = [
    'username', 'email', 'login', 'user', 'account', 'auth',
    'field-type-email', 'field-type-username'
  ];

  function _matchesAny(value, patterns) {
    if (!value) return false;
    const lower = value.toLowerCase();
    return patterns.some((p) => lower.includes(p.toLowerCase()));
  }

  function _getOriginalAutocomplete(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    if (el.hasAttribute('data-ps-orig-autocomplete')) {
      return (el.getAttribute('data-ps-orig-autocomplete') || '').toLowerCase();
    }
    return (el.getAttribute('autocomplete') || '').toLowerCase();
  }

  function _isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.type === 'hidden' || el.hidden) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    if (el.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function _querySelectorAllDeep(root, selector) {
    const results = [];
    if (!root || typeof root.querySelectorAll !== 'function') return results;
    try {
      const els = root.querySelectorAll(selector);
      els.forEach((el) => results.push(el));
      const allEls = root.querySelectorAll('*');
      allEls.forEach((el) => {
        if (el.shadowRoot) {
          _querySelectorAllDeep(el.shadowRoot, selector).forEach((found) => results.push(found));
        }
      });
    } catch (_) {}
    return results;
  }

  function _getLogicalContainer(el) {
    if (!el) return null;
    if (el.tagName && el.tagName.toLowerCase() === 'form') return el;
    if (el.form) return el.form;
    const roleForm = el.closest('[role="form"]');
    if (roleForm) return roleForm;

    let curr = el.parentElement;
    let depth = 0;
    let best = el.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement && depth < 4) {
      const inputs = curr.querySelectorAll('input:not([type="hidden"])');
      if (inputs.length >= 1 && inputs.length <= 6) {
        best = curr;
      }
      if (inputs.length > 6) {
        break;
      }
      curr = curr.parentElement;
      depth++;
    }
    return best || el.parentElement || document.body;
  }

  function _getPasswordFieldsInScope(scope) {
    const container = _getLogicalContainer(scope) || scope;
    if (!container || typeof container.querySelectorAll !== 'function') return [];
    const inputs = _querySelectorAllDeep(container, 'input');
    return inputs.filter((inp) => isPasswordField(inp) && _isVisible(inp));
  }

  function _getFormContextText(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return '';
    const parts = [];
    const internalTextEls = container.querySelectorAll('h1, h2, h3, h4, h5, h6, label, legend, p, span');
    internalTextEls.forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t && t.length < 200) parts.push(t);
    });
    let prev = container.previousElementSibling;
    let looked = 0;
    while (prev && looked < 3) {
      const tag = prev.tagName?.toLowerCase();
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'legend'].includes(tag)) {
        const t = (prev.textContent || '').trim();
        if (t && t.length < 200) parts.push(t);
      }
      prev = prev.previousElementSibling;
      looked++;
    }
    const parent = container.parentElement;
    if (parent) {
      const parentHeadings = parent.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
      parentHeadings.forEach((h) => {
        const t = (h.textContent || '').trim();
        if (t && t.length < 200) parts.push(t);
      });
    }
    return parts.join(' ').toLowerCase();
  }

  function _getSubmitButtonTexts(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return '';
    const parts = [];
    const buttons = container.querySelectorAll(
      'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
    );
    buttons.forEach((btn) => {
      const text = btn.value || btn.textContent || btn.getAttribute('aria-label') || '';
      if (text.trim()) parts.push(text.trim());
    });
    return parts.join(' ').toLowerCase();
  }

  function _hasUsernameDataAttrs(input) {
    if (!input.attributes) return false;
    for (const attr of input.attributes) {
      if (attr.name.startsWith('data-') && !attr.name.startsWith('data-ps-')) {
        if (_matchesAny(attr.value, DATA_ATTR_USERNAME_PATTERNS)) return true;
        if (_matchesAny(attr.name, DATA_ATTR_USERNAME_PATTERNS)) return true;
      }
    }
    return false;
  }

  function _isOtpOrSpecialField(input) {
    const ac = _getOriginalAutocomplete(input);
    if (ac === 'one-time-code' || ac.includes('cc-')) return true;
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const maxLen = input.maxLength;
    if (maxLen > 0 && maxLen <= 6 && (input.inputMode === 'numeric' || input.type === 'tel' || input.type === 'number')) {
      return true;
    }
    return (
      _matchesAny(name, OTP_EXCLUSION_PATTERNS) ||
      _matchesAny(id, OTP_EXCLUSION_PATTERNS) ||
      _matchesAny(placeholder, OTP_EXCLUSION_PATTERNS)
    );
  }

  function isPasswordField(input) {
    if (!input || input.tagName?.toLowerCase() !== 'input') return false;
    if (_isOtpOrSpecialField(input)) return false;
    if (input.type === 'password') {
      input.setAttribute('data-ps-password', 'true');
      return true;
    }
    if (input.getAttribute('data-ps-password') === 'true') return true;
    const ac = _getOriginalAutocomplete(input);
    if (ac === 'current-password' || ac === 'new-password') {
      input.setAttribute('data-ps-password', 'true');
      return true;
    }
    return false;
  }

  function _getLabelText(input) {
    if (input.id) {
      try {
        const root = input.getRootNode() || document;
        const label = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) return label.textContent || '';
      } catch (_) {}
    }
    const closestLabel = input.closest('label');
    if (closestLabel) return closestLabel.textContent || '';
    return '';
  }

  function _getAllInputsInContext(input) {
    const container = _getLogicalContainer(input);
    if (container) {
      return _querySelectorAllDeep(container, 'input');
    }
    return _querySelectorAllDeep(document, 'input');
  }

  function _isSearchField(input) {
    const type = (input.type || '').toLowerCase();
    if (type === 'search') return true;
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const role = (input.getAttribute('role') || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    return (
      _matchesAny(name, SEARCH_EXCLUSION_PATTERNS) ||
      _matchesAny(id, SEARCH_EXCLUSION_PATTERNS) ||
      _matchesAny(role, SEARCH_EXCLUSION_PATTERNS) ||
      _matchesAny(placeholder, SEARCH_EXCLUSION_PATTERNS) ||
      _matchesAny(ariaLabel, SEARCH_EXCLUSION_PATTERNS)
    );
  }

  function isUsernameField(input) {
    if (!input || input.tagName?.toLowerCase() !== 'input') return false;
    if (isPasswordField(input)) return false;

    const type = (input.type || 'text').toLowerCase();
    if (type !== 'text' && type !== 'email' && type !== 'tel' && type !== 'number') return false;

    if (_isSearchField(input) || _isOtpOrSpecialField(input)) return false;

    if (type === 'email') return true;

    const autocomplete = _getOriginalAutocomplete(input);
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const ariaDescribedBy = (input.getAttribute('aria-describedby') || '').toLowerCase();
    const labelText = _getLabelText(input).toLowerCase();

    const hasAutocompleteSignal = _matchesAny(autocomplete, ['username', 'email', 'user', 'login']);
    const hasNameSignal = _matchesAny(name, USERNAME_NAME_ID_PATTERNS);
    const hasIdSignal = _matchesAny(id, USERNAME_NAME_ID_PATTERNS);
    const hasPlaceholderSignal = _matchesAny(placeholder, USERNAME_PLACEHOLDER_PATTERNS);
    const hasAriaLabelSignal = _matchesAny(ariaLabel, USERNAME_PLACEHOLDER_PATTERNS);
    const hasAriaDescSignal = _matchesAny(ariaDescribedBy, USERNAME_NAME_ID_PATTERNS);
    const hasLabelSignal = _matchesAny(labelText, USERNAME_PLACEHOLDER_PATTERNS);
    const hasDataAttrSignal = _hasUsernameDataAttrs(input);

    const hasAnySignal =
      hasAutocompleteSignal ||
      hasNameSignal ||
      hasIdSignal ||
      hasPlaceholderSignal ||
      hasAriaLabelSignal ||
      hasAriaDescSignal ||
      hasLabelSignal ||
      hasDataAttrSignal;

    if (hasAnySignal) {
      const onlyAutocompleteOff =
        autocomplete === 'off' &&
        !hasNameSignal &&
        !hasIdSignal &&
        !hasPlaceholderSignal &&
        !hasAriaLabelSignal &&
        !hasLabelSignal &&
        !hasDataAttrSignal;
      if (!onlyAutocompleteOff) {
        return true;
      }
    }

    const allInputs = _getAllInputsInContext(input);
    const inputIdx = allInputs.indexOf(input);
    if (inputIdx !== -1) {
      let nextPwIdx = -1;
      for (let i = inputIdx + 1; i < allInputs.length; i++) {
        if (isPasswordField(allInputs[i])) {
          nextPwIdx = i;
          break;
        }
      }
      if (nextPwIdx !== -1) {
        let isClosestText = true;
        for (let i = inputIdx + 1; i < nextPwIdx; i++) {
          const t = (allInputs[i].type || 'text').toLowerCase();
          if (['text', 'email', 'tel', 'number'].includes(t) && !_isSearchField(allInputs[i])) {
            isClosestText = false;
            break;
          }
        }
        if (isClosestText) return true;
      }
    }

    return false;
  }

  function isSignupForm(formOrEl) {
    const container = _getLogicalContainer(formOrEl);
    if (!container) return false;

    const passwordFields = _getPasswordFieldsInScope(container);
    const pwCount = passwordFields.length;
    if (pwCount >= 2) return true;

    const hasNewPassword = passwordFields.some((pw) => {
      const ac = _getOriginalAutocomplete(pw);
      return ac === 'new-password';
    });
    if (hasNewPassword) return true;

    const action = (typeof container.getAttribute === 'function' ? container.getAttribute('action') || '' : '').toLowerCase();
    if (_matchesAny(action, SIGNUP_ACTION_PATTERNS)) return true;

    const idAndClass = `${container.id || ''} ${container.className || ''}`.toLowerCase();
    if (_matchesAny(idAndClass, SIGNUP_ACTION_PATTERNS)) return true;

    const contextText = _getFormContextText(container);
    if (_matchesAny(contextText, SIGNUP_TEXT_PATTERNS)) return true;
    if (pwCount >= 2 && _matchesAny(contextText, SIGNUP_TEXT_CONDITIONAL)) return true;

    const buttonText = _getSubmitButtonTexts(container);
    if (_matchesAny(buttonText, SIGNUP_BUTTON_PATTERNS)) return true;
    if (pwCount >= 2 && _matchesAny(buttonText, SIGNUP_BUTTON_CONDITIONAL)) return true;

    return false;
  }

  function isLoginForm(formOrEl) {
    const container = _getLogicalContainer(formOrEl);
    if (!container) return false;
    if (isSignupForm(container)) return false;

    const passwordFields = _getPasswordFieldsInScope(container);
    if (passwordFields.length === 1) return true;

    const inputs = _querySelectorAllDeep(container, 'input').filter((inp) => _isVisible(inp));
    const hasUsername = inputs.some((inp) => isUsernameField(inp));
    if (hasUsername && passwordFields.length === 0) {
      const buttonText = _getSubmitButtonTexts(container);
      const contextText = _getFormContextText(container);
      if (_matchesAny(buttonText, LOGIN_CONTEXT_PATTERNS) || _matchesAny(contextText, LOGIN_CONTEXT_PATTERNS)) {
        return true;
      }
    }
    return false;
  }

  function findUsernameForPassword(passwordField, allowHidden = false) {
    if (!passwordField) return null;
    const container = _getLogicalContainer(passwordField);

    if (container) {
      const formInputs = _querySelectorAllDeep(container, 'input');
      const pwIndex = formInputs.indexOf(passwordField);
      for (let i = pwIndex - 1; i >= 0; i--) {
        const candidate = formInputs[i];
        if ((allowHidden || _isVisible(candidate)) && !candidate.disabled && isUsernameField(candidate)) {
          return candidate;
        }
      }
      for (let i = pwIndex + 1; i < formInputs.length; i++) {
        const candidate = formInputs[i];
        if ((allowHidden || _isVisible(candidate)) && !candidate.disabled && isUsernameField(candidate)) {
          return candidate;
        }
      }
    }

    const allInputs = _querySelectorAllDeep(document, 'input');
    const pwIndex = allInputs.indexOf(passwordField);

    const startIdx = Math.max(0, pwIndex - 8);
    for (let i = pwIndex - 1; i >= startIdx; i--) {
      const candidate = allInputs[i];
      if ((allowHidden || _isVisible(candidate)) && !candidate.disabled && isUsernameField(candidate)) {
        return candidate;
      }
    }

    const emailFields = _querySelectorAllDeep(
      document,
      'input[type="email"], input[autocomplete="email"], input[autocomplete="username"]'
    );
    for (const ef of emailFields) {
      if ((allowHidden || _isVisible(ef)) && !ef.disabled && !_isSearchField(ef)) {
        return ef;
      }
    }

    return null;
  }

  function findPasswordFields(scope) {
    scope = scope || document;
    const all = _querySelectorAllDeep(scope, 'input');
    return all.filter((inp) => isPasswordField(inp) && _isVisible(inp));
  }

  function findLoginForms(scope) {
    scope = scope || document;
    const results = [];
    const processedPw = new Set();
    const processedUser = new Set();

    const forms = _querySelectorAllDeep(scope, 'form');
    forms.forEach((form) => {
      const pwFields = findPasswordFields(form);
      if (pwFields.length > 0) {
        let formType = 'unknown';
        if (isSignupForm(form)) formType = 'signup';
        else if (isLoginForm(form)) formType = 'login';

        const usernameField = findUsernameForPassword(pwFields[0]);
        pwFields.forEach((pw) => processedPw.add(pw));
        if (usernameField) processedUser.add(usernameField);

        results.push({
          form,
          usernameField,
          passwordField: pwFields[0],
          passwordFields: pwFields,
          formType,
        });
        return;
      }

      const visibleInputs = _querySelectorAllDeep(form, 'input').filter(
        (inp) => _isVisible(inp) && !inp.disabled && !inp.readOnly
      );
      const userCandidates = visibleInputs.filter((inp) => isUsernameField(inp));
      if (userCandidates.length === 1 && visibleInputs.length <= 3 && !isSignupForm(form)) {
        const uField = userCandidates[0];
        const ac = _getOriginalAutocomplete(uField);
        const isStrongUserField =
          uField.type === 'email' ||
          ac === 'username' ||
          ac === 'email' ||
          isLoginForm(form);
        if (isStrongUserField) {
          processedUser.add(uField);
          results.push({
            form,
            usernameField: uField,
            passwordField: null,
            passwordFields: [],
            formType: 'login',
          });
        }
      }
    });

    const allPwFields = findPasswordFields(scope);
    const containerGroups = new Map();

    allPwFields.forEach((pw) => {
      if (processedPw.has(pw)) return;
      processedPw.add(pw);
      const container = _getLogicalContainer(pw) || document.body;
      if (!containerGroups.has(container)) {
        containerGroups.set(container, []);
      }
      containerGroups.get(container).push(pw);
    });

    for (const [container, pwFields] of containerGroups.entries()) {
      let formType = 'unknown';
      if (isSignupForm(container)) formType = 'signup';
      else if (isLoginForm(container)) formType = 'login';

      const usernameField = findUsernameForPassword(pwFields[0]);
      if (usernameField) processedUser.add(usernameField);

      results.push({
        form: container !== document.body ? container : null,
        usernameField,
        passwordField: pwFields[0],
        passwordFields: pwFields,
        formType,
      });
    }

    if (results.length === 0) {
      const standaloneInputs = _querySelectorAllDeep(scope, 'input').filter(
        (inp) => !processedUser.has(inp) && _isVisible(inp) && !inp.disabled && !inp.readOnly
      );
      for (const inp of standaloneInputs) {
        if (!isUsernameField(inp)) continue;
        const ac = _getOriginalAutocomplete(inp);
        const container = _getLogicalContainer(inp);
        const hasLoginSignal =
          inp.type === 'email' ||
          ac === 'username' ||
          ac === 'email' ||
          (container && isLoginForm(container));
        if (hasLoginSignal) {
          processedUser.add(inp);
          results.push({
            form: container !== document.body ? container : null,
            usernameField: inp,
            passwordField: null,
            passwordFields: [],
            formType: 'login',
          });
          break;
        }
      }
    }

    return results;
  }

  return {
    isPasswordField,
    isUsernameField,
    isSignupForm,
    isLoginForm,
    findUsernameForPassword,
    findPasswordFields,
    findLoginForms,
  };
})();
