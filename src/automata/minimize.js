'use strict';

/**
 * @module minimize
 * @description DFA minimization using Hopcroft's partition refinement algorithm.
 * Also provides language equivalence checking between two DFAs.
 */

const { DFA, DFAState } = require('./dfa');

/**
 * Minimize a deterministic finite automaton using Hopcroft's algorithm.
 *
 * @param {DFA} dfa - The DFA to minimize.
 * @returns {DFA} A new, minimal DFA accepting the same language.
 */
function minimizeDFA(dfa) {
  const startState = dfa.start || dfa.startState;
  if (!startState) {
    const dummy = new DFAState(0, new Set(), false);
    return new DFA(dummy, new Map([[0, dummy]]), dfa.alphabet || []);
  }

  // 1. Gather reachable states from start state via BFS/DFS
  const reachable = new Set();
  const queue = [startState];
  reachable.add(startState.id);

  while (queue.length > 0) {
    const curr = queue.shift();
    for (const [, nextState] of curr.transitions) {
      if (nextState && !reachable.has(nextState.id)) {
        reachable.add(nextState.id);
        queue.push(nextState);
      }
    }
  }

  // Filter to only reachable states
  const states = [];
  for (const [id, state] of dfa.states) {
    if (reachable.has(id)) {
      states.push(state);
    }
  }

  if (states.length === 0) {
    const dummy = new DFAState(0, new Set(), false);
    return new DFA(dummy, new Map([[0, dummy]]), dfa.alphabet);
  }

  // 2. Initial partition: F (accepting) and Q \ F (non-accepting)
  const accepting = new Set();
  const nonAccepting = new Set();
  for (const s of states) {
    if (s.isAccept) {
      accepting.add(s.id);
    } else {
      nonAccepting.add(s.id);
    }
  }

  /** @type {Array<Set<number>>} */
  let P = [];
  if (accepting.size > 0) P.push(accepting);
  if (nonAccepting.size > 0) P.push(nonAccepting);

  // Worklist W initialized to P
  /** @type {Array<Set<number>>} */
  let W = [];
  if (accepting.size > 0 && nonAccepting.size > 0) {
    // Choose the smaller set for efficiency
    if (accepting.size <= nonAccepting.size) {
      W.push(new Set(accepting));
    } else {
      W.push(new Set(nonAccepting));
    }
  } else if (P.length > 0) {
    W.push(new Set(P[0]));
  }

  const alphabet = Array.from(dfa.alphabet).sort();

  // Helper map: id -> DFAState
  const stateMap = new Map();
  for (const s of states) {
    stateMap.set(s.id, s);
  }

  // Precompute reverse transitions: symbol -> (targetId -> Set<sourceId>)
  const revTransitions = new Map();
  for (const sym of alphabet) {
    revTransitions.set(sym, new Map());
  }
  for (const s of states) {
    for (const [sym, nextState] of s.transitions) {
      if (!revTransitions.has(sym)) {
        revTransitions.set(sym, new Map());
      }
      const symRev = revTransitions.get(sym);
      if (!symRev.has(nextState.id)) {
        symRev.set(nextState.id, new Set());
      }
      symRev.get(nextState.id).add(s.id);
    }
  }

  // 3. Hopcroft's partition refinement loop
  while (W.length > 0) {
    const A = W.shift();

    for (const c of alphabet) {
      // X = set of states for which transition on c leads to a state in A
      const X = new Set();
      const symRev = revTransitions.get(c);
      if (symRev) {
        for (const targetId of A) {
          const sources = symRev.get(targetId);
          if (sources) {
            for (const srcId of sources) {
              X.add(srcId);
            }
          }
        }
      }

      if (X.size === 0) continue;

      const newP = [];
      for (const Y of P) {
        // Compute intersection X_int_Y and difference Y_minus_X
        const X_int_Y = new Set();
        const Y_minus_X = new Set();
        for (const yId of Y) {
          if (X.has(yId)) {
            X_int_Y.add(yId);
          } else {
            Y_minus_X.add(yId);
          }
        }

        if (X_int_Y.size > 0 && Y_minus_X.size > 0) {
          newP.push(X_int_Y);
          newP.push(Y_minus_X);

          // Update worklist W
          const indexInW = W.findIndex(wSet => setsEqual(wSet, Y));
          if (indexInW !== -1) {
            W.splice(indexInW, 1, X_int_Y, Y_minus_X);
          } else {
            if (X_int_Y.size <= Y_minus_X.size) {
              W.push(X_int_Y);
            } else {
              W.push(Y_minus_X);
            }
          }
        } else {
          newP.push(Y);
        }
      }
      P = newP;
    }
  }

  // Helper: check set equality
  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  // 4. Construct minimized DFA from partition P
  // Map old state id -> block index
  const stateToBlock = new Map();
  for (let i = 0; i < P.length; i++) {
    for (const id of P[i]) {
      stateToBlock.set(id, i);
    }
  }

  // Find which block contains the start state
  const startBlockIdx = stateToBlock.get(startState.id);

  // Create new DFA states
  const newStates = new Map();
  for (let i = 0; i < P.length; i++) {
    const block = P[i];
    // Block is accept if any state in it is accept
    let isAccept = false;
    const combinedNfaStates = new Set();
    for (const id of block) {
      const orig = stateMap.get(id);
      if (orig) {
        if (orig.isAccept) isAccept = true;
        for (const nid of orig.nfaStates) combinedNfaStates.add(nid);
      }
    }
    newStates.set(i, new DFAState(i, combinedNfaStates, isAccept));
  }

  // Connect transitions
  for (let i = 0; i < P.length; i++) {
    const block = P[i];
    const repId = block.values().next().value;
    const repState = stateMap.get(repId);
    const newBlockState = newStates.get(i);

    if (repState) {
      for (const [sym, targetState] of repState.transitions) {
        const targetBlock = stateToBlock.get(targetState.id);
        if (targetBlock !== undefined) {
          newBlockState.transitions.set(sym, newStates.get(targetBlock));
        }
      }
    }
  }

  const newStartState = newStates.get(startBlockIdx);
  return new DFA(newStartState, newStates, dfa.alphabet);
}

/**
 * Determine if two DFAs recognize the exact same formal language.
 * Uses minimization and canonical isomorphism check.
 *
 * @param {DFA} dfa1
 * @param {DFA} dfa2
 * @returns {boolean} True if equivalent.
 */
function areEquivalent(dfa1, dfa2) {
  // A standard way is product automaton (symmetric difference)
  // or testing if (L1 \ L2) == ∅ and (L2 \ L1) == ∅.
  // BFS on pairs of states (s1, s2).
  const combinedAlphabet = new Set([...dfa1.alphabet, ...dfa2.alphabet]);
  const visited = new Set();
  const s1Start = dfa1.start || dfa1.startState;
  const s2Start = dfa2.start || dfa2.startState;
  const queue = [{ s1: s1Start, s2: s2Start }];

  function key(s1, s2) {
    const id1 = s1 ? s1.id : 'null';
    const id2 = s2 ? s2.id : 'null';
    return `${id1},${id2}`;
  }

  visited.add(key(s1Start, s2Start));

  while (queue.length > 0) {
    const { s1, s2 } = queue.shift();

    const accept1 = s1 ? s1.isAccept : false;
    const accept2 = s2 ? s2.isAccept : false;

    // If one accepts and the other does not, languages differ
    if (accept1 !== accept2) {
      return false;
    }

    for (const sym of combinedAlphabet) {
      const next1 = s1 ? s1.transitions.get(sym) || null : null;
      const next2 = s2 ? s2.transitions.get(sym) || null : null;

      const k = key(next1, next2);
      if (!visited.has(k)) {
        visited.add(k);
        queue.push({ s1: next1, s2: next2 });
      }
    }
  }

  return true;
}

module.exports = {
  minimizeDFA,
  areEquivalent,
};
