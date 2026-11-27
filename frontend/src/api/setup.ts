/**
 * Setup API endpoints
 */
import axios from 'axios'
import { buildGatewayUrl } from './url'

// The first-run server prints a one-time token; the wizard must present it on
// every write so a wizard reachable over the network is not a free admin account.
const SETUP_TOKEN_STORAGE_KEY = 'zhijing_setup_token'
const SETUP_TOKEN_HEADER = 'X-Setup-Token'

let setupToken = ''

function readTokenFromQuery(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (new URLSearchParams(window.location.search).get('setup_token') || '').trim()
  } catch {
    return ''
  }
}

function readStoredToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return (window.sessionStorage.getItem(SETUP_TOKEN_STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

// Taking the token out of the address bar keeps the link from resurrecting a
// token the server rejected, and keeps the secret out of browser history.
function stripTokenFromQuery(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('setup_token')) return
    url.searchParams.delete('setup_token')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  } catch {
    // The token is already stored for this session, so a URL we cannot rewrite
    // is not a reason to fail.
  }
}

/**
 * Returns the active setup token, preferring a `?setup_token=` query parameter
 * (the link the server prints) over the one kept for this browser session.
 */
export function getSetupToken(): string {
  if (setupToken) return setupToken

  const fromQuery = readTokenFromQuery()
  if (fromQuery) {
    setSetupToken(fromQuery)
    stripTokenFromQuery()
    return setupToken
  }

  setupToken = readStoredToken()
  return setupToken
}

export function hasSetupToken(): boolean {
  return getSetupToken() !== ''
}

export function setSetupToken(token: string): void {
  setupToken = token.trim()
  if (typeof window === 'undefined') return
  try {
    if (setupToken) {
      window.sessionStorage.setItem(SETUP_TOKEN_STORAGE_KEY, setupToken)
    } else {
      window.sessionStorage.removeItem(SETUP_TOKEN_STORAGE_KEY)
    }
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still works.
  }
}

/**
 * Drops a token the server rejected so the wizard asks for it again instead of
 * keeping a value that can never work (a typo, or a token from a previous run).
 * Returns true when the request failed because of the token.
 */
export function clearRejectedSetupToken(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  if (status !== 401) return false

  setSetupToken('')
  return true
}

// Create a separate client for setup endpoints (not under /api/v1)
const setupClient = axios.create({
  baseURL: buildGatewayUrl('/').replace(/\/+$/, ''),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

setupClient.interceptors.request.use((config) => {
  const token = getSetupToken()
  if (token) {
    config.headers.set(SETUP_TOKEN_HEADER, token)
  }
  return config
})

export interface SetupStatus {
  needs_setup: boolean
  step: string
  requires_token?: boolean
}

export interface DatabaseConfig {
  host: string
  port: number
  user: string
  password: string
  dbname: string
  sslmode: string
}

export interface RedisConfig {
  host: string
  port: number
  username: string
  password: string
  db: number
  enable_tls: boolean
}

export interface AdminConfig {
  email: string
  password: string
}

export interface ServerConfig {
  host: string
  port: number
  mode: string
}

export interface InstallRequest {
  database: DatabaseConfig
  redis: RedisConfig
  admin: AdminConfig
  server: ServerConfig
}

export interface InstallResponse {
  message: string
  restart: boolean
}

/**
 * Get setup status
 */
export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await setupClient.get('/setup/status')
  return response.data.data
}

/**
 * Test database connection
 */
export async function testDatabase(config: DatabaseConfig): Promise<void> {
  await setupClient.post('/setup/test-db', config)
}

/**
 * Test Redis connection
 */
export async function testRedis(config: RedisConfig): Promise<void> {
  await setupClient.post('/setup/test-redis', config)
}

/**
 * Perform installation
 */
export async function install(config: InstallRequest): Promise<InstallResponse> {
  const response = await setupClient.post('/setup/install', config)
  return response.data.data
}
