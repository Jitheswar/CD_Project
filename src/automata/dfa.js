'use strict';

/**
 * @module dfa
 * @description Subset (powerset) construction — convert an NFA to a DFA.
 *
 * Each DFA state corresponds to a set of NFA states.  A DFA state is
 * accepting if any of its constituent NFA states is the NFA's accept state.
 */

const { NFA } = require('./nfa');

// ─── DFAState ────────────────────────────────────────────────────────────────

/**
 * A single state in a DFA.
 * @class
 */
class DFAState {
  /**
   * @param {number} id        - Unique identifier.
   * @param {Set<number>} nfaStates - Set of NFA state ids this DFA state represents.
   * @param {boolean} isAccept - Whether this is an accepting state.
   */
  constructor(id, nfaStates, isAccept) {
    /** @type {number} */
    this.id = id;
    /** @type {Set<number>} */
    this.nfaStates = nfaStates;
    /** @type {boolean} */
    this.isAccept = isAccept;
    /**
     * Transitions: symbol → DFAState
     * @type {Map<string, DFAState>}
     */
    this.transitions = new Map();
  }
}

// ─── DFA ─────────────────────────────────────────────────────────────────────

/**
 * Deterministic Finite Automaton.
 * @class
 */
class DFA {
  /**
   * @param {DFAState} start               - The start state.
   * @param {Map<number, DFAState>} states  - id → DFAState map.
   * @param {string[]} alphabet             - Input alphabet.
   */
  constructor(start, states, alphabet) {
    /** @type {DFAState} */
    this.start = start;
    /** @type {Map<number, DFAState>} */
    this.states = states;
    /** @type {string[]} */
    this.alphabet = alphabet;
  }

  /**
   * Simulate the DFA on an input string.
   * @param {string} input
   * @returns {boolean} True if the DFA accepts the input.
   */
  simulate(input) {
    let current = this.start;
    for (let i = 0; i < input.length; i++) {
      const next = current.transitions.get(input[i]);
      if (!next) return false; // no transition → reject (implicit dead state)
      current = next;
    }
    return current.isAccept;
  }

  /**
   * Return a transition table representation.
   * @returns {{headers: string[], rows: Object[]}}
   *   headers: ['State', ...alphabet]
   *   rows: [{state, isAccept, isStart, transitions: {symbol: targetId}}]
   */
  toTransitionTable() {
    const headers = ['State', ...this.alphabet];
    const rows = [];
    for (const [id, state] of this.states) {
      const transObj = {};
      for (const sym of this.alphabet) {
        const target = state.transitions.get(sym);
        transObj[sym] = target ? target.id : null;
      }
      rows.push({
        state: id,
        isAccept: state.isAccept,
        isStart: state === this.start,
        transitions: transObj,
      });
    }
    // Sort rows by state id for deterministic output
    rows.sort((a, b) => a.state - b.state);
    return { headers, rows };
  }

  /**
   * Serializable JSON representation for visualization.
   * @returns {Object}
   */
  toJSON() {
    const stateList = [];
    const transitions = [];
    for (const [id, state] of this.states) {
      stateList.push({
        id,
        isAccept: state.isAccept,
        isStart: state === this.start,
        nfaStates: Array.from(state.nfaStates).sort((a, b) => a - b),
      });
      for (const [sym, target] of state.transitions) {
        transitions.push({ from: id, to: target.id, symbol: sym });
      }
    }
    stateList.sort((a, b) => a.id - b.id);
    return {
      states: stateList,
      start: this.start.id,
      accepting: stateList.filter(s => s.isAccept).map(s => s.id),
      transitions,
      alphabet: this.alphabet,
    };
  }
}

// ─── Subset Construction ─────────────────────────────────────────────────────

/**
 * Convert an NFA to an equivalent DFA via the subset (powerset) construction.
 *
 * @param {import('./nfa').NFA} nfa - The NFA to convert.
 * @returns {DFA} The resulting DFA.
 */
function nfaToDFA(nfa) {
  const alphabet = nfa.getAlphabet();
  const allNFAStates = nfa.getStates();

  // Build an id → NFAState lookup for fast access.
  const nfaStateById = new Map();
  for (const s of allNFAStates) {
    nfaStateById.set(s.id, s);
  }

  // Helper: create a canonical key for a set of NFA state ids.
  function setKey(nfaStateIds) {
    return Array.from(nfaStateIds).sort((a, b) => a - b).join(',');
  }

  // Helper: extract ids from a Set<NFAState>.
  function stateIds(stateSet) {
    const ids = new Set();
    for (const s of stateSet) {
      ids.add(s.id);
    }
    return ids;
  }

  let dfaIdCounter = 0;

  // The initial DFA state is the epsilon closure of the NFA start state.
  const startClosure = NFA.epsilonClosure([nfa.start]);
  const startNfaIds = stateIds(startClosure);
  const startKey = setKey(startNfaIds);
  const startIsAccept = startClosure.has(nfa.accept);
  const startDFAState = new DFAState(dfaIdCounter++, startNfaIds, startIsAccept);

  /** @type {Map<string, DFAState>} canonical key → DFAState */
  const dfaStatesMap = new Map();
  dfaStatesMap.set(startKey, startDFAState);

  /** @type {Map<string, Set<import('./nfa').NFAState>>} key → NFA state set */
  const nfaStateSets = new Map();
  nfaStateSets.set(startKey, startClosure);

  const worklist = [startKey];

  while (worklist.length > 0) {
    const currentKey = worklist.pop();
    const currentDFA = dfaStatesMap.get(currentKey);
    const currentNFASet = nfaStateSets.get(currentKey);

    for (const sym of alphabet) {
      const nextNFASet = NFA.move(currentNFASet, sym);
      if (nextNFASet.size === 0) continue; // goes to dead state — skip

      const nextIds = stateIds(nextNFASet);
      const nextKey = setKey(nextIds);

      if (!dfaStatesMap.has(nextKey)) {
        const isAccept = nextNFASet.has(nfa.accept);
        const newState = new DFAState(dfaIdCounter++, nextIds, isAccept);
        dfaStatesMap.set(nextKey, newState);
        nfaStateSets.set(nextKey, nextNFASet);
        worklist.push(nextKey);
      }

      currentDFA.transitions.set(sym, dfaStatesMap.get(nextKey));
    }
  }

  // Build final states map by id.
  const statesById = new Map();
  for (const state of dfaStatesMap.values()) {
    statesById.set(state.id, state);
  }

  return new DFA(startDFAState, statesById, alphabet);
}

module.exports = {
  DFAState,
  DFA,
  nfaToDFA,
};
