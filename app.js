/**
 * @file UI controller.
 *
 * Binds DOM events to {@link CalculatorEngine} and renders snapshots back to
 * the LED display. All DOM references are cached once at start-up and every
 * render writes only the properties that actually changed, keeping reflows to
 * a minimum.
 */

(function (global) {
  'use strict';

  var Engine = global.CalculatorEngine;
  var ACTIONS = Engine.ACTIONS;

  /** Duration of the synthetic key-press highlight, in milliseconds. */
  var KEY_FLASH_MS = 110;

  /**
   * Display length buckets used for responsive font scaling. The first bucket
   * whose `max` is not exceeded wins.
   * @type {Array<{max: number, size: string}>}
   */
  var FONT_SCALE_STEPS = [
    { max: 7, size: 'clamp(2.2rem, 12vw, 3rem)' },
    { max: 10, size: 'clamp(1.7rem, 9vw, 2.4rem)' },
    { max: 13, size: 'clamp(1.35rem, 7vw, 1.9rem)' },
    { max: Infinity, size: 'clamp(1.05rem, 5.5vw, 1.5rem)' }
  ];

  /**
   * Maps `KeyboardEvent.key` values to engine actions.
   * @type {Object<string, {action: string, payload: (string|undefined)}>}
   */
  var KEY_BINDINGS = {
    '+': { action: ACTIONS.OPERATOR, payload: '+' },
    '-': { action: ACTIONS.OPERATOR, payload: '-' },
    '*': { action: ACTIONS.OPERATOR, payload: '*' },
    x: { action: ACTIONS.OPERATOR, payload: '*' },
    X: { action: ACTIONS.OPERATOR, payload: '*' },
    '/': { action: ACTIONS.OPERATOR, payload: '/' },
    Enter: { action: ACTIONS.EQUALS },
    '=': { action: ACTIONS.EQUALS },
    Backspace: { action: ACTIONS.BACKSPACE },
    Delete: { action: ACTIONS.CLEAR_ENTRY },
    Escape: { action: ACTIONS.CLEAR_ALL },
    '%': { action: ACTIONS.PERCENT },
    '.': { action: ACTIONS.DECIMAL },
    ',': { action: ACTIONS.DECIMAL }
  };

  /** Keys whose browser default must be suppressed (scrolling, quick-find). */
  var PREVENT_DEFAULT_KEYS = ['Enter', 'Backspace', '/', "'"];

  /**
   * Looks up the CSS font size for a readout of the given length.
   * @param {number} length Character count of the display string.
   * @returns {string} A CSS `font-size` value.
   */
  function fontSizeFor(length) {
    for (var i = 0; i < FONT_SCALE_STEPS.length; i += 1) {
      if (length <= FONT_SCALE_STEPS[i].max) return FONT_SCALE_STEPS[i].size;
    }
    return FONT_SCALE_STEPS[FONT_SCALE_STEPS.length - 1].size;
  }

  /**
   * Boots the calculator UI.
   * @param {Document} doc Owning document.
   * @returns {void}
   */
  function init(doc) {
    var calculator = Engine.createCalculator();

    // Cached DOM references: looked up once, reused for the app's lifetime.
    var dom = {
      screen: doc.getElementById('screen'),
      expression: doc.getElementById('expression'),
      announcer: doc.getElementById('announcer'),
      keys: doc.getElementById('keys'),
      display: doc.querySelector('.display'),
      clearEntry: doc.querySelector('[data-action="clearEntry"]')
    };

    /** Last rendered snapshot, used to skip redundant DOM writes. */
    var rendered = { display: null, expression: null, isError: null, isEntering: null, canClearEntry: null };

    /**
     * Writes a snapshot to the DOM, touching only changed nodes.
     * @param {import('./engine.js').CalculatorSnapshot} snapshot Engine state.
     * @returns {void}
     */
    function render(snapshot) {
      if (snapshot.display !== rendered.display) {
        dom.screen.textContent = snapshot.display;
        dom.screen.style.fontSize = fontSizeFor(snapshot.display.length);
        // Restarting the animation requires a reflow-free class toggle.
        dom.screen.classList.remove('is-updated');
        void dom.screen.offsetWidth;
        dom.screen.classList.add('is-updated');
        dom.announcer.textContent = snapshot.display;
        rendered.display = snapshot.display;
      }

      if (snapshot.expression !== rendered.expression) {
        dom.expression.textContent = snapshot.expression;
        rendered.expression = snapshot.expression;
      }

      if (snapshot.isError !== rendered.isError) {
        dom.display.classList.toggle('is-error', snapshot.isError);
        dom.screen.setAttribute('aria-invalid', String(snapshot.isError));
        rendered.isError = snapshot.isError;
      }

      if (snapshot.isEntering !== rendered.isEntering) {
        dom.display.classList.toggle('is-entering', snapshot.isEntering);
        rendered.isEntering = snapshot.isEntering;
      }

      if (dom.clearEntry && snapshot.canClearEntry !== rendered.canClearEntry) {
        dom.clearEntry.disabled = !snapshot.canClearEntry;
        rendered.canClearEntry = snapshot.canClearEntry;
      }
    }

    /**
     * Sends an action to the engine and repaints.
     * @param {string} action Engine action name.
     * @param {string} [payload] Digit character or operator token.
     * @returns {void}
     */
    function run(action, payload) {
      render(calculator.dispatch(action, payload));
    }

    /**
     * Briefly highlights a key so keyboard input has visual feedback.
     * @param {string} selector CSS selector for the key to highlight.
     * @returns {void}
     */
    function flashKey(selector) {
      var key = dom.keys.querySelector(selector);
      if (!key) return;
      key.classList.add('is-pressed');
      global.setTimeout(function () {
        key.classList.remove('is-pressed');
      }, KEY_FLASH_MS);
    }

    /**
     * Builds the selector matching the key button for an action/payload pair.
     * @param {string} action Engine action name.
     * @param {string} [payload] Digit character or operator token.
     * @returns {string} CSS selector.
     */
    function selectorFor(action, payload) {
      if (action === ACTIONS.DIGIT) return '[data-digit="' + payload + '"]';
      if (action === ACTIONS.OPERATOR) return '[data-operator="' + payload + '"]';
      return '[data-action="' + action + '"]';
    }

    // A single delegated listener covers all 20 keys (pointer + touch + click).
    dom.keys.addEventListener('click', function (event) {
      var key = event.target.closest('.key');
      if (!key || key.disabled) return;
      run(key.dataset.action, key.dataset.digit || key.dataset.operator);
    });

    doc.addEventListener('keydown', function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      var binding = event.key >= '0' && event.key <= '9'
        ? { action: ACTIONS.DIGIT, payload: event.key }
        : KEY_BINDINGS[event.key];
      if (!binding) return;

      // Space/Enter must still activate a focused button natively.
      var onButton = doc.activeElement && doc.activeElement.classList.contains('key');
      if (onButton && event.key === 'Enter') return;

      if (PREVENT_DEFAULT_KEYS.indexOf(event.key) !== -1) event.preventDefault();

      run(binding.action, binding.payload);
      flashKey(selectorFor(binding.action, binding.payload));
    });

    render(calculator.getSnapshot());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }
})(window);
