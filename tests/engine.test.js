/**
 * @file Automated test suite for the calculator engine.
 * Run with: `npm test` (Node.js 18+, no external dependencies).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../engine.js');

const { ACTIONS } = Engine;

/**
 * Maps a single character of a shorthand script to an engine action.
 * @param {string} char Character from a press script.
 * @returns {{action: string, payload: (string|undefined)}} Dispatch pair.
 */
function toAction(char) {
  if (char >= '0' && char <= '9') return { action: ACTIONS.DIGIT, payload: char };
  switch (char) {
    case '.': return { action: ACTIONS.DECIMAL };
    case '+': case '-': case '*': case '/':
      return { action: ACTIONS.OPERATOR, payload: char };
    case '=': return { action: ACTIONS.EQUALS };
    case 'C': return { action: ACTIONS.CLEAR_ALL };
    case 'E': return { action: ACTIONS.CLEAR_ENTRY };
    case '<': return { action: ACTIONS.BACKSPACE };
    case '~': return { action: ACTIONS.SIGN };
    case '%': return { action: ACTIONS.PERCENT };
    default: throw new Error(`Unknown key in script: ${char}`);
  }
}

/**
 * Runs a shorthand key script against a fresh calculator.
 * @param {string} script Sequence of key characters, e.g. `"12+3="`.
 * @returns {import('../engine.js').CalculatorSnapshot} Final snapshot.
 */
function press(script) {
  const calculator = Engine.createCalculator();
  let snapshot = calculator.getSnapshot();
  for (const char of script) {
    const { action, payload } = toAction(char);
    snapshot = calculator.dispatch(action, payload);
  }
  return snapshot;
}

/**
 * Asserts the readout produced by a key script.
 * @param {string} script Key script.
 * @param {string} expected Expected display text.
 * @returns {void}
 */
function expectDisplay(script, expected) {
  assert.equal(press(script).display, expected, `script "${script}"`);
}

test('basic arithmetic', () => {
  expectDisplay('2+3=', '5');
  expectDisplay('9-4=', '5');
  expectDisplay('7*8=', '56');
  expectDisplay('8/4=', '2');
});

test('division by zero and undefined forms are reported, not crashed', () => {
  const divByZero = press('10/0=');
  assert.equal(divByZero.display, 'DIV BY 0');
  assert.equal(divByZero.isError, true);

  const zeroOverZero = press('0/0=');
  assert.equal(zeroOverZero.display, 'NOT A NUMBER');
  assert.equal(zeroOverZero.isError, true);
});

test('an error state is cleared by AC and by the next entry', () => {
  expectDisplay('10/0=C', '0');
  expectDisplay('10/0=7', '7');
});

test('decimal arithmetic and floating point noise', () => {
  expectDisplay('0.1+0.2=', '0.3');
  expectDisplay('1.5*2=', '3');
  expectDisplay('2.5-0.5=', '2');
});

test('chained calculations evaluate left to right', () => {
  expectDisplay('2+3*4=', '20');
  expectDisplay('100/4/5=', '5');
  expectDisplay('1+2+3+4+5=', '15');
});

test('repeated equals repeats the last operation', () => {
  expectDisplay('2+3=', '5');
  expectDisplay('2+3==', '8');
  expectDisplay('2+3===', '11');
  expectDisplay('3*2==', '12');
});

test('typing after equals starts a fresh entry', () => {
  expectDisplay('2+3=7', '7');
  expectDisplay('2+3=7+1=', '8');
});

test('operator replacement keeps the pending operand', () => {
  expectDisplay('8+*2=', '16');
  expectDisplay('8+-/2=', '4');
});

test('sign toggle', () => {
  expectDisplay('5~', '-5');
  expectDisplay('5~~', '5');
  expectDisplay('~', '0');
  expectDisplay('5~+3=', '-2');
});

test('percent follows desktop calculator semantics', () => {
  expectDisplay('50%', '0.5');
  expectDisplay('200+10%=', '220');
  expectDisplay('200-10%=', '180');
  expectDisplay('200*10%=', '20');
  expectDisplay('200+10~%=', '180');
});

test('clear entry only resets the current operand', () => {
  expectDisplay('12+34E', '0');
  expectDisplay('12+34E5=', '17');
  expectDisplay('12+34C5=', '5');
});

test('backspace deletes the last typed character', () => {
  expectDisplay('123<', '12');
  expectDisplay('123<<<', '0');
  expectDisplay('123<<<<', '0');
  expectDisplay('1.5<', '1.');
  expectDisplay('5~<', '0');
});

test('backspace does not edit a computed result', () => {
  expectDisplay('2+3=<', '5');
});

test('leading zeros are collapsed', () => {
  expectDisplay('0000123', '123');
  expectDisplay('000', '0');
  expectDisplay('0.5', '0.5');
  expectDisplay('00.5', '0.5');
});

test('only one decimal point is accepted', () => {
  expectDisplay('1.2.3', '1.23');
  expectDisplay('.5', '0.5');
  expectDisplay('...', '0.');
});

test('entry length is capped at the configured digit budget', () => {
  const overflowScript = '1234567890123456';
  const snapshot = press(overflowScript);
  const digits = snapshot.display.replace(/[-.]/g, '').length;
  assert.equal(digits, Engine.CONFIG.MAX_INPUT_DIGITS);
  expectDisplay('999999999999', '999999999999');
});

test('large results fall back to scientific notation', () => {
  const snapshot = press('999999999999*999999999999=');
  assert.match(snapshot.display, /e\d+$/);
  assert.equal(snapshot.isError, false);
});

test('very small results fall back to scientific notation', () => {
  const snapshot = press('1/1000000000000=');
  assert.match(snapshot.display, /e-\d+$/);
});

test('formatNumber handles the documented boundaries', () => {
  assert.equal(Engine.formatNumber(0), '0');
  assert.equal(Engine.formatNumber(-42.5), '-42.5');
  assert.equal(Engine.formatNumber(1 / 3), '0.333333333333');
  assert.match(Engine.formatNumber(1e13), /e13$/);
});

test('the expression line mirrors the pending operation', () => {
  assert.equal(press('12+').expression, '12 +');
  assert.equal(press('12*').expression, '12 \u00d7');
  assert.equal(press('12+3=').expression, '');
});

test('snapshot flags drive the UI states', () => {
  assert.equal(press('1').isEntering, true);
  assert.equal(press('1+').isEntering, false);
  assert.equal(press('').canClearEntry, false);
  assert.equal(press('1').canClearEntry, true);
});

test('unknown actions are ignored without changing state', () => {
  const calculator = Engine.createCalculator();
  calculator.dispatch(ACTIONS.DIGIT, '7');
  assert.equal(calculator.dispatch('teleport').display, '7');
});

test('a long rapid sequence stays consistent', () => {
  const calculator = Engine.createCalculator();
  calculator.dispatch(ACTIONS.DIGIT, '1');
  for (let i = 0; i < 500; i += 1) {
    calculator.dispatch(ACTIONS.OPERATOR, '+');
    calculator.dispatch(ACTIONS.DIGIT, '1');
  }
  assert.equal(calculator.dispatch(ACTIONS.EQUALS).display, '501');
});

test('calculator instances are isolated from one another', () => {
  const first = Engine.createCalculator();
  const second = Engine.createCalculator();
  first.dispatch(ACTIONS.DIGIT, '9');
  assert.equal(second.getSnapshot().display, '0');
});
