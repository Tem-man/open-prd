import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/variables.css'
import './style.css'
import '@prd-runtime/prd-content.css'
import App from './App.vue'
import router from './router/index'

createApp(App).use(createPinia()).use(router).mount('#app')
