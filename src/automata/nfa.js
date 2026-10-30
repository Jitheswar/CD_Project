'use strict';

/**
 * @module nfa
 * @description Thompson's Construction — convert a regex AST into an NFA.
 *
 * Each NFA is a fragment with a single start state and a single accept state.
 * Transitions are either on a character (symbol) or on epsilon (ε).
 */

const { expandCharClass } = require('./regex-parser');

// ─── State ID Generator ─────────────────────────────────────────────────────

let _nextStateId = 0;

/** Reset the global state counter (useful for tests). */
function resetStateCounter() {
  _nextStateId = 0;
}

/** Allocate the next unique state id. */
function nextId() {
  return _nextStateId++;
}

// ─── NFAState ────────────────────────────────────────────────────────────────

/**
 * A single state in an NFA.
 * @class
 */
class NFAState {
  /**
   * @param {number} id - Unique identifier for this state.
   */
  constructor(id) {
    /** @type {number} */
    this.id = id;
    /**
     * Transitions on symbols.  Maps character → Set<NFAState>.
     * @type {Map<string, Set<NFAState>>}
     */
    this.transitions = new Map();
    /**
     * Epsilon transitions.
     * @type {Set<NFAState>}
     */
    this.epsilonTransitions = new Set();
  }

  /**
   * Add a transition on a symbol.
   * @param {string} symbol - The input character.
   * @param {NFAState} state - Target state.
   */
  addTransition(symbol, state) {
    if (!this.transitions.has(symbol)) {
      this.transitions.set(symbol, new Set());
    }
    this.transitions.get(symbol).add(state);
  }

  /**
   * Add an epsilon (ε) transition.
   * @param {NFAState} state - Target state.
   */
  addEpsilonTransition(state) {
    this.epsilonTransitions.add(state);
  }
}

// ─── NFA ─────────────────────────────────────────────────────────────────────

/**
 * Non-deterministic Finite Automaton.
 * @class
 */
class NFA {
  /**
   * @param {NFAState} start  - The start state.
   * @param {NFAState} accept - The single accept state.
   */
  constructor(start, accept) {
    /** @type {NFAState} */
    this.start = start;
    /** @type {NFAState} */
    this.accept = accept;
  }

  // ── Epsilon Closure ──────────────────────────────────────────

  /**
   * Compute the epsilon closure of a set of states.
   * @param {Set<NFAState>|NFAState[]} states
   * @returns {Set<NFAState>}
   */
  static epsilonClosure(states) {
    const closure = new Set(states);
    const stack = Array.from(states);
    while (stack.length > 0) {
      const state = stack.pop();
      for (const next of state.epsilonTransitions) {
        if (!closure.has(next)) {
          closure.add(next);
          stack.push(next);
        }
      }
    }
    return closure;
  }

  /**
   * Compute the set of states reachable from `states` on `symbol`,
   * followed by epsilon closure.
   * @param {Set<NFAState>} states
   * @param {string} symbol
   * @returns {Set<NFAState>}
   */
  static move(states, symbol) {
    const reached = new Set();
    for (const s of states) {
      const targets = s.transitions.get(symbol);
      if (targets) {
        for (const t of targets) {
          reached.add(t);
        }
      }
    }
    return NFA.epsilonClosure(reached);
  }

  // ── Simulation ───────────────────────────────────────────────

  /**
   * Simulate the NFA on an input string.
   * @param {string} input - The input string.
   * @returns {boolean} True if the NFA accepts the input.
   */
  simulate(input) {
    let current = NFA.epsilonClosure([this.start]);
    for (let i = 0; i < input.length; i++) {
      current = NFA.move(current, input[i]);
      if (current.size === 0) return false;
    }
    return current.has(this.accept);
  }

  // ── Introspection ────────────────────────────────────────────

  /**
   * Collect all reachable states via BFS.
   * @returns {NFAState[]}
   */
  getStates() {
    const visited = new Set();
    const queue = [this.start];
    visited.add(this.start);
    while (queue.length > 0) {
      const s = queue.shift();
      for (const targets of s.transitions.values()) {
        for (const t of targets) {
          if (!visited.has(t)) {
            visited.add(t);
            queue.push(t);
          }
        }
      }
      for (const t of s.epsilonTransitions) {
        if (!visited.has(t)) {
          visited.add(t);
          queue.push(t);
        }
      }
    }
    return Array.from(visited);
  }

  /**
   * Derive the input alphabet from all transitions (excluding ε).
   * @returns {string[]} Sorted array of symbols.
   */
  getAlphabet() {
    const symbols = new Set();
    for (const state of this.getStates()) {
      for (const sym of state.transitions.keys()) {
        symbols.add(sym);
      }
    }
    return Array.from(symbols).sort();
  }

  /**
   * Serializable JSON representation for visualization.
   * @returns {Object}
   */
  toJSON() {
    const states = this.getStates();
    const stateList = states.map(s => s.id);
    const transitions = [];
    for (const s of states) {
      for (const [sym, targets] of s.transitions) {
        for (const t of targets) {
          transitions.push({ from: s.id, to: t.id, symbol: sym });
        }
      }
      for (const t of s.epsilonTransitions) {
        transitions.push({ from: s.id, to: t.id, symbol: 'ε' });
      }
    }
    return {
      states: stateList,
      start: this.start.id,
      accept: this.accept.id,
      transitions,
      alphabet: this.getAlphabet(),
    };
  }
}

// ─── Thompson's Construction ─────────────────────────────────────────────────

/**
 * Build an NFA from a regex AST using Thompson's Construction.
 * @param {Object} ast - The AST produced by parseRegex.
 * @returns {NFA}
 */
function regexToNFA(ast) {
  resetStateCounter();
  return _build(ast);
}

/**
 * Internal recursive builder.
 * @param {Object} node - AST node.
 * @returns {NFA} An NFA fragment.
 */
function _build(node) {
  switch (node.type) {
    case 'Literal':
      return _buildLiteral(node.value);

    case 'Concat':
      return _buildConcat(node.left, node.right);

    case 'Alt':
      return _buildAlt(node.left, node.right);

    case 'Star':
      return _buildStar(node.child);

    case 'Plus':
      return _buildPlus(node.child);

    case 'Optional':
      return _buildOptional(node.child);

    case 'CharClass':
      return _buildCharClass(node);

    case 'Dot':
      return _buildDot();

    case 'Empty':
      return _buildEmpty();

    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

/**
 * Thompson's construction for a single literal character.
 *
 *   (start) --ch--> (accept)
 */
function _buildLiteral(ch) {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  start.addTransition(ch, accept);
  return new NFA(start, accept);
}

/**
 * Thompson's construction for concatenation.
 *
 *   NFA1.start --...--> NFA1.accept --ε--> NFA2.start --...--> NFA2.accept
 */
function _buildConcat(left, right) {
  const nfa1 = _build(left);
  const nfa2 = _build(right);
  nfa1.accept.addEpsilonTransition(nfa2.start);
  return new NFA(nfa1.start, nfa2.accept);
}

/**
 * Thompson's construction for alternation.
 *
 *          ε──> NFA1 ──ε
 *         /               \
 *   start                  accept
 *         \               /
 *          ε──> NFA2 ──ε
 */
function _buildAlt(left, right) {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  const nfa1 = _build(left);
  const nfa2 = _build(right);

  start.addEpsilonTransition(nfa1.start);
  start.addEpsilonTransition(nfa2.start);
  nfa1.accept.addEpsilonTransition(accept);
  nfa2.accept.addEpsilonTransition(accept);

  return new NFA(start, accept);
}

/**
 * Thompson's construction for Kleene star.
 *
 *          ε────────────────ε
 *         /                   \
 *   start ──ε──> NFA ──ε──> accept
 *                  \    ε    /
 *                   \──────/
 */
function _buildStar(child) {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  const nfa = _build(child);

  start.addEpsilonTransition(nfa.start);
  start.addEpsilonTransition(accept);       // skip (zero occurrences)
  nfa.accept.addEpsilonTransition(nfa.start); // loop back
  nfa.accept.addEpsilonTransition(accept);    // exit

  return new NFA(start, accept);
}

/**
 * Thompson's construction for plus (one-or-more).
 *
 *   start ──ε──> NFA ──ε──> accept
 *                  \    ε    /
 *                   \──────/  (loop back)
 *
 * (no skip from start to accept — must go through NFA at least once)
 */
function _buildPlus(child) {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  const nfa = _build(child);

  start.addEpsilonTransition(nfa.start);
  nfa.accept.addEpsilonTransition(nfa.start); // loop back
  nfa.accept.addEpsilonTransition(accept);    // exit

  return new NFA(start, accept);
}

/**
 * Thompson's construction for optional (zero-or-one).
 *
 *          ε────────────────ε
 *         /                   \
 *   start ──ε──> NFA ──ε──> accept
 *
 * (skip allowed, but no loop back)
 */
function _buildOptional(child) {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  const nfa = _build(child);

  start.addEpsilonTransition(nfa.start);
  start.addEpsilonTransition(accept);      // skip
  nfa.accept.addEpsilonTransition(accept); // exit

  return new NFA(start, accept);
}

/**
 * Build an NFA for a character class.
 * Expands the ranges and creates an alternation of literals.
 *
 *          ε──> (--c1-->) ──ε
 *         /                   \
 *   start ──ε──> (--c2-->) ──ε──> accept
 *         \                   /
 *          ε──> (--c3-->) ──ε
 */
function _buildCharClass(node) {
  const chars = expandCharClass(node);
  if (chars.length === 0) {
    // Degenerate: no chars match — build a dead NFA (never accepts).
    const start = new NFAState(nextId());
    const accept = new NFAState(nextId());
    return new NFA(start, accept); // no transitions at all
  }

  // Optimization: single transition from start to accept for each char.
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  for (const ch of chars) {
    start.addTransition(ch, accept);
  }
  return new NFA(start, accept);
}

/**
 * Build an NFA for the dot metacharacter (any char except newline).
 * Uses printable ASCII range 32-126 plus \t, \r (but not \n).
 */
function _buildDot() {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  // Tab and carriage return
  start.addTransition('\t', accept);
  start.addTransition('\r', accept);
  // Printable ASCII 32–126
  for (let c = 32; c <= 126; c++) {
    start.addTransition(String.fromCharCode(c), accept);
  }
  return new NFA(start, accept);
}

/**
 * Build an NFA for the empty string ε.
 *
 *   start ──ε──> accept
 */
function _buildEmpty() {
  const start = new NFAState(nextId());
  const accept = new NFAState(nextId());
  start.addEpsilonTransition(accept);
  return new NFA(start, accept);
}

module.exports = {
  NFAState,
  NFA,
  regexToNFA,
  resetStateCounter,
};
