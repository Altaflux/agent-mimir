import { createFileRoute } from '@tanstack/react-router'
import { ChatApp } from '../components/chat-app'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  return <ChatApp />
}
