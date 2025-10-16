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
const MAZE = [
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
const rows = MAZE.length
const cols = MAZE[0].length
const canvasWidth = cols * tileSize
const canvasHeight = rows * tileSize

let animationId = 0

// Grid: 0 empty, 1 pellet, 2 wall
let grid = [] // 0 empty, 1 pellet, 2 wall
let pelletCount = 0
let pacman = { x: 1, y: 1, dirX: 1, dirY: 0, speed: 7, facing: 0 } // facing: 0 right,1 down,2 left,3 up
let ghosts = []

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
	pacman.dirX = 1; pacman.dirY = 0; pacman.facing = 0; pacman.mouth = 0
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
	const cx = Math.round(pacman.x)
	const cy = Math.round(pacman.y)
	const aligned = Math.abs(pacman.x - cx) < 0.1 && Math.abs(pacman.y - cy) < 0.1
	if (!aligned) return
	const nx = cx + dx
	const ny = cy + dy
	if (grid[ny] && grid[ny][nx] !== 2) {
		pacman.dirX = dx
		pacman.dirY = dy
		pacman.facing = face
	}
}

// Helpers
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)) }

function step(deltaSeconds) {
	if (!ctx.value || !difficulty.value) return
	if (gameStatus.value !== 'running') return
	// Update Pac-Man with grid-aligned movement
	const moveTiles = pacman.speed * deltaSeconds
	const cx = Math.round(pacman.x)
	const cy = Math.round(pacman.y)
	const targetX = cx + pacman.dirX
	const targetY = cy + pacman.dirY
	const blocked = pacman.dirX !== 0 || pacman.dirY !== 0 ? (grid[targetY] && grid[targetY][targetX] === 2) : false
	if (blocked) {
		// Move back to tile center then stop
		pacman.x += Math.sign(cx - pacman.x) * Math.min(Math.abs(cx - pacman.x), moveTiles)
		pacman.y += Math.sign(cy - pacman.y) * Math.min(Math.abs(cy - pacman.y), moveTiles)
		if (Math.abs(pacman.x - cx) < 0.05 && Math.abs(pacman.y - cy) < 0.05) { pacman.x = cx; pacman.y = cy; pacman.dirX = 0; pacman.dirY = 0 }
	} else {
		pacman.x = clamp(pacman.x + pacman.dirX * moveTiles, 1, cols - 2)
		pacman.y = clamp(pacman.y + pacman.dirY * moveTiles, 1, rows - 2)
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
		const atCenter = Math.abs(g.x - cx) < 0.1 && Math.abs(g.y - cy) < 0.1
		if (g.changeTimer <= 0 || atCenter) {
			const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ]
			const notReverse = (dx,dy) => !(dx === -g.dirX && dy === -g.dirY)
			const options = dirs.filter(([dx,dy]) => notReverse(dx,dy) && grid[cy+dy] && grid[cy+dy][cx+dx] !== 2)
			options.sort((a,b) => {
				const ax = cx + a[0], ay = cy + a[1]
				const bx = cx + b[0], by = cy + b[1]
				const da = Math.abs(ax - Math.round(pacman.x)) + Math.abs(ay - Math.round(pacman.y))
				const db = Math.abs(bx - Math.round(pacman.x)) + Math.abs(by - Math.round(pacman.y))
				return da - db
			})
			const pick = options[0] || [g.dirX, g.dirY]
			g.dirX = pick[0]; g.dirY = pick[1]
			g.changeTimer = 0.5 + Math.random() * 1.0
		}
		const gMove = g.speed * deltaSeconds
		const gxNext = g.x + g.dirX * gMove
		const gyNext = g.y + g.dirY * gMove
		const gtx = Math.round(gxNext), gty = Math.round(gyNext)
		if (grid[gty] && grid[gty][gtx] !== 2) {
			g.x = clamp(gxNext, 1, cols - 2)
			g.y = clamp(gyNext, 1, rows - 2)
		} else {
			g.dirX = -g.dirX; g.dirY = -g.dirY; g.changeTimer = 0
		}
		// Collision with Pacman
		if (Math.hypot(g.x - pacman.x, g.y - pacman.y) < 0.6) {
			store.dispatch('setLost')
			store.dispatch('pauseGame')
		}
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
	// Draw Pac-Man as solid ball
	const radius = tileSize * 0.38
	const centerX = pacman.x * tileSize
	const centerY = pacman.y * tileSize
	c.fillStyle = '#ffd54f'
	c.beginPath()
	c.arc(centerX, centerY, radius, 0, Math.PI * 2)
	c.fill()
	// Draw Ghosts
	for (const g of ghosts) {
		drawGhost(c, g.x * tileSize, g.y * tileSize, tileSize * 0.8, g.color || '#ef5350')
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
	c.fillStyle = '#1e3a8a'
	c.beginPath(); c.arc(x - eyeOffsetX + w*0.03, top + h*0.5, w*0.04, 0, Math.PI*2); c.fill()
	c.beginPath(); c.arc(x + eyeOffsetX + w*0.03, top + h*0.5, w*0.04, 0, Math.PI*2); c.fill()
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


