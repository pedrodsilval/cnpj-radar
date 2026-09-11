import { calcularAlertaEnquadramento, parsePgdasTexto } from './pgdas.parser';

// Texto sintético com a mesma estrutura de rótulos de um recibo real do
// PGDAS-D (Programa Gerador do Documento de Arrecadação do Simples
// Nacional), com valores fictícios — não é o extrato de nenhum cliente.
function textoPgdas(opts: { cnpj: string; periodo: string; rbt12: string; rpa: string }): string {
  const [dia, mes, ano] = opts.periodo.split('/');
  return `Programa Gerador do Documento de Arrecadação
do Simples Nacional - Declaratório
Declaração Original
Período de Apuração: ${dia}/${mes}/${ano} a 30/${mes}/${ano}
.
1. Identificação do Contribuinte
CNPJ Matriz: ${opts.cnpj}
Nome empresarial: EMPRESA TESTE LTDA
.
2.Apuração do Simples Nacional
2.1 Discriminativo de Receitas
Total de Receitas Brutas (R$) Mercado Interno Mercado Externo Total
Receita Bruta do PA (RPA) - Competência ${opts.rpa} 0,00 ${opts.rpa}
Receita Bruta do PA (RPA) - Caixa ${opts.rpa} 0,00 ${opts.rpa}
Receita bruta acumulada nos doze meses anteriores
ao PA (RBT12) ${opts.rbt12} 0,00 ${opts.rbt12}
Limite de receita bruta proporcionalizado 4.800.000,00 4.800.000,00`;
}

describe('parsePgdasTexto', () => {
  it('extrai CNPJ, período (YYYY-MM), RBT12 e receita do mês', () => {
    const texto = textoPgdas({ cnpj: '29.726.178/0001-04', periodo: '01/05/2026', rbt12: '380.000,00', rpa: '35.000,50' });
    const resultado = parsePgdasTexto(texto);
    expect(resultado.cnpjDeclarado).toBe('29726178000104');
    expect(resultado.periodoApuracao).toBe('2026-05');
    expect(resultado.rbt12).toBe(380000);
    expect(resultado.receitaBrutaMes).toBe(35000.5);
  });

  it('lança erro claro quando falta o CNPJ Matriz', () => {
    expect(() => parsePgdasTexto('documento qualquer sem os rótulos esperados')).toThrow(/CNPJ Matriz/);
  });

  it('lança erro claro quando falta o RBT12', () => {
    const texto = textoPgdas({ cnpj: '29.726.178/0001-04', periodo: '01/05/2026', rbt12: '', rpa: '1.000,00' }).replace(/RBT12\).*$/m, '');
    expect(() => parsePgdasTexto(texto)).toThrow(/RBT12/);
  });
});

describe('calcularAlertaEnquadramento', () => {
  it('não alerta empresa que não é ME', () => {
    expect(calcularAlertaEnquadramento('EPP', 500_000, '2026-05')).toBeNull();
    expect(calcularAlertaEnquadramento('DEMAIS', 500_000, '2026-05')).toBeNull();
    expect(calcularAlertaEnquadramento(null, 500_000, '2026-05')).toBeNull();
  });

  it('não alerta ME dentro do limite de R$360k', () => {
    expect(calcularAlertaEnquadramento('ME', 360_000, '2026-05')).toBeNull();
    expect(calcularAlertaEnquadramento('ME', 200_000, '2026-05')).toBeNull();
  });

  it('alerta PROXIMO_ANO quando excede até 20% do limite', () => {
    const alerta = calcularAlertaEnquadramento('ME', 400_000, '2026-05');
    expect(alerta).toEqual({ tipo: 'PROXIMO_ANO', rbt12: 400_000, excedente: 40_000, periodoApuracao: '2026-05' });
  });

  it('alerta IMEDIATO quando excede mais de 20% do limite', () => {
    const alerta = calcularAlertaEnquadramento('ME', 450_000, '2026-05');
    expect(alerta?.tipo).toBe('IMEDIATO');
  });

  it('reconhece porte por extenso ("MICRO EMPRESA"), não só a sigla', () => {
    expect(calcularAlertaEnquadramento('MICRO EMPRESA', 400_000, '2026-05')?.tipo).toBe('PROXIMO_ANO');
  });
});
