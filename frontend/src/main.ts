import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/variables.css'
import './style.css'
import './styles/prd-content.scss'
import App from './App.vue'
import router from './router/index'

createApp(App).use(createPinia()).use(router).mount('#app')
