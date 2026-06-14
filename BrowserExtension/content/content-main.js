/**
 * content-main.js – Hauptorchestrator der PassSafer Content Scripts.
 *
 * Wird als letztes Content Script geladen (nach allen Modulen) und
 * verbindet Felderkennung, Autofill, Generator, Storage und UI zu
 * einem kohärenten Ablauf.
 *
 * Abhängigkeiten (über window.PassSafer bereitgestellt):
 *   DomainUtils, StorageClient, FieldDetection, Autofill, Generator, UI
 */
(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Modul-Referenzen aus dem gemeinsamen Namespace
  // ──────────────────────────────────────────────
  const ns = window.PassSafer;
  if (!ns) {
    console.error('[PassSafer] Namespace window.PassSafer nicht gefunden – Module fehlen.');
    return;
  }

  const { DomainUtils, StorageClient, FieldDetection, Autofill, Generator, UI } = ns;

  // Sicherheitsprüfung: alle Module vorhanden?
  const requiredModules = { DomainUtils, StorageClient, FieldDetection, Autofill, Generator, UI };
  for (const [name, mod] of Object.entries(requiredModules)) {
    if (!mod) {
      console.error(`[PassSafer] Pflichtmodul "${name}" nicht geladen – Abbruch.`);
      return;
    }
  }

  // ──────────────────────────────────────────────
  // Interner Zustand
  // ──────────────────────────────────────────────

  /** Bereits verarbeitete Eingabefelder (verhindert doppeltes Anhängen von Listenern) */
  const processedFields = new WeakSet();

  /** Zwischengespeicherte Zugangsdaten des aktuellen Formular-Submits */
  let pendingCredentials = { username: '', password: '', domain: '' };

  /** Verhindert mehrfaches Einblenden des Speichern-Banners pro Seitenladevorgang */
  let savePromptShown = false;

  /** Aktuelle Domain (z. B. "example.com") */
  const currentDomain = DomainUtils.getCurrentDomain();

  /** Debounce-Timer für den MutationObserver */
  let mutationDebounceTimer = null;

  /** Letzte bekannte URL – für SPA-Navigationserkennung */
  let lastKnownUrl = location.href;

  /** Speichert die ursprünglichen Autocomplete-Attribute der Input-Felder */
  const originalAutocompletes = new WeakMap();

  // ──────────────────────────────────────────────
  // Hilfsfunktionen
  // ──────────────────────────────────────────────

  /**
   * Erzeugt eine entprellte Version einer Funktion.
   * @param {Function} fn  – Die zu entprellende Funktion
   * @param {number}   ms  – Wartezeit in Millisekunden
   * @returns {Function}
   */
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ──────────────────────────────────────────────
  // Core Flow 1: Felder scannen & Dropdown zeigen
  // ──────────────────────────────────────────────

  /**
   * Durchsucht das DOM nach Login-/Registrierungsformularen und
   * hängt Focus-/Blur-Listener an alle erkannten Felder.
   */
  function scanAndAttach() {
    /** @type {Array<{form: HTMLFormElement|null, usernameField: HTMLInputElement|null, passwordField: HTMLInputElement}>} */
    let formGroups;
    try {
      formGroups = FieldDetection.findLoginForms();
    } catch (err) {
      console.warn('[PassSafer] Fehler bei findLoginForms():', err);
      return;
    }

    if (!formGroups || formGroups.length === 0) return;

    for (const group of formGroups) {
      const fieldsToProcess = [
        ...(group.passwordField ? [group.passwordField] : []),
        ...(group.usernameField ? [group.usernameField] : []),
      ];

      // Prüfe, ob mindestens ein Feld in der Gruppe noch nicht verarbeitet wurde
      const allProcessed = fieldsToProcess.every((f) => processedFields.has(f));
      if (allProcessed && fieldsToProcess.length > 0) continue;

      for (const field of fieldsToProcess) {
        if (processedFields.has(field)) continue;
        processedFields.add(field);

        // --- Focus-Listener: Dropdown anzeigen ---
        field.addEventListener('focus', () => {
          // Browser native autocomplete Vorschläge unterdrücken
          if (!originalAutocompletes.has(field)) {
            originalAutocompletes.set(field, field.getAttribute('autocomplete'));
          }
          field.setAttribute('autocomplete', 'one-time-code');
          
          handleFieldFocus(field, group);
        }, { passive: true });

        // --- Blur-Listener: Dropdown verzögert schließen ---
        field.addEventListener(
          'blur',
          () => {
            // Originales Autocomplete wiederherstellen
            if (originalAutocompletes.has(field)) {
              const orig = originalAutocompletes.get(field);
              if (orig === null) {
                field.removeAttribute('autocomplete');
              } else {
                field.setAttribute('autocomplete', orig);
              }
            }

            // 150 ms Verzögerung, damit ein Klick im Dropdown registriert werden kann
            setTimeout(() => {
              UI.closeDropdown();
            }, 150);
          },
          { passive: true },
        );
      }
    }
  }

  /**
   * Wird bei Focus auf ein Eingabefeld aufgerufen.
   * Prüft Ignore-Status, lädt Zugangsdaten und zeigt das Dropdown an.
   *
   * @param {HTMLInputElement} anchorElement – Das fokussierte Feld
   * @param {object}           group        – Die zugehörige Formulargruppe
   */
  async function handleFieldFocus(anchorElement, group) {
    try {
      // Seite auf Ignore-Liste?
      const ignoredResponse = await StorageClient.checkIgnored(currentDomain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      // Zugangsdaten für die aktuelle Domain abrufen
      const loginsResponse = await StorageClient.getLogins(currentDomain);
      const credentials = loginsResponse && loginsResponse.credentials ? loginsResponse.credentials : [];

      // Registrierungsformular?
      const isSignup = FieldDetection.isSignupForm(group.form || anchorElement);

      // Dropdown rendern
      UI.showDropdown(anchorElement, credentials, {
        showGenerator: isSignup,

        /**
         * Callback: Benutzer wählt einen bestehenden Eintrag aus.
         * @param {{ username: string, password: string }} selected
         */
        onSelect(selected) {
          if (!selected) return;
          Autofill.fillCredentials(
            group.usernameField,
            group.passwordField,
            selected.username,
            selected.password
          );
        },

        /**
         * Callback: Benutzer möchte ein Passwort generieren lassen.
         */
        onGenerate() {
          const generated = Generator.generate();
          const pwFields = group.form ? FieldDetection.findPasswordFields(group.form) : [group.passwordField];
          Autofill.fillAllPasswordFields(pwFields, generated);
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] Fehler beim Anzeigen des Dropdowns:', err);
    }
  }

  // ──────────────────────────────────────────────
  // Core Flow 2: Submit erkennen & Speichern
  // ──────────────────────────────────────────────

  /**
   * Verarbeitet die erkannten Zugangsdaten nach einem Formular-Submit
   * oder einem Klick auf einen Login-Button.
   *
   * @param {HTMLInputElement|null} usernameField
   * @param {HTMLInputElement[]}    passwordFields
   */
  async function handleSubmitAction(usernameField, passwordFields) {
    const password = (passwordFields && passwordFields.length > 0)
      ? passwordFields[0].value
      : '';

    if (!password) return;

    const username = usernameField ? usernameField.value : '';
    const domain = currentDomain;

    pendingCredentials = { username, password, domain };

    try {
      const result = await StorageClient.checkExists(domain, username, password);

      if (result && result.shouldSave) {
        // Für den Fall einer Seiten-Navigation (Full Reload) im Background sichern
        await StorageClient.setPendingSave({
          domain,
          username,
          password,
          isUpdate: !!result.isUpdate,
        });

        // AJAX / SPA Erfolgsprüfung anstoßen (für Formular-Submits ohne Full Reload)
        detectAjaxSuccess(usernameField, passwordFields, {
          domain,
          username,
          password,
          isUpdate: !!result.isUpdate,
        });
      }
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] Fehler bei Submit-Verarbeitung:', err);
    }
  }

  /**
   * Versucht den Erfolg eines AJAX-Submits zu erkennen, um den
   * Speichern-Prompt auch ohne Seitenreload (z. B. auf Testseiten oder SPAs)
   * anzuzeigen.
   */
  function detectAjaxSuccess(usernameField, passwordFields, pendingData) {
    setTimeout(async () => {
      // Wenn der Prompt bereits eingeblendet wurde, nichts tun
      if (savePromptShown) return;

      // Haben wir einen sichtbaren Fehler auf der Seite?
      if (hasLoginErrorIndicators()) {
        // Submit war fehlerhaft → Pending-Status verwerfen
        await StorageClient.setPendingSave(null);
        return;
      }

      // Sind die Formularfelder noch sichtbar / im DOM?
      let fieldsStillVisible = false;
      for (const field of passwordFields) {
        if (field.isConnected) {
          const rect = field.getBoundingClientRect();
          const style = window.getComputedStyle(field);
          if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
            fieldsStillVisible = true;
            break;
          }
        }
      }

      // Spezielle Testumgebungen begünstigen (z. B. lokale Dateien oder localhost),
      // da dort meist kein Reload stattfindet oder Felder sichtbar bleiben.
      const isTestEnv = !currentDomain || currentDomain === 'localhost';
      const urlChanged = location.href !== lastKnownUrl;

      // Wenn die Felder verschwunden sind, die URL gewechselt hat oder wir in einer Testumgebung sind
      if (!fieldsStillVisible || urlChanged || isTestEnv) {
        // Pending Save aus dem Background löschen, da wir es jetzt direkt abarbeiten
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
            ).then(() => {
              UI.showToast(pendingData.isUpdate ? 'Password updated!' : 'Password saved!');
            }).catch((err) => console.warn('[PassSafer] Fehler beim Speichern:', err));
          },
          onDismiss() {},
          onNever() {
            StorageClient.ignoreSite(pendingData.domain)
              .catch((err) => console.warn('[PassSafer] Fehler beim Ignorieren:', err));
          }
        });
      }
    }, 1500);
  }

  /**
   * Findet alle Formulare mit Passwortfeldern und hängt Submit-Listener an.
   * Fängt außerdem Klicks auf typische Login-Buttons ab.
   */
  function attachSubmitListeners() {
    // --- Formulare mit Passwortfeldern ---
    const forms = document.querySelectorAll('form');
    forms.forEach((form) => {
      if (processedFields.has(form)) return;
      const pwFields = form.querySelectorAll('input[type="password"]');
      if (pwFields.length === 0) return;

      processedFields.add(form);

      form.addEventListener('submit', (e) => {
        // Benutzernamenfeld im Formular suchen
        const usernameField =
          form.querySelector('input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="login" i], input[type="text"][name*="email" i], input[type="text"][autocomplete*="user" i]') ||
          form.querySelector('input[type="text"]');

        handleSubmitAction(usernameField, Array.from(pwFields));
      });
    });

    // --- Submit-ähnliche Buttons außerhalb oder innerhalb von Formularen ---
    attachButtonClickListeners();
  }

  /**
   * Hängt Klick-Listener an Buttons/Links, die wahrscheinlich
   * einen Login-Vorgang auslösen (z. B. "Login", "Anmelden", "Sign in").
   */
  function attachButtonClickListeners() {
    /** Regulärer Ausdruck für typische Login-Button-Texte (DE + EN) */
    const loginTextPattern = /\b(log\s*in|sign\s*in|anmelden|einloggen|login)\b/i;

    const candidates = document.querySelectorAll(
      'button[type="submit"], input[type="submit"], button, a',
    );

    candidates.forEach((el) => {
      if (processedFields.has(el)) return;

      const isSubmitType = el.type === 'submit';
      const textContent = (el.textContent || el.value || '').trim();
      const matchesText = loginTextPattern.test(textContent);

      if (!isSubmitType && !matchesText) return;

      processedFields.add(el);

      el.addEventListener('click', () => {
        // Das nächstgelegene Formular oder die nächstgelegenen Passwortfelder finden
        const form = el.closest('form');
        let pwFields;
        let usernameField;

        if (form) {
          pwFields = Array.from(form.querySelectorAll('input[type="password"]'));
          usernameField =
            form.querySelector('input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="login" i], input[type="text"][name*="email" i]') ||
            form.querySelector('input[type="text"]');
        } else {
          // Kein Formular vorhanden – im gesamten Dokument suchen
          pwFields = Array.from(document.querySelectorAll('input[type="password"]'));
          usernameField =
            document.querySelector('input[type="email"], input[type="text"][name*="user" i], input[type="text"][name*="login" i]') ||
            document.querySelector('input[type="text"]');
        }

        if (pwFields && pwFields.length > 0) {
          handleSubmitAction(usernameField, pwFields);
        }
      });
    });
  }

  // ──────────────────────────────────────────────
  // Core Flow 2b: Ausstehende Speicherung prüfen
  // ──────────────────────────────────────────────

  /**
   * Prüft nach dem Laden der Seite, ob ein vorheriger Submit
   * ausstehende Zugangsdaten hinterlassen hat, und zeigt ggf.
   * das Speichern-Banner an.
   */
  async function checkForPendingSave() {
    try {
      const response = await StorageClient.getPendingSave();
      const pendingData = response ? response.pending : null;
      if (!pendingData || !pendingData.domain) return;

      // Kurz warten, damit die Seite sich stabilisieren kann
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Prüfen, ob Fehlermeldungen auf der Seite sichtbar sind
      // (z. B. "Falsches Passwort", "Login failed" etc.)
      if (hasLoginErrorIndicators()) {
        // Login war vermutlich nicht erfolgreich – Banner nicht anzeigen
        return;
      }

      // Ignorierte Seite?
      const ignoredResponse = await StorageClient.checkIgnored(pendingData.domain);
      if (ignoredResponse && ignoredResponse.ignored) return;

      if (savePromptShown) return;
      savePromptShown = true;

      UI.showSaveBanner({
        domain: pendingData.domain,
        username: pendingData.username,
        password: pendingData.password,
        isUpdate: !!pendingData.isUpdate,

        /** Benutzer klickt "Speichern" */
        onSave() {
          StorageClient.saveLogin(
            pendingData.domain,
            pendingData.username,
            pendingData.password,
            !!pendingData.isUpdate,
          ).catch((err) => console.warn('[PassSafer] Fehler beim Speichern:', err));
        },

        /** Benutzer schließt das Banner */
        onDismiss() {
          // Nichts weiter – Banner wird von der UI entfernt
        },

        /** Benutzer klickt "Nie für diese Seite" */
        onNever() {
          StorageClient.ignoreSite(pendingData.domain)
            .catch((err) => console.warn('[PassSafer] Fehler beim Ignorieren:', err));
        },
      });
    } catch (err) {
      if (err.message && err.message.includes('context invalidated')) return;
      console.warn('[PassSafer] Fehler bei checkForPendingSave():', err);
    }
  }

  /**
   * Durchsucht das sichtbare DOM nach typischen Fehlermeldungen,
   * die auf einen gescheiterten Login-Versuch hindeuten.
   *
   * @returns {boolean} true wenn Fehlerindikatoren gefunden wurden
   */
  function hasLoginErrorIndicators() {
    const errorPattern =
      /\b(error|invalid|incorrect|failed|wrong|falsch|ungültig|fehler|fehlgeschlagen)\b/i;

    // Sichtbare Textelemente durchsuchen (kein versteckter Inhalt)
    const candidates = document.querySelectorAll(
      '[class*="error" i], [class*="alert" i], [class*="message" i], ' +
      '[class*="notification" i], [role="alert"], ' +
      '.error, .alert-danger, .alert-error, .form-error',
    );

    for (const el of candidates) {
      // Nur sichtbare Elemente berücksichtigen
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const text = (el.textContent || '').trim();
      if (text.length > 0 && text.length < 500 && errorPattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  // ──────────────────────────────────────────────
  // Core Flow 3: MutationObserver für SPAs
  // ──────────────────────────────────────────────

  /**
   * Entprellte Version von scanAndAttach für den MutationObserver.
   */
  const debouncedScan = debounce(() => {
    scanAndAttach();
    attachSubmitListeners();

    // SPA-Navigation erkennen: Hat sich die URL geändert?
    if (location.href !== lastKnownUrl) {
      lastKnownUrl = location.href;
      // Bei URL-Wechsel den Speichern-Status zurücksetzen
      savePromptShown = false;
    }
  }, 300);

  /**
   * Startet den MutationObserver auf document.body.
   */
  function startObserver() {
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      // Nur reagieren, wenn tatsächlich Knoten hinzugefügt wurden
      const hasNewNodes = mutations.some(
        (m) => m.addedNodes && m.addedNodes.length > 0,
      );
      if (hasNewNodes) {
        debouncedScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ──────────────────────────────────────────────
  // Initialisierung
  // ──────────────────────────────────────────────

  /**
   * Startet alle Kernfunktionen, sobald document.body verfügbar ist.
   */
  function initialize() {
    try {
      scanAndAttach();
      attachSubmitListeners();
      checkForPendingSave();
      startObserver();
      console.log('[PassSafer] Extension initialized on', currentDomain);
    } catch (err) {
      console.error('[PassSafer] Fehler bei Initialisierung:', err);
    }
  }

  // document.body kann bei "run_at: document_end" bereits existieren
  if (document.body) {
    initialize();
  } else {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  }
})();
