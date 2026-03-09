import { useEffect, useMemo, useRef, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001'
const STORAGE_KEY = 'communicator_auth'
const OUTBOX_KEY = 'communicator_outbox'
const UNREAD_KEY = 'communicator_unread'
const LAST_READ_KEY = 'communicator_last_read'
const CHAT_HASH_PREFIX = '#/chat/'
const SESSION_EXPIRED_MESSAGE = 'Session expired or user missing. Please sign in again.'
const PRESENCE_PING_MS = 10000

function loadAuth() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function saveAuth(auth) {
  if (auth) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

function loadOutbox() {
  const raw = localStorage.getItem(OUTBOX_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(OUTBOX_KEY)
    return []
  }
}

function saveOutbox(items) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
}

function loadUnread() {
  const raw = localStorage.getItem(UNREAD_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(UNREAD_KEY)
    return {}
  }
}

function saveUnread(map) {
  localStorage.setItem(UNREAD_KEY, JSON.stringify(map))
}

function loadLastRead() {
  const raw = localStorage.getItem(LAST_READ_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    localStorage.removeItem(LAST_READ_KEY)
    return {}
  }
}

function saveLastRead(map) {
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map))
}

function getChatIdFromHash() {
  const hash = window.location.hash || ''
  if (!hash.startsWith(CHAT_HASH_PREFIX)) return null
  const candidate = hash.slice(CHAT_HASH_PREFIX.length)
  return candidate.length > 0 ? candidate : null
}

function setChatHash(userId) {
  window.location.hash = `${CHAT_HASH_PREFIX}${userId}`
}

function clearChatHash() {
  if (window.location.hash) {
    window.location.hash = '#/'
  }
}

function getDisplayNameFromMessage(message, userId) {
  if (!message || !userId) return ''
  if (message.fromUserId === userId) return message.fromUserName || ''
  if (message.toUserId === userId) return message.toUserName || ''
  return ''
}

async function apiRequest(path, options = {}, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  })

  if (!response.ok) {
    if (response.status === 401) {
      const error = new Error('Unauthorized')
      error.code = 401
      error.status = 401
      throw error
    }
    const body = await response.text()
    const error = new Error(body || response.statusText)
    error.status = response.status
    throw error
  }

  return response.status === 204 ? null : response.json()
}

export default function App() {
  const [auth, setAuth] = useState(loadAuth)
  const [mode, setMode] = useState('login')
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [userNameError, setUserNameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [toasts, setToasts] = useState([])
  const [online, setOnline] = useState(navigator.onLine)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersRefreshing, setUsersRefreshing] = useState(false)
  const [threadRefreshing, setThreadRefreshing] = useState(false)
  const [lastUsersRefresh, setLastUsersRefresh] = useState(null)
  const [lastThreadRefresh, setLastThreadRefresh] = useState(null)
    const [scrollTop, setScrollTop] = useState(0)
  const [activeChatId, setActiveChatId] = useState(getChatIdFromHash)
  const [thread, setThread] = useState([])
  const [threadStatus, setThreadStatus] = useState('')
  const [messageText, setMessageText] = useState('')
  const [threadLoading, setThreadLoading] = useState(false)
  const [outbox, setOutbox] = useState(loadOutbox)
  const [lastMessageByUser, setLastMessageByUser] = useState({})
  const [unreadByUser, setUnreadByUser] = useState(loadUnread)
  const [lastReadByUser, setLastReadByUser] = useState(loadLastRead)
  const [hubConnected, setHubConnected] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const chatEndRef = useRef(null)
  const hubRef = useRef(null)
  const activeChatIdRef = useRef(activeChatId)
  const authRef = useRef(auth)
  const outboxRef = useRef(outbox)
  const lastReadRef = useRef(lastReadByUser)
  const toastTimerRef = useRef(null)
  const toastTimersByMessageRef = useRef({})
  const toastByMessageRef = useRef(new Map())
  const toastsRef = useRef(toasts)
  const userNameRef = useRef(null)
  const passwordRef = useRef(null)

  useEffect(() => {
    saveAuth(auth)
  }, [auth])

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  useEffect(() => {
    authRef.current = auth
  }, [auth])

  useEffect(() => {
    outboxRef.current = outbox
  }, [outbox])

  useEffect(() => {
    lastReadRef.current = lastReadByUser
  }, [lastReadByUser])

  useEffect(() => {
    toastsRef.current = toasts
  }, [toasts])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        toastTimerRef.current.forEach((timer) => clearTimeout(timer))
      }
      Object.values(toastTimersByMessageRef.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  useEffect(() => {
    if (!auth) return

    const connection = new HubConnectionBuilder()
      .withUrl(`${API_BASE}/hub/chat`, {
        accessTokenFactory: () => auth.token,
        withCredentials: false,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()

    connection.on('message', (message) => {
      const currentAuth = authRef.current
      if (!currentAuth) return

      const otherUserId = message.fromUserId === currentAuth.userId
        ? message.toUserId
        : message.fromUserId

      setLastMessageByUser((prev) => ({
        ...prev,
        [otherUserId]: message,
      }))

      const currentChatId = activeChatIdRef.current
      if (currentChatId && otherUserId === currentChatId) {
        upsertMessage(message)
        setUnreadByUser((prev) => ({ ...prev, [otherUserId]: 0 }))
        setLastReadByUser((prev) => ({ ...prev, [otherUserId]: new Date().toISOString() }))
      } else if (message.fromUserId !== currentAuth.userId) {
        const lastRead = lastReadRef.current[otherUserId]
        if (!lastRead || new Date(message.sentAtUtc) > new Date(lastRead)) {
          setUnreadByUser((prev) => ({ ...prev, [otherUserId]: (prev[otherUserId] || 0) + 1 }))
        }
      }
    })

    connection.on('presence', (userIds) => {
      if (!Array.isArray(userIds)) return
      setOnlineUsers(new Set(userIds))
    })

    connection.onreconnecting(() => setHubConnected(false))
    connection.onreconnected(() => setHubConnected(true))
    connection.onclose(() => setHubConnected(false))

    connection.start()
      .then(async () => {
        setHubConnected(true)
        try {
          const presence = await apiRequest('/presence', {}, auth.token)
          if (Array.isArray(presence)) {
            setOnlineUsers(new Set(presence))
          }
        } catch {
          // ignore presence fetch errors
        }
      })
      .catch(() => {
        setHubConnected(false)
      })

    hubRef.current = connection

    return () => {
      hubRef.current = null
      connection.stop().catch(() => {})
    }
  }, [auth])

  useEffect(() => {
    if (!auth) return

    const interval = setInterval(async () => {
      try {
        await apiRequest('/presence/ping', { method: 'POST' }, auth.token)
        const presence = await apiRequest('/presence', {}, auth.token)
        if (Array.isArray(presence)) {
          setOnlineUsers(new Set(presence))
        }
      } catch (error) {
        if (error.code === 401) {
          handleLogout(SESSION_EXPIRED_MESSAGE)
        }
      }
    }, PRESENCE_PING_MS)

    return () => clearInterval(interval)
  }, [auth])

  useEffect(() => {
    saveOutbox(outbox)
  }, [outbox])

  useEffect(() => {
    saveUnread(unreadByUser)
  }, [unreadByUser])

  useEffect(() => {
    saveLastRead(lastReadByUser)
  }, [lastReadByUser])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!online || !auth) return
    flushOutbox()
  }, [online, auth])

  useEffect(() => {
    if (!auth || !online) return
    if (outboxRef.current.length === 0) return

    flushOutbox()
    const interval = setInterval(() => {
      if (outboxRef.current.length === 0) return
      flushOutbox()
    }, 5000)

    return () => clearInterval(interval)
  }, [auth, online])

  useEffect(() => {
    if (!auth) return
    validateAuth()
  }, [auth])

  useEffect(() => {
    const handleHashChange = () => {
      setActiveChatId(getChatIdFromHash())
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    if (!auth || !activeChatId) {
      setThread([])
      setThreadStatus('')
      setThreadLoading(false)
      return
    }

    let isActive = true
    const loadThread = async () => {
      setThreadLoading(true)
      setThreadStatus('')
      try {
        const data = await apiRequest(`/messages/thread/${activeChatId}`, {}, auth.token)
        if (isActive) {
          const deduped = dedupeMessages(data)
          const merged = mergeThreadWithOutbox(deduped, activeChatId)
          setThread(merged)
          if (data.length > 0) {
            const latest = merged[merged.length - 1]
            setLastMessageByUser((prev) => ({
              ...prev,
              [activeChatId]: latest,
            }))
          }
        }
      } catch (error) {
        if (error.code === 401) {
          handleLogout()
          return
        }
        if (isActive) {
          showToast(`Failed to load thread: ${error.message}`)
        }
      } finally {
        if (isActive) {
          setThreadLoading(false)
        }
      }
    }

    loadThread()

    return () => {
      isActive = false
    }
  }, [activeChatId, auth])

  useEffect(() => {
    if (!auth || !activeChatId || !online) return

    const interval = setInterval(() => {
      fetchThread(activeChatId)
    }, 4000)

    return () => clearInterval(interval)
  }, [activeChatId, auth, online])

  useEffect(() => {
    if (!auth || !online || hubConnected) return

    const interval = setInterval(() => {
      syncInbox()
    }, 6000)

    return () => clearInterval(interval)
  }, [auth, online, activeChatId, hubConnected])

  async function validateAuth() {
    try {
      await apiRequest('/auth/me', {}, auth.token)
      const presence = await apiRequest('/presence', {}, auth.token)
      if (Array.isArray(presence)) {
        setOnlineUsers(new Set(presence))
      }
      refreshUsersList()
      if (activeChatIdRef.current) {
        fetchThread(activeChatIdRef.current)
      }
      if (online) {
        flushOutbox()
      }
    } catch (error) {
      handleLogout(SESSION_EXPIRED_MESSAGE)
    }
  }

  async function fetchThread(userId) {
    if (!auth || !userId) return
    try {
    const data = await apiRequest(`/messages/thread/${userId}`, {}, auth.token)
      const deduped = dedupeMessages(data)
      const merged = mergeThreadWithOutbox(deduped, userId)
      setThread(merged)
      setLastThreadRefresh(new Date())
      if (merged.length > 0) {
        const latest = merged[merged.length - 1]
        setLastMessageByUser((prev) => ({
          ...prev,
          [userId]: latest,
        }))
        setLastReadByUser((prev) => ({ ...prev, [userId]: latest.sentAtUtc }))
      }
    } catch (error) {
      if (error.code === 401) {
        handleLogout('Session expired. Please sign in again.')
      }
    }
  }

  async function refreshUsersList() {
    try {
      setUsersRefreshing(true)
      setUsersLoading(true)
      const usersResponse = await apiRequest('/users', {}, auth.token)
      const filteredUsers = usersResponse.filter((u) => u.id !== auth.userId)
      setUsers(filteredUsers)
      setLastUsersRefresh(new Date())
      syncInbox()
    } catch (error) {
      if (error.code === 401) {
        handleLogout('Session expired. Please sign in again.')
        return
      }
      setStatus(`Failed to refresh users: ${error.message}`)
    } finally {
      setUsersLoading(false)
      setUsersRefreshing(false)
    }
  }

  async function refreshThread() {
    if (!activeChatId) return
    try {
      setThreadRefreshing(true)
      await fetchThread(activeChatId)
      setLastThreadRefresh(new Date())
      if (online) {
        flushOutbox()
      }
    } finally {
      setThreadRefreshing(false)
    }
  }

  async function handleAuth(event) {
    event.preventDefault()
    setStatus('')
    setUserNameError('')
    setPasswordError('')
    const trimmedUser = userName.trim()
    const trimmedPass = password.trim()

    if (!trimmedUser) {
      setUserNameError('Username is required.')
      userNameRef.current?.focus()
      return
    }

    if (!trimmedPass) {
      setPasswordError('Password is required.')
      passwordRef.current?.focus()
      return
    }

    if (trimmedPass.length < 4) {
      setPasswordError('Password must be at least 4 characters.')
      passwordRef.current?.focus()
      return
    }

    try {
      if (mode === 'register') {
        await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ userName: trimmedUser, password: trimmedPass }),
        })
      }

      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ userName: trimmedUser, password: trimmedPass }),
      })

      setAuth({ token: response.token, userId: response.userId, userName: response.userName })
      setUserName('')
      setPassword('')
    } catch (error) {
      showToast(`Auth failed: ${error.message}`)
    }
  }

  function handleLogout(message = '') {
    const safeMessage = typeof message === 'string' ? message : ''
    clearChatHash()
    setAuth(null)
    setUsers([])
    setSearch('')
    setStatus(safeMessage === SESSION_EXPIRED_MESSAGE ? '' : safeMessage)
    setActiveChatId(null)
    setThread([])
    setThreadStatus('')
    setMessageText('')
    setOutbox([])
    setLastMessageByUser({})
    setUnreadByUser({})
    setLastReadByUser({})
    localStorage.removeItem(OUTBOX_KEY)
    localStorage.removeItem(UNREAD_KEY)
    localStorage.removeItem(LAST_READ_KEY)
    if (safeMessage === SESSION_EXPIRED_MESSAGE) {
      showToast(safeMessage)
    }
  }

  function openChat(user) {
    setChatHash(user.id)
    setActiveChatId(user.id)
    setThread([])
    setThreadStatus('')
    setUnreadByUser((prev) => ({ ...prev, [user.id]: 0 }))
    setLastReadByUser((prev) => ({ ...prev, [user.id]: new Date().toISOString() }))
  }

  function closeChat() {
    clearChatHash()
    setActiveChatId(null)
    setThread([])
    setThreadStatus('')
    setMessageText('')
  }

  function isSameLogicalMessage(a, b) {
    if (a.clientMessageId && b.clientMessageId && a.clientMessageId === b.clientMessageId) return true
    if (a.id && b.id && a.id === b.id) return true
    if (a.content !== b.content) return false
    if ((a.fromUserId || '') !== (b.fromUserId || '')) return false
    if ((a.toUserId || '') !== (b.toUserId || '')) return false
    const timeA = a.sentAtUtc || a.createdAtUtc || ''
    const timeB = b.sentAtUtc || b.createdAtUtc || ''
    return timeA !== '' && timeA === timeB
  }

  function dedupeMessages(messages) {
    const unique = []
    messages.forEach((message) => {
      if (!unique.some((item) => isSameLogicalMessage(item, message))) {
        unique.push(message)
      }
    })
    return unique
  }

  function mergeThreadWithOutbox(messages, chatId) {
    const currentAuth = authRef.current
    const pendingOutbox = outboxRef.current
    if (!currentAuth || !chatId || pendingOutbox.length === 0) return messages

    const merged = [...messages]
    pendingOutbox
      .filter((item) => item.toUserId === chatId)
      .forEach((item) => {
        if (merged.some((message) => message.clientMessageId && message.clientMessageId === item.clientMessageId)) return
        merged.push({
          id: item.id,
          fromUserId: currentAuth.userId,
          toUserId: item.toUserId,
          content: item.content,
          sentAtUtc: item.createdAtUtc,
          clientMessageId: item.clientMessageId,
          queued: true,
        })
      })

    return merged
  }

  function upsertMessage(message) {
    setThread((prev) => {
      let replaced = false
      const next = prev.map((item) => {
        if (item.queued && message.clientMessageId && item.clientMessageId === message.clientMessageId) {
          replaced = true
          return message
        }
        return item
      })

      if (replaced) return next
      if (next.some((item) => isSameLogicalMessage(item, message))) return next
      return [...next, message]
    })
  }

  async function handleSendMessage(event) {
    event.preventDefault()
    if (!activeChatId || !messageText.trim()) return

    const content = messageText.trim()
    const clientMessageId = crypto.randomUUID()
    setMessageText('')
    setThreadStatus('')

    const queuedMessage = {
      id: `queued-${crypto.randomUUID()}`,
      toUserId: activeChatId,
      content,
      clientMessageId,
      createdAtUtc: new Date().toISOString(),
    }

    if (!navigator.onLine) {
      setOutbox((prev) => [...prev, queuedMessage])
      if (activeChatId === queuedMessage.toUserId) {
        upsertMessage({
          id: queuedMessage.id,
          fromUserId: auth.userId,
          toUserId: queuedMessage.toUserId,
          content: queuedMessage.content,
          sentAtUtc: queuedMessage.createdAtUtc,
          clientMessageId: queuedMessage.clientMessageId,
          queued: true,
        })
      }
      showToast('Offline: message queued and will send when back online.')
      return
    }

    try {
      const message = await apiRequest(
        '/messages',
        {
          method: 'POST',
          body: JSON.stringify({ toUserId: activeChatId, content, clientMessageId }),
        },
        auth.token,
      )
      upsertMessage(message)
      setLastMessageByUser((prev) => ({
        ...prev,
        [activeChatId]: message,
      }))
    } catch (error) {
      if (error.code === 401) {
        handleLogout('Session expired. Please sign in again.')
        return
      }
      setOutbox((prev) => [...prev, queuedMessage])
      if (activeChatId === queuedMessage.toUserId) {
        upsertMessage({
          id: queuedMessage.id,
          fromUserId: auth.userId,
          toUserId: queuedMessage.toUserId,
          content: queuedMessage.content,
          sentAtUtc: queuedMessage.createdAtUtc,
          clientMessageId: queuedMessage.clientMessageId,
          queued: true,
        })
      }
      setThreadStatus('Send failed: message queued for retry.')
    }
  }

  async function flushOutbox() {
    const currentAuth = authRef.current
    const pendingOutbox = outboxRef.current
    if (!currentAuth || pendingOutbox.length === 0) return

    const pending = [...pendingOutbox]
    const remaining = []

    for (const item of pending) {
      try {
        const message = await apiRequest(
          '/messages',
          {
            method: 'POST',
            body: JSON.stringify({ toUserId: item.toUserId, content: item.content, clientMessageId: item.clientMessageId }),
          },
          currentAuth.token,
        )
        if (item.toUserId === activeChatIdRef.current) {
          upsertMessage(message)
        }
        setLastMessageByUser((prev) => ({
          ...prev,
          [item.toUserId]: message,
        }))
        if (item.clientMessageId) {
          setOutbox((prev) => prev.filter((queued) => queued.clientMessageId !== item.clientMessageId))
        } else {
          setOutbox((prev) => prev.filter((queued) => queued.id !== item.id))
        }
      } catch (error) {
        if (error.code === 401) {
          handleLogout('Session expired. Please sign in again.')
          return
        }
        if (error.status === 400 || error.status === 404) {
          showToast('Queued message dropped: recipient not found.')
          continue
        }
        remaining.push(item)
      }
    }

    setOutbox(remaining)
  }

  async function syncInbox() {
    if (!auth) return
    try {
      const inbox = await apiRequest('/messages/inbox', {}, auth.token)
      const latestByUser = {}
      const unreadCounts = {}

      inbox.forEach((message) => {
        const fromUserId = message.fromUserId
        const currentLatest = latestByUser[fromUserId]
        if (!currentLatest || new Date(message.sentAtUtc) > new Date(currentLatest.sentAtUtc)) {
          latestByUser[fromUserId] = message
        }
      })

      Object.entries(latestByUser).forEach(([userId, message]) => {
        setLastMessageByUser((prev) => ({
          ...prev,
          [userId]: message,
        }))
      })

      inbox.forEach((message) => {
        const fromUserId = message.fromUserId
        if (activeChatIdRef.current === fromUserId) return
        const lastRead = lastReadByUser[fromUserId]
        if (!lastRead || new Date(message.sentAtUtc) > new Date(lastRead)) {
          unreadCounts[fromUserId] = (unreadCounts[fromUserId] || 0) + 1
        }
      })

      setUnreadByUser(() => ({ ...unreadCounts }))
    } catch (error) {
      if (error.code === 401) {
        handleLogout('Session expired. Please sign in again.')
      }
    }
  }

  function removeToastById(id) {
    const map = toastByMessageRef.current
    for (const [message, toast] of map.entries()) {
      if (toast.id === id) {
        map.delete(message)
        break
      }
    }
    setToasts(Array.from(map.values()))
  }

  function showToast(message) {
    if (!message) return
    const map = toastByMessageRef.current
    const existing = map.get(message)
    const id = existing?.id ?? crypto.randomUUID()
    map.set(message, { id, message })
    setToasts(Array.from(map.values()))

    if (!toastTimerRef.current) {
      toastTimerRef.current = []
    }
    const timers = toastTimersByMessageRef.current
    if (timers[message]) {
      clearTimeout(timers[message])
    }
    timers[message] = setTimeout(() => {
      map.delete(message)
      setToasts(Array.from(map.values()))
      delete timers[message]
    }, 5000)
  }

  const conversationUsers = useMemo(() => {
    const byId = new Map(users.map((user) => [user.id, user]))

    Object.entries(lastMessageByUser).forEach(([userId, message]) => {
      if (!userId || byId.has(userId)) return
      const userName = getDisplayNameFromMessage(message, userId)
      byId.set(userId, {
        id: userId,
        userName: userName || 'Unknown user',
      })
    })

    return Array.from(byId.values())
  }, [users, lastMessageByUser])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return conversationUsers
    return conversationUsers.filter((u) => u.userName.toLowerCase().includes(term))
  }, [conversationUsers, search])

  const orderedUsers = useMemo(() => {
    const withTime = filteredUsers.map((user) => ({
      user,
      lastTime: lastMessageByUser[user.id]
        ? new Date(lastMessageByUser[user.id].sentAtUtc).getTime()
        : 0,
    }))

    withTime.sort((a, b) => b.lastTime - a.lastTime)
    return withTime.map((item) => item.user)
  }, [filteredUsers, lastMessageByUser])

  const threadItems = useMemo(() => {
    if (!activeChatId) return thread
    const combined = [...thread]
    combined.sort((a, b) => {
      const timeA = new Date(a.sentAtUtc || a.createdAtUtc || 0).getTime()
      const timeB = new Date(b.sentAtUtc || b.createdAtUtc || 0).getTime()
      return timeA - timeB
    })
    return combined
  }, [activeChatId, thread])

  useEffect(() => {
    if (!activeChatId || threadItems.length === 0) return
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [threadItems, activeChatId])

  function getUserPreview(userId) {
    if (userId === activeChatId && thread.length > 0) {
      return thread[thread.length - 1]
    }
    const queued = outbox
      .filter((item) => item.toUserId === userId)
      .sort((a, b) => new Date(b.createdAtUtc) - new Date(a.createdAtUtc))[0]
    const lastMessage = lastMessageByUser[userId] || null
    if (!queued) return lastMessage
    if (!lastMessage) {
      return {
        id: queued.id,
        content: queued.content,
        sentAtUtc: queued.createdAtUtc,
        queued: true,
      }
    }
    const queuedTime = new Date(queued.createdAtUtc).getTime()
    const lastTime = new Date(lastMessage.sentAtUtc).getTime()
    if (queuedTime > lastTime) {
      return {
        ...lastMessage,
        id: queued.id,
        content: queued.content,
        sentAtUtc: queued.createdAtUtc,
        queued: true,
      }
    }
    return lastMessage
  }

  const itemHeight = 74
  const viewportHeight = 520
  const totalHeight = orderedUsers.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 4)
  const visibleCount = Math.ceil(viewportHeight / itemHeight) + 8
  const endIndex = Math.min(orderedUsers.length, startIndex + visibleCount)
  const visibleUsers = orderedUsers.slice(startIndex, endIndex)
  const activeUser = conversationUsers.find((user) => user.id === activeChatId) || null

  if (!auth) {
    return (
      <div className="app">
        <header>
          <h1>TheDevTeam Communicator</h1>
          <p>Simple demo for secure-ish messaging.</p>
        </header>
        <form className="card" onSubmit={handleAuth}>
          <h2>{mode === 'login' ? 'Login' : 'Register'}</h2>
          <label>
            Username
            <input
              ref={userNameRef}
              value={userName}
              onChange={(e) => {
                setUserName(e.target.value)
                if (userNameError) setUserNameError('')
              }}
            />
            {userNameError && <span className="field-error">{userNameError}</span>}
          </label>
          <label>
            Password
            <input
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (passwordError) setPasswordError('')
              }}
            />
            {passwordError && <span className="field-error">{passwordError}</span>}
          </label>
          <button type="submit">{mode === 'login' ? 'Login' : 'Register + Login'}</button>
          <button type="button" className="secondary" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            Switch to {mode === 'login' ? 'Register' : 'Login'}
          </button>
          {status && <p className="status">{status}</p>}
        </form>
        {toasts.length > 0 && (
          <div className="toast-stack" role="status" aria-live="polite">
            {toasts.map((toast) => (
              <div className="toast error" key={toast.id}>
                <span>{toast.message}</span>
                <button
                  type="button"
                  className="toast-close"
                  aria-label="Dismiss notification"
                  onClick={() => removeToastById(toast.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="nav-bar">
        <div className="nav-left">
          <h1>TheDevTeam Communicator</h1>
          <div className="nav-meta">
            <span className="nav-pill">Signed in as {auth.userName}</span>
          </div>
        </div>
        <nav className="nav-right" aria-label="App actions">
          <div className="nav-actions">
            <span className={`pill ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
            <button className="secondary" onClick={() => handleLogout()}>Logout</button>
          </div>
        </nav>
      </header>

      <main className={`single ${activeChatId ? 'split' : ''}`}>
        <section className={`card users-card ${activeChatId ? 'compact' : ''}`}>
          <div className="users-header">
            <div>
              <h2>Users</h2>
            </div>
            <div className="right">
              {lastUsersRefresh && (
                <span className="refresh-meta">Last refresh: {lastUsersRefresh.toLocaleTimeString()}</span>
              )}
              <button
                type="button"
                className="secondary small icon-button"
                onClick={refreshUsersList}
                disabled={usersRefreshing}
                aria-label="Refresh users"
                title="Refresh users"
              >
                {usersRefreshing ? (
                  <svg className="refresh-icon spinning" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.35-5.65l-1.65 1.65H21V3l-1.9 1.9A10 10 0 1 0 22 12h-2z" />
                  </svg>
                ) : (
                  <svg className="refresh-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.35-5.65l-1.65 1.65H21V3l-1.9 1.9A10 10 0 1 0 22 12h-2z" />
                  </svg>
                )}
              </button>
              <div className="queue-pill">{orderedUsers.length} users</div>
            </div>
          </div>
          <input
            className="search"
            placeholder="Search users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div
            className="users-table"
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: totalHeight }}>
              <div style={{ transform: `translateY(${startIndex * itemHeight}px)` }}>
                {usersLoading && (
                  <div className="skeleton-list" aria-hidden="true">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div className="skeleton-user" key={`user-skel-${index}`}>
                        <div className="skeleton-avatar" />
                        <div className="skeleton-lines">
                          <div className="skeleton-line short" />
                          <div className="skeleton-line" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {visibleUsers.length === 0 && (
                  <div className="empty">No users found.</div>
                )}
                {visibleUsers.map((user) => {
                  const preview = getUserPreview(user.id)
                  const isActive = onlineUsers.has(user.id)
                  return (
                  <button
                    type="button"
                    className={`user-row ${user.id === activeChatId ? 'active' : ''} ${unreadByUser[user.id] ? 'unread' : ''}`}
                    key={user.id}
                    onClick={() => openChat(user)}
                  >
                    <div className="avatar">
                      {user.userName.slice(0, 2).toUpperCase()}
                      <span
                        className={`presence-dot ${isActive ? 'online' : 'offline'}`}
                        aria-label={isActive ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className="user-info">
                      <div className="user-title">
                        <div className="user-name">{user.userName}</div>
                        {preview && (
                          <div className={`user-time ${preview.queued ? 'queued' : ''}`}>
                            {new Date(preview.sentAtUtc).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="user-preview">
                        {preview
                          ? `${preview.queued ? 'Queued · ' : ''}${preview.content}`
                          : 'No messages yet.'}
                      </div>
                    </div>
                    {unreadByUser[user.id] ? (
                      <div className="unread-badge">{unreadByUser[user.id]}</div>
                    ) : null}
                  </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        {activeChatId && (
          <section className="card chat-card">
            <div className="chat-header">
              <div>
                <h2>{activeUser ? activeUser.userName : 'Chat'}</h2>
              </div>
              <div className="right">
                {lastThreadRefresh && (
                  <span className="refresh-meta">Last refresh: {lastThreadRefresh.toLocaleTimeString()}</span>
                )}
                <button
                  type="button"
                  className="secondary small icon-button"
                  onClick={refreshThread}
                  disabled={threadRefreshing}
                  aria-label="Refresh chat"
                  title="Refresh chat"
                >
                  {threadRefreshing ? (
                  <svg className="refresh-icon spinning" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.35-5.65l-1.65 1.65H21V3l-1.9 1.9A10 10 0 1 0 22 12h-2z" />
                  </svg>
                ) : (
                  <svg className="refresh-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.35-5.65l-1.65 1.65H21V3l-1.9 1.9A10 10 0 1 0 22 12h-2z" />
                  </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="secondary close-button"
                  aria-label="Close chat"
                  onClick={closeChat}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="chat-thread">
              {threadLoading && (
                <div className="skeleton-thread" aria-hidden="true">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div className={`skeleton-bubble ${index % 2 === 0 ? 'left' : 'right'}`} key={`thread-skel-${index}`}>
                      <div className="skeleton-line" />
                      <div className="skeleton-line short" />
                    </div>
                  ))}
                </div>
              )}
              {!threadLoading && threadItems.length === 0 && (
                <div className="empty">No messages yet.</div>
              )}
              {threadItems.map((message) => {
                const isMine = message.fromUserId === auth.userId
                const isQueued = Boolean(message.queued)
                return (
                  <div key={message.id} className={`message-row ${isMine ? 'mine' : 'theirs'} ${isQueued ? 'queued' : ''}`}>
                    <div className={`message-bubble ${isQueued ? 'queued' : ''}`}>
                      <div className="message-text">{message.content}</div>
                      <div className={`message-time ${isQueued ? 'queued' : ''}`}>
                        {isQueued ? 'Queued · ' : ''}
                        {new Date(message.sentAtUtc).toLocaleString()}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>
            <form className="chat-input" onSubmit={handleSendMessage}>
              <textarea
                rows={2}
                placeholder="Type your message"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    handleSendMessage(event)
                  }
                }}
              />
              <button type="submit">Send</button>
            </form>
            {threadStatus && <p className="status">{threadStatus}</p>}
          </section>
        )}
      </main>

      {status && <p className="status">{status}</p>}
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div className="toast error" key={toast.id}>
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss notification"
                onClick={() => removeToastById(toast.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
