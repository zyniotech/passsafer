// field-detection.js – Intelligente Erkennung von Login-/Signup-Formularen und Eingabefeldern
// Content-Script ohne ES-Module-Syntax; teilt sich den globalen Scope mit anderen Content-Scripts.

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

    const SEARCH_EXCLUSION_PATTERNS = ['search', 'query', 'filter', 'find', 'suche', 'recherche'];

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
        'inscription', 's\'inscrire', 'registrarse', 'cadastrar'
    ];
    const SIGNUP_BUTTON_CONDITIONAL = ['anmelden'];

    // data-* attribute patterns for username recognition
    const DATA_ATTR_USERNAME_PATTERNS = [
        'username', 'email', 'login', 'user', 'account', 'auth',
        'field-type-email', 'field-type-username'
    ];

    function _matchesAny(value, patterns) {
        if (!value) return false;
        const lower = value.toLowerCase();
        return patterns.some(p => lower.includes(p));
    }

    function _isVisible(el) {
        if (!el) return false;
        if (el.offsetParent === null) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (style.position !== 'fixed' && style.position !== 'sticky') return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function _getPasswordFieldsInScope(scope) {
        return Array.from(scope.querySelectorAll('input[type="password"]'));
    }

    /**
     * Rekursiv durch Shadow DOMs suchen.
     * @param {HTMLElement|Document} root
     * @param {string} selector
     * @returns {HTMLElement[]}
     */
    function _querySelectorAllDeep(root, selector) {
        const results = [];
        try {
            const els = root.querySelectorAll(selector);
            els.forEach(el => results.push(el));
            // Traverse all shadow roots
            const allEls = root.querySelectorAll('*');
            allEls.forEach(el => {
                if (el.shadowRoot) {
                    _querySelectorAllDeep(el.shadowRoot, selector).forEach(found => results.push(found));
                }
            });
        } catch (e) {}
        return results;
    }

    function _getFormContextText(form) {
        const parts = [];
        const internalTextEls = form.querySelectorAll('h1, h2, h3, h4, h5, h6, label, legend, p, span');
        internalTextEls.forEach(el => {
            const t = (el.textContent || '').trim();
            if (t) parts.push(t);
        });
        let prev = form.previousElementSibling;
        let looked = 0;
        while (prev && looked < 3) {
            const tag = prev.tagName?.toLowerCase();
            if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'legend'].includes(tag)) {
                const t = (prev.textContent || '').trim();
                if (t) parts.push(t);
            }
            prev = prev.previousElementSibling;
            looked++;
        }
        const parent = form.parentElement;
        if (parent) {
            const parentHeadings = parent.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
            parentHeadings.forEach(h => {
                const t = (h.textContent || '').trim();
                if (t) parts.push(t);
            });
        }
        return parts.join(' ').toLowerCase();
    }

    function _getSubmitButtonTexts(form) {
        const parts = [];
        const buttons = form.querySelectorAll(
            'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
        );
        buttons.forEach(btn => {
            const text = btn.value || btn.textContent || btn.getAttribute('aria-label') || '';
            if (text.trim()) parts.push(text.trim());
        });
        return parts.join(' ').toLowerCase();
    }

    function _hasUsernameDataAttrs(input) {
        for (const attr of input.attributes) {
            if (attr.name.startsWith('data-')) {
                if (_matchesAny(attr.value, DATA_ATTR_USERNAME_PATTERNS)) return true;
                if (_matchesAny(attr.name, DATA_ATTR_USERNAME_PATTERNS)) return true;
            }
        }
        return false;
    }

    function isPasswordField(input) {
        if (!input || input.tagName?.toLowerCase() !== 'input') return false;
        if (input.type === 'password') return true;
        const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
        return ac.includes('password');
    }

    function isUsernameField(input) {
        if (!input || input.tagName?.toLowerCase() !== 'input') return false;

        const type = (input.type || 'text').toLowerCase();
        if (type !== 'text' && type !== 'email' && type !== 'tel' && type !== 'number') return false;

        if (_isSearchField(input)) return false;

        if (type === 'email') return true;

        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const ariaDescribedBy = (input.getAttribute('aria-describedby') || '').toLowerCase();
        const labelText = _getLabelText(input).toLowerCase();

        const hasAutocompleteSignal = _matchesAny(autocomplete, ['username', 'email', 'user', 'login', 'id']);
        const hasNameSignal = _matchesAny(name, USERNAME_NAME_ID_PATTERNS);
        const hasIdSignal = _matchesAny(id, USERNAME_NAME_ID_PATTERNS);
        const hasPlaceholderSignal = _matchesAny(placeholder, USERNAME_PLACEHOLDER_PATTERNS);
        const hasAriaLabelSignal = _matchesAny(ariaLabel, USERNAME_PLACEHOLDER_PATTERNS);
        const hasAriaDescSignal = _matchesAny(ariaDescribedBy, USERNAME_NAME_ID_PATTERNS);
        const hasLabelSignal = _matchesAny(labelText, USERNAME_PLACEHOLDER_PATTERNS);
        const hasDataAttrSignal = _hasUsernameDataAttrs(input);

        const hasAnySignal = hasAutocompleteSignal || hasNameSignal || hasIdSignal ||
            hasPlaceholderSignal || hasAriaLabelSignal || hasAriaDescSignal ||
            hasLabelSignal || hasDataAttrSignal;

        if (hasAnySignal) {
            if (autocomplete === 'off' && !hasNameSignal && !hasIdSignal &&
                !hasPlaceholderSignal && !hasAriaLabelSignal && !hasLabelSignal && !hasDataAttrSignal) {
                // continue to fallback
            } else {
                return true;
            }
        }

        // Fallback: nearest text input before a password field
        const allInputs = _getAllInputsInContext(input);
        const inputIdx = allInputs.indexOf(input);
        if (inputIdx !== -1) {
            let nextPwIdx = -1;
            for (let i = inputIdx + 1; i < allInputs.length; i++) {
                if (allInputs[i].type === 'password') { nextPwIdx = i; break; }
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

    /**
     * Holt den Text eines assoziierten <label>-Elements fuer ein Input.
     */
    function _getLabelText(input) {
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return label.textContent || '';
        }
        const closestLabel = input.closest('label');
        if (closestLabel) return closestLabel.textContent || '';
        return '';
    }

    /**
     * Gibt alle Inputs im Formular-Kontext zurueck (oder im Dokument als Fallback).
     * Schaut bis 8 Felder zurueck statt 5.
     */
    function _getAllInputsInContext(input) {
        if (input.form) {
            return Array.from(input.form.querySelectorAll('input'));
        }
        return Array.from(document.querySelectorAll('input'));
    }

    function _isSearchField(input) {
        const type = (input.type || '').toLowerCase();
        if (type === 'search') return true;
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const role = (input.getAttribute('role') || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        return _matchesAny(name, SEARCH_EXCLUSION_PATTERNS)
            || _matchesAny(id, SEARCH_EXCLUSION_PATTERNS)
            || _matchesAny(role, SEARCH_EXCLUSION_PATTERNS)
            || _matchesAny(placeholder, SEARCH_EXCLUSION_PATTERNS);
    }

    function isSignupForm(form) {
        if (!form) return false;
        const passwordFields = _getPasswordFieldsInScope(form);
        const pwCount = passwordFields.length;
        if (pwCount >= 2) return true;
        const hasNewPassword = passwordFields.some(pw => {
            const ac = (pw.getAttribute('autocomplete') || '').toLowerCase();
            return ac === 'new-password';
        });
        if (hasNewPassword) return true;
        const action = (form.getAttribute('action') || '').toLowerCase();
        if (_matchesAny(action, SIGNUP_ACTION_PATTERNS)) return true;
        const contextText = _getFormContextText(form);
        if (_matchesAny(contextText, SIGNUP_TEXT_PATTERNS)) return true;
        if (pwCount >= 2 && _matchesAny(contextText, SIGNUP_TEXT_CONDITIONAL)) return true;
        const buttonText = _getSubmitButtonTexts(form);
        if (_matchesAny(buttonText, SIGNUP_BUTTON_PATTERNS)) return true;
        if (pwCount >= 2 && _matchesAny(buttonText, SIGNUP_BUTTON_CONDITIONAL)) return true;
        return false;
    }

    function isLoginForm(form) {
        if (!form) return false;
        const passwordFields = _getPasswordFieldsInScope(form);
        if (passwordFields.length !== 1) return false;
        const inputs = Array.from(form.querySelectorAll('input'));
        const hasUsername = inputs.some(inp => isUsernameField(inp));
        if (!hasUsername) return false;
        if (isSignupForm(form)) return false;
        return true;
    }

    function findUsernameForPassword(passwordField) {
        if (!passwordField) return null;
        const form = passwordField.form;

        if (form) {
            const formInputs = Array.from(form.querySelectorAll('input'));
            const pwIndex = formInputs.indexOf(passwordField);
            for (let i = pwIndex - 1; i >= 0; i--) {
                if (isUsernameField(formInputs[i])) return formInputs[i];
            }
            for (let i = pwIndex + 1; i < formInputs.length; i++) {
                if (isUsernameField(formInputs[i])) return formInputs[i];
            }
            return null;
        }

        // Kein Formular – im gesamten Dokument inkl. Shadow DOM suchen
        const allInputs = _querySelectorAllDeep(document, 'input');
        const pwIndex = allInputs.indexOf(passwordField);

        // Bis zu 8 Felder zurueckschauen (vorher: 5) fuer Step-Login-Flows
        const startIdx = Math.max(0, pwIndex - 8);
        for (let i = pwIndex - 1; i >= startIdx; i--) {
            if (isUsernameField(allInputs[i])) return allInputs[i];
        }

        // Bei Step-Login (Google/LinkedIn): auch auf der ganzen Seite nach sichtbaren Email-Feldern suchen
        const emailFields = document.querySelectorAll('input[type="email"], input[autocomplete="email"], input[autocomplete="username"]');
        for (const ef of emailFields) {
            if (_isVisible(ef) && !ef.disabled) return ef;
        }

        return null;
    }

    function findPasswordFields(scope) {
        scope = scope || document;
        // Auch Shadow DOM durchsuchen
        const all = _querySelectorAllDeep(scope, 'input[type="password"]');
        return all.filter(pw => _isVisible(pw));
    }

    function findLoginForms(scope) {
        scope = scope || document;
        const results = [];
        const processed = new Set();

        const forms = scope.querySelectorAll('form');
        forms.forEach(form => {
            const pwFields = findPasswordFields(form);
            if (pwFields.length === 0) return;

            let formType = 'unknown';
            if (isSignupForm(form)) formType = 'signup';
            else if (isLoginForm(form)) formType = 'login';

            pwFields.forEach(pw => {
                processed.add(pw);
                results.push({
                    form,
                    usernameField: findUsernameForPassword(pw),
                    passwordField: pw,
                    formType
                });
            });
        });

        // Formlose Passwort-Felder (inkl. Shadow DOM)
        const allPwFields = findPasswordFields(scope);
        allPwFields.forEach(pw => {
            if (processed.has(pw)) return;
            if (pw.form) return;
            processed.add(pw);
            results.push({
                form: null,
                usernameField: findUsernameForPassword(pw),
                passwordField: pw,
                formType: 'unknown'
            });
        });

        return results;
    }

    return {
        isPasswordField,
        isUsernameField,
        isSignupForm,
        isLoginForm,
        findUsernameForPassword,
        findPasswordFields,
        findLoginForms
    };
})();
