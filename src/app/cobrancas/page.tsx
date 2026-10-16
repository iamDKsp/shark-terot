import { prisma } from "@/lib/db";
import ClientCobrancasView from "./ClientCobrancasView";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { chaveCobranca } from "@/lib/mensagens/catalogo";
import {
  carregarConfiguracoes,
  carregarTemplates,
  contextoCobranca,
  parcelasCobradasHoje,
  renderizarComTemplates,
  ultimasCobrancas,
} from "@/lib/mensagens/servidor";
import { obterConfiguracoesSistema } from "@/app/configuracoes/actions";

export const revalidate = 0;

const TIPOS_PARCELA_UNICA = ["a_vista", "a_vista_juros", "juros_compostos"];

export default async function CobrancasPage({ searchParams }: { searchParams: Promise<{ filtro?: string; tab?: string }> }) {
  const params = await searchParams;
  const hojeUTC = hojeEmBrasilia();
  const ontemUTC = new Date(hojeUTC);
  ontemUTC.setUTCDate(hojeUTC.getUTCDate() - 1);

  // Buscar todos os empréstimos ativos com suas parcelas abertas
  const emprestimos = await prisma.emprestimo.findMany({
    where: {
      status: "ativo",
    },
    include: {
      cliente: true,
      parcelas: {
        orderBy: { numero: "asc" },
      },
    },
  });

  // Modelos de mensagem + dados da base (Pix etc.): carregados UMA vez para todas as parcelas
  const [templates, cfg, cobradasHoje, configSistema] = await Promise.all([
    carregarTemplates(),
    carregarConfiguracoes(),
    parcelasCobradasHoje(),
    obterConfiguracoesSistema(),
  ]);
  const modoCarencia = configSistema.regra_carencia_30_dias;
  const modoCarencia10 = configSistema.regra_carencia_10_dias;
  // ?tab= tem prioridade sobre o legado ?filtro=
  const initialFiltro = params?.tab ?? params?.filtro ?? (modoCarencia10 ? "hoje" : "atrasados");

  const atrasadosOntem: any[] = [];
  const atrasadosAnteriores: any[] = [];
  const hojeLista: any[] = [];
  const aVencer: any[] = [];

  const limite3DiasUTC = new Date(hojeUTC);
  limite3DiasUTC.setUTCDate(hojeUTC.getUTCDate() + 3);

  for (const emp of emprestimos) {
    const valorEmprestadoNum = Number(emp.valor_emprestado);
    const taxaJurosNum = Number(emp.taxa_juros);
    const parcelasNaoRenovacao = emp.parcelas.filter(
      (p: any) => p.status !== "pago_renovacao" && !p.status.includes("renovacao") && p.status !== "renovado"
    );
    const totalParcelas = parcelasNaoRenovacao.length || 1;
    const parcelasAbertas = emp.parcelas.length > 0
      ? emp.parcelas.filter((p: any) => p.status === "aberto")
      : [
          {
            id: `legacy-${emp.id}`,
            numero: 1,
            valor: valorEmprestadoNum * (1 + taxaJurosNum / 100),
            data_vencimento: emp.data_vencimento,
            status: "aberto",
          }
        ];

    const saldoRestante = parcelasAbertas.reduce((acc: number, p: any) => acc + Number(p.valor), 0);
    const parcelaUnica = totalParcelas <= 1 || TIPOS_PARCELA_UNICA.includes(emp.tipo_pagamento);

    for (const p of parcelasAbertas) {
      const vencObj = new Date(p.data_vencimento);
      const vencimentoUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));

      let tipo: "atrasados" | "hoje" | "aVencer" | null = null;
      if (vencimentoUTC < hojeUTC) tipo = "atrasados";
      else if (vencimentoUTC.getTime() === hojeUTC.getTime()) tipo = "hoje";
      else if (vencimentoUTC > hojeUTC && vencimentoUTC <= limite3DiasUTC) tipo = "aVencer";
      if (!tipo) continue;

      // Texto final da cobrança (modelo editável + rodapé), igual ao que o disparo envia
      const mensagem = renderizarComTemplates(
        chaveCobranca(tipo, parcelaUnica),
        contextoCobranca(
          {
            clienteNome: emp.cliente.nome,
            numero: p.numero,
            valor: Number(p.valor),
            dataVencimento: p.data_vencimento,
            totalParcelas,
            valorEmprestado: valorEmprestadoNum,
            taxaJuros: taxaJurosNum,
            saldoRestante,
          },
          cfg
        ),
        templates,
        { anexarRodape: true }
      ).texto;

      const serializedParcela = {
        id: p.id,
        numero: p.numero,
        valor: Number(p.valor),
        data_vencimento: new Date(p.data_vencimento).toISOString(),
        status: p.status,
        mensagem,
        // Dias corridos de atraso (horário de Brasília): >0 atrasada, 0 vence hoje, <0 faltam N dias
        diasAtraso: Math.round((hojeUTC.getTime() - vencimentoUTC.getTime()) / 86_400_000),
        ultimaCobranca: null as string | null,
        emprestimo: {
          id: emp.id,
          valor_emprestado: valorEmprestadoNum,
          taxa_juros: taxaJurosNum,
          tipo_pagamento: emp.tipo_pagamento,
          frequencia: emp.frequencia || "mensal",
          totalParcelas: totalParcelas,
          parcelasAbertasCount: parcelasAbertas.length,
          saldoRestante,
          atraso_tipo: emp.atraso_tipo ?? null,
          atraso_valor: emp.atraso_valor != null ? Number(emp.atraso_valor) : null,
          data_prevista_pagamento: emp.data_prevista_pagamento
            ? emp.data_prevista_pagamento.toISOString().split("T")[0]
            : null,
          cliente: {
            id: emp.cliente.id,
            nome: emp.cliente.nome,
            telefone: emp.cliente.telefone,
          },
        },
      };

      if (tipo === "atrasados") {
        if (vencimentoUTC.getTime() === ontemUTC.getTime()) {
          atrasadosOntem.push(serializedParcela);
        } else {
          atrasadosAnteriores.push(serializedParcela);
        }
      } else if (tipo === "hoje") {
        hojeLista.push(serializedParcela);
      } else {
        aVencer.push(serializedParcela);
      }
    }
  }

  // Última cobrança de cada parcela listada (1 consulta agrupada para todas)
  const todas = [...atrasadosOntem, ...atrasadosAnteriores, ...hojeLista, ...aVencer];
  const ultimas = await ultimasCobrancas(todas.map((p) => p.id).filter((id) => !id.startsWith("legacy-")));
  for (const p of todas) p.ultimaCobranca = ultimas.get(p.id) ?? null;

  const sortByDate = (a: any, b: any) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime();
  atrasadosOntem.sort(sortByDate);
  atrasadosAnteriores.sort(sortByDate);
  hojeLista.sort(sortByDate);
  aVencer.sort(sortByDate);

  return (
    <ClientCobrancasView 
      atrasadosOntem={atrasadosOntem}
      atrasadosAnteriores={atrasadosAnteriores}
      hojeLista={hojeLista}
      aVencer={aVencer}
      initialFiltro={initialFiltro}
      cobradasHoje={cobradasHoje}
      pixConfigurado={cfg.pix_chave.trim().length > 0}
      modoCarencia={modoCarencia}
      modoCarencia10={modoCarencia10}
    />
  );
}
