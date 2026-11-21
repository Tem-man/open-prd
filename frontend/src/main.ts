import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { locale } from '@open-pencil/vue'
import './styles/variables.css'
import './style.css'
import '@prd-runtime/prd-content.css'
import App from './App.vue'
import router from './router/index'

const DESCRIPTIONS: Record<string, string> = {
  'zh-CN': 'Open PRD — AI 驱动的产品需求文档与原型设计工作台',
  en: 'Open PRD — An AI-powered workspace for product requirement documents and prototyping'
}

function syncDocumentLocale(code: string): void {
  const lang = code === 'zh-CN' ? 'zh-CN' : 'en'
  document.documentElement.lang = lang
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (meta) meta.content = DESCRIPTIONS[lang] ?? DESCRIPTIONS.en
}

syncDocumentLocale(locale.get())
locale.subscribe((code) => syncDocumentLocale(code))

createApp(App).use(createPinia()).use(router).mount('#app')
