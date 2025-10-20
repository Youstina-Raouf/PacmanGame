import { createStore } from 'vuex'

const difficultyToGhosts = {
	easy: 2,
	medium: 3,
	hard: 5,
}

const store = createStore({
	state: {  /*Holds the global state of the game*/
		selectedDifficulty: null,
		ghostCount: 0,
		score: 0,
		paused: false,
		gameVersion: 0,
		gameStatus: 'idle', // idle | running | won | lost
	},
	mutations: {   /*Mutations change the state*/
		setDifficulty(state, difficulty) {
			state.selectedDifficulty = difficulty
			state.ghostCount = difficultyToGhosts[difficulty]
		},
		setPaused(state, value) {
			state.paused = value
		},
		addScore(state, delta) {
			state.score += delta
		},
		resetGame(state) {
			state.score = 0
			state.paused = false
			state.gameVersion += 1
			state.gameStatus = 'running'
		},
		setGameStatus(state, status) { state.gameStatus = status },
	},
	actions: {  /*functions that can be async and call mutations*/
		chooseDifficulty({ commit }, difficulty) {
			commit('setDifficulty', difficulty)
		},
		pauseGame({ commit }) { commit('setPaused', true) },
		resumeGame({ commit }) { commit('setPaused', false) },
		togglePause({ state, commit }) { commit('setPaused', !state.paused) },
		newGame({ commit }) { commit('resetGame') },
		setWon({ commit }) { commit('setGameStatus', 'won') },
		setLost({ commit }) { commit('setGameStatus', 'lost') },
		incrementScore({ commit }, delta) { commit('addScore', delta) },
	},
	getters: {
		ghostCount: (state) => state.ghostCount,
		selectedDifficulty: (state) => state.selectedDifficulty,
		score: (state) => state.score,
		paused: (state) => state.paused,
		gameVersion: (state) => state.gameVersion,
		gameStatus: (state) => state.gameStatus,
	},
})

export default store


