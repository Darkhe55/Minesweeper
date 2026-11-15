/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "minesweeper-8x8-lgdpfl", name: "初识扫雷", width: 8, height: 8, difficulty: 'easy', series: "入门", board: ".1.....2..4.2.3.3.....22..32.......0.01.1.......1..0....0.....0.", solution: "0000011001000001011100001000000100000000010000000000000000000000" },
  { id: "minesweeper-8x8-lgdpfm", name: "雷区边缘", width: 8, height: 8, difficulty: 'easy', series: "入门", board: "....3....20...2..2.........0.....0...02......1.2....2....0.11..2", solution: "0000010010001100100000000000000100000001000100000001001000000010" },
  { id: "minesweeper-8x8-lgdpfn", name: "数字迷宫", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "1.0........1.232.3...1.......2.1.0.0..2..21......2..3.......211.", solution: "0000010110000000101000100000000000000100000001001010010000010000" },
  { id: "minesweeper-8x8-lgdpfo", name: "八邻计数", width: 8, height: 8, difficulty: 'medium', series: "进阶", board: "....2..0.2...3.13.......2...0.....2...2.3......2.....3...2..1.10", solution: "0000010010001000010000100100000000000001010010101100000000000100" },
  { id: "minesweeper-8x8-lgdpfp", name: "雷区之壁", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: ".3....0..3..22....1...0...2......33.1.2.3..2.2...2....1...1..1..", solution: "1010100010000000000010000100000010010001010000101000100000010000" },
  { id: "minesweeper-8x8-lgdpfq", name: "终局扫雷", width: 8, height: 8, difficulty: 'hard', series: "挑战", board: "1.0.1..1....2.....113.3.3...3........3...4.3..0..3.....0.2221...", solution: "0000011010000000100001000001011011000000100010000011000010000000" },
]
