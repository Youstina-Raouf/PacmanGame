<template>
	<div class="home">
	  <h1 class="title">PACMAN</h1>
	  <div class="levels">
		<button class="level easy" @click="select('easy')">Easy</button>
		<button class="level medium" @click="select('medium')">Medium</button>
		<button class="level hard" @click="select('hard')">Hard</button>
	  </div>
	</div>
  </template>
  
  <script setup>
  import { useRouter } from 'vue-router'
  import { useStore } from 'vuex'
  
  const router = useRouter()
  const store = useStore()
  
  function select(level) {
	store.dispatch('chooseDifficulty', level)
	router.push({ name: 'game' })
  }
  </script>
  
  <style>
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
  
  /* 🎮 Overall Layout */
  .home {
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	min-height: 100vh;
	background-color: #222;
	color: #ffeaa7; /* pastel yellow */
  }
  
  /* 🟨 Title */
  .title {
	font-family: 'Press Start 2P', cursive;
	font-size: 3.5rem;
	color:#fdd835;
	text-shadow: 3px 3px 0 #000, -3px -3px 0 #000;
	margin-bottom: 2.5rem;
	letter-spacing: 4px;
  }
  
  /* 🕹️ Levels Layout */
  .levels {
	display: flex;
	flex-direction: row;
	gap: 2rem;
  }
  
  /* 🎯 Level Buttons */
  .level {
	font-family: 'Press Start 2P', cursive;
	font-size: 0.9rem;
	background: #fdd835;
	color: #111;
	padding: 1rem 2rem;
	border: none;
	border-radius: 12px; /* softer rounded corners */
	box-shadow: 4px 4px 0 #000;
	cursor: pointer;
	transition: transform 0.1s ease-in-out, box-shadow 0.1s ease-in-out;
	min-width: 200px;
  }
  
  .level:hover {
	transform: translateY(-4px);
	box-shadow: 6px 6px 0 #000;
  }
  
  .level:active {
	transform: translateY(2px);
	box-shadow: 2px 2px 0 #000;
  }
  
  .level.active {
	background: #ffdf70;
	outline: 2px solid #fff;
  }
  </style>
  