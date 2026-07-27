/**
 * @file Pure calculator engine.
 *
 * Contains zero DOM references so it can run in the browser (attached to
 * `window.CalculatorEngine`) and in Node.js (via `module.exports`) for testing.
 * All state transitions are performed through {@link createCalculator}.
 */

(function (root, factory) {
  'use strict';
  /* istanbul ignore else */
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CalculatorEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Tunable engine limits and copy. Centralised so no magic numbers leak into
   * the transition logic below.
   * @readonly
   * @enum {number|string}
   */
  var CONFIG = {
    /** Maximum digits a user may type into the entry buffer. */
    MAX_INPUT_DIGITS: 12,
    /** Significant digits kept when normalising a computed result. */
    SIGNIFICANT_DIGITS: 12,
    /** Results at or above this magnitude switch to scientific notation. */
    SCIENTIFIC_UPPER_BOUND: 1e12,
    /** Non-zero results below this magnitude switch to scientific notation. */
    SCIENTIFIC_LOWER_BOUND: 1e-9,
    /** Digits of mantissa precision used for scientific notation. */
    SCIENTIFIC_PRECISION: 6
  };

  /**
   * Human readable error strings surfaced on the display.
   * @readonly
   * @enum {string}
   */
  var ERRORS = {
    DIVIDE_BY_ZERO: 'DIV BY 0',
    OVERFLOW: 'OVERFLOW',
    UNDEFINED: 'NOT A NUMBER'
  };

  /**
   * Every action the engine understands. The UI layer dispatches these names
   * so the two layers share a single vocabulary.
   * @readonly
   * @enum {string}
   */
  var ACTIONS = {
    DIGIT: 'digit',
    DECIMAL: 'decimal',
    OPERATOR: 'operator',
    EQUALS: 'equals',
    CLEAR_ALL: 'clearAll',
    CLEAR_ENTRY: 'clearEntry',
    BACKSPACE: 'backspace',
    SIGN: 'sign',
    PERCENT: 'percent'
  };

  /** Display symbols for each operator, keyed by its internal token. */
  var OPERATOR_SYMBOLS = {
    '+': '+',
    '-': '\u2212',
    '*': '\u00d7',
    '/': '\u00f7'
  };

  /**
   * Arithmetic implementations keyed by operator token. Each returns a raw
   * JavaScript number; `Infinity`/`NaN` are normalised later by
   * {@link toEngineNumber}.
   * @type {Object<string, function(number, number): number>}
   */
  var OPERATIONS = {
    '+': function (a, b) { return a + b; },
    '-': function (a, b) { return a - b; },
    '*': function (a, b) { return a * b; },
    '/': function (a, b) { return a / b; }
  };

  /**
   * Runs an operation and normalises the outcome, reporting divide-by-zero
   * with a dedicated message rather than a generic overflow.
   * @param {string} token Operator token.
   * @param {number} left Left operand.
   * @param {number} right Right operand.
   * @returns {{value: (number|null), error: (string|null)}} Normalised result.
   */
  function applyOperation(token, left, right) {
    if (token === '/' && right === 0) {
      return {
        value: null,
        error: left === 0 ? ERRORS.UNDEFINED : ERRORS.DIVIDE_BY_ZERO
      };
    }
    return toEngineNumber(OPERATIONS[token](left, right));
  }

  /**
   * Counts significant digits typed by the user, ignoring formatting glyphs.
   * @param {string} entry Raw entry buffer, e.g. `-12.30`.
   * @returns {number} Number of numeric characters.
   */
  function countDigits(entry) {
    return entry.replace(/[-.]/g, '').length;
  }

  /**
   * Removes binary floating point noise (e.g. `0.30000000000000004`) by
   * re-rounding to the configured significant digits.
   * @param {number} value Raw arithmetic result.
   * @returns {number} Cleaned value.
   */
  function stripFloatNoise(value) {
    if (!isFinite(value) || value === 0) return value;
    return parseFloat(value.toPrecision(CONFIG.SIGNIFICANT_DIGITS));
  }

  /**
   * Converts a raw arithmetic result into either a finite number or an error
   * token, so downstream code never has to test for `NaN`/`Infinity` again.
   * @param {number} value Raw arithmetic result.
   * @returns {{value: (number|null), error: (string|null)}} Normalised result.
   */
  function toEngineNumber(value) {
    if (Number.isNaN(value)) return { value: null, error: ERRORS.UNDEFINED };
    if (!isFinite(value)) return { value: null, error: ERRORS.OVERFLOW };
    return { value: stripFloatNoise(value), error: null };
  }

  /**
   * Formats a number for the LED display, falling back to scientific notation
   * for magnitudes that cannot fit in {@link CONFIG.MAX_INPUT_DIGITS}.
   * @param {number} value Finite number to format.
   * @returns {string} Display-ready string.
   */
  function formatNumber(value) {
    if (value === 0) return '0';

    var magnitude = Math.abs(value);
    var needsScientific =
      magnitude >= CONFIG.SCIENTIFIC_UPPER_BOUND ||
      magnitude < CONFIG.SCIENTIFIC_LOWER_BOUND;

    if (needsScientific) {
      // `toExponential` keeps trailing zeros; trim them for a cleaner readout.
      return value
        .toExponential(CONFIG.SCIENTIFIC_PRECISION)
        .replace(/\.?0+e/, 'e')
        .replace('e+', 'e');
    }

    var text = String(stripFloatNoise(value));
    if (countDigits(text) <= CONFIG.MAX_INPUT_DIGITS) return text;

    // The integer part gets first claim on the digit budget; a leading "0."
    // is pure formatting and must not consume any of it.
    var truncated = Math.trunc(value);
    var integerDigits = truncated === 0 ? 0 : countDigits(String(truncated));
    var fractionBudget = Math.max(0, CONFIG.MAX_INPUT_DIGITS - integerDigits);
    return stripFloatNoise(parseFloat(value.toFixed(fractionBudget))).toString();
  }

  /**
   * @typedef {Object} CalculatorSnapshot
   * @property {string} display Primary readout, already formatted.
   * @property {string} expression Secondary readout showing pending operation.
   * @property {boolean} isError True when the engine is in an error state.
   * @property {boolean} isEntering True while the user is typing an operand.
   * @property {boolean} canClearEntry True when CE differs from AC.
   */

  /**
   * Creates an isolated calculator instance.
   *
   * The engine is a small state machine: an entry buffer (`display`) plus an
   * accumulator and a pending operator. `lastOperator`/`lastOperand` implement
   * desktop-style repeated equals.
   *
   * @returns {{
   *   dispatch: function(string, *=): CalculatorSnapshot,
   *   getSnapshot: function(): CalculatorSnapshot
   * }} Calculator instance.
   */
  function createCalculator() {
    var display = '0';
    var accumulator = null;
    var operator = null;
    var lastOperator = null;
    var lastOperand = null;
    var waitingForOperand = false;
    var error = null;

    /**
     * Builds an immutable view of the current state for the UI layer.
     * @returns {CalculatorSnapshot} Current snapshot.
     */
    function getSnapshot() {
      var expression = '';
      if (!error && accumulator !== null && operator) {
        expression = formatNumber(accumulator) + ' ' + OPERATOR_SYMBOLS[operator];
      }
      return {
        display: error || display,
        expression: expression,
        isError: Boolean(error),
        isEntering: !waitingForOperand && !error,
        canClearEntry: display !== '0' || waitingForOperand
      };
    }

    /** Resets every field back to power-on state. */
    function clearAll() {
      display = '0';
      accumulator = null;
      operator = null;
      lastOperator = null;
      lastOperand = null;
      waitingForOperand = false;
      error = null;
    }

    /** Clears only the current entry, preserving any pending operation. */
    function clearEntry() {
      display = '0';
      waitingForOperand = false;
      error = null;
    }

    /**
     * Applies a normalised result to the entry buffer, or latches an error.
     * @param {{value: (number|null), error: (string|null)}} normalised
     *   Result produced by {@link toEngineNumber} or {@link applyOperation}.
     * @returns {boolean} True when the result was finite and usable.
     */
    function commitResult(normalised) {
      if (normalised.error) {
        error = normalised.error;
        accumulator = null;
        operator = null;
        lastOperator = null;
        lastOperand = null;
        return false;
      }
      display = formatNumber(normalised.value);
      return true;
    }

    /**
     * Appends a digit, honouring the entry length limit and leading zeros.
     * @param {string} digit Single character `0`-`9`.
     */
    function inputDigit(digit) {
      if (waitingForOperand) {
        display = digit;
        waitingForOperand = false;
        return;
      }
      // Leading zeros are meaningless: "0" + "5" must become "5", not "05".
      if (display === '0') {
        display = digit;
        return;
      }
      if (display === '-0') {
        display = '-' + digit;
        return;
      }
      if (countDigits(display) < CONFIG.MAX_INPUT_DIGITS) {
        display += digit;
      }
    }

    /** Starts or continues a decimal fraction, never allowing two points. */
    function inputDecimal() {
      if (waitingForOperand) {
        display = '0.';
        waitingForOperand = false;
        return;
      }
      if (display.indexOf('.') === -1) display += '.';
    }

    /** Deletes the right-most character of the entry buffer. */
    function backspace() {
      // Backspace never edits a computed result, matching desktop calculators.
      if (waitingForOperand) return;
      display = display.length > 1 ? display.slice(0, -1) : '0';
      if (display === '-' || display === '') display = '0';
    }

    /** Flips the sign of the current entry without disturbing the entry mode. */
    function toggleSign() {
      if (display === '0') return;
      display = display.charAt(0) === '-' ? display.slice(1) : '-' + display;
    }

    /**
     * Desktop-style percentage: relative to the accumulator for additive
     * operations (`200 + 10% = 220`), absolute otherwise (`200 * 10% = 20`).
     */
    function percent() {
      var current = parseFloat(display) || 0;
      var isAdditive = operator === '+' || operator === '-';
      var result =
        isAdditive && accumulator !== null
          ? (accumulator * current) / 100
          : current / 100;
      if (commitResult(toEngineNumber(result))) waitingForOperand = false;
    }

    /**
     * Registers a pending operator, folding any already-pending operation.
     * @param {string} token One of `+`, `-`, `*`, `/`.
     */
    function setOperator(token) {
      if (!OPERATIONS[token]) return;

      // Pressing another operator while waiting simply replaces the choice.
      if (waitingForOperand && operator !== null) {
        operator = token;
        return;
      }

      var current = parseFloat(display) || 0;
      if (accumulator !== null && operator) {
        if (!commitResult(applyOperation(operator, accumulator, current))) return;
        accumulator = parseFloat(display);
      } else {
        accumulator = current;
      }

      operator = token;
      waitingForOperand = true;
      lastOperator = null;
      lastOperand = null;
    }

    /**
     * Evaluates the pending operation, or repeats the previous one when `=`
     * is pressed consecutively.
     */
    function equals() {
      var current = parseFloat(display) || 0;
      var activeOperator = operator || lastOperator;
      if (!activeOperator) return;

      var left;
      var right;
      if (operator) {
        left = accumulator === null ? current : accumulator;
        right = current;
      } else {
        // Repeated equals: reuse the stored right-hand operand.
        left = current;
        right = lastOperand;
      }

      if (!commitResult(applyOperation(activeOperator, left, right))) return;

      lastOperator = activeOperator;
      lastOperand = right;
      accumulator = null;
      operator = null;
      waitingForOperand = true;
    }

    /** Action handlers keyed by name; avoids a long switch statement. */
    var HANDLERS = {};
    HANDLERS[ACTIONS.DIGIT] = inputDigit;
    HANDLERS[ACTIONS.DECIMAL] = inputDecimal;
    HANDLERS[ACTIONS.OPERATOR] = setOperator;
    HANDLERS[ACTIONS.EQUALS] = equals;
    HANDLERS[ACTIONS.CLEAR_ALL] = clearAll;
    HANDLERS[ACTIONS.CLEAR_ENTRY] = clearEntry;
    HANDLERS[ACTIONS.BACKSPACE] = backspace;
    HANDLERS[ACTIONS.SIGN] = toggleSign;
    HANDLERS[ACTIONS.PERCENT] = percent;

    /**
     * Applies an action and returns the resulting snapshot.
     * @param {string} action One of {@link ACTIONS}.
     * @param {*} [payload] Optional payload (digit character or operator token).
     * @returns {CalculatorSnapshot} Snapshot after the transition.
     */
    function dispatch(action, payload) {
      var handler = HANDLERS[action];
      if (!handler) return getSnapshot();

      // Any keypress other than a clear escapes a latched error state.
      if (error && action !== ACTIONS.CLEAR_ALL && action !== ACTIONS.CLEAR_ENTRY) {
        clearAll();
      }

      handler(payload);
      return getSnapshot();
    }

    return { dispatch: dispatch, getSnapshot: getSnapshot };
  }

  return {
    ACTIONS: ACTIONS,
    CONFIG: CONFIG,
    ERRORS: ERRORS,
    OPERATOR_SYMBOLS: OPERATOR_SYMBOLS,
    formatNumber: formatNumber,
    createCalculator: createCalculator
  };
});
