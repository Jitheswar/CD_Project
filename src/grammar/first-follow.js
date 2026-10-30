'use strict';

/**
 * @module first-follow
 * FIRST and FOLLOW set computation for context-free grammars.
 */

const { EPSILON, END_MARKER } = require('./grammar');

/**
 * Compute the FIRST sets for all symbols in the grammar.
 *
 * Rules:
 * 1. If X is a terminal, FIRST(X) = { X }
 * 2. If X -> ε is a production, add ε to FIRST(X)
 * 3. If X -> Y1 Y2 ... Yk, add FIRST(Y1) - {ε} to FIRST(X).
 *    If ε ∈ FIRST(Y1), also add FIRST(Y2) - {ε}, etc.
 *    If all Yi are nullable, add ε to FIRST(X).
 *
 * @param {import('./grammar').Grammar} grammar
 * @returns {Map<string, Set<string>>} Map from symbol to its FIRST set.
 */
function computeFirst(grammar) {
  /** @type {Map<string, Set<string>>} */
  const first = new Map();

  // Initialize FIRST for each terminal
  for (const t of grammar.terminals) {
    first.set(t, new Set([t]));
  }
  // Epsilon's FIRST is itself
  first.set(EPSILON, new Set([EPSILON]));

  // Initialize FIRST for each non-terminal
  for (const nt of grammar.nonTerminals) {
    first.set(nt, new Set());
  }

  // Iterative fixed-point computation
  let changed = true;
  while (changed) {
    changed = false;

    for (const prod of grammar.productions) {
      const headFirst = first.get(prod.head);
      const body = prod.body;

      // Compute FIRST of the body string
      const bodyFirst = firstOfString(body, first);

      for (const sym of bodyFirst) {
        if (!headFirst.has(sym)) {
          headFirst.add(sym);
          changed = true;
        }
      }
    }
  }

  return first;
}

/**
 * Compute FIRST of a sequence of symbols.
 *
 * FIRST(Y1 Y2 ... Yk):
 * - Add all of FIRST(Y1) except ε.
 * - If ε ∈ FIRST(Y1), add all of FIRST(Y2) except ε.
 * - ...
 * - If ε ∈ FIRST(Yi) for all i from 1 to k, add ε.
 *
 * @param {string[]} symbols - Sequence of grammar symbols.
 * @param {Map<string, Set<string>>} firstSets - Pre-computed FIRST sets.
 * @returns {Set<string>} FIRST of the symbol sequence.
 */
function firstOfString(symbols, firstSets) {
  const result = new Set();

  if (!symbols || symbols.length === 0) {
    result.add(EPSILON);
    return result;
  }

  // Special case: body is just ε
  if (symbols.length === 1 && symbols[0] === EPSILON) {
    result.add(EPSILON);
    return result;
  }

  let allNullable = true;

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];

    if (sym === EPSILON) {
      // ε is nullable, continue
      continue;
    }

    const symFirst = firstSets.get(sym);
    if (!symFirst) {
      // Unknown symbol — treat as terminal
      result.add(sym);
      allNullable = false;
      break;
    }

    // Add everything except ε from FIRST(sym)
    for (const s of symFirst) {
      if (s !== EPSILON) {
        result.add(s);
      }
    }

    // If ε is NOT in FIRST(sym), stop
    if (!symFirst.has(EPSILON)) {
      allNullable = false;
      break;
    }
    // Otherwise continue to next symbol
  }

  if (allNullable) {
    result.add(EPSILON);
  }

  return result;
}

/**
 * Compute the FOLLOW sets for all non-terminals in the grammar.
 *
 * Rules:
 * 1. $ ∈ FOLLOW(S) where S is the start symbol.
 * 2. If A -> α B β, then everything in FIRST(β) except ε is in FOLLOW(B).
 * 3. If A -> α B, or A -> α B β where ε ∈ FIRST(β),
 *    then everything in FOLLOW(A) is in FOLLOW(B).
 *
 * @param {import('./grammar').Grammar} grammar
 * @param {Map<string, Set<string>>} firstSets - Pre-computed FIRST sets.
 * @returns {Map<string, Set<string>>} Map from non-terminal to its FOLLOW set.
 */
function computeFollow(grammar, firstSets) {
  /** @type {Map<string, Set<string>>} */
  const follow = new Map();

  // Initialize FOLLOW for each non-terminal
  for (const nt of grammar.nonTerminals) {
    follow.set(nt, new Set());
  }

  // Rule 1: $ ∈ FOLLOW(start)
  follow.get(grammar.startSymbol).add(END_MARKER);

  // Iterative fixed-point computation
  let changed = true;
  while (changed) {
    changed = false;

    for (const prod of grammar.productions) {
      const A = prod.head;
      const body = prod.body;

      for (let i = 0; i < body.length; i++) {
        const B = body[i];

        // Only compute FOLLOW for non-terminals
        if (!grammar.isNonTerminal(B)) continue;

        const followB = follow.get(B);
        const beta = body.slice(i + 1);

        // Compute FIRST(β)
        const firstBeta = firstOfString(beta, firstSets);

        // Rule 2: Add FIRST(β) - {ε} to FOLLOW(B)
        for (const sym of firstBeta) {
          if (sym !== EPSILON && !followB.has(sym)) {
            followB.add(sym);
            changed = true;
          }
        }

        // Rule 3: If β is empty or ε ∈ FIRST(β), add FOLLOW(A) to FOLLOW(B)
        if (firstBeta.has(EPSILON)) {
          const followA = follow.get(A);
          if (followA) {
            for (const sym of followA) {
              if (!followB.has(sym)) {
                followB.add(sym);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  return follow;
}

module.exports = { computeFirst, computeFollow, firstOfString };
