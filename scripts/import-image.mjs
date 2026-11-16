/**
 * 扫雷（Minesweeper）—— 从题面图片自动识别并导入题库
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [选项]
 *
 * 选项：
 *   --name 名称        题库中显示的名称（默认：识图 · W×H）
 *   --id ID            指定题目 id
 *   --series 系列      系列名（默认：图片导入）
 *   --difficulty 级别  easy / medium / hard / custom（默认 hard）
 *   --size N           正方形网格边长（自动识别失败时手动指定）
 *   --width N / --height N  非正方形题图的宽/高，可只给一边
 *   --map r,c=数字     人工覆盖某格线索（行列从 1 开始；0-8 为数字，`--map r,c=.` 表示无数字）
 *   --append           写入 src/game/imported-puzzles.ts
 *   --verify           唯一性检查（大网格常超时，会给出警告）
 *   --dry              只识别网格与数字，不求解、不写入
 *   --timeout MS       唯一性搜索时间上限毫秒（默认 30000）
 *   --max-nodes N      唯一性搜索节点上限（默认 300000）
 *   --edge PATH        指定 Edge 可执行文件路径（默认自动探测）
 *
 * 识别原理（Playwright + Edge，无网络、无外部服务）：
 *   1. 取图片亮度众数作为背景，投影比背景更暗的像素得到网格线，取最长等距线序列；
 *   2. 每格内提取数字墨迹（比背景暗或带色），归一到 12×12 后与 0-9 字体模板做 IoU 匹配；
 *   3. 同时统计每个数字主色，用「同色必同数字」的多数表决自动纠正个别字形误判；
 *   4. 生成题面串（'.' = 无数字，数字 = 线索），预览，可 --append 写入题库。
 *
 * 题图预期：扫雷题面的数字线索（0-8 可能带颜色），网格外的坐标标签不会影响识别。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { register } from 'node:module'

const tsResolveLoader = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (err) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      try { return await next(specifier + '.ts', context) } catch {}
    }
    throw err
  }
}`
register('data:text/javascript;base64,' + Buffer.from(tsResolveLoader).toString('base64'))

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function resolveEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p
  throw new Error('找不到 Microsoft Edge，可用 --edge 或环境变量 EDGE_PATH 指定路径')
}

const DATA_FILE = path.resolve('src/game/imported-puzzles.ts')

function usage(message) {
  if (message) console.error(`[import] ${message}`)
  console.error(
    '用法: node scripts/import-image.mjs <图片路径> [--name 名称] [--series 系列] [--difficulty easy|medium|hard|custom]\n' +
      '       [--size N | --width N --height N] [--map r,c=数字] [--append] [--verify] [--dry]\n' +
      '       [--timeout MS] [--max-nodes N] [--id ID] [--edge PATH]',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    positional: [],
    append: false,
    verify: false,
    dry: false,
    size: 0,
    width: 0,
    height: 0,
    timeout: 30_000,
    maxNodes: 300_000,
    map: [],
  }
  const valueFlags = new Set(['name', 'id', 'series', 'difficulty', 'size', 'width', 'height', 'timeout', 'max-nodes', 'edge', 'map'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      opts.positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'append') opts.append = true
    else if (key === 'verify') opts.verify = true
    else if (key === 'dry') opts.dry = true
    else if (valueFlags.has(key)) {
      const value = argv[i + 1]
      if (value === undefined) usage(`缺少 --${key} 的值`)
      i++
      if (key === 'max-nodes') opts.maxNodes = Number(value)
      else if (key === 'timeout') opts.timeout = Number(value)
      else if (key === 'size') opts.size = Number(value)
      else if (key === 'width') opts.width = Number(value)
      else if (key === 'height') opts.height = Number(value)
      else if (key === 'map') opts.map.push(value)
      else opts[key] = value
    } else usage(`未知选项 --${key}`)
  }
  if (opts.positional.length !== 1) usage('需要且只需要一个图片路径')
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) usage('--timeout 必须是正数')
  if (!Number.isFinite(opts.maxNodes) || opts.maxNodes <= 0) usage('--max-nodes 必须是正数')
  return opts
}

function hashId(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

function encodeClues(clues) {
  let out = ''
  for (const v of clues) out += v < 0 ? '.' : String(v)
  return out
}

// ───────────────────────────── 图片识别 ─────────────────────────────

function dataUrlOf(file) {
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.png' ? 'image/png' : ext === '.bmp' ? 'image/bmp' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

async function analyzeImage({ imageFile, edge, size, width, height }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true, executablePath: edge })
  try {
    const page = await browser.newPage()
    return await page.evaluate(
      async ({ src, sizeOpt, widthOpt, heightOpt }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const W = img.naturalWidth
        const H = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, W, H).data
        const lum = new Float32Array(W * H)
        for (let p = 0, i = 0; p < lum.length; p++, i += 4) lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

        // 背景亮度 = 亮度众数（按 4 级分桶后取众数桶中位数）
        const hist = new Int32Array(64)
        for (let p = 0; p < lum.length; p++) hist[Math.min(63, Math.floor(lum[p] / 4))]++
        let modeBin = 0
        for (let i = 0; i < 64; i++) if (hist[i] > hist[modeBin]) modeBin = i
        const bgLum = modeBin * 4 + 2
        const lineThreshold = Math.max(40, bgLum - 40)

        const groupLines = (scores, min) => {
          const out = []
          let run = []
          for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= min) run.push(i)
            else if (run.length) {
              out.push(run.reduce((a, b) => a + b, 0) / run.length)
              run = []
            }
          }
          if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
          return out
        }
        const longestRun = (lines) => {
          let best = []
          for (let i = 0; i < lines.length; i++) {
            for (let j = i + 1; j < lines.length; j++) {
              const step = (lines[j] - lines[i]) / (j - i)
              if (step < 6) continue
              const run = [lines[i]]
              let expected = lines[i] + step
              let k = i + 1
              while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.25) {
                run.push(lines[k])
                k++
                expected += step
              }
              if (run.length > best.length) best = run
            }
          }
          if (best.length < 3) return null
          return { first: best[0], last: best[best.length - 1], step: (best[best.length - 1] - best[0]) / (best.length - 1), lines: best.length }
        }

        // 网格线阈值不唯一：由深到浅多档扫描，取「线数最多且间距均匀」的那一档，
        // 避免把彩色数字所在的行/列误当成网格线。
        const axisScores = (horizontal, threshold) => {
          const scores = horizontal ? new Int32Array(H) : new Int32Array(W)
          if (horizontal) {
            for (let y = 0; y < H; y++) {
              let n = 0
              for (let x = 0; x < W; x++) if (lum[y * W + x] < threshold) n++
              scores[y] = n
            }
          } else {
            for (let x = 0; x < W; x++) {
              let n = 0
              for (let y = 0; y < H; y++) if (lum[y * W + x] < threshold) n++
              scores[x] = n
            }
          }
          return scores
        }
        const findGrid = (horizontal) => {
          let best = null
          for (let delta = 100; delta >= 20; delta -= 10) {
            const lineThreshold = Math.max(10, bgLum - delta)
            const scores = axisScores(horizontal, lineThreshold)
            const lines = groupLines(scores, Math.max(20, Math.max(...scores) * 0.5))
            if (lines.length < 3) continue
            for (let i = 0; i < lines.length; i++) {
              for (let j = i + 1; j < lines.length; j++) {
                const step = (lines[j] - lines[i]) / (j - i)
                if (step < 6) continue
                const run = [lines[i]]
                let expected = lines[i] + step
                let k = i + 1
                while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.25) {
                  run.push(lines[k])
                  k++
                  expected += step
                }
                if (run.length < 3) continue
                const realStep = (run[run.length - 1] - run[0]) / (run.length - 1)
                let maxDev = 0
                for (let q = 0; q < run.length; q++) maxDev = Math.max(maxDev, Math.abs(run[q] - (run[0] + q * realStep)))
                if (maxDev > realStep * 0.1) continue
                const score = run.length
                if (!best || score > best.score) {
                  best = { score, first: run[0], last: run[run.length - 1], step: realStep, lines: run.length, threshold: lineThreshold }
                }
              }
            }
            if (best && best.score >= 20) break
          }
          return best
        }
        const hLines = findGrid(true)
        const vLines = findGrid(false)
        if (!hLines || !vLines) {
          return { error: '未能定位网格线；请确认图片包含完整的题面网格，或先用 --size / --width / --height 指定尺寸' }
        }
        const autoW = vLines.lines - 1
        const autoH = hLines.lines - 1
        const w = widthOpt || sizeOpt || autoW
        const h = heightOpt || sizeOpt || autoH
        if (!(w >= 2) || !(h >= 2)) {
          return { error: `无法确定网格尺寸：竖线 ${vLines.lines} 条、横线 ${hLines.lines} 条（自动识别 ${autoW}×${autoH}）` }
        }
        if (vLines.lines !== w + 1 || hLines.lines !== h + 1) {
          return { error: `网格不匹配：识别到 ${vLines.lines} 条竖线 / ${hLines.lines} 条横线，但目标是 ${w}×${h}（需要 ${w + 1} / ${h + 1} 条线）` }
        }
        const x0 = vLines.first
        const y0 = hLines.first
        const cellW = vLines.step
        const cellH = hLines.step
        const cellMin = Math.min(cellW, cellH)

        // —— 数字模板 ——
        const N = 12
        const fonts = ['bold 60px Arial', 'bold 60px Helvetica', 'bold 60px "Segoe UI"', 'bold 60px Verdana', 'bold 60px Tahoma', 'bold 60px "Microsoft YaHei"']
        const tcv = document.createElement('canvas')
        tcv.width = 96
        tcv.height = 96
        const tg = tcv.getContext('2d', { willReadFrequently: true })
        const normRaw = (raw, rw, rh) => {
          let bx0 = rw
          let bx1 = -1
          let by0 = rh
          let by1 = -1
          for (let y = 0; y < rh; y++)
            for (let x = 0; x < rw; x++)
              if (raw[y * rw + x]) {
                if (x < bx0) bx0 = x
                if (x > bx1) bx1 = x
                if (y < by0) by0 = y
                if (y > by1) by1 = y
              }
          if (bx1 < 0) return null
          const bw = bx1 - bx0 + 1
          const bh = by1 - by0 + 1
          const out = new Uint8Array(N * N)
          for (let j = 0; j < N; j++)
            for (let i = 0; i < N; i++) {
              const sx = bx0 + Math.min(bw - 1, Math.floor((bw * i) / N))
              const sy = by0 + Math.min(bh - 1, Math.floor((bh * j) / N))
              out[j * N + i] = raw[sy * rw + sx]
            }
          return out
        }
        const templates = {}
        for (const font of fonts) {
          const list = {}
          for (let d = 0; d <= 9; d++) {
            tg.fillStyle = '#fff'
            tg.fillRect(0, 0, 96, 96)
            tg.fillStyle = '#000'
            tg.font = font
            tg.textAlign = 'center'
            tg.textBaseline = 'middle'
            tg.fillText(String(d), 48, 48)
            const id = tg.getImageData(0, 0, 96, 96).data
            const raw = new Uint8Array(96 * 96)
            for (let p = 0; p < raw.length; p++) raw[p] = id[p * 4] < 128 ? 1 : 0
            const norm = normRaw(raw, 96, 96)
            if (norm) list[d] = norm
          }
          templates[font] = list
        }
        const iou = (a, b) => {
          let inter = 0
          let union = 0
          for (let i = 0; i < a.length; i++) {
            if (a[i] && b[i]) inter++
            if (a[i] || b[i]) union++
          }
          return union ? inter / union : 0
        }
        const classifyDigit = (norm) => {
          let bestDigit = -1
          let bestScore = 0
          for (const font of fonts) {
            const list = templates[font]
            for (let d = 0; d <= 9; d++) {
              const s = iou(norm, list[d])
              if (s > bestScore) {
                bestScore = s
                bestDigit = d
              }
            }
          }
          return { digit: bestDigit, score: bestScore }
        }

        // —— 逐格识别 ——
        const cells = new Array(w * h).fill(null)
        const colorKeyOf = (r, g, b) => [r, g, b].map((v) => Math.round(v / 48) * 48).join(',')
        const inkThreshold = bgLum - 36
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const gx0 = x0 + c * cellW
            const gy0 = y0 + r * cellH
            const margin = Math.max(2, cellMin * 0.12)
            const pts = []
            for (let y = Math.ceil(gy0 + margin); y <= Math.floor(gy0 + cellH - margin); y++) {
              for (let x = Math.ceil(gx0 + margin); x <= Math.floor(gx0 + cellW - margin); x++) {
                const i = (y * W + x) * 4
                const rr = data[i]
                const gg = data[i + 1]
                const bb = data[i + 2]
                const mx = Math.max(rr, gg, bb)
                const mn = Math.min(rr, gg, bb)
                if (lum[y * W + x] < inkThreshold || mx - mn > 40) pts.push([x, y, rr, gg, bb])
              }
            }
            if (pts.length < 8) continue
            let minX = W
            let maxX = -1
            let minY = H
            let maxY = -1
            let cr = 0
            let cg = 0
            let cb = 0
            let cn = 0
            let sx = 0
            let sy = 0
            for (const [x, y, rr, gg, bb] of pts) {
              if (x < minX) minX = x
              if (x > maxX) maxX = x
              if (y < minY) minY = y
              if (y > maxY) maxY = y
              sx += x
              sy += y
              const mx = Math.max(rr, gg, bb)
              const mn = Math.min(rr, gg, bb)
              if (mx - mn > 60 || lum[y * W + x] < 120) {
                cr += rr
                cg += gg
                cb += bb
                cn++
              }
            }
            const bw = maxX - minX + 1
            const bh = maxY - minY + 1
            // 过滤格子边上的立体高光/阴影：数字应是居中、接近格高的紧凑字形
            const ccx = gx0 + cellW / 2
            const ccy = gy0 + cellH / 2
            const centerOffX = Math.abs(sx / pts.length - ccx)
            const centerOffY = Math.abs(sy / pts.length - ccy)
            if (centerOffX > cellW * 0.2 || centerOffY > cellH * 0.2) continue
            if (bh < cellH * 0.32 || bh > cellH * 0.85 || bw > cellW * 0.75) continue
            if (bw < Math.max(3, cellW * 0.1)) continue
            const raw = new Uint8Array(bw * bh)
            for (const [x, y] of pts) raw[(y - minY) * bw + (x - minX)] = 1
            const norm = normRaw(raw, bw, bh)
            if (!norm) continue
            const cls = classifyDigit(norm)
            const mean = cn ? [Math.round(cr / cn), Math.round(cg / cn), Math.round(cb / cn)] : [0, 0, 0]
            cells[r * w + c] = { digit: cls.digit, score: cls.score, colorKey: colorKeyOf(mean[0], mean[1], mean[2]) }
          }
        }

        // —— 同色多数表决：同一颜色的数字应当相同，纠正个别字形误判 ——
        // 只用高置信度字形建立「颜色→数字」映射，再仅修正低置信度格子，
        // 避免把字形本来就清楚的特例（如黑色的 7 与灰色 0 同色）改错。
        const colorVotes = new Map()
        for (const cell of cells) {
          if (!cell || cell.score < 0.75) continue
          if (!colorVotes.has(cell.colorKey)) colorVotes.set(cell.colorKey, new Map())
          const votes = colorVotes.get(cell.colorKey)
          votes.set(cell.digit, (votes.get(cell.digit) ?? 0) + 1)
        }
        const colorWinner = new Map()
        for (const [key, votes] of colorVotes) {
          let total = 0
          let bestDigit = -1
          let bestCount = 0
          for (const [digit, count] of votes) {
            total += count
            if (count > bestCount) {
              bestCount = count
              bestDigit = digit
            }
          }
          if (total >= 3 && bestCount / total >= 0.9) colorWinner.set(key, bestDigit)
        }
        const corrections = []
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i]
          if (!cell || cell.score >= 0.75) continue
          const want = colorWinner.get(cell.colorKey)
          if (want !== undefined && want !== cell.digit) {
            corrections.push({ r: Math.floor(i / w), c: i % w, from: cell.digit, to: want })
            cell.digit = want
          }
        }

        return {
          width: w,
          height: h,
          cells,
          corrections,
          colorCount: colorVotes.size,
          grid: { imageW: W, imageH: H, x0, y0, cellW, cellH, autoW, autoH, bgLum, lineThreshold },
        }
      },
      { src: dataUrlOf(imageFile), sizeOpt: size, widthOpt: width, heightOpt: height },
    )
  } finally {
    await browser.close()
  }
}

// ───────────────────────────── 写入题库 ─────────────────────────────

function appendEntry(entry) {
  const line = `  { id: ${JSON.stringify(entry.id)}, name: ${JSON.stringify(entry.name)}, width: ${entry.width}, height: ${entry.height}, difficulty: '${entry.difficulty}', series: ${JSON.stringify(entry.series)}, board: ${JSON.stringify(entry.board)}, solution: ${JSON.stringify(entry.solution ?? '')} },\n`
  if (!existsSync(DATA_FILE)) {
    writeFileSync(
      DATA_FILE,
      "import type { RawPuzzle } from './puzzles-data'\n\n/** 由 scripts/import-image.mjs 追加；不会在 npm run gen 时被覆盖 */\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n" +
        line +
        ']\n',
      'utf8',
    )
    return
  }
  let text = readFileSync(DATA_FILE, 'utf8').replace(/\r\n/g, '\n')
  const close = text.lastIndexOf(']')
  if (close < 0) throw new Error('imported-puzzles.ts 格式异常：找不到数组结尾 ]')
  const before = text.slice(0, close)
  text = before + (before.endsWith('\n') ? '' : '\n') + line + text.slice(close)
  writeFileSync(DATA_FILE, text, 'utf8')
}

// ───────────────────────────── 主流程 ─────────────────────────────

const opts = parseArgs(process.argv.slice(2))
const imageFile = path.resolve(opts.positional[0])
if (!existsSync(imageFile)) usage(`找不到图片：${imageFile}`)
const edge = opts.edge || resolveEdge()

console.log(`[import] 识别 ${path.relative(process.cwd(), imageFile) || imageFile}`)
const detected = await analyzeImage({ imageFile, edge, size: opts.size, width: opts.width, height: opts.height })
if (detected.error) {
  console.error(`[import] ${detected.error}`)
  process.exit(1)
}
const { width, height, grid } = detected
const size = width * height
const digits = detected.cells.map((cell) => (cell ? cell.digit : -1))

// --map 人工覆盖：r,c=数字（行列从 1 开始；`.` 或 -1 表示无数字）
for (const spec of opts.map) {
  for (const pair of spec.split(';')) {
    if (!pair.trim()) continue
    const m = pair.trim().match(/^(\d+)\s*,\s*(\d+)\s*=\s*([0-9.]|-[0-9]+)$/)
    if (!m) usage(`--map 格式应为 行,列=数字（0-8，或 . 表示无数字），收到：${pair}`)
    const r = Number(m[1]) - 1
    const c = Number(m[2]) - 1
    if (r < 0 || r >= height || c < 0 || c >= width) usage(`--map 坐标越界：${pair}（网格 ${width}×${height}）`)
    digits[r * width + c] = m[3] === '.' ? -1 : Number(m[3])
  }
}

const clueCount = digits.filter((v) => v >= 0).length
const counts = {}
for (const v of digits) if (v >= 0) counts[v] = (counts[v] ?? 0) + 1
console.log(
  `[import] 网格 ${width}×${height}，格子 ${grid.cellW.toFixed(2)}×${grid.cellH.toFixed(2)}px，图片 ${grid.imageW}×${grid.imageH}，` +
    `背景亮度 ${grid.bgLum}；线索 ${clueCount} 格`,
)
console.log(
  '[import] 数字分布：' +
    Object.keys(counts)
      .sort((a, b) => Number(a) - Number(b))
      .map((d) => `${d}×${counts[d]}`)
      .join(' ') +
    (detected.colorCount ? `；颜色 ${detected.colorCount} 组` : ''),
)
if (detected.corrections.length) {
  console.log(`[import] 同色多数表决纠正了 ${detected.corrections.length} 个字形：`)
  for (const fix of detected.corrections.slice(0, 12)) console.log(`  第 ${fix.r + 1} 行第 ${fix.c + 1} 列：${fix.from} → ${fix.to}`)
}
const lowScore = detected.cells
  .map((cell, i) => ({ cell, i }))
  .filter((entry) => entry.cell && entry.cell.score < 0.5)
if (lowScore.length) {
  console.warn(`[import] 有 ${lowScore.length} 个数字识别把握不足（可用 --map 修正）：`)
  for (const entry of lowScore.slice(0, 12)) {
    console.warn(`  第 ${Math.floor(entry.i / width) + 1} 行第 ${(entry.i % width) + 1} 列：${entry.cell.digit}（相似度 ${entry.cell.score.toFixed(2)}）`)
  }
}

console.log('[import] 题面（. = 无数字）：')
for (let r = 0; r < height; r++) {
  let line = ''
  for (let c = 0; c < width; c++) {
    const v = digits[r * width + c]
    line += v < 0 ? '.' : String(v)
  }
  console.log(String(r + 1).padStart(2) + ' ' + line)
}
const board = encodeClues(digits)

const id = opts.id || `minesweeper-${width}x${height}-${hashId(board)}`
const name = opts.name || `识图 · ${width}×${height}`
const difficulty = opts.difficulty || 'hard'
const series = opts.series || '图片导入'
const entry = { id, name, width, height, difficulty, series, board, solution: '' }

if (opts.dry) {
  console.log('[import] --dry：仅识别，不求解、不写入。')
  process.exit(0)
}

if (opts.verify || opts.append) {
  const solverMod = await import('../src/game/solver.ts')
  console.log('[import] 唯一性检查（大型扫雷题常超时，会给出警告）…')
  const t0 = Date.now()
  const counted = solverMod.countSolutions(digits, width, height, 2, opts.maxNodes)
  const ms = Date.now() - t0
  if (counted.timedOut) {
    console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点 / ${ms}ms），无法确认唯一解；可放宽 --max-nodes / --timeout 后重试。`)
  } else if (counted.count === 0) {
    console.error(`[import] 无解：识别出的线索自相矛盾，请检查数字识别或使用 --map 修正（${ms}ms）。`)
    process.exit(1)
  } else if (counted.count === 1) {
    console.log(`[import] 唯一解确认（${counted.nodes} 节点 / ${ms}ms）`)
    const solved = solverMod.findSolution(digits, width, height, opts.maxNodes)
    if (solved) entry.solution = solved.map((v) => (v ? '1' : '0')).join('')
  } else {
    console.warn(`[import] 警告：项目求解器找到 ${counted.count} 个解，题目可能不唯一。`)
  }
  if (!entry.solution) console.log('[import] 未写入参考解。')
}

if (!opts.append) {
  console.log('[import] 预览模式（未写入题库）。加 --append 写入 src/game/imported-puzzles.ts。')
  console.log(
    `[import] 题库条目：id=${id} name=${name} 尺寸=${width}×${height} 线索=${clueCount} 格` +
      (entry.solution ? ` 参考解=${entry.solution.length} 格` : ''),
  )
  console.log(`[import] board = ${board}`)
} else {
  appendEntry(entry)
  console.log(`[import] 已写入 ${path.relative(process.cwd(), DATA_FILE)}：${id} ${name}`)
}
