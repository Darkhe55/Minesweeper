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
import { encodeClues, type MinesweeperPuzzle } from './types'

const meta = {
  title: '扫雷',
  tagline: '根据数字线索在空白格中布置地雷',
  footerNote:
    '规则：数字表示其周围八格中地雷的数量；数字格本身不是雷。把所有数字都满足的雷布置找出来。点击格子在「雷 / 空」之间切换。',
  storageKeyPrefix: 'minesweeper',
  customIdPrefix: 'minesweeper-custom-',
  customMinW: 4,
  customMinH: 4,
  customMaxW: 10,
  customMaxH: 10,
  targetKind: 'cell' as const,
}

const custom: CustomSupport = {
  mode: 'none',
  valueCycle: [null, 1],
  keyForDigit: () => undefined,
  cellLabel: (v) => (v == null ? '' : String(v)),
  hint: '扫雷暂不支持自定义题板。',
  makePuzzle: (w, h, _grid, existingId) => ({
    id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    clues: new Array<number>(w * h).fill(-1),
  } satisfies MinesweeperPuzzle),
  encodePuzzle: (p) => {
    const mp = p as MinesweeperPuzzle
    return { board: encodeClues(mp.clues ?? []) }
  },
  decodePuzzle: () => null,
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
