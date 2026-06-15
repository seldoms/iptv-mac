export class AppError extends Error {
    code;
    publicMessage;
    constructor(code, publicMessage, options) {
        super(options?.internalMessage || publicMessage, { cause: options?.cause });
        this.name = 'AppError';
        this.code = code;
        this.publicMessage = publicMessage;
    }
}
export function toPublicErrorMessage(error, fallback = '操作失败，请稍后重试') {
    return error instanceof AppError ? error.publicMessage : fallback;
}
export function getInternalErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
