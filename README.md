# NexCC — Interactive Optimizing Compiler & Compiler Construction Workbench

> **"The Compiler Where Nothing is Hidden"**  
> Department of Computer Science & Engineering · Course: Project Evaluation (24CS2235F) · A.Y. 2026 - 2027  
> **Students:** N. Rithvik Sai (2420030333) · Ch. Jitheswar (2420030078)  
> **Guide:** Dr. Krishna Kishore  

---

## 📌 Project Overview

**NexCC** is an interactive optimizing compiler and compiler-construction workbench designed to integrate the major phases of compilation into a single inspectable, visual, and executable system.

Most educational tools show only isolated fragments (regex → NFA, parse tables), while industrial compilers (LLVM, GCC) hide classical intermediate stages inside millions of lines of code. NexCC bridges this **"missing middle"** by making every transformation inspectable, verifiable, and testable end-to-end.

NexCC features two unified systems on one workbench:
1. **Compiler Construction Lab**:
   - **Automata Lab:** Regex AST → Thompson's NFA → Subset DFA → Hopcroft's Minimized DFA with equivalence verification and live simulation.
   - **Grammar Lab:** Grammar analysis, left recursion elimination, left factoring, FIRST/FOLLOW set computation, LL(1) predictive parsing, and LR-family parser generation (LR(0), SLR(1), CLR(1), LALR(1)) with shift-reduce/reduce-reduce conflict diagnostics and step-by-step derivation traces.
   - **Syntax-Directed Definitions & Translation (SDD/SDT):** Synthesized and inherited attributes evaluation.
2. **Production Optimizing Compiler:**
   - **Frontend:** Tokenizer with maximal munch, recursive-descent parser, Abstract Syntax Tree (AST), and typed High-Level IR (HIR) for a bounded C-subset (integers, booleans, characters, pointers, arrays, structs, dynamic memory, recursion).
   - **Intermediate Representations:** Three-Address Code (TAC) quadruples, Control-Flow Graphs (CFG) with dominator trees & dominance frontiers, and Static Single Assignment (SSA) form with Cytron iterated dominance frontier φ-function placement and destruction.
   - **Optimization Engine:** Implements deterministic levels (`-O0` to `-O3`) featuring `mem2reg`, Wegman-Zadeck Sparse Conditional Constant Propagation (`sccp`), Global Value Numbering (`gvn`), Loop Invariant Code Motion (`licm`), and mark-sweep Dead Code Elimination (`dce`) with immutable pass snapshots and instruction/block delta tracking.
   - **Dual Execution Backends:**
     - **RV32IM RISC-V Codegen:** Instruction selection, backward dataflow liveness analysis, Chaitin-Briggs graph coloring register allocation with spill rewriting, peephole optimization, and GNU-assembler/32-bit binary emission.
     - **Bytecode Virtual Machine & Time-Travel Debugger:** 32-bit address space (static, heap, stack), dynamic shadow memory tracking allocation bounds, uninitialized reads, and use-after-free violations, with full reversible execution (`stepBack`).
3. **Interactive Web Workbench:**
   - Full visual workbench with panels for all compiler stages, interactive state machine graphs, parse tables, pass diff scrubbers, and shadow memory inspectors.

---

## 🏗 System Architecture

```
CD_Project/
├── src/
│   ├── automata/             # Automata Construction Lab
│   │   ├── regex-parser.js   # Regex AST with precedence & char classes
│   │   ├── nfa.js            # Thompson's construction & NFA simulator
│   │   ├── dfa.js            # Powerset subset construction & DFA simulator
│   │   ├── minimize.js       # Hopcroft's partition refinement & equivalence
│   │   └── index.js
│   ├── grammar/              # Grammar Analysis Lab
│   │   ├── grammar.js        # CFG representation, BNF parser, factoring
│   │   ├── first-follow.js   # FIRST and FOLLOW computation
│   │   ├── ll1.js            # LL(1) parsing table & predictive parser
│   │   ├── lr.js             # LR(0), SLR(1), CLR(1), LALR(1) tables & parser
│   │   ├── sdd-sdt.js        # Semantic attributes & translation schemes
│   │   └── index.js
│   ├── frontend/             # C-subset Compiler Frontend
│   │   ├── token.js          # Canonical token catalog
│   │   ├── lexer.js          # Maximal munch lexer with source locations
│   │   ├── ast.js            # AST node definitions, factory & visitors
│   │   ├── parser.js         # Recursive-descent C-subset parser
│   │   ├── hir.js            # Type checker, symbol table, typed HIR
│   │   └── index.js
│   ├── ir/                   # Intermediate Representations
│   │   ├── tac.js            # Three-Address Code quadruples generator
│   │   ├── cfg.js            # Basic blocks, dominator tree, loops
│   │   ├── ssa.js            # SSA construction (φ placement) & destruction
│   │   ├── lowered-ir.js     # Lowered IR with dense virtual registers
│   │   └── index.js
│   ├── optimizer/            # Optimization Engine
│   │   ├── pass.js           # PassManager & immutable pass snapshots
│   │   ├── mem2reg.js        # Stack alloc/load/store to SSA promotion
│   │   ├── sccp.js           # Sparse Conditional Constant Propagation
│   │   ├── gvn.js            # Dominator-scoped Global Value Numbering
│   │   ├── licm.js           # Loop-Invariant Code Motion
│   │   ├── dce.js            # Mark-sweep Dead Code Elimination
│   │   ├── pipeline.js       # -O0, -O1, -O2, -O3 configurations
│   │   └── index.js
│   ├── codegen/              # Machine Codegen Target (RV32IM)
│   │   ├── mir.js            # Machine IR with RV32IM opcodes
│   │   ├── regalloc.js       # Liveness, interference graph, graph coloring
│   │   ├── rv32im.js         # Assembly text emission & 32-bit binary encoder
│   │   ├── peephole.js       # Target peephole optimizations
│   │   └── index.js
│   ├── vm/                   # Interactive Target (Bytecode VM & Time-Travel)
│   │   ├── bytecode.js       # Bytecode instruction set & compiler
│   │   ├── shadow-memory.js  # 32-bit address space & bounds violation checker
│   │   ├── history.js        # Execution history delta recording & time travel
│   │   ├── vm.js             # Virtual Machine runtime (run, step, stepBack)
│   │   └── index.js
│   ├── nexcc.js              # Unified end-to-end compiler driver
│   ├── server.js             # HTTP server & REST APIs for Web Workbench
│   └── main.js               # CLI driver & server launcher
├── public/
│   └── index.html            # Web Workbench UI (Compiler, Automata, Grammar, VM)
├── examples/                 # Benchmark & Demo Programs
│   ├── linked_list.c         # Dynamic struct linked list (Slide 4)
│   ├── fibonacci.c           # Recursive Fibonacci (Slide 12)
│   ├── quicksort.c           # In-place quicksort algorithm (Slide 12)
│   ├── bst.c                 # Binary Search Tree (Slide 12)
│   ├── matrix_multiply.c     # 2x2 matrix multiplication (Slide 12)
│   ├── prime_sieve.c         # Sieve of Eratosthenes (Slide 12)
│   └── shadow_violation.c    # Out-of-bounds safety violation demo (Slide 10)
├── test/
│   └── nexcc.test.js         # Comprehensive 17-point test suite
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- npm

### 1. Run Comprehensive Test Suite
```bash
npm test
```
Executes all 17 automated tests covering automata, grammar analysis, frontend, TAC/CFG/SSA, optimization passes, RV32IM machine code emission, and Bytecode VM time-travel execution.

### 2. Start Interactive Web Workbench
```bash
./start.sh
# or: npm start
```
Spins up the web server at `http://localhost:3000`. Open your browser to explore:
- **Compiler Pipeline:** Live C editor, compile button, optimization level selector (`-O0` to `-O3`), and inspectable panels for Tokens, AST, HIR, TAC, CFG blocks, Optimization Pass Snapshots with deltas, Lowered IR, and generated RISC-V assembly.
- **Automata Lab:** Regex input, live acceptance simulation, and state machine transitions for NFA, DFA, and Hopcroft's Minimized DFA.
- **Grammar Lab:** Context-free grammar BNF input, FIRST/FOLLOW calculation, LL(1) and LR(0)/SLR(1)/CLR(1)/LALR(1) table construction, conflict diagnostics, and shift-reduce derivation traces.
- **Time-Travel VM:** Disassembled bytecode, Step Forward, Step Back, Run controls, registers inspector, standard output, and Shadow Memory address space visualization.

---

## 🧪 Demo Programs Included

| Program | Source File | Description |
|---------|-------------|-------------|
| **Linked List** | [`examples/linked_list.c`](file:///home/jitheswar/CD_Project/examples/linked_list.c) | Demonstrates dynamic memory allocation (`malloc`, `free`), pointers, structs, arrow operators (`->`), and heap memory safety. |
| **Fibonacci** | [`examples/fibonacci.c`](file:///home/jitheswar/CD_Project/examples/fibonacci.c) | Recursive computation demonstrating call frames, register preservation, and stack layout. |
| **Quicksort** | [`examples/quicksort.c`](file:///home/jitheswar/CD_Project/examples/quicksort.c) | Pointer swapping, array partitions, and divide-and-conquer recursion. |
| **Binary Search Tree** | [`examples/bst.c`](file:///home/jitheswar/CD_Project/examples/bst.c) | Recursive data structures, tree insertions, and key searches. |
| **Matrix Multiply** | [`examples/matrix_multiply.c`](file:///home/jitheswar/CD_Project/examples/matrix_multiply.c) | Dynamic 2D matrix multiplication demonstrating array offset math and register allocation. |
| **Prime Sieve** | [`examples/prime_sieve.c`](file:///home/jitheswar/CD_Project/examples/prime_sieve.c) | Sieve of Eratosthenes with while loops, boolean arrays, and algorithmic optimization. |
| **Memory Violation** | [`examples/shadow_violation.c`](file:///home/jitheswar/CD_Project/examples/shadow_violation.c) | Deliberate out-of-bounds write (`arr[5]`) demonstrating instant detection by NexCC's shadow memory subsystem. |

---

## 📜 License
MIT License · Developed for Academic Year 2026 - 2027 by N. Rithvik Sai & Ch. Jitheswar under the guidance of Dr. Krishna Kishore.
