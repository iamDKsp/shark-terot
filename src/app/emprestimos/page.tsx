import { prisma } from "@/lib/db";
import { Plus } from "lucide-react";
import Link from "next/link";
import EmprestimosListWrapper from "@/components/EmprestimosListWrapper";
import ExportarEmprestimosButton from "@/components/ExportarEmprestimosButton";
import { obterConfiguracoesSistema } from "@/app/configuracoes/actions";

export const revalidate = 0;

export default async function EmprestimosPage({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?:   string; // compat legado
    status?:   string;
    q?:        string;
    parceiro?: string;
    sort?:     string;
    pagina?:   string;
    dias_atraso?: string;
  }>;
}) {
  const [params, config] = await Promise.all([
    searchParams,
    obterConfiguracoesSistema(),
  ]);
  const modoCarencia = config.regra_carencia_30_dias;
  const modoCarencia10 = config.regra_carencia_10_dias;
  // ?status= tem prioridade sobre o legado ?filtro=
  const statusPadrao       = modoCarencia10 ? "hoje" : modoCarencia ? "carencia" : "ativos";
  const statusInicial      = params?.status      ?? params?.filtro ?? statusPadrao;
  const searchInicial      = params?.q           ?? "";
  const parceiroInicial    = params?.parceiro    ?? "todos";
  const sortInicial        = params?.sort        ?? "padrao";
  const paginaInicial      = parseInt(params?.pagina ?? "1", 10) || 1;
  const diasAtrasoInicial  = params?.dias_atraso ?? "0";
  // Buscar todos os empréstimos de uma só vez para possibilitar busca instantânea no client-side.
  // select explícito exclui foto_url e documentos_urls do cliente, que não são usados pela listagem.
  const emprestimos = await prisma.emprestimo.findMany({
    select: {
      id: true,
      valor_emprestado: true,
      taxa_juros: true,
      taxa_multa: true,
      juros_atraso: true,
      data_vencimento: true,
      status: true,
      tipo_pagamento: true,
      frequencia: true,
      categoria: true,
      observacoes: true,
      data_inicio: true,
      data_prevista_pagamento: true,
      parceiro_id: true,
      criado_em: true,
      cliente: {
        select: {
          id: true,
          nome: true,
          telefone: true,
          cidade: true,
        },
      },
      parcelas: {
        select: {
          id: true,
          numero: true,
          valor: true,
          valor_pago: true,
          data_vencimento: true,
          status: true,
          data_pagamento: true,
        },
      },
      parceiro: {
        select: {
          id: true,
          nome: true,
        },
      },
    },
    orderBy: {
      data_vencimento: "asc",
    },
  });

  // Cheques são omitidos do carregamento inicial.
  // O botão de exportação os buscará via /api/exportar-cheques somente quando acionado.

  const serializedEmprestimos = emprestimos.map((emp) => ({
    ...emp,
    valor_emprestado: Number(emp.valor_emprestado),
    taxa_juros: Number(emp.taxa_juros),
    taxa_multa: Number(emp.taxa_multa),
    juros_atraso: Number(emp.juros_atraso),
    parcelas: emp.parcelas.map((p) => ({
      ...p,
      valor: Number(p.valor),
      valor_pago: p.valor_pago ? Number(p.valor_pago) : null,
    })),
  }));

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Empréstimos</h1>
          <p className="text-slate-500">
            {emprestimos.length} no total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ExportarEmprestimosButton emprestimos={serializedEmprestimos} />
          <Link
            href="/emprestimos/novo"
            className="flex items-center space-x-1.5 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Novo empréstimo</span>
          </Link>
        </div>
      </div>

      {/* Busca, Filtros e Lista (Componente de Cliente Instantâneo) */}
      <EmprestimosListWrapper
        initialEmprestimos={serializedEmprestimos}
        initialFiltro={statusInicial}
        initialSearch={searchInicial}
        initialParceiro={parceiroInicial}
        initialSort={sortInicial}
        initialPagina={paginaInicial}
        initialDiasAtraso={diasAtrasoInicial}
        modoCarencia={modoCarencia}
        modoCarencia10={modoCarencia10}
      />
    </div>
  );
}
