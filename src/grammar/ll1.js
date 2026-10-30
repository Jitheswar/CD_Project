'use strict';

/**
 * @module ll1
 * LL(1) parsing table construction and predictive parsing.
 */

const { EPSILON, END_MARKER } = require('./grammar');
const { computeFirst, computeFollow, firstOfString } = require('./first-follow');

/**
 * Build the LL(1) parsing table.
 *
 * For each production A -> α:
 *   For each terminal a in FIRST(α), add A -> α to M[A, a].
 *   If ε ∈ FIRST(α), for each terminal b in FOLLOW(A), add A -> α to M[A, b].
 *   If ε ∈ FIRST(α) and $ ∈ FOLLOW(A), add A -> α to M[A, $].
 *
 * @param {import('./grammar').Grammar} grammar
 * @param {Map<string, Set<string>>} firstSets
 * @param {Map<string, Set<string>>} followSets
 * @returns {{ table: Map<string, Map<string, object>>, conflicts: { nonTerminal: string, terminal: string, productions: object[] }[] }}
 */
function buildLL1Table(grammar, firstSets, followSets) {
  /** @type {Map<string, Map<string, object[]>>} - intermediate with arrays for conflict detection */
  const tableMulti = new Map();

  for (const nt of grammar.nonTerminals) {
    tableMulti.set(nt, new Map());
  }

  for (const prod of grammar.productions) {
    const A = prod.head;
    const alpha = prod.body;
    const firstAlpha = firstOfString(alpha, firstSets);

    // For each terminal a in FIRST(α) (except ε), add production to M[A, a]
    for (const a of firstAlpha) {
      if (a !== EPSILON) {
        _addToTable(tableMulti, A, a, prod);
      }
    }

    // If ε ∈ FIRST(α), for each b in FOLLOW(A), add production to M[A, b]
    if (firstAlpha.has(EPSILON)) {
      const followA = followSets.get(A);
      if (followA) {
        for (const b of followA) {
          _addToTable(tableMulti, A, b, prod);
        }
      }
    }
  }

  // Build final table and detect conflicts
  const table = new Map();
  const conflicts = [];

  for (const [nt, row] of tableMulti) {
    const finalRow = new Map();
    for (const [terminal, prods] of row) {
      if (prods.length > 1) {
        conflicts.push({
          nonTerminal: nt,
          terminal: terminal,
          productions: prods.map(p => ({ head: p.head, body: [...p.body], index: p.index }))
        });
      }
      // Store the first production (or could store all for conflict reporting)
      finalRow.set(terminal, { head: prods[0].head, body: [...prods[0].body], index: prods[0].index });
    }
    table.set(nt, finalRow);
  }

  return { table, conflicts };
}

/**
 * @private
 */
function _addToTable(tableMulti, nt, terminal, prod) {
  const row = tableMulti.get(nt);
  if (!row.has(terminal)) {
    row.set(terminal, []);
  }
  const existing = row.get(terminal);
  // Avoid adding the exact same production twice
  const isDup = existing.some(p => p.index === prod.index);
  if (!isDup) {
    existing.push(prod);
  }
}

/**
 * Perform LL(1) predictive parsing using an explicit stack.
 *
 * @param {Map<string, Map<string, object>>} table - LL(1) parsing table.
 * @param {import('./grammar').Grammar} grammar
 * @param {string[]} tokens - Array of input tokens (terminals), must end with '$'.
 * @returns {{ trace: { step: number, stack: string[], input: string[], action: string }[], parseTree: object, accepted: boolean }}
 */
function parseLL1(table, grammar, tokens) {
  // Ensure input ends with $
  const input = [...tokens];
  if (input[input.length - 1] !== END_MARKER) {
    input.push(END_MARKER);
  }

  const stack = [END_MARKER, grammar.startSymbol];
  let ip = 0;
  const trace = [];
  let step = 0;
  let accepted = false;

  // Parse tree: root node
  const root = { symbol: grammar.startSymbol, children: [] };
  // Map stack entries to tree nodes using a parallel node stack
  const nodeStack = [null, root]; // null for $ sentinel

  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const topNode = nodeStack[nodeStack.length - 1];
    const currentInput = input.slice(ip);

    if (top === END_MARKER) {
      if (input[ip] === END_MARKER) {
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: 'Accept'
        });
        accepted = true;
        break;
      } else {
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: 'Error: unexpected symbol, expected end of input'
        });
        break;
      }
    }

    if (grammar.isTerminal(top) || top === END_MARKER) {
      if (top === input[ip]) {
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: `Match '${top}'`
        });
        stack.pop();
        nodeStack.pop();
        ip++;
      } else {
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: `Error: expected '${top}', found '${input[ip]}'`
        });
        break;
      }
    } else if (grammar.isNonTerminal(top)) {
      const row = table.get(top);
      const entry = row ? row.get(input[ip]) : undefined;

      if (entry) {
        const bodyStr = entry.body.join(' ');
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: `Output ${top} -> ${bodyStr}`
        });

        stack.pop();
        nodeStack.pop();

        if (!(entry.body.length === 1 && entry.body[0] === EPSILON)) {
          // Push body symbols in reverse order
          const childNodes = entry.body.map(s => ({ symbol: s, children: [] }));
          if (topNode) {
            topNode.children = childNodes;
          }
          for (let i = entry.body.length - 1; i >= 0; i--) {
            stack.push(entry.body[i]);
            nodeStack.push(childNodes[i]);
          }
        } else {
          // Epsilon production: add epsilon child node
          if (topNode) {
            topNode.children = [{ symbol: EPSILON, children: [] }];
          }
        }
      } else {
        trace.push({
          step: step++,
          stack: [...stack],
          input: currentInput,
          action: `Error: no rule for M[${top}, ${input[ip]}]`
        });
        break;
      }
    } else {
      // Unknown symbol — error
      trace.push({
        step: step++,
        stack: [...stack],
        input: currentInput,
        action: `Error: unknown symbol '${top}'`
      });
      break;
    }

    // Safety limit
    if (step > 10000) {
      trace.push({
        step: step++,
        stack: [...stack],
        input: input.slice(ip),
        action: 'Error: parsing exceeded maximum steps'
      });
      break;
    }
  }

  return { trace, parseTree: root, accepted };
}

/**
 * Check if a grammar is LL(1).
 * A grammar is LL(1) if its LL(1) parsing table has no conflicts.
 *
 * @param {import('./grammar').Grammar} grammar
 * @returns {{ isLL1: boolean, conflicts: object[] }}
 */
function isLL1(grammar) {
  const firstSets = computeFirst(grammar);
  const followSets = computeFollow(grammar, firstSets);
  const { conflicts } = buildLL1Table(grammar, firstSets, followSets);
  return { isLL1: conflicts.length === 0, conflicts };
}

module.exports = { buildLL1Table, parseLL1, isLL1 };
