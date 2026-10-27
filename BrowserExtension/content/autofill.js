'use strict';

window.PassSafer = window.PassSafer || {};

window.PassSafer.Autofill = (function () {
  function setNativeValue(element, value) {
    if (!element || element.disabled || element.readOnly) {
      return false;
    }

    const strValue = value == null ? '' : String(value);
    const prevValue = element.value;

    try {
      element.focus({ preventScroll: true });
      element.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    } catch (_) {}

    let descriptor = Object.getOwnPropertyDescriptor(element, 'value');
    if (!descriptor || !descriptor.set) {
      const proto = Object.getPrototypeOf(element);
      descriptor = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    }
    if (!descriptor || !descriptor.set) {
      descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    }

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, strValue);
    } else {
      element.value = strValue;
    }

    if (element._valueTracker && typeof element._valueTracker.setValue === 'function') {
      try {
        element._valueTracker.setValue(prevValue);
      } catch (_) {}
    }

    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', bubbles: true, cancelable: true }));

    let inputEvent;
    if (typeof InputEvent === 'function') {
      inputEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: strValue,
        inputType: 'insertReplacementText',
      });
    } else {
      inputEvent = new Event('input', { bubbles: true, cancelable: true });
    }
    element.dispatchEvent(inputEvent);
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', bubbles: true, cancelable: true }));

    return true;
  }

  function fillCredentials(usernameField, passwordField, username, password) {
    try {
      const fd = window.PassSafer && window.PassSafer.FieldDetection;

      let targetUserField = usernameField && usernameField.isConnected ? usernameField : null;
      let targetPwField = passwordField && passwordField.isConnected ? passwordField : null;

      if (!targetUserField && targetPwField && fd && typeof fd.findUsernameForPassword === 'function') {
        targetUserField = fd.findUsernameForPassword(targetPwField);
      }

      if (!targetPwField && targetUserField && fd && typeof fd.findPasswordFields === 'function') {
        const scope = targetUserField.form || document;
        const foundPws = fd.findPasswordFields(scope);
        if (foundPws && foundPws.length > 0) {
          targetPwField = foundPws[0];
        }
      }

      let filledAny = false;

      if (targetUserField && username !== undefined && username !== null) {
        if (setNativeValue(targetUserField, username)) {
          filledAny = true;
        }
      }

      if (targetPwField && password !== undefined && password !== null) {
        if (targetUserField && targetUserField !== targetPwField) {
          try {
            targetUserField.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
            targetUserField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
          } catch (_) {}
        }
        if (setNativeValue(targetPwField, password)) {
          filledAny = true;
        }
      }

      return filledAny;
    } catch (err) {
      console.error('[PassSafer:Autofill] fillCredentials failed:', err);
      return false;
    }
  }

  function fillAllPasswordFields(fields, password) {
    try {
      if (!Array.isArray(fields) || fields.length === 0) {
        return false;
      }

      let filledAny = false;
      for (const field of fields) {
        if (field && field.isConnected) {
          if (setNativeValue(field, password)) {
            filledAny = true;
          }
        }
      }

      return filledAny;
    } catch (err) {
      console.error('[PassSafer:Autofill] fillAllPasswordFields failed:', err);
      return false;
    }
  }

  return {
    setNativeValue,
    fillCredentials,
    fillAllPasswordFields,
  };
})();
