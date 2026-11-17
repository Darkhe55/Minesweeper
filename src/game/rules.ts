/**
 * 扫雷 —— 规则传播
 *
 * 只做「可证明」的局部推理，直到规则不动点；不做猜测（猜测由 solver.ts 回溯兜底）。
 *
 * 规则 1  数字格自身不能是雷。
 * 规则 2  单线索计数：need = clue - 已确定雷数
 *           need === 0        → 周围未知格全是安全格（数字已满足）
 *           need === 未知格数  → 周围未知格全是雷（未知格全是雷）
 *           need 越界          → 矛盾
 * 规则 3  两条线索候选集的差集（子集规则 / 1-2-1、1-1-2、1-2-2-1 等局部定式）：
 *           设 A、B 为两条线索各自的「未知格」集合，a、b 为它们还差的雷数，
 *           U = A\B，V = B\A，d = a - b。因为
 *             sum(U) + sum(A∩B) = a
 *             sum(V) + sum(A∩B) = b
 *           两式相减得 sum(U) - sum(V) = d，且 0 ≤ sum(U) ≤ |U|、0 ≤ sum(V) ≤ |V|：
 *             d > |U| 或 d < -|V| → 矛盾
 *             d === |U|           → U 全是雷、V 全是安全格
 *             d === -|V|          → V 全是雷、U 全是安全格
 *           U 为空（A⊆B）或 V 为空时就是「子集规则」；U、V 各只有一个格子时
 *           正好是 1-2-1 / 1-2-2-1 / 1-1-2 这类局部定式。
 *
 * 说明：题面只给数字线索、没有给总雷数，因此不存在可用的「全局雷数上下界」；
 * 规则 3 里 d 与 |U|、|V| 的比较就是前沿约束的整数上下界推理。
 */

import { neighbors } from './types.ts'

export type SetCallback = (index: number, value: number, rule: string) => void

interface ClueConstraint {
  /** 这条线索还差的雷数 */
  need: number
  /** 还没确定的相邻格 */
  cells: number[]
}

/** 扫描所有数字线索，得到「还差几颗雷 / 未知格」；发现越界立即返回 null 表示矛盾 */
function collectConstraints(
  mines: ArrayLike<number>,
  clues: ArrayLike<number>,
  w: number,
  h: number,
): ClueConstraint[] | null {
  const size = w * h
  const out: ClueConstraint[] = []
  for (let i = 0; i < size; i++) {
    const clue = clues[i] ?? -1
    if (clue < 0) continue
    const near = neighbors(i, w, h)
    let knownMines = 0
    const unknown: number[] = []
    for (const n of near) {
      const v = mines[n]!
      if (v === 1) knownMines++
      else if (v === -1) unknown.push(n)
    }
    const need = clue - knownMines
    if (need < 0 || need > unknown.length) return null
    out.push({ need, cells: unknown })
  }
  return out
}

/** mines 就地修改：-1 未知 / 0 安全 / 1 雷 */
export function propagate(
  mines: number[],
  clues: ArrayLike<number>,
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  const size = w * h
  const mark = new Uint8Array(size)
  let changed = true
  const set = (i: number, value: number, rule: string): boolean => {
    if (mines[i] === value) return true
    if (mines[i] !== -1) return false
    mines[i] = value
    onSet?.(i, value, rule)
    changed = true
    return true
  }

  while (changed) {
    changed = false

    // 规则 1：数字格自身不能是雷
    for (let i = 0; i < size; i++) {
      if ((clues[i] ?? -1) < 0) continue
      if (mines[i] === 1) return false
      if (mines[i] === -1 && !set(i, 0, '数字格不能是雷')) return false
    }

    // 规则 2：单线索计数
    let cons = collectConstraints(mines, clues, w, h)
    if (!cons) return false
    for (const c of cons) {
      if (c.need === 0) {
        for (const n of c.cells) if (!set(n, 0, '数字周围雷数已满足')) return false
      } else if (c.need === c.cells.length) {
        for (const n of c.cells) if (!set(n, 1, '数字周围剩余格全是雷')) return false
      }
    }

    // 规则 3：两线索差集
    cons = collectConstraints(mines, clues, w, h)
    if (!cons) return false
    // 只对「同一个未知格所涉及」的线索对做差集，避免 O(线索数²)
    const cellCons: number[][] = Array.from({ length: size }, () => [])
    for (let ci = 0; ci < cons.length; ci++) {
      for (const cell of cons[ci]!.cells) cellCons[cell]!.push(ci)
    }
    const seenPairs = new Set<number>()
    for (let cell = 0; cell < size; cell++) {
      const list = cellCons[cell]!
      if (list.length < 2) continue
      for (let p = 0; p < list.length; p++) {
        const ai = list[p]!
        for (let q = p + 1; q < list.length; q++) {
          const bi = list[q]!
          const key = ai * cons.length + bi
          if (seenPairs.has(key)) continue
          seenPairs.add(key)
          const A = cons[ai]!
          const B = cons[bi]!
          const d = A.need - B.need
          // 标记 B 的格子：2 = 属于 B；随后扫 A 时把 A 的格子改成 1
          for (const x of B.cells) mark[x] = 2
          const u: number[] = []
          for (const x of A.cells) {
            if (mark[x] !== 2) u.push(x)
            mark[x] = 1
          }
          const v: number[] = []
          for (const x of B.cells) if (mark[x] !== 1) v.push(x)
          for (const x of A.cells) mark[x] = 0
          for (const x of B.cells) mark[x] = 0

          if (d > u.length || d < -v.length) return false
          if (u.length + v.length === 0) continue
          if (d === u.length) {
            // U 全为雷，V 全为安全格
            const mineRule = v.length === 0 ? '子集推理：差集格必为雷' : '差集推理：差集格必为雷'
            const safeRule = u.length === 0 ? '子集推理：差集格必为安全' : '差集推理：差集格必为安全'
            for (const x of u) if (!set(x, 1, mineRule)) return false
            for (const x of v) if (!set(x, 0, safeRule)) return false
          } else if (d === -v.length) {
            // V 全为雷，U 全为安全格
            const mineRule = u.length === 0 ? '子集推理：差集格必为雷' : '差集推理：差集格必为雷'
            const safeRule = v.length === 0 ? '子集推理：差集格必为安全' : '差集推理：差集格必为安全'
            for (const x of v) if (!set(x, 1, mineRule)) return false
            for (const x of u) if (!set(x, 0, safeRule)) return false
          }
        }
      }
    }
  }
  return true
}

export interface MinesweeperCheck {
  ok: boolean
  badCells: number[]
  issues: Array<{ cell: number; expected: number; actual: number }>
}

export function checkSolution(
  mines: ArrayLike<number>,
  clues: ArrayLike<number>,
  w: number,
  h: number,
): MinesweeperCheck {
  const bad = new Set<number>()
  const issues: Array<{ cell: number; expected: number; actual: number }> = []
  for (let i = 0; i < w * h; i++) {
    const clue = clues[i] ?? -1
    if (clue < 0) continue
    if (mines[i] === 1) {
      bad.add(i)
      continue
    }
    let count = 0
    for (const n of neighbors(i, w, h)) if (mines[n] === 1) count++
    if (count !== clue) {
      issues.push({ cell: i, expected: clue, actual: count })
      bad.add(i)
    }
  }
  return { ok: issues.length === 0, badCells: Array.from(bad), issues }
}
