/*create a router instance for your app.*/
/*uses hash-based URLs*/
import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
	{ path: '/', name: 'home', component: () => import('../views/Home.vue') },
	{ path: '/game', name: 'game', component: () => import('../views/Game.vue') },
]

const router = createRouter({
	history: createWebHashHistory(),
	routes,
})

export default router


