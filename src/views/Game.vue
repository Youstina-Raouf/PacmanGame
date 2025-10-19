<template>
	<div class="game">
		<!-- HUD -->
		<div class="hud">
			<button class="menu" @click="toggleMenu">☰</button>
			<div class="score" :class="{ paused: paused }">SCORE {{ score }}</div>
		</div>

		<!-- Menu Dropdown -->
		<div v-if="showMenu" class="menu-panel">
			<button @click="onTogglePause">{{ paused ? 'Resume' : 'Pause' }} Game</button>
			<button @click="onNewGame">New Game</button>
			<button @click="goHome">Return Home</button>
		</div>

		<!-- Canvas Area -->
		<canvas ref="canvasRef" :width="canvasWidth" :height="canvasHeight" class="board" />
		<div v-if="!difficulty" class="overlay">Select a level on Home to start.</div>
	</div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'

const router = useRouter()
const store = useStore()

// Store bindings
const difficulty = computed(() => store.getters.selectedDifficulty)
const ghostCount = computed(() => store.getters.ghostCount)
const paused = computed(() => store.getters.paused)
const score = computed(() => store.getters.score)
const gameVersion = computed(() => store.getters.gameVersion)
const gameStatus = computed(() => store.getters.gameStatus)

// UI state
const showMenu = ref(false)
function toggleMenu() { showMenu.value = !showMenu.value }
function onTogglePause() { store.dispatch('togglePause') }
function onNewGame() { store.dispatch('newGame') }
function goHome() { router.push({ name: 'home' }) }

// Canvas and game state
const canvasRef = ref(null)
const ctx = ref(null)
const tileSize = 24

// Fixed classic-like maze (21x21) using characters: # wall, . pellet, ' ' empty
// Represent maze as a true 2D matrix (array of char arrays) for more accurate indexing
const MAZE_STR = [
	"#####################",
	"#.........#.........#",
	"#.###.###.#.###.###.#",
	"#.#.....#...#.....#.#",
	"#.###.#.#####.#.###.#",
	"#.....#...#...#.....#",
	"###.#####.#.#####.###",
	"  #.#   #...#   #.#  ",
	"###.# #.#####.# #.###",
	"#.....#...#...#.....#",
	"#.###.###.#.###.###.#",
	"#.#.....#...#.....#.#",
	"#.###.#.#####.#.###.#",
	"#.....#...#...#.....#",
	"###.#####.#.#####.###",
	"#.........P.........#",
	"#.###.###.#.###.###.#",
	"#.#.....#...#.....#.#",
	"#.###.#.#####.#.###.#",
	"#.........G.........#",
	"#####################",
]
const MAZE = MAZE_STR.map(r => r.split(''))
const rows = MAZE.length
const cols = MAZE[0].length
const canvasWidth = cols * tileSize
const canvasHeight = rows * tileSize

let animationId = 0

// Grid: 0 empty, 1 pellet, 2 wall
let grid = [] // 0 empty, 1 pellet, 2 wall
let pelletCount = 0
// pacman: position (float), current direction (dirX/dirY), queued next direction (nextDirX/nextDirY)
let pacman = { x: 1, y: 1, dirX: 1, dirY: 0, nextDirX: 0, nextDirY: 0, nextFacing: 0, speed: 7, facing: 0, mouth: 0, mouthPhase: 0 }
let ghosts = []
// Debug toggle: set true to show tile vs actual center markers and offsets
const SHOW_DEBUG_CENTER = true

function buildFixedMaze() {
	grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))
	pelletCount = 0
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const ch = MAZE[y][x]
			if (ch === '#') grid[y][x] = 2
			else if (ch === '.') { grid[y][x] = 1; pelletCount++ }
			else grid[y][x] = 0
			if (ch === 'P') { pacman.x = x; pacman.y = y; grid[y][x] = 0 }
			if (ch === 'G') { /* ghost gate placeholder, pellets off */ grid[y][x] = 0 }
		}
	}
}

function resetEntities() {
	pacman.dirX = 1; pacman.dirY = 0; pacman.nextDirX = 0; pacman.nextDirY = 0; pacman.nextFacing = 0; pacman.facing = 0; pacman.mouth = 0
	ghosts = []
	const count = ghostCount.value || 0
	const spawnX = cols - 2
	const spawnY = rows - 2
	for (let i = 0; i < count; i++) {
		ghosts.push({ x: spawnX, y: spawnY, dirX: 0, dirY: -1, speed: 4.5 + Math.random() * 1.5, changeTimer: 0, color: pickGhostColor(i) })
	}
}

function pickGhostColor(i) {
	const colors = ['#ef5350','#42a5f5','#66bb6a','#ab47bc','#ffa726']
	return colors[i % colors.length]
}

function initGame() {
	const canvas = canvasRef.value
	if (!canvas) return
	ctx.value = canvas.getContext('2d')
	buildFixedMaze()
	resetEntities()
	store.dispatch('setGameStatus', 'running')
}

// Input handling
function handleKey(e) {
	if (e.key === 'Escape') { store.dispatch('togglePause'); return }
	const dir = { ArrowUp: [0, -1, 3], ArrowDown: [0, 1, 1], ArrowLeft: [-1, 0, 2], ArrowRight: [1, 0, 0] }[e.key]
	if (!dir) return
	const [dx, dy, face] = dir
	// Queue the requested direction immediately
	pacman.nextDirX = dx
	pacman.nextDirY = dy
	pacman.nextFacing = face
	// Try an immediate turn if we're close enough to tile center and the target tile is free
	const cx = Math.round(pacman.x)
	const cy = Math.round(pacman.y)
	const nearCenterX = Math.abs(pacman.x - cx) < 0.42
	const nearCenterY = Math.abs(pacman.y - cy) < 0.42
	const nx = cx + dx
	const ny = cy + dy
	if (isWalkable(nx, ny)) {
		// allow immediate turn when moving perpendicular and close to center, or if currently stopped
		if ((dx !== 0 && nearCenterY) || (dy !== 0 && nearCenterX) || (pacman.dirX === 0 && pacman.dirY === 0)) {
			pacman.dirX = dx
			pacman.dirY = dy
			pacman.facing = face
			pacman.nextDirX = 0
			pacman.nextDirY = 0
		}
	}
}

// Helpers
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)) }

// Return true if tile (x,y) is walkable (not a wall) and inside bounds
function isWalkable(x, y) {
	if (typeof x !== 'number' || typeof y !== 'number') return false
	if (y < 0 || y >= rows || x < 0 || x >= cols) return false
	return grid[y][x] !== 2
}

// BFS to find the next step from (sx,sy) towards (tx,ty). Returns [dx,dy] for the first step or null.
function bfsNextStep(sx, sy, tx, ty) {
	if (sx === tx && sy === ty) return null
	if (!isWalkable(tx, ty)) return null
	const dirs = [[1,0],[-1,0],[0,1],[0,-1]]
	const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
	const parent = new Map()
	const q = []
	q.push([sx, sy])
	visited[sy][sx] = true
	let found = false
	while (q.length) {
		const [x, y] = q.shift()
		if (x === tx && y === ty) { found = true; break }
		for (const [dx, dy] of dirs) {
			const nx = x + dx, ny = y + dy
			if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue
			if (visited[ny][nx]) continue
			if (!isWalkable(nx, ny)) continue
			visited[ny][nx] = true
			parent.set(`${nx},${ny}`, `${x},${y}`)
			q.push([nx, ny])
		}
	}
	if (!found) return null
	// reconstruct path: from target back to source
	let cur = `${tx},${ty}`
	let prev = parent.get(cur)
	if (!prev) return null
	// walk back until the parent is the start
	while (prev && prev !== `${sx},${sy}`) {
		cur = prev
		prev = parent.get(cur)
	}
	if (!prev) return null
	const [firstX, firstY] = cur.split(',').map(Number)
	return [firstX - sx, firstY - sy]
}

// --- new helper: find nearest walkable tile to a target (returns [x,y] or null) ---
function findNearestAccessibleTile(tx, ty) {
	if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) return null
	const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
	const q = []
	q.push([tx, ty])
	visited[ty][tx] = true
	const dirs = [[1,0],[-1,0],[0,1],[0,-1]]
	while (q.length) {
		const [x, y] = q.shift()
		if (isWalkable(x, y)) return [x, y]
		for (const [dx, dy] of dirs) {
			const nx = x + dx, ny = y + dy
			if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue
			if (visited[ny][nx]) continue
			visited[ny][nx] = true
			q.push([nx, ny])
		}
	}
	return null
}

// --- new helper: find BFS distance (in tiles) between two walkable tiles; Infinity if unreachable ---
function bfsDistance(sx, sy, tx, ty) {
	if (sx === tx && sy === ty) return 0
	if (!isWalkable(tx, ty) || sx < 0 || sx >= cols || sy < 0 || sy >= rows) return Infinity
	const dirs = [[1,0],[-1,0],[0,1],[0,-1]]
	const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
	const q = []
	q.push([sx, sy, 0])
	visited[sy][sx] = true
	while (q.length) {
		const [x, y, d] = q.shift()
		for (const [dx, dy] of dirs) {
			const nx = x + dx, ny = y + dy
			if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue
			if (visited[ny][nx]) continue
			if (!isWalkable(nx, ny)) continue
			if (nx === tx && ny === ty) return d + 1
			visited[ny][nx] = true
			q.push([nx, ny, d + 1])
		}
	}
	return Infinity
}

function step(deltaSeconds) {
	if (!ctx.value || !difficulty.value) return
	if (gameStatus.value !== 'running') return
	// Update Pac-Man with grid-aligned movement
	const moveTiles = pacman.speed * deltaSeconds
	const cx = Math.round(pacman.x)
	const cy = Math.round(pacman.y)
	// If there's a queued turn, try to perform it when Pac-Man is aligned on the perpendicular axis
	const distX = pacman.x - cx
	const distY = pacman.y - cy
	const nearCenterRadial = Math.hypot(distX, distY) < 0.46
	const nearCenterX = Math.abs(distX) < 0.5
	const nearCenterY = Math.abs(distY) < 0.5
	if (pacman.nextDirX !== 0 || pacman.nextDirY !== 0) {
		const ntx = cx + pacman.nextDirX
		const nty = cy + pacman.nextDirY
		const canWalk = isWalkable(ntx, nty)
		// allow turn if: near center radially, or aligned on perpendicular axis, or currently stopped
		const wantsHorizontal = pacman.nextDirX !== 0
		const wantsVertical = pacman.nextDirY !== 0
		const aligned = (wantsHorizontal && nearCenterY) || (wantsVertical && nearCenterX)
		if (canWalk && (nearCenterRadial || aligned || (pacman.dirX === 0 && pacman.dirY === 0))) {
			pacman.dirX = pacman.nextDirX
			pacman.dirY = pacman.nextDirY
			pacman.facing = pacman.nextFacing || pacman.facing
			pacman.nextDirX = 0; pacman.nextDirY = 0
		}
	}
	// Compute proposed next position and check adjacent tiles along the movement axis to avoid rounding edge cases
	const nextPX = pacman.x + pacman.dirX * moveTiles
	const nextPY = pacman.y + pacman.dirY * moveTiles
	const nextTileX = Math.round(nextPX)
	const nextTileY = Math.round(nextPY)
	let canMove = false
	if (pacman.dirX !== 0 || pacman.dirY !== 0) {
		if (pacman.dirX !== 0) {
			// moving horizontally: ensure both the tile at current row and the tile at nextPY row are walkable horizontally
			const rowA = Math.round(pacman.y)
			const rowB = Math.round(nextPY)
			canMove = isWalkable(nextTileX, rowA) && isWalkable(nextTileX, rowB)
		} else {
			// moving vertically: ensure both the tile at current column and the tile at nextPX column are walkable vertically
			const colA = Math.round(pacman.x)
			const colB = Math.round(nextPX)
			canMove = isWalkable(colA, nextTileY) && isWalkable(colB, nextTileY)
		}
	}
	if (canMove) {
		pacman.x = clamp(nextPX, 1, cols - 2)
		pacman.y = clamp(nextPY, 1, rows - 2)
	} else if (pacman.dirX !== 0 || pacman.dirY !== 0) {
		// Blocked: move back to tile center and stop to avoid slipping into walls
		pacman.x += Math.sign(cx - pacman.x) * Math.min(Math.abs(cx - pacman.x), moveTiles)
		pacman.y += Math.sign(cy - pacman.y) * Math.min(Math.abs(cy - pacman.y), moveTiles)
		if (Math.abs(pacman.x - cx) < 0.06 && Math.abs(pacman.y - cy) < 0.06) { pacman.x = cx; pacman.y = cy; pacman.dirX = 0; pacman.dirY = 0 }
	}
	// Eat pellet
	const ix = Math.round(pacman.x)
	const iy = Math.round(pacman.y)
	if (grid[iy] && grid[iy][ix] === 1) {
		grid[iy][ix] = 0
		store.dispatch('incrementScore', 10)
		pelletCount--
		if (pelletCount <= 0) {
			store.dispatch('setWon')
			store.dispatch('pauseGame')
		}
	}
	// Update ghosts (simple chase AI)
	for (const g of ghosts) {
		g.changeTimer -= deltaSeconds
		// At intersections or on timer, pick direction towards Pacman
		const cx = Math.round(g.x)
		const cy = Math.round(g.y)
		const atCenter = Math.abs(g.x - cx) < 0.28 && Math.abs(g.y - cy) < 0.28
		// Prefer to continue forward if possible; only pick new direction at center or when forward is blocked
		const forwardX = cx + g.dirX
		const forwardY = cy + g.dirY
		const forwardWalkable = isWalkable(forwardX, forwardY)

		// if Pac-Man is nearby (in tile units), force a re-evaluation so visual offsets don't hide him
		const nearPac = Math.hypot(pacman.x - g.x, pacman.y - g.y) < 6.0

		if (!forwardWalkable || g.changeTimer <= 0 || atCenter || nearPac) {
			// Try BFS to find a routed next step to Pac-Man
			// Attempt BFS toward Pac-Man's tile and its neighbors (3x3) so slight offsets don't hide Pac-Man
			let bfsStep = null
			const px = Math.round(pacman.x), py = Math.round(pacman.y)
			const candidates = []
			for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
				const tx = px + ox, ty = py + oy
				if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) continue
				// if the tile itself is walkable use it; otherwise find nearest accessible tile around it
				if (isWalkable(tx, ty)) {
					candidates.push([tx, ty])
				} else {
					const near = findNearestAccessibleTile(tx, ty)
					if (near) candidates.push(near)
				}
			}

			for (const [tx, ty] of candidates) {
				const stepDir = bfsNextStep(cx, cy, tx, ty)
				if (stepDir) { bfsStep = stepDir; break }
			}
			if (bfsStep && (bfsStep[0] !== -g.dirX || bfsStep[1] !== -g.dirY)) {
				g.dirX = bfsStep[0]; g.dirY = bfsStep[1]
			} else {
				// If pac-man is very close (within ~1.5 tiles), try a direct chase based on actual positions
				const dxTile = pacman.x - g.x
				const dyTile = pacman.y - g.y
				const distTiles = Math.hypot(dxTile, dyTile)
				if (distTiles <= 1.5) {
					// prefer the axis with larger absolute difference
					let candDir = [Math.sign(dxTile), 0]
					if (Math.abs(dyTile) > Math.abs(dxTile)) candDir = [0, Math.sign(dyTile)]
					// avoid immediate reverse if possible
					if (candDir[0] === -g.dirX && candDir[1] === -g.dirY) {
						// try the orthogonal axis
						candDir = candDir[0] === 0 ? [Math.sign(dxTile), 0] : [0, Math.sign(dyTile)]
					}
					// only commit if the tile ahead is walkable; otherwise fallback to normal options
					if (isWalkable(cx + candDir[0], cy + candDir[1])) {
						g.dirX = candDir[0]; g.dirY = candDir[1]
					} else {
						// fallback to original options selection
						const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ]
						const notReverse = (dx,dy) => !(dx === -g.dirX && dy === -g.dirY)
						let options = dirs.filter(([dx,dy]) => notReverse(dx,dy) && isWalkable(cx+dx, cy+dy))
						if (options.length === 0) options = dirs.filter(([dx,dy]) => isWalkable(cx+dx, cy+dy))
						options.sort((a,b) => {
							const ax = cx + a[0], ay = cy + a[1]
							const bx = cx + b[0], by = cy + b[1]
							const da = Math.abs(ax - px) + Math.abs(ay - py)
							const db = Math.abs(bx - px) + Math.abs(by - py)
							return da - db
						})
						const forwardOptionIdx = options.findIndex(o => o[0] === g.dirX && o[1] === g.dirY)
						let pick = null
						if (forwardOptionIdx >= 0) pick = options[forwardOptionIdx]
						else pick = options[0] || [g.dirX, g.dirY]
						g.dirX = pick[0]; g.dirY = pick[1]
					}
				} else {
					// original fallback behavior when not near Pac-Man
					const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ]
					const notReverse = (dx,dy) => !(dx === -g.dirX && dy === -g.dirY)
					let options = dirs.filter(([dx,dy]) => notReverse(dx,dy) && isWalkable(cx+dx, cy+dy))
					if (options.length === 0) options = dirs.filter(([dx,dy]) => isWalkable(cx+dx, cy+dy))
					// sort by real BFS distance to Pac-Man tile when possible
					options.sort((a,b) => {
						const ax = cx + a[0], ay = cy + a[1]
						const bx = cx + b[0], by = cy + b[1]
						const da = bfsDistance(ax, ay, px, py)
						const db = bfsDistance(bx, by, px, py)
						if (da === db) return (Math.abs(ax - px) + Math.abs(ay - py)) - (Math.abs(bx - px) + Math.abs(by - py))
						return da - db
					})
					const forwardOptionIdx = options.findIndex(o => o[0] === g.dirX && o[1] === g.dirY)
					let pick = null
					if (forwardOptionIdx >= 0) pick = options[forwardOptionIdx]
					else pick = options[0] || [g.dirX, g.dirY]
					g.dirX = pick[0]; g.dirY = pick[1]
				}
			}
			g.changeTimer = 0.5 + Math.random() * 1.0
		}
		const gMove = g.speed * deltaSeconds
		const gxNext = g.x + g.dirX * gMove
		const gyNext = g.y + g.dirY * gMove
		const gtx = Math.round(gxNext), gty = Math.round(gyNext)
		// Use same next-tile check as Pacman to avoid entering walls mid-step
		if (isWalkable(gtx, gty)) {
			g.x = clamp(gxNext, 1, cols - 2)
			g.y = clamp(gyNext, 1, rows - 2)
		} else {
			// try to pick a new direction next frame; if stuck, reverse
			g.dirX = -g.dirX; g.dirY = -g.dirY; g.changeTimer = 0
		}
		// Collision with Pacman
		// pixel-based collision: compare circle overlap using drawn sizes (includes ghost bob offset)
		{
			const pacPx = pacman.x * tileSize + tileSize / 2
			const pacPy = pacman.y * tileSize + tileSize / 2
			const ghostPx = g.x * tileSize + tileSize / 2
			const ghostPy = g.y * tileSize + tileSize / 2 + (g.bobOffset || 0)
			const dist = Math.hypot(ghostPx - pacPx, ghostPy - pacPy)
			const pacR = tileSize * 0.38
			const ghostR = (tileSize * 0.8) / 2
			// collision if circles overlap
			if (dist < pacR + ghostR) {
				store.dispatch('setLost')
				store.dispatch('pauseGame')
			}
		}
	}

	// Animation state updates: pacman mouth phase and ghost bob phases
	pacman.mouthPhase = (pacman.mouthPhase || 0) + deltaSeconds * 8
	pacman.mouth = Math.abs(Math.sin(pacman.mouthPhase)) // 0..1
	for (const g of ghosts) {
		g.bobPhase = (g.bobPhase || 0) + deltaSeconds * 6
		g.bobOffset = Math.sin(g.bobPhase) * 2.2
		// make pupils track pacman slightly (store for drawGhost)
		g.pupilOffsetX = clamp((pacman.x - g.x) * 0.08, -0.08, 0.08)
		g.pupilOffsetY = clamp((pacman.y - g.y) * 0.06, -0.06, 0.06)
	}
}

function draw() {
	const c = ctx.value
	if (!c) return
	// Background
	c.fillStyle = '#000'
	c.fillRect(0, 0, canvasWidth, canvasHeight)
	// Draw pellets and walls
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const cell = grid[y][x]
			const px = x * tileSize
			const py = y * tileSize
			if (cell === 2) {
				c.fillStyle = '#1e3a8a'
				c.fillRect(px, py, tileSize, tileSize)
			} else if (cell === 1) {
				c.fillStyle = '#ffeb3b'
				c.beginPath()
				c.arc(px + tileSize/2, py + tileSize/2, 3, 0, Math.PI * 2)
				c.fill()
			}
		}
	}
		// Draw Pac-Man as solid ball using consistent pixel center
		const radius = tileSize * 0.38
		const centerX = pacman.x * tileSize + tileSize/2
		const centerY = pacman.y * tileSize + tileSize/2
		// Pac-Man with animated mouth (wedge)
		const mouthOpen = pacman.mouth * 0.5 + 0.05 // radians range
		const facing = pacman.facing || 0
		// compute rotation from facing (0 = right, 1 = down, 2 = left, 3 = up)
		const angle = facing * Math.PI/2
		c.fillStyle = '#ffd54f'
		c.beginPath()
		c.moveTo(centerX, centerY)
		c.arc(centerX, centerY, radius, angle + mouthOpen, angle + Math.PI*2 - mouthOpen)
		c.closePath()
		c.fill()
		// Draw Ghosts using same center formula
		for (const g of ghosts) {
			const gx = g.x * tileSize + tileSize/2
			const gy = g.y * tileSize + tileSize/2 + (g.bobOffset || 0)
			drawGhost(c, gx, gy, tileSize * 0.8, g.color || '#ef5350', g)
		}
			// Debug markers: show logical tile center (white) and actual center (red cross) + offsets
			if (SHOW_DEBUG_CENTER) {
				const tileCenterX = Math.round(pacman.x) * tileSize + tileSize/2
				const tileCenterY = Math.round(pacman.y) * tileSize + tileSize/2
				const actualX = pacman.x * tileSize + tileSize/2
				const actualY = pacman.y * tileSize + tileSize/2
				// tile center (white)
				c.fillStyle = 'rgba(255,255,255,0.95)'
				c.beginPath(); c.arc(tileCenterX, tileCenterY, 3, 0, Math.PI*2); c.fill()
				// actual center (red cross)
				c.strokeStyle = 'rgba(255,0,0,0.95)'
				c.beginPath(); c.moveTo(actualX-6, actualY); c.lineTo(actualX+6, actualY); c.moveTo(actualX, actualY-6); c.lineTo(actualX, actualY+6); c.stroke()
				// numeric offsets
				const offX = (actualX - tileCenterX).toFixed(3)
				const offY = (actualY - tileCenterY).toFixed(3)
				c.fillStyle = '#fff'
				c.font = '12px monospace'
				c.fillText(`offX: ${offX}`, 6, canvasHeight - 28)
				c.fillText(`offY: ${offY}`, 6, canvasHeight - 12)
			}
	// Paused overlay
	if (paused.value) {
		c.fillStyle = 'rgba(0,0,0,0.5)'
		c.fillRect(0, 0, canvasWidth, canvasHeight)
	}
	// Win/Lose overlays
	if (gameStatus.value === 'won' || gameStatus.value === 'lost') {
		c.fillStyle = 'rgba(0,0,0,0.7)'
		c.fillRect(0, 0, canvasWidth, canvasHeight)
		c.fillStyle = '#ffeb3b'
		c.textAlign = 'center'
		c.font = '16px "Press Start 2P", cursive'
		c.fillText(gameStatus.value === 'won' ? 'YOU WIN!' : 'GAME OVER', canvasWidth/2, canvasHeight/2)
	}
}

function drawGhost(c, x, y, size, color) {
	const w = size
	const h = size * 0.9
	const left = x - w/2
	const top = y - h/2
	// Body
	c.fillStyle = color
	c.beginPath()
	c.moveTo(left, top + h*0.5)
	c.arc(x, top + h*0.5, w/2, Math.PI, 0) // head
	c.lineTo(left + w, top + h)
	// feet bumps
	const bumps = 4
	for (let i=bumps; i>0; i--) {
		const bx = left + (i-0.5) * (w/bumps)
		c.quadraticCurveTo(bx - w/(bumps*4), top + h*0.85, bx, top + h)
	}
	c.closePath()
	c.fill()
	// Eyes
	c.fillStyle = '#fff'
	const eyeOffsetX = w*0.18
	const eyeOffsetY = h*0.15
	c.beginPath(); c.arc(x - eyeOffsetX, top + h*0.5, w*0.08, 0, Math.PI*2); c.fill()
	c.beginPath(); c.arc(x + eyeOffsetX, top + h*0.5, w*0.08, 0, Math.PI*2); c.fill()
	c.fillStyle = '#000'
	c.beginPath(); c.arc(x - eyeOffsetX + w*0.02, top + h*0.5, w*0.03, 0, Math.PI*2); c.fill()
	c.beginPath(); c.arc(x + eyeOffsetX + w*0.02, top + h*0.5, w*0.03, 0, Math.PI*2); c.fill()
}

let lastTime = 0
function loop(ts) {
	if (!lastTime) lastTime = ts
	const delta = (ts - lastTime) / 1000
	lastTime = ts
	if (!paused.value) step(delta)
	draw()
	animationId = requestAnimationFrame(loop)
}

onMounted(() => {
	initGame()
	window.addEventListener('keydown', handleKey)
	animationId = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
	window.removeEventListener('keydown', handleKey)
	cancelAnimationFrame(animationId)
})

// Reinitialize when difficulty or new game requested
watch([difficulty, gameVersion], () => {
	initGame()
})
</script>

<style scoped>
.game {
	position: relative;
	min-height: 100vh;
	background: #000;
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
	font-family: 'Press Start 2P', cursive;
}
.board {
	border: 4px solid #fdd835;
	box-shadow: 0 0 0 4px #000, 0 0 24px rgba(253, 216, 53, 0.35);
}
.hud {
	position: absolute;
	top: 16px;
	left: 16px;
	right: 16px;
	display: flex;
	align-items: center;
	justify-content: space-between;
}
.menu {
	background: #fdd835;
	color: #111;
	border: none;
	padding: 10px 14px;
	border-radius: 10px;
	box-shadow: 3px 3px 0 #000;
	cursor: pointer;
}
.score {
	margin-left: auto;
	color: #ffeb3b;
	text-shadow: 2px 2px 0 #000;
}
.score.paused { opacity: 0.7 }
.menu-panel {
	position: absolute;
	top: 56px;
	left: 16px;
	display: flex;
	flex-direction: column;
	gap: 8px;
	background: #111;
	border: 2px solid #fdd835;
	padding: 12px;
	border-radius: 8px;
}
.menu-panel button {
	font-family: 'Press Start 2P', cursive;
	font-size: 12px;
	background: #222;
	color: #fdd835;
	border: 1px solid #fdd835;
	padding: 8px 10px;
	cursor: pointer;
}
.overlay {
	position: absolute;
	bottom: 16px;
	left: 50%;
	transform: translateX(-50%);
	color: #fff;
	opacity: 0.8;
}
</style>


