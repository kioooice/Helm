function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSensitiveText(
  value: string,
  explicitSecrets: Array<string | null | undefined> = []
) {
  let redacted = value
  const secrets = Array.from(
    new Set(
      explicitSecrets
        .map((secret) => secret?.trim())
        .filter((secret): secret is string => Boolean(secret))
    )
  )
    .filter((secret) => secret.length >= 4)
    .sort((left, right) => right.length - left.length)

  secrets.forEach((secret) => {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted-secret]')
  })

  redacted = redacted
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted-secret]')
    .replace(/\b(sk|ghp|xox[baprs])[-_A-Za-z0-9]{8,}\b/gi, '$1-[redacted-secret]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|token)(\s*[:=]\s*|["']\s*:\s*["']?)([A-Za-z0-9._~+/=-]{8,})/gi,
      '$1$2[redacted-secret]'
    )

  return redacted
}
