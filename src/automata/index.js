'use strict';

/**
 * @module automata
 * @description Educational and production Automata module for NexCC:
 *   Regex AST -> NFA (Thompson's) -> DFA (Subset construction) -> Minimized DFA (Hopcroft's)
 */

const { parseRegex, expandCharClass } = require('./regex-parser');
const { NFA, NFAState, regexToNFA, resetStateCounter } = require('./nfa');
const { DFA, DFAState, nfaToDFA } = require('./dfa');
const { minimizeDFA, areEquivalent } = require('./minimize');

/**
 * Convenience pipeline helper: compile regex string all the way to minimized DFA.
 * @param {string} pattern
 * @returns {{ ast: object, nfa: NFA, dfa: DFA, minDfa: DFA }}
 */
function compileRegexPipeline(pattern) {
  const ast = parseRegex(pattern);
  const nfa = regexToNFA(ast);
  const dfa = nfaToDFA(nfa);
  const minDfa = minimizeDFA(dfa);
  return { ast, nfa, dfa, minDfa };
}

module.exports = {
  parseRegex,
  expandCharClass,
  NFA,
  NFAState,
  regexToNFA,
  resetStateCounter,
  DFA,
  DFAState,
  nfaToDFA,
  minimizeDFA,
  areEquivalent,
  compileRegexPipeline,
};
