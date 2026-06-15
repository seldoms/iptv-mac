const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|access[-_]?token|refresh[-_]?token|session|signature|sig|sign)$/i;
const SENSITIVE_QUERY = /([?&](?:api[-_]?key|token|access[-_]?token|auth|authorization|cookie|session|signature|sig|sign)=)[^&#\s]*/gi;
export function redactText(value) {
    return value
        .replace(SENSITIVE_QUERY, '$1[REDACTED]')
        .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/(^|\s)((?:Cookie|Set-Cookie|X-API-Key)\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]');
}
export function redactHeaders(headers) {
    if (!headers)
        return {};
    const redacted = {};
    for (const [key, value] of Object.entries(headers)) {
        redacted[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactText(String(value));
    }
    return redacted;
}
