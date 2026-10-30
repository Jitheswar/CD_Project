'use strict';

/**
 * @module grammar
 * Grammar representation and utilities for NexCC.
 * Supports parsing grammar notation, left-recursion elimination, and left factoring.
 */

/** Epsilon symbol constant */
const EPSILON = 'ε';
/** End-of-input symbol constant */
const END_MARKER = '$';

/**
 * Represents a context-free grammar.
 */
class Grammar {
  /**
   * Create a Grammar.
   * @param {string[]} terminals - Array of terminal symbols.
   * @param {string[]} nonTerminals - Array of non-terminal symbols.
   * @param {{ head: string, body: string[] }[]} productions - Array of productions.
   * @param {string} startSymbol - The start symbol of the grammar.
   */
  constructor(terminals, nonTerminals, productions, startSymbol) {
    this.terminals = [...terminals];
    this.nonTerminals = [...nonTerminals];
    this.productions = productions.map(p => ({ head: p.head, body: [...p.body] }));
    this.startSymbol = startSymbol;

    // Assign indices to productions for reference
    for (let i = 0; i < this.productions.length; i++) {
      this.productions[i].index = i;
    }
  }

  /**
   * Parse a grammar from text notation.
   * Format:
   *   E -> E + T | T
   *   T -> T * F | F
   *   F -> ( E ) | id
   *
   * Epsilon can be written as ε or epsilon or ε.
   * The first non-terminal encountered is the start symbol.
   *
   * @param {string} text - Grammar in text notation.
   * @returns {Grammar} Parsed grammar.
   */
  static fromString(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const productions = [];
    const nonTerminalSet = new Set();
    const allSymbols = new Set();
    let startSymbol = null;

    for (const line of lines) {
      // Split on -> or →
      const arrowIdx = line.indexOf('->');
      const arrowIdx2 = line.indexOf('→');
      let head, bodyStr;

      if (arrowIdx !== -1) {
        head = line.substring(0, arrowIdx).trim();
        bodyStr = line.substring(arrowIdx + 2).trim();
      } else if (arrowIdx2 !== -1) {
        head = line.substring(0, arrowIdx2).trim();
        bodyStr = line.substring(arrowIdx2 + 1).trim();
      } else {
        throw new Error(`Invalid production (no arrow): "${line}"`);
      }

      if (!head) {
        throw new Error(`Empty head in production: "${line}"`);
      }

      if (startSymbol === null) {
        startSymbol = head;
      }
      nonTerminalSet.add(head);

      // Split alternatives on |
      const alternatives = bodyStr.split('|');
      for (const alt of alternatives) {
        const trimmed = alt.trim();
        if (!trimmed) {
          throw new Error(`Empty alternative in production: "${line}"`);
        }

        let bodySymbols;
        // Normalize epsilon representations
        const normalized = trimmed
          .replace(/\bepsilon\b/gi, EPSILON)
          .replace(/\beps\b/gi, EPSILON)
          .replace(/ε/g, EPSILON);

        bodySymbols = normalized.split(/\s+/).filter(s => s.length > 0);

        // If the body is just epsilon, keep it as [EPSILON]
        if (bodySymbols.length === 1 && bodySymbols[0] === EPSILON) {
          bodySymbols = [EPSILON];
        } else {
          // Remove any epsilon mixed with other symbols (shouldn't happen in valid grammar)
          bodySymbols = bodySymbols.filter(s => s !== EPSILON);
          if (bodySymbols.length === 0) {
            bodySymbols = [EPSILON];
          }
        }

        for (const s of bodySymbols) {
          if (s !== EPSILON) {
            allSymbols.add(s);
          }
        }

        productions.push({ head, body: bodySymbols });
      }
    }

    // Terminals = all symbols that are not non-terminals and not epsilon
    const terminals = [];
    for (const s of allSymbols) {
      if (!nonTerminalSet.has(s) && s !== EPSILON) {
        terminals.add ? terminals.push(s) : terminals.push(s);
      }
    }

    // Filter properly
    const terminalArray = [...allSymbols].filter(s => !nonTerminalSet.has(s) && s !== EPSILON);

    return new Grammar(terminalArray, [...nonTerminalSet], productions, startSymbol);
  }

  /**
   * Check if a symbol is a terminal.
   * @param {string} symbol
   * @returns {boolean}
   */
  isTerminal(symbol) {
    return this.terminals.includes(symbol);
  }

  /**
   * Check if a symbol is a non-terminal.
   * @param {string} symbol
   * @returns {boolean}
   */
  isNonTerminal(symbol) {
    return this.nonTerminals.includes(symbol);
  }

  /**
   * Get all productions with a given non-terminal as head.
   * @param {string} nonTerminal
   * @returns {{ head: string, body: string[], index: number }[]}
   */
  getProductionsFor(nonTerminal) {
    return this.productions.filter(p => p.head === nonTerminal);
  }

  /**
   * Eliminate immediate and indirect left recursion.
   * Uses the standard algorithm (ordering non-terminals, substituting, then
   * eliminating immediate left recursion for each).
   * @returns {Grammar} A new Grammar without left recursion.
   */
  eliminateLeftRecursion() {
    // Deep clone productions
    let prods = this.productions.map(p => ({ head: p.head, body: [...p.body] }));
    const ntOrder = [...this.nonTerminals];
    const newNonTerminals = new Set(this.nonTerminals);
    const newProds = [];

    for (let i = 0; i < ntOrder.length; i++) {
      const Ai = ntOrder[i];

      // For each Aj where j < i, substitute Aj productions into Ai
      for (let j = 0; j < i; j++) {
        const Aj = ntOrder[j];
        const substituted = [];

        for (const prod of prods.filter(p => p.head === Ai)) {
          if (prod.body.length > 0 && prod.body[0] === Aj) {
            // Replace Aj with each Aj-production body
            const ajProds = prods.filter(p => p.head === Aj);
            for (const ajProd of ajProds) {
              const newBody = ajProd.body[0] === EPSILON
                ? prod.body.slice(1)
                : [...ajProd.body, ...prod.body.slice(1)];
              substituted.push({ head: Ai, body: newBody.length === 0 ? [EPSILON] : newBody });
            }
          } else {
            substituted.push(prod);
          }
        }

        // Remove old Ai productions and replace with substituted
        prods = prods.filter(p => p.head !== Ai).concat(substituted);
      }

      // Eliminate immediate left recursion for Ai
      const aiProds = prods.filter(p => p.head === Ai);
      const leftRecursive = aiProds.filter(p => p.body.length > 0 && p.body[0] === Ai);
      const nonLeftRecursive = aiProds.filter(p => !(p.body.length > 0 && p.body[0] === Ai));

      if (leftRecursive.length > 0) {
        const AiPrime = Ai + "'";
        newNonTerminals.add(AiPrime);

        // Remove old Ai productions
        prods = prods.filter(p => p.head !== Ai);

        // For each non-left-recursive production β, add Ai -> β Ai'
        for (const prod of nonLeftRecursive) {
          const body = prod.body[0] === EPSILON ? [AiPrime] : [...prod.body, AiPrime];
          prods.push({ head: Ai, body });
        }

        // If there are no non-left-recursive productions, Ai -> Ai'
        if (nonLeftRecursive.length === 0) {
          prods.push({ head: Ai, body: [AiPrime] });
        }

        // For each left-recursive production Ai -> Ai α, add Ai' -> α Ai'
        for (const prod of leftRecursive) {
          const alpha = prod.body.slice(1);
          const body = alpha.length === 0 ? [AiPrime] : [...alpha, AiPrime];
          prods.push({ head: AiPrime, body });
        }

        // Add Ai' -> ε
        prods.push({ head: AiPrime, body: [EPSILON] });
      }
    }

    // Collect terminals
    const terminalSet = new Set(this.terminals);
    for (const p of prods) {
      for (const s of p.body) {
        if (s !== EPSILON && !newNonTerminals.has(s)) {
          terminalSet.add(s);
        }
      }
    }

    return new Grammar(
      [...terminalSet],
      [...newNonTerminals],
      prods,
      this.startSymbol
    );
  }

  /**
   * Perform left factoring on the grammar.
   * For non-terminals with alternatives sharing a common prefix, factor it out.
   * @returns {Grammar} A new Grammar after left factoring.
   */
  leftFactor() {
    let prods = this.productions.map(p => ({ head: p.head, body: [...p.body] }));
    const newNonTerminals = new Set(this.nonTerminals);
    const terminalSet = new Set(this.terminals);
    let changed = true;
    let primeCounter = {};

    while (changed) {
      changed = false;
      const ntList = [...newNonTerminals];

      for (const nt of ntList) {
        const ntProds = prods.filter(p => p.head === nt);
        if (ntProds.length <= 1) continue;

        // Find longest common prefix among any group of productions
        const prefix = _findLongestCommonPrefix(ntProds);
        if (prefix.length === 0) continue;

        changed = true;

        // Generate a fresh name for the new non-terminal
        if (!primeCounter[nt]) primeCounter[nt] = 0;
        primeCounter[nt]++;
        let newNT = nt + "'";
        while (newNonTerminals.has(newNT)) {
          newNT += "'";
        }
        newNonTerminals.add(newNT);

        // Separate matching and non-matching productions
        const matching = [];
        const nonMatching = [];
        for (const p of ntProds) {
          if (_hasPrefix(p.body, prefix)) {
            matching.push(p);
          } else {
            nonMatching.push(p);
          }
        }

        // Remove all old productions for this NT
        prods = prods.filter(p => p.head !== nt);

        // Add nt -> prefix newNT
        prods.push({ head: nt, body: [...prefix, newNT] });

        // Keep non-matching productions
        for (const p of nonMatching) {
          prods.push(p);
        }

        // Add newNT -> suffix for each matching production
        for (const p of matching) {
          const suffix = p.body.slice(prefix.length);
          prods.push({ head: newNT, body: suffix.length === 0 ? [EPSILON] : suffix });
        }
      }
    }

    return new Grammar([...terminalSet], [...newNonTerminals], prods, this.startSymbol);
  }

  /**
   * Serialize grammar to a JSON-compatible object.
   * @returns {object}
   */
  toJSON() {
    return {
      terminals: [...this.terminals],
      nonTerminals: [...this.nonTerminals],
      productions: this.productions.map(p => ({
        index: p.index,
        head: p.head,
        body: [...p.body]
      })),
      startSymbol: this.startSymbol
    };
  }

  /**
   * Create an augmented grammar by adding S' -> S production.
   * Used by LR parsers.
   * @returns {Grammar}
   */
  augment() {
    const augStart = this.startSymbol + "'";
    const newProds = [
      { head: augStart, body: [this.startSymbol] },
      ...this.productions.map(p => ({ head: p.head, body: [...p.body] }))
    ];
    const newNT = [augStart, ...this.nonTerminals];
    return new Grammar([...this.terminals], newNT, newProds, augStart);
  }

  /**
   * Pretty-print the grammar.
   * @returns {string}
   */
  toString() {
    const grouped = {};
    for (const nt of this.nonTerminals) {
      grouped[nt] = [];
    }
    for (const p of this.productions) {
      if (!grouped[p.head]) grouped[p.head] = [];
      grouped[p.head].push(p.body.join(' '));
    }
    const lines = [];
    for (const nt of this.nonTerminals) {
      if (grouped[nt] && grouped[nt].length > 0) {
        lines.push(`${nt} -> ${grouped[nt].join(' | ')}`);
      }
    }
    return lines.join('\n');
  }
}

/**
 * Find the longest common prefix among a group of production bodies.
 * @param {{ body: string[] }[]} prods
 * @returns {string[]}
 * @private
 */
function _findLongestCommonPrefix(prods) {
  if (prods.length < 2) return [];

  // Try all pairs and groups; find best prefix shared by at least 2 productions
  let bestPrefix = [];

  for (let i = 0; i < prods.length; i++) {
    for (let j = i + 1; j < prods.length; j++) {
      const common = [];
      const a = prods[i].body;
      const b = prods[j].body;
      const len = Math.min(a.length, b.length);
      for (let k = 0; k < len; k++) {
        if (a[k] === b[k]) {
          common.push(a[k]);
        } else {
          break;
        }
      }
      if (common.length > bestPrefix.length) {
        bestPrefix = common;
      }
    }
  }

  return bestPrefix;
}

/**
 * Check if a body starts with the given prefix.
 * @param {string[]} body
 * @param {string[]} prefix
 * @returns {boolean}
 * @private
 */
function _hasPrefix(body, prefix) {
  if (body.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (body[i] !== prefix[i]) return false;
  }
  return true;
}

module.exports = { Grammar, EPSILON, END_MARKER };
