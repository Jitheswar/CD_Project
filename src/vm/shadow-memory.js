'use strict';

/**
 * @module shadow-memory
 * @description Shadow Memory and bounds checker for NexCC Virtual Machine.
 * Tracks 32-bit address space layout:
 *   - Static Data: 0x00001000 - 0x0000FFFF
 *   - Heap:        0x00010000 - 0x7FFFFFFF (grows upward)
 *   - Stack:       0x80000000 - 0xFFFFFFFC (grows downward)
 *
 * For every byte, shadow memory monitors:
 *   - Allocation status
 *   - Initialization status (uninitialized read detection)
 *   - Allocation bounds (out-of-bounds read/write detection)
 *   - Use-after-free detection
 */

class AllocationRecord {
  /**
   * @param {number} id
   * @param {number} base
   * @param {number} size
   * @param {'heap'|'stack'|'static'} region
   */
  constructor(id, base, size, region = 'heap') {
    this.id = id;
    this.base = base;
    this.size = size;
    this.region = region;
    this.freed = false;
    this.initializedBytes = new Uint8Array(size); // 1 = written, 0 = uninit
  }

  contains(addr, size = 1) {
    return addr >= this.base && (addr + size) <= (this.base + this.size);
  }
}

class ShadowMemory {
  constructor() {
    this.heapBreak = 0x00010000;
    this.stackPointer = 0xFFFFFFFC;
    this.allocations = new Map(); // id -> AllocationRecord
    this.addressMap = [];         // sorted list of active allocations for fast lookup
    this.nextAllocId = 1;
    this.violations = [];

    // Pre-allocate a 16MB raw ArrayBuffer for actual physical data simulation
    this.rawBuffer = new ArrayBuffer(16 * 1024 * 1024);
    this.dataView = new DataView(this.rawBuffer);
  }

  _physicalOffset(addr) {
    // Map simulated 32-bit address into rawBuffer (modulo buffer size)
    return Math.abs(addr) % (this.rawBuffer.byteLength - 4);
  }

  /**
   * Allocate memory on simulated heap.
   * @param {number} size - Bytes to allocate
   * @returns {number} 32-bit virtual address
   */
  malloc(size) {
    if (size <= 0) size = 4;
    // Align to 4 bytes
    const alignedSize = (size + 3) & ~3;
    const base = this.heapBreak;
    this.heapBreak += alignedSize;

    const id = this.nextAllocId++;
    const record = new AllocationRecord(id, base, alignedSize, 'heap');
    this.allocations.set(id, record);
    this.addressMap.push(record);

    return base;
  }

  /**
   * Free an allocated heap buffer.
   * @param {number} addr
   * @returns {{ ok: boolean, violation: string|null }}
   */
  free(addr) {
    const record = this.addressMap.find(a => a.base === addr && a.region === 'heap');
    if (!record) {
      const v = `Invalid free: address 0x${addr.toString(16)} is not an active heap allocation`;
      this.violations.push(v);
      return { ok: false, violation: v };
    }

    if (record.freed) {
      const v = `Double free: address 0x${addr.toString(16)} was already freed`;
      this.violations.push(v);
      return { ok: false, violation: v };
    }

    record.freed = true;
    this.addressMap = this.addressMap.filter(a => a.id !== record.id);
    return { ok: true, violation: null };
  }

  /**
   * Check validity of a read operation.
   * @param {number} addr
   * @param {number} size
   * @returns {{ ok: boolean, violation: string|null }}
   */
  checkRead(addr, size = 4) {
    // Check if in any active allocation
    const record = this.addressMap.find(a => a.contains(addr, size));

    if (!record) {
      // Check if it belongs to a freed chunk (use-after-free)
      for (const alloc of this.allocations.values()) {
        if (alloc.freed && alloc.contains(addr, size)) {
          const v = `Use-after-free read: address 0x${addr.toString(16)} at freed block #${alloc.id}`;
          this.violations.push(v);
          return { ok: false, violation: v };
        }
      }

      // Check if partially within bounds (out-of-bounds)
      const partial = this.addressMap.find(a => addr >= a.base && addr < (a.base + a.size + 64));
      if (partial) {
        const offset = addr - partial.base;
        const v = `Out-of-bounds read: offset ${offset} exceeds allocation size ${partial.size} [0..${partial.size - 1}]`;
        this.violations.push(v);
        return { ok: false, violation: v };
      }

      const v = `Illegal memory read: unmapped address 0x${addr.toString(16)}`;
      this.violations.push(v);
      return { ok: false, violation: v };
    }

    // Check initialization
    const off = addr - record.base;
    let uninit = false;
    for (let i = 0; i < size; i++) {
      if (record.initializedBytes[off + i] === 0) {
        uninit = true;
        break;
      }
    }

    if (uninit) {
      // Uninitialized read warning
      const v = `Uninitialized memory read at address 0x${addr.toString(16)}`;
      this.violations.push(v);
      return { ok: true, violation: v, warning: true };
    }

    return { ok: true, violation: null };
  }

  /**
   * Check validity of a write operation.
   * @param {number} addr
   * @param {number} size
   * @returns {{ ok: boolean, violation: string|null }}
   */
  checkWrite(addr, size = 4) {
    const record = this.addressMap.find(a => a.contains(addr, size));

    if (!record) {
      // Check use-after-free
      for (const alloc of this.allocations.values()) {
        if (alloc.freed && alloc.contains(addr, size)) {
          const v = `Use-after-free write: address 0x${addr.toString(16)} at freed block #${alloc.id}`;
          this.violations.push(v);
          return { ok: false, violation: v };
        }
      }

      // Out-of-bounds write
      const partial = this.addressMap.find(a => addr >= a.base && addr < (a.base + a.size + 64));
      if (partial) {
        const offset = addr - partial.base;
        const v = `Out-of-bounds write: offset ${offset} exceeds allocation size ${partial.size} [0..${partial.size - 1}]`;
        this.violations.push(v);
        return { ok: false, violation: v };
      }

      const v = `Illegal memory write: unmapped address 0x${addr.toString(16)}`;
      this.violations.push(v);
      return { ok: false, violation: v };
    }

    // Mark bytes as initialized
    const off = addr - record.base;
    for (let i = 0; i < size; i++) {
      record.initializedBytes[off + i] = 1;
    }

    return { ok: true, violation: null };
  }

  // Raw byte access
  read32(addr) {
    this.checkRead(addr, 4);
    const p = this._physicalOffset(addr);
    return this.dataView.getInt32(p, true); // Little endian
  }

  write32(addr, val) {
    this.checkWrite(addr, 4);
    const p = this._physicalOffset(addr);
    const oldVal = this.dataView.getInt32(p, true);
    this.dataView.setInt32(p, val | 0, true);
    return oldVal;
  }
}

module.exports = {
  AllocationRecord,
  ShadowMemory,
};
