import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Combina classes CSS de forma inteligente, resolvendo conflitos do Tailwind
 * @param inputs - Classes CSS para combinar
 * @returns String com classes combinadas
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formata bytes em formato legível
 * @param bytes - Número de bytes
 * @param decimals - Número de casas decimais (padrão: 2)
 * @returns String formatada (ex: "1.23 MB")
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * Debounce function para otimizar performance
 * @param func - Função para fazer debounce
 * @param wait - Tempo de espera em ms
 * @returns Função com debounce aplicado
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

/**
 * Capitaliza a primeira letra de uma string
 * @param str - String para capitalizar
 * @returns String capitalizada
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Trunca texto mantendo palavras completas
 * @param text - Texto para truncar
 * @param maxLength - Comprimento máximo
 * @returns Texto truncado
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  
  const truncated = text.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '...' : truncated + '...'
}

/**
 * Verifica se uma URL é válida
 * @param url - URL para validar
 * @returns true se válida, false caso contrário
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Gera um ID único simples
 * @returns String com ID único
 */
export function generateId(): string {
  return Math.random().toString(36).substr(2, 9)
}

/**
 * Converte string para slug (URL-friendly)
 * @param text - Texto para converter
 * @returns Slug gerado
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9\s-]/g, '') // Remove caracteres especiais
    .trim()
    .replace(/\s+/g, '-') // Substitui espaços por hífens
    .replace(/-+/g, '-') // Remove hífens múltiplos
}

/**
 * Pausa a execução por um tempo determinado
 * @param ms - Tempo em milissegundos
 * @returns Promise que resolve após o tempo especificado
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Clamp - limita um valor entre min e max
 * @param value - Valor a ser limitado
 * @param min - Valor mínimo
 * @param max - Valor máximo
 * @returns Valor limitado
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
