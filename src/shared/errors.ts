export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'DATABASE_ERROR'
  | 'UNSUPPORTED'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly publicMessage: string

  constructor(
    code: AppErrorCode,
    publicMessage: string,
    options?: { cause?: unknown; internalMessage?: string }
  ) {
    super(options?.internalMessage || publicMessage, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.publicMessage = publicMessage
  }
}

export function toPublicErrorMessage(
  error: unknown,
  fallback = '操作失败，请稍后重试'
): string {
  return error instanceof AppError ? error.publicMessage : fallback
}

export function getInternalErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
