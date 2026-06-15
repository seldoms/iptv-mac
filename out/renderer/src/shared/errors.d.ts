export type AppErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'TIMEOUT' | 'PARSE_ERROR' | 'DATABASE_ERROR' | 'UNSUPPORTED' | 'INTERNAL_ERROR';
export declare class AppError extends Error {
    readonly code: AppErrorCode;
    readonly publicMessage: string;
    constructor(code: AppErrorCode, publicMessage: string, options?: {
        cause?: unknown;
        internalMessage?: string;
    });
}
export declare function toPublicErrorMessage(error: unknown, fallback?: string): string;
export declare function getInternalErrorMessage(error: unknown): string;
