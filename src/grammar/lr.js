'use strict';

/**
 * @module lr
 * @description LR-family parser generator and runtime:
 *   - LR(0)
 *   - SLR(1)
 *   - CLR(1) / Canonical LR(1)
 *   - LALR(1)
 * Includes canonical collection builder, conflict diagnostic witnesses,
 * and step-by-step parsing with derivation trees.
 */

const { Grammar } = require('./grammar');
const { computeFirst, firstOfString } = require('./first-follow');

/**
 * Represents an LR item: A -> α • β [, a]
 */
class LRItem {
  /**
   * @param {object} production - { head, body }
   * @param {number} dotPos - Position of the dot (0 <= dotPos <= body.length)
   * @param {string} [lookahead='$'] - Lookahead token for LR(1) items
   */
  constructor(production, dotPos = 0, lookahead = '$') {
    this.production = production;
    this.dotPos = dotPos;
    this.lookahead = lookahead;
  }

  isReduce() {
    return this.dotPos >= this.production.body.length || (this.production.body.length === 1 && this.production.body[0] === 'ε');
  }

  nextSymbol() {
    if (this.isReduce()) return null;
    return this.production.body[this.dotPos];
  }

  advance() {
    return new LRItem(this.production, this.dotPos + 1, this.lookahead);
  }

  key(isLR1 = false) {
    const head = this.production.head;
    const bodyStr = this.production.body.join(' ');
    if (isLR1) {
      return `${head}->${bodyStr}#${this.dotPos}#${this.lookahead}`;
    }
    return `${head}->${bodyStr}#${this.dotPos}`;
  }

  coreKey() {
    return `${this.production.head}->${this.production.body.join(' ')}#${this.dotPos}`;
  }

  toString(isLR1 = false) {
    const body = [...this.production.body];
    if (body.length === 1 && body[0] === 'ε') {
      body.pop();
    }
    body.splice(this.dotPos, 0, '•');
    const core = `${this.production.head} -> ${body.join(' ')}`;
    return isLR1 ? `[${core}, ${this.lookahead}]` : `[${core}]`;
  }
}

/**
 * Compute the closure of an item set.
 * @param {LRItem[]} items
 * @param {Grammar} grammar
 * @param {'lr0'|'lr1'} type
 * @param {Map<string, Set<string>>} [firstSets]
 * @returns {LRItem[]}
 */
function closure(items, grammar, type = 'lr0', firstSets = null) {
  const isLR1 = (type === 'lr1');
  const result = [...items];
  const itemMap = new Map();

  for (const item of items) {
    itemMap.set(item.key(isLR1), item);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      const B = item.nextSymbol();
      if (!B || !grammar.isNonTerminal(B)) continue;

      let lookaheads = ['$'];
      if (isLR1) {
        // βa where β is remainder of body after B, and a is current lookahead
        const remainder = item.production.body.slice(item.dotPos + 1);
        remainder.push(item.lookahead);
        const fSet = firstOfString(remainder, firstSets || computeFirst(grammar));
        lookaheads = Array.from(fSet);
      }

      const productions = grammar.getProductionsFor(B);
      for (const prod of productions) {
        for (const la of lookaheads) {
          const newItem = new LRItem(prod, 0, la);
          const k = newItem.key(isLR1);
          if (!itemMap.has(k)) {
            itemMap.set(k, newItem);
            result.push(newItem);
            changed = true;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Compute GOTO(I, X)
 */
function gotoSet(items, symbol, grammar, type = 'lr0', firstSets = null) {
  const moved = [];
  for (const item of items) {
    if (item.nextSymbol() === symbol) {
      moved.push(item.advance());
    }
  }
  if (moved.length === 0) return [];
  return closure(moved, grammar, type, firstSets);
}

/**
 * Sort and get canonical key for a set of items
 */
function itemSetKey(items, isLR1 = false) {
  return items.map(it => it.key(isLR1)).sort().join(';;');
}

/**
 * Build the canonical collection of LR item sets.
 */
function buildCanonicalCollection(grammar, type = 'lr0') {
  const isLR1 = (type === 'lr1');
  const firstSets = isLR1 ? computeFirst(grammar) : null;

  // Augment grammar if not already augmented
  const startProd = grammar.productions[0];
  const augmentedHead = startProd.head + "'";
  const augmentedProd = { head: augmentedHead, body: [startProd.head] };

  const startItem = new LRItem(augmentedProd, 0, '$');
  const I0 = closure([startItem], grammar, type, firstSets);

  const C = [I0];
  const setKeys = new Map();
  setKeys.set(itemSetKey(I0, isLR1), 0);

  const transitions = new Map(); // stateIndex -> Map<symbol, nextStateIndex>

  const symbols = [...grammar.nonTerminals, ...grammar.terminals].filter(s => s !== 'ε' && s !== '$');

  for (let i = 0; i < C.length; i++) {
    const I = C[i];
    transitions.set(i, new Map());

    for (const X of symbols) {
      const g = gotoSet(I, X, grammar, type, firstSets);
      if (g.length === 0) continue;

      const k = itemSetKey(g, isLR1);
      let nextId;
      if (setKeys.has(k)) {
        nextId = setKeys.get(k);
      } else {
        nextId = C.length;
        setKeys.set(k, nextId);
        C.push(g);
      }
      transitions.get(i).set(X, nextId);
    }
  }

  return { itemSets: C, transitions, augmentedProd };
}

/**
 * Build LR(0) Parsing Table
 */
function buildLR0Table(grammar) {
  const { itemSets, transitions, augmentedProd } = buildCanonicalCollection(grammar, 'lr0');
  const actionTable = new Map();
  const gotoTable = new Map();
  const conflicts = [];

  const allTerminals = [...grammar.terminals, '$'].filter(t => t !== 'ε');

  for (let i = 0; i < itemSets.length; i++) {
    actionTable.set(i, new Map());
    gotoTable.set(i, new Map());
    const I = itemSets[i];

    // Shift & Goto transitions
    const stateTransitions = transitions.get(i) || new Map();
    for (const [sym, target] of stateTransitions) {
      if (grammar.isTerminal(sym)) {
        addAction(actionTable, i, sym, { type: 'shift', state: target }, conflicts);
      } else {
        gotoTable.get(i).set(sym, target);
      }
    }

    // Reduce & Accept
    for (const item of I) {
      if (item.isReduce()) {
        if (item.production.head === augmentedProd.head) {
          addAction(actionTable, i, '$', { type: 'accept' }, conflicts);
        } else {
          for (const a of allTerminals) {
            addAction(actionTable, i, a, { type: 'reduce', production: item.production }, conflicts);
          }
        }
      }
    }
  }

  return { actionTable, gotoTable, itemSets, conflicts };
}

/**
 * Build SLR(1) Parsing Table
 */
function buildSLRTable(grammar, followSets = null) {
  const { computeFollow } = require('./first-follow');
  const firstSets = computeFirst(grammar);
  if (!followSets) followSets = computeFollow(grammar, firstSets);

  const { itemSets, transitions, augmentedProd } = buildCanonicalCollection(grammar, 'lr0');
  const actionTable = new Map();
  const gotoTable = new Map();
  const conflicts = [];

  for (let i = 0; i < itemSets.length; i++) {
    actionTable.set(i, new Map());
    gotoTable.set(i, new Map());
    const I = itemSets[i];

    // Shift & Goto
    const stateTransitions = transitions.get(i) || new Map();
    for (const [sym, target] of stateTransitions) {
      if (grammar.isTerminal(sym)) {
        addAction(actionTable, i, sym, { type: 'shift', state: target }, conflicts);
      } else {
        gotoTable.get(i).set(sym, target);
      }
    }

    // Reduce & Accept using FOLLOW(A)
    for (const item of I) {
      if (item.isReduce()) {
        if (item.production.head === augmentedProd.head) {
          addAction(actionTable, i, '$', { type: 'accept' }, conflicts);
        } else {
          const follow = followSets.get(item.production.head) || new Set(['$']);
          for (const a of follow) {
            addAction(actionTable, i, a, { type: 'reduce', production: item.production }, conflicts);
          }
        }
      }
    }
  }

  return { actionTable, gotoTable, itemSets, conflicts };
}

/**
 * Build CLR(1) / Canonical LR(1) Parsing Table
 */
function buildCLRTable(grammar) {
  const { itemSets, transitions, augmentedProd } = buildCanonicalCollection(grammar, 'lr1');
  const actionTable = new Map();
  const gotoTable = new Map();
  const conflicts = [];

  for (let i = 0; i < itemSets.length; i++) {
    actionTable.set(i, new Map());
    gotoTable.set(i, new Map());
    const I = itemSets[i];

    // Shift & Goto
    const stateTransitions = transitions.get(i) || new Map();
    for (const [sym, target] of stateTransitions) {
      if (grammar.isTerminal(sym)) {
        addAction(actionTable, i, sym, { type: 'shift', state: target }, conflicts);
      } else {
        gotoTable.get(i).set(sym, target);
      }
    }

    // Reduce on item.lookahead
    for (const item of I) {
      if (item.isReduce()) {
        if (item.production.head === augmentedProd.head && item.lookahead === '$') {
          addAction(actionTable, i, '$', { type: 'accept' }, conflicts);
        } else {
          addAction(actionTable, i, item.lookahead, { type: 'reduce', production: item.production }, conflicts);
        }
      }
    }
  }

  return { actionTable, gotoTable, itemSets, conflicts };
}

/**
 * Build LALR(1) Parsing Table by merging CLR(1) states with identical LR(0) cores.
 */
function buildLALRTable(grammar) {
  const { itemSets: clrSets, transitions: clrTransitions, augmentedProd } = buildCanonicalCollection(grammar, 'lr1');

  // Group CLR states by core key
  function getCoreKey(items) {
    return items.map(it => it.coreKey()).sort().join(';;');
  }

  const coreGroups = new Map(); // coreKey -> [clrStateIndex, ...]
  for (let i = 0; i < clrSets.length; i++) {
    const ck = getCoreKey(clrSets[i]);
    if (!coreGroups.has(ck)) coreGroups.set(ck, []);
    coreGroups.get(ck).push(i);
  }

  // Create merged states
  const oldToNew = new Map();
  const lalrSets = [];
  let newIdx = 0;

  for (const group of coreGroups.values()) {
    // Merge items: same core, union of lookaheads
    const itemMap = new Map();
    for (const oldId of group) {
      oldToNew.set(oldId, newIdx);
      for (const item of clrSets[oldId]) {
        const ck = item.coreKey();
        if (!itemMap.has(ck)) {
          itemMap.set(ck, new LRItem(item.production, item.dotPos, new Set([item.lookahead])));
        } else {
          itemMap.get(ck).lookahead.add(item.lookahead);
        }
      }
    }

    // Expand merged items back to single-lookahead LRItems for uniform interface
    const expanded = [];
    for (const mItem of itemMap.values()) {
      for (const la of mItem.lookahead) {
        expanded.push(new LRItem(mItem.production, mItem.dotPos, la));
      }
    }
    lalrSets.push(expanded);
    newIdx++;
  }

  // Remap transitions
  const actionTable = new Map();
  const gotoTable = new Map();
  const conflicts = [];

  for (let i = 0; i < lalrSets.length; i++) {
    actionTable.set(i, new Map());
    gotoTable.set(i, new Map());
  }

  for (let oldState = 0; oldState < clrSets.length; oldState++) {
    const newState = oldToNew.get(oldState);
    const trans = clrTransitions.get(oldState) || new Map();

    for (const [sym, targetOld] of trans) {
      const targetNew = oldToNew.get(targetOld);
      if (grammar.isTerminal(sym)) {
        addAction(actionTable, newState, sym, { type: 'shift', state: targetNew }, conflicts);
      } else {
        gotoTable.get(newState).set(sym, targetNew);
      }
    }
  }

  // Reductions
  for (let i = 0; i < lalrSets.length; i++) {
    const I = lalrSets[i];
    for (const item of I) {
      if (item.isReduce()) {
        if (item.production.head === augmentedProd.head && item.lookahead === '$') {
          addAction(actionTable, i, '$', { type: 'accept' }, conflicts);
        } else {
          addAction(actionTable, i, item.lookahead, { type: 'reduce', production: item.production }, conflicts);
        }
      }
    }
  }

  return { actionTable, gotoTable, itemSets: lalrSets, conflicts };
}

/**
 * Add an action with conflict checking.
 */
function addAction(actionTable, state, symbol, action, conflicts) {
  const row = actionTable.get(state);
  const existing = row.get(symbol);

  if (!existing) {
    row.set(symbol, action);
    return;
  }

  // Same action already added
  if (actionsEqual(existing, action)) return;

  // Conflict!
  const conflictType = (existing.type === 'shift' || action.type === 'shift')
    ? 'shift-reduce'
    : 'reduce-reduce';

  conflicts.push({
    state,
    symbol,
    conflictType,
    actions: [existing, action],
    description: `State ${state} on lookahead '${symbol}': conflict between ${actionToString(existing)} and ${actionToString(action)}`
  });

  // Default heuristic: keep shift over reduce
  if (action.type === 'shift' && existing.type === 'reduce') {
    row.set(symbol, action);
  }
}

function actionsEqual(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'shift') return a.state === b.state;
  if (a.type === 'reduce') {
    return a.production.head === b.production.head &&
           a.production.body.join(' ') === b.production.body.join(' ');
  }
  return true;
}

function actionToString(act) {
  if (act.type === 'shift') return `Shift to state ${act.state}`;
  if (act.type === 'reduce') return `Reduce by ${act.production.head} -> ${act.production.body.join(' ')}`;
  if (act.type === 'accept') return 'Accept';
  return act.type;
}

/**
 * Parse tokens using LR action and goto tables.
 */
function parseLR(actionTable, gotoTable, grammar, tokens) {
  const input = [...tokens];
  if (input.length === 0 || input[input.length - 1] !== '$') {
    input.push('$');
  }

  const stateStack = [0];
  const symbolStack = [];
  const nodeStack = [];
  const trace = [];
  let ip = 0;
  let accepted = false;
  const maxSteps = 10000;
  let steps = 0;

  while (steps++ < maxSteps) {
    const currentState = stateStack[stateStack.length - 1];
    const currentToken = input[ip];
    const row = actionTable.get(currentState);
    const action = row ? row.get(currentToken) : null;

    trace.push({
      step: steps,
      stateStack: [...stateStack],
      symbolStack: [...symbolStack],
      remainingInput: input.slice(ip).join(' '),
      action: action ? actionToString(action) : `Error: no entry for state ${currentState} on '${currentToken}'`
    });

    if (!action) {
      break;
    }

    if (action.type === 'shift') {
      stateStack.push(action.state);
      symbolStack.push(currentToken);
      nodeStack.push({ type: 'Terminal', value: currentToken });
      ip++;
    } else if (action.type === 'reduce') {
      const prod = action.production;
      const bodyLen = (prod.body.length === 1 && prod.body[0] === 'ε') ? 0 : prod.body.length;

      const children = [];
      for (let k = 0; k < bodyLen; k++) {
        stateStack.pop();
        symbolStack.pop();
        children.unshift(nodeStack.pop());
      }

      const topState = stateStack[stateStack.length - 1];
      const nextState = gotoTable.get(topState) ? gotoTable.get(topState).get(prod.head) : undefined;

      if (nextState === undefined) {
        trace.push({
          step: steps,
          stateStack: [...stateStack],
          symbolStack: [...symbolStack],
          remainingInput: input.slice(ip).join(' '),
          action: `Error: GOTO(${topState}, ${prod.head}) is undefined`
        });
        break;
      }

      stateStack.push(nextState);
      symbolStack.push(prod.head);
      nodeStack.push({
        type: 'NonTerminal',
        symbol: prod.head,
        production: prod,
        children
      });
    } else if (action.type === 'accept') {
      accepted = true;
      break;
    }
  }

  return {
    accepted,
    parseTree: nodeStack.length > 0 ? nodeStack[0] : null,
    trace
  };
}

module.exports = {
  LRItem,
  closure,
  gotoSet,
  buildCanonicalCollection,
  buildLR0Table,
  buildSLRTable,
  buildCLRTable,
  buildLALRTable,
  parseLR,
  actionToString,
};
