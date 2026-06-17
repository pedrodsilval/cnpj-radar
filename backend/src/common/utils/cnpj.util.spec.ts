import { sanitizeCnpj, isValidCnpj } from './cnpj.util'

describe('sanitizeCnpj', () => {
  it('removes mask characters from a numeric CNPJ', () => {
    expect(sanitizeCnpj('11.222.333/0001-81')).toBe('11222333000181')
  })

  it('removes leading and trailing spaces', () => {
    expect(sanitizeCnpj('  11222333000181  ')).toBe('11222333000181')
  })

  it('uppercases letters and keeps them (alphanumeric format)', () => {
    expect(sanitizeCnpj('ab.123.456/0001-10')).toBe('AB123456000110')
  })
})

describe('isValidCnpj', () => {
  it('validates a correct numeric CNPJ with mask', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
  })

  it('validates a correct numeric CNPJ without mask', () => {
    expect(isValidCnpj('11222333000181')).toBe(true)
  })

  it('rejects a numeric CNPJ with wrong check digit', () => {
    expect(isValidCnpj('11222333000182')).toBe(false)
  })

  it('validates a correct alphanumeric CNPJ with DVs computed from the base', () => {
    // DVs são calculados aqui a partir da base — nenhum dígito é inventado
    const base12 = 'AB1234560001'
    const cv = (c: string) => c.charCodeAt(0) - 48
    const dv = (s: string, ws: number[]) => {
      const rem = s.split('').reduce((acc, c, i) => acc + cv(c) * ws[i], 0) % 11
      return rem < 2 ? 0 : 11 - rem
    }
    const dv1 = dv(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    const dv2 = dv(base12 + String(dv1), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    expect(isValidCnpj(base12 + String(dv1) + String(dv2))).toBe(true)
  })

  it('rejects a CNPJ with fewer than 14 positions', () => {
    expect(isValidCnpj('1122233300018')).toBe(false)
  })

  it('rejects a CNPJ with more than 14 positions', () => {
    expect(isValidCnpj('112223330001811')).toBe(false)
  })

  it('rejects a CNPJ with a letter in one of the last 2 positions (DV area)', () => {
    expect(isValidCnpj('112223330001A1')).toBe(false)
  })

  it('rejects the repeated digit sequence 00000000000000', () => {
    expect(isValidCnpj('00000000000000')).toBe(false)
  })

  it('rejects input with unexpected special characters', () => {
    expect(isValidCnpj('11.222.333/0001-8!')).toBe(false)
  })
})
