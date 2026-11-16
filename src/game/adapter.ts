/**
 * ════════════════════════════════════════════════════════════════════
 *  扫雷（Minesweeper）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 状态：每格 0 = 安全，1 = 地雷。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import { decodeClues, encodeClues, type MinesweeperPuzzle } from './types'

const meta = {
  title: '扫雷',
  tagline: '根据数字线索在空白格中布置地雷',
  footerNote:
    '规则：数字表示其周围八格中地雷的数量；数字格本身不是雷。把所有数字都满足的雷布置找出来。点击格子在「雷 / 空」之间切换。',
  storageKeyPrefix: 'minesweeper',
  customIdPrefix: 'minesweeper-custom-',
  customMinW: 4,
  customMinH: 4,
  customMaxW: 20,
  customMaxH: 20,
  targetKind: 'cell' as const,
}

const custom: CustomSupport = {
  mode: 'cell',
  valueCycle: [null, 0, 1, 2, 3, 4, 5, 6, 7, 8],
  keyForDigit: (digit) => {
    // 0-8 都是合法线索（0 = 周围没有雷）；清空用退格 / Delete / 点「空」画笔。
    if (digit >= 0 && digit <= 8) return digit
    return undefined
  },
  cellLabel: (v) => (v == null ? '' : String(v)),
  hint: '数字 1-8 表示该格周围八格的地雷数；格子留空表示没有数字线索。点格循环 空→0→1…→8，键盘 0-8 直填、退格清空，方向键移动。',
  toGrid: (p) => {
    const mp = p as MinesweeperPuzzle
    const size = p.width * p.height
    if (!Array.isArray(mp.clues) || mp.clues.length !== size) return null
    return {
      width: p.width,
      height: p.height,
      grid: mp.clues.map((v) => (typeof v === 'number' && v >= 0 && v <= 8 ? v : null)),
    }
  },
  makePuzzle: (w, h, grid, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    clues: grid.map((v) =>
      typeof v === 'number' && v >= 0 && v <= 8 ? Math.floor(v) : -1,
    ),
  } satisfies MinesweeperPuzzle),
  encodePuzzle: (p) => {
    const mp = p as MinesweeperPuzzle
    return { board: encodeClues(mp.clues ?? []) }
  },
  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    const clues = typeof record.board === 'string' ? decodeClues(record.board, w * h) : null
    if (!clues) return null
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      clues,
    }
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === 1) playDrop(streak)
  else playPluck(streak, 0.9)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
