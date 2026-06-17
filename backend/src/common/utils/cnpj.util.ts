const WEIGHTS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const WEIGHTS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

// Aceita numérico e alfanumérico (Receita Federal, vigente a partir de 06/07/2026).
// charCodeAt(0) - 48: '0'→0 … '9'→9, 'A'→17 … 'Z'→42
function charVal(c: string): number {
  return c.charCodeAt(0) - 48
}

function calcDv(base: string, weights: number[]): number {
  let sum = 0
  for (let i = 0; i < base.length; i++) {
    sum += charVal(base[i]) * weights[i]
  }
  const rem = sum % 11
  return rem < 2 ? 0 : 11 - rem
}

export function sanitizeCnpj(cnpj: string): string {
  return cnpj.replace(/[\s./-]/g, '').toUpperCase()
}

export function isValidCnpj(cnpj: string): boolean {
  const s = sanitizeCnpj(cnpj)

  if (s.length !== 14) return false

  // Primeiras 12 posições: [A-Z0-9]; últimas 2 (DVs): sempre numéricas
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(s)) return false

  // Rejeita sequências numéricas repetidas (ex: 00000000000000) — passa no módulo 11 mas não é CNPJ real
  if (/^(\d)\1{13}$/.test(s)) return false

  if (calcDv(s.slice(0, 12), WEIGHTS_DV1) !== Number(s[12])) return false
  if (calcDv(s.slice(0, 13), WEIGHTS_DV2) !== Number(s[13])) return false

  return true
}
