// field-detection.js – Intelligente Erkennung von Login-/Signup-Formularen und Eingabefeldern
// Content-Script ohne ES-Module-Syntax; teilt sich den globalen Scope mit anderen Content-Scripts.

window.PassSafer = window.PassSafer || {};

window.PassSafer.FieldDetection = (() => {
    'use strict';

    // ──────────────────────────────────────────────
    // Hilfskonstanten für Heuristiken
    // ──────────────────────────────────────────────

    /** Muster, die auf ein Benutzername-Feld hindeuten (name / id) */
    const USERNAME_NAME_ID_PATTERNS = [
        'user', 'username', 'login', 'email', 'e-mail',
        'account', 'identifier', 'signin', 'benutzername'
    ];

    /** Zusätzliche Muster für den Placeholder (Obermenge der name/id-Muster) */
    const USERNAME_PLACEHOLDER_EXTRA = [
        'e-mail-adresse', 'benutzername', 'anmelden'
    ];
    const USERNAME_PLACEHOLDER_PATTERNS = [...USERNAME_NAME_ID_PATTERNS, ...USERNAME_PLACEHOLDER_EXTRA];

    /** Muster, die ein Suchfeld identifizieren und als Username ausschließen */
    const SEARCH_EXCLUSION_PATTERNS = ['search', 'query', 'filter', 'find'];

    /** URL-Fragmente in der Form-Action, die auf Registrierung hindeuten */
    const SIGNUP_ACTION_PATTERNS = ['register', 'signup', 'sign-up', 'create', 'join', 'enroll'];

    /** Texte in Überschriften / Seitentext, die auf Registrierung hindeuten */
    const SIGNUP_TEXT_PATTERNS = [
        'registrier', 'sign up', 'signup', 'create account',
        'konto erstellen', 'neues konto', 'register', 'join'
    ];
    /** 'anmelden' nur in Kombination mit 2+ Passwortfeldern */
    const SIGNUP_TEXT_CONDITIONAL = ['anmelden'];

    /** Button-Texte, die auf Registrierung hindeuten */
    const SIGNUP_BUTTON_PATTERNS = [
        'registrier', 'sign up', 'create', 'erstellen', 'join'
    ];
    /** 'anmelden' im Button nur in Kombination mit 2+ Passwortfeldern */
    const SIGNUP_BUTTON_CONDITIONAL = ['anmelden'];

    // ──────────────────────────────────────────────
    // Interne Hilfsfunktionen
    // ──────────────────────────────────────────────

    /**
     * Prüft, ob ein String eines der gegebenen Muster enthält (case-insensitive).
     * @param {string} value  – zu prüfender String
     * @param {string[]} patterns – Array von Mustern
     * @returns {boolean}
     */
    function _matchesAny(value, patterns) {
        if (!value) return false;
        const lower = value.toLowerCase();
        return patterns.some(p => lower.includes(p));
    }

    /**
     * Prüft, ob ein Element im Viewport sichtbar ist.
     * offsetParent ist null bei display:none und bei position:fixed – letzteres behandeln wir separat.
     */
    function _isVisible(el) {
        if (!el) return false;
        // Schneller Check: versteckte Elemente haben kein offsetParent
        // Ausnahme: fixed/sticky positionierte Elemente oder das <body>-Element
        if (el.offsetParent === null) {
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            // position: fixed/sticky Elemente haben offsetParent === null, sind aber sichtbar
            if (style.position !== 'fixed' && style.position !== 'sticky') return false;
        }
        // Zusätzlicher Check: Null-Dimensionen filtern
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * Gibt alle Passwort-Felder innerhalb eines Scopes zurück.
     * @param {HTMLElement|Document} scope
     * @returns {HTMLInputElement[]}
     */
    function _getPasswordFieldsInScope(scope) {
        return Array.from(scope.querySelectorAll('input[type="password"]'));
    }

    /**
     * Ermittelt den sichtbaren Text in der Nähe eines Formulars
     * (Überschriften innerhalb und direkt vor dem Formular).
     * @param {HTMLFormElement} form
     * @returns {string} – zusammengeführter Text, lowercase
     */
    function _getFormContextText(form) {
        const parts = [];

        // Text innerhalb des Formulars: Überschriften, Labels, Legends, Paragraphen
        const internalTextEls = form.querySelectorAll('h1, h2, h3, h4, h5, h6, label, legend, p, span');
        internalTextEls.forEach(el => {
            const t = (el.textContent || '').trim();
            if (t) parts.push(t);
        });

        // Text vor dem Formular: vorheriges Geschwister-Element (Überschrift etc.)
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

        // Elternknoten (z.B. ein Container mit Überschrift)
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

    /**
     * Ermittelt die Texte aller Submit-Buttons innerhalb eines Formulars.
     * @param {HTMLFormElement} form
     * @returns {string} – zusammengeführter Text, lowercase
     */
    function _getSubmitButtonTexts(form) {
        const parts = [];

        // <button type="submit"> oder <input type="submit">
        const buttons = form.querySelectorAll(
            'button[type="submit"], input[type="submit"], button:not([type]), [role="button"]'
        );
        buttons.forEach(btn => {
            const text = btn.value || btn.textContent || btn.getAttribute('aria-label') || '';
            if (text.trim()) parts.push(text.trim());
        });

        return parts.join(' ').toLowerCase();
    }

    // ──────────────────────────────────────────────
    // Öffentliche API
    // ──────────────────────────────────────────────

    /**
     * Prüft ob ein Input ein Passwort-Feld ist.
     * @param {HTMLInputElement} input
     * @returns {boolean}
     */
    function isPasswordField(input) {
        if (!input || input.tagName?.toLowerCase() !== 'input') return false;
        if (input.type === 'password') return true;
        const ac = (input.getAttribute('autocomplete') || '').toLowerCase();
        return ac.includes('password');
    }

    /**
     * Prüft ob ein Input ein Benutzername-/E-Mail-Feld ist.
     * Verwendet mehrere Heuristiken und schließt Suchfelder aus.
     * @param {HTMLInputElement} input
     * @returns {boolean}
     */
    function isUsernameField(input) {
        if (!input || input.tagName?.toLowerCase() !== 'input') return false;

        // Typ-Check: text, email, tel, number (manche Seiten nutzen Telefonnummer oder ID-Nummern)
        const type = (input.type || 'text').toLowerCase();
        if (type !== 'text' && type !== 'email' && type !== 'tel' && type !== 'number') return false;

        // Suchfeld-Ausschluss
        if (_isSearchField(input)) return false;

        // E-Mail-Felder sind fast immer Benutzername-Felder
        if (type === 'email') return true;

        // Positiv-Heuristiken prüfen
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();

        // Erweiterte Muster für Benutzernamen / E-Mails / IDs (Englisch und Deutsch)
        const USERNAME_PATTERNS = [
            'user', 'username', 'login', 'email', 'e-mail', 'mail',
            'account', 'identifier', 'signin', 'benutzername', 'benutzer',
            'anmelde', 'id', 'uid', 'name', 'phone', 'tel', 'mobile', 'handy',
            'mitglied', 'member', 'credential', 'kunden', 'kdnr'
        ];

        const hasAutocompleteSignal = _matchesAny(autocomplete, ['username', 'email', 'user', 'login', 'id']);
        const hasNameSignal = _matchesAny(name, USERNAME_PATTERNS);
        const hasIdSignal = _matchesAny(id, USERNAME_PATTERNS);
        const hasPlaceholderSignal = _matchesAny(placeholder, USERNAME_PATTERNS);
        const hasAriaLabelSignal = _matchesAny(ariaLabel, USERNAME_PATTERNS);

        const hasAnySignal = hasAutocompleteSignal || hasNameSignal || hasIdSignal || hasPlaceholderSignal || hasAriaLabelSignal;

        if (hasAnySignal) {
            // Sonderbedingung: autocomplete="off" ohne andere Signale → kein Username
            if (autocomplete === 'off' && !hasNameSignal && !hasIdSignal && !hasPlaceholderSignal && !hasAriaLabelSignal) {
                // falls off, aber keine anderen Signale, trotzdem weiterprüfen mit Formular-Fallbacks
            } else {
                return true;
            }
        }

        // Fallback-Heuristik: Wenn sich das Feld in einem Formular befindet, das ein Passwort-Feld enthält,
        // und es das einzige oder letzte Textfeld vor dem Passwortfeld ist.
        const form = input.form;
        if (form) {
            const inputs = Array.from(form.querySelectorAll('input'));
            const inputIdx = inputs.indexOf(input);
            if (inputIdx !== -1) {
                // Suchen nach dem nächsten Passwort-Feld nach diesem Input
                let nextPwIdx = -1;
                for (let i = inputIdx + 1; i < inputs.length; i++) {
                    if (inputs[i].type === 'password') {
                        nextPwIdx = i;
                        break;
                    }
                }
                if (nextPwIdx !== -1) {
                    // Prüfen, ob es zwischen diesem Input und dem Passwortfeld andere Textfelder gibt.
                    // Wenn dies das unmittelbar vorangegangene Text/Email-Feld vor dem Passwort-Feld ist,
                    // markieren wir es als Username-Feld.
                    let isClosestText = true;
                    for (let i = inputIdx + 1; i < nextPwIdx; i++) {
                        const otherType = (inputs[i].type || 'text').toLowerCase();
                        if (['text', 'email', 'tel', 'number'].includes(otherType) && !_isSearchField(inputs[i])) {
                            isClosestText = false;
                            break;
                        }
                    }
                    if (isClosestText) return true;
                }
            }
        }

        return false;
    }

    /**
     * Prüft ob ein Eingabefeld ein Suchfeld ist (Ausschluss-Logik).
     * @param {HTMLInputElement} input
     * @returns {boolean}
     */
    function _isSearchField(input) {
        const type = (input.type || '').toLowerCase();
        if (type === 'search') return true;

        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        const role = (input.getAttribute('role') || '').toLowerCase();

        return _matchesAny(name, SEARCH_EXCLUSION_PATTERNS)
            || _matchesAny(id, SEARCH_EXCLUSION_PATTERNS)
            || _matchesAny(role, SEARCH_EXCLUSION_PATTERNS);
    }

    /**
     * Prüft ob ein Formular ein Registrierungsformular ist.
     * @param {HTMLFormElement} form
     * @returns {boolean}
     */
    function isSignupForm(form) {
        if (!form) return false;

        const passwordFields = _getPasswordFieldsInScope(form);
        const pwCount = passwordFields.length;

        // Heuristik 1: 2+ Passwort-Felder → sehr wahrscheinlich Signup
        if (pwCount >= 2) return true;

        // Heuristik 2: autocomplete="new-password" auf einem Passwort-Feld
        const hasNewPassword = passwordFields.some(pw => {
            const ac = (pw.getAttribute('autocomplete') || '').toLowerCase();
            return ac === 'new-password';
        });
        if (hasNewPassword) return true;

        // Heuristik 3: Form-Action-URL enthält Signup-Muster
        const action = (form.getAttribute('action') || '').toLowerCase();
        if (_matchesAny(action, SIGNUP_ACTION_PATTERNS)) return true;

        // Heuristik 4: Seitentext / Überschriften in oder nahe dem Formular
        const contextText = _getFormContextText(form);
        if (_matchesAny(contextText, SIGNUP_TEXT_PATTERNS)) return true;
        // 'anmelden' nur mit 2+ Passwortfeldern (bereits oben abgedeckt, hier defensiv)
        if (pwCount >= 2 && _matchesAny(contextText, SIGNUP_TEXT_CONDITIONAL)) return true;

        // Heuristik 5: Submit-Button-Text
        const buttonText = _getSubmitButtonTexts(form);
        if (_matchesAny(buttonText, SIGNUP_BUTTON_PATTERNS)) return true;
        // 'anmelden' im Button nur mit 2+ Passwortfeldern
        if (pwCount >= 2 && _matchesAny(buttonText, SIGNUP_BUTTON_CONDITIONAL)) return true;

        return false;
    }

    /**
     * Prüft ob ein Formular ein Login-Formular ist.
     * Bedingungen: genau 1 Passwort-Feld, mind. 1 Username-Feld, kein Signup.
     * @param {HTMLFormElement} form
     * @returns {boolean}
     */
    function isLoginForm(form) {
        if (!form) return false;

        const passwordFields = _getPasswordFieldsInScope(form);
        if (passwordFields.length !== 1) return false;

        // Mindestens ein Username-Feld im Formular?
        const inputs = Array.from(form.querySelectorAll('input'));
        const hasUsername = inputs.some(inp => isUsernameField(inp));
        if (!hasUsername) return false;

        // Kein Signup-Formular?
        if (isSignupForm(form)) return false;

        return true;
    }

    /**
     * Findet das zugehörige Benutzername-Feld für ein gegebenes Passwort-Feld.
     * Strategie:
     *   1. Innerhalb desselben <form>-Elements: erstes Username-Feld vor dem Passwort-Feld.
     *   2. Ohne Formular: alle Inputs im Dokument durchsuchen, bis zu 5 Felder zurückschauen.
     * @param {HTMLInputElement} passwordField
     * @returns {HTMLInputElement|null}
     */
    function findUsernameForPassword(passwordField) {
        if (!passwordField) return null;

        const form = passwordField.form;

        if (form) {
            // Strategie 1: Innerhalb des Formulars suchen
            const formInputs = Array.from(form.querySelectorAll('input'));
            const pwIndex = formInputs.indexOf(passwordField);

            // Rückwärts suchen – das nächstliegende Username-Feld vor dem Passwort-Feld
            for (let i = pwIndex - 1; i >= 0; i--) {
                if (isUsernameField(formInputs[i])) {
                    return formInputs[i];
                }
            }
            // Kein Username-Feld vor dem Passwort → vorwärts suchen (seltener Fall)
            for (let i = pwIndex + 1; i < formInputs.length; i++) {
                if (isUsernameField(formInputs[i])) {
                    return formInputs[i];
                }
            }
            return null;
        }

        // Strategie 2: Kein Formular – im gesamten Dokument suchen
        const allInputs = Array.from(document.querySelectorAll('input'));
        const pwIndex = allInputs.indexOf(passwordField);

        // Bis zu 5 Felder zurückschauen
        const startIdx = Math.max(0, pwIndex - 5);
        for (let i = pwIndex - 1; i >= startIdx; i--) {
            if (isUsernameField(allInputs[i])) {
                return allInputs[i];
            }
        }

        return null;
    }

    /**
     * Findet alle sichtbaren Passwort-Felder im angegebenen Scope.
     * @param {HTMLElement|Document} [scope=document]
     * @returns {HTMLInputElement[]}
     */
    function findPasswordFields(scope) {
        scope = scope || document;
        const all = _getPasswordFieldsInScope(scope);
        return all.filter(pw => _isVisible(pw));
    }

    /**
     * Scannt den Scope nach Formularen und formlosen Feldgruppen.
     * Gibt ein Array von Login-/Signup-Beschreibungsobjekten zurück.
     * @param {HTMLElement|Document} [scope=document]
     * @returns {Array<{form: HTMLFormElement|null, usernameField: HTMLInputElement|null, passwordField: HTMLInputElement, formType: 'login'|'signup'|'unknown'}>}
     */
    function findLoginForms(scope) {
        scope = scope || document;
        const results = [];
        /** Set, um bereits verarbeitete Passwort-Felder zu tracken */
        const processed = new Set();

        // Phase 1: Alle <form>-Elemente durchgehen
        const forms = scope.querySelectorAll('form');
        forms.forEach(form => {
            const pwFields = findPasswordFields(form);
            if (pwFields.length === 0) return;

            // Formulartyp bestimmen
            let formType = 'unknown';
            if (isSignupForm(form)) {
                formType = 'signup';
            } else if (isLoginForm(form)) {
                formType = 'login';
            }

            // Für jedes Passwort-Feld einen Eintrag erzeugen
            pwFields.forEach(pw => {
                processed.add(pw);
                const usernameField = findUsernameForPassword(pw);
                results.push({
                    form: form,
                    usernameField: usernameField,
                    passwordField: pw,
                    formType: formType
                });
            });
        });

        // Phase 2: Formlose Passwort-Felder (nicht in einem <form>)
        const allPwFields = findPasswordFields(scope);
        allPwFields.forEach(pw => {
            if (processed.has(pw)) return;
            if (pw.form) return; // Gehört zu einem Formular, das keine PW-Felder hatte (unwahrscheinlich)

            processed.add(pw);
            const usernameField = findUsernameForPassword(pw);
            results.push({
                form: null,
                usernameField: usernameField,
                passwordField: pw,
                formType: 'unknown'
            });
        });

        return results;
    }

    // ──────────────────────────────────────────────
    // Öffentliche Schnittstelle exportieren
    // ──────────────────────────────────────────────
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
