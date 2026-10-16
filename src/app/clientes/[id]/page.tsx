import { prisma } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  MessageSquare, 
  User, 
  Calendar, 
  HandCoins, 
  Trash2, 
  Edit3,
  AlertCircle,
  TrendingUp,
  CheckCircle2,
  Wallet
} from "lucide-react";
import { revalidatePath } from "next/cache";
import DeleteClientButton from "@/components/DeleteClientButton";
import DocumentosLightbox from "@/components/DocumentosLightbox";
import EmprestimosClienteCard, { type EmprestimoClienteItem } from "@/components/EmprestimosClienteCard";
import ValorTotalDividaCard, { type EmprestimoItemWizard } from "@/components/ValorTotalDividaCard";
import { hojeEmBrasilia } from "@/lib/dateUtils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 0;

// Action para deletar cliente
async function deleteCliente(id: string) {
  "use server";
  await prisma.cliente.delete({
    where: { id },
  });
  revalidatePath("/clientes");
  redirect("/clientes");
}

export default async function ClienteDetalhesPage({ params }: PageProps) {
  const { id } = await params;

  // Buscar cliente e todos os seus empréstimos
  const cliente = await prisma.cliente.findUnique({
    where: { id },
    include: {
      emprestimos: {
        orderBy: {
          data_vencimento: "asc",
        },
        include: {
          parcelas: {
            orderBy: {
              numero: "asc",
            },
          },
        },
      },
      cheques: {
        orderBy: {
          data_compensacao: "asc",
        },
      },
    },
  });

  if (!cliente) {
    notFound();
  }

  // Obter data de hoje em Brasília (corrige bug de fuso UTC em server components)
  const hojeUTC = hojeEmBrasilia();

  // Cálculos financeiros
  let totalEmprestadoAtivo = 0;
  let totalRecebido = 0;
  let totalAReceber = 0;
  let totalAtrasado = 0;
  let countAbertos = 0;
  let countAtrasados = 0;
  let lucroCheques = 0;
  let valorTotalDivida = 0;
  const emprestimosAtivosWizard: EmprestimoItemWizard[] = [];

  const formatData = (date: Date) => {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(date));
  };

  cliente.emprestimos.forEach((emp) => {
    const principal = Number(emp.valor_emprestado);
    const juros = Number(emp.taxa_juros);
    const totalComJuros = principal * (1 + juros / 100);

    const vencObj = new Date(emp.data_vencimento);
    const vencimentoUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));

    const estaAtrasado = emp.status === "ativo" && vencimentoUTC < hojeUTC;

    if (emp.status === "quitado") {
      totalRecebido += totalComJuros;
    } else if (emp.status === "ativo") {
      totalEmprestadoAtivo += principal;
      totalAReceber += totalComJuros;
      valorTotalDivida += totalComJuros;
      emprestimosAtivosWizard.push({
        id: emp.id,
        data_vencimento: formatData(emp.data_vencimento),
        principal,
        taxa_juros: juros,
        totalComJuros,
      });
      countAbertos++;
      
      if (estaAtrasado) {
        totalAtrasado += totalComJuros;
        countAtrasados++;
      }
    }
  });

  cliente.cheques.forEach((cheque) => {
    const valor = Number(cheque.valor);
    const liquido = Number(cheque.valor_liquido || cheque.valor);
    const lucro = valor - liquido;
    lucroCheques += lucro;
  });

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  // Iniciais para o avatar
  const iniciais = cliente.nome
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const whatsappUrl = `https://wa.me/${cliente.telefone}`;

  return (
    <div className="space-y-6 w-full max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto">
      {/* Botão Voltar & Ações Rápidas */}
      <div className="flex items-center justify-between">
        <Link
          href="/clientes"
          className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Pessoas</span>
        </Link>
        
        <div className="flex items-center space-x-2">
          <Link
            href={`/clientes/${cliente.id}/editar`}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors flex items-center justify-center cursor-pointer"
            title="Editar Pessoa"
          >
            <Edit3 className="w-5 h-5" />
          </Link>
          <DeleteClientButton clienteId={cliente.id} onDeleteAction={deleteCliente} />
        </div>
      </div>

      {/* Card Cabeçalho Perfil */}
      <div className="premium-card p-6 flex flex-col items-center text-center bg-white border border-slate-200 shadow-sm rounded-2xl">
        {cliente.foto_url ? (
          <img 
            src={cliente.foto_url} 
            alt={cliente.nome} 
            className="w-24 h-24 rounded-full object-cover border-2 border-emerald-500 shadow-md"
          />
        ) : (
          <div className="w-24 h-24 bg-emerald-600 text-white font-bold rounded-full flex items-center justify-center text-xl shadow-md">
            {iniciais}
          </div>
        )}

        <h1 className="text-2xl font-bold text-slate-900 mt-4">{cliente.nome}</h1>
        <p className="text-sm text-slate-500 mt-1">{cliente.telefone}</p>

        {cliente.blacklist && (
          <span className="mt-2 bg-rose-100 text-rose-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
            Lista Negra (Bloqueado)
          </span>
        )}

        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center space-x-2 bg-[#075e54] text-white px-8 py-2.5 rounded-full text-sm font-semibold hover:bg-[#128c7e] transition-colors shadow-sm"
        >
          <MessageSquare className="w-4 h-4" />
          <span>WhatsApp</span>
        </a>
      </div>

      {/* Resumo Financeiro */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">Resumo financeiro</h2>
        
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-3.5">
          {/* Valor Total da Dívida (com Mini Wizard ao Clicar) */}
          <ValorTotalDividaCard
            valorTotalDivida={valorTotalDivida}
            totalEmprestadoAtivo={totalEmprestadoAtivo}
            totalAReceber={totalAReceber}
            emprestimosAtivos={emprestimosAtivosWizard}
            clienteNome={cliente.nome}
          />

          {/* Emprestado (Ativo) */}
          <div className="premium-card p-4 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col justify-between">
            <div className="flex items-center space-x-2 text-slate-400">
              <HandCoins className="w-4.5 h-4.5 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Emprestado (ativo)</span>
            </div>
            <div className="text-lg font-bold text-slate-900 mt-2">
              {formatBRL(totalEmprestadoAtivo)}
            </div>
          </div>

          {/* Total Recebido */}
          <div className="premium-card p-4 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col justify-between">
            <div className="flex items-center space-x-2 text-emerald-500">
              <CheckCircle2 className="w-4.5 h-4.5 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Total recebido</span>
            </div>
            <div className="text-lg font-bold text-emerald-600 mt-2">
              {formatBRL(totalRecebido)}
            </div>
          </div>

          {/* A receber */}
          <div className="premium-card p-4 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col justify-between">
            <div className="flex items-center space-x-2 text-slate-400">
              <TrendingUp className="w-4.5 h-4.5 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">A receber</span>
            </div>
            <div className="text-lg font-bold text-slate-900 mt-2">
              {formatBRL(totalAReceber)}
            </div>
          </div>

          {/* Total Atrasado */}
          <div className="premium-card p-4 bg-white border border-slate-200 shadow-sm rounded-2xl flex flex-col justify-between">
            <div className="flex items-center space-x-2 text-rose-500">
              <AlertCircle className="w-4.5 h-4.5 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider">Total Atrasado</span>
            </div>
            <div className="text-lg font-bold text-rose-600 mt-2">
              {formatBRL(totalAtrasado)}
            </div>
          </div>

          {/* Lucro Cheques */}
          <div className="premium-card p-4 bg-white border border-emerald-200 bg-emerald-50/40 shadow-sm rounded-2xl col-span-1 min-[360px]:col-span-2 md:col-span-3 lg:col-span-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-emerald-700">
                <Wallet className="w-5 h-5" />
                <span className="text-xs font-bold uppercase tracking-wider">Lucro Gerado com Cheques</span>
              </div>
              <div className="text-lg font-bold text-emerald-700">
                {formatBRL(lucroCheques)}
              </div>
            </div>
          </div>
        </div>

        {/* Contadores */}
        <div className="grid grid-cols-3 gap-4 premium-card p-4 bg-white border border-slate-200 shadow-sm rounded-2xl text-center">
          <div>
            <div className="text-lg font-bold text-slate-900">{countAbertos}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Abertos</div>
          </div>
          <div>
            <div className="text-lg font-bold text-rose-600">{countAtrasados}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Atrasados</div>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{cliente.blacklist ? "Sim" : "Não"}</div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Lista Negra</div>
          </div>
        </div>
      </div>

      {/* Informações detalhadas */}
      <div className="premium-card p-6 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-4">
        <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
          Informações
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 text-sm">
          <div>
            <span className="block text-xs text-slate-400 font-bold uppercase">CPF / RG</span>
            <span className="text-slate-900 font-medium">{cliente.documento || "Não cadastrado"}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400 font-bold uppercase">Email</span>
            <span className="text-slate-900 font-medium">{cliente.email || "Não cadastrado"}</span>
          </div>
          <div className="sm:col-span-2">
            <span className="block text-xs text-slate-400 font-bold uppercase">Endereço</span>
            <span className="text-slate-900 font-medium">{cliente.endereco || "Não cadastrado"}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400 font-bold uppercase">Cidade</span>
            <span className="text-slate-900 font-medium">{cliente.cidade}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400 font-bold uppercase">Referência</span>
            <span className="text-slate-900 font-medium">{cliente.referencia || "Não cadastrado"}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400 font-bold uppercase">Quem indicou</span>
            <span className="text-slate-900 font-medium">{cliente.quem_indicou || "Não indicado"}</span>
          </div>
        </div>
      </div>

      {/* Observações */}
      {cliente.observacoes && (
        <div className="premium-card p-6 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-2">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
            Observações
          </h2>
          <p className="text-sm text-slate-700 font-medium whitespace-pre-line leading-relaxed">
            {cliente.observacoes}
          </p>
        </div>
      )}

      {/* Documentos Anexados */}
      {(() => {
        let documentos: string[] = [];
        if (cliente.documentos_urls) {
          try {
            documentos = JSON.parse(cliente.documentos_urls);
            if (!Array.isArray(documentos)) documentos = [];
          } catch {
            documentos = [];
          }
        }
        if (documentos.length === 0) return null;
        return (
          <div className="premium-card p-6 bg-white border border-slate-200 shadow-sm rounded-2xl space-y-4">
            <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
              Documentos Anexados
            </h2>
            <DocumentosLightbox documentos={documentos} />
          </div>
        );
      })()}

      {/* Empréstimos da Pessoa */}
      <EmprestimosClienteCard
        clienteId={cliente.id}
        clienteNome={cliente.nome}
        clienteTelefone={cliente.telefone}
        clienteDocumento={cliente.documento}
        emprestimos={cliente.emprestimos.map((emp) => {
          const principal = Number(emp.valor_emprestado);
          const juros = Number(emp.taxa_juros);

          const vencObj = new Date(emp.data_vencimento);
          const vencimentoUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));

          const quitado = emp.status.startsWith("quitado");
          const venceHoje = emp.status === "ativo" && vencimentoUTC.getTime() === hojeUTC.getTime();
          const estaAtrasado = emp.status === "ativo" && vencimentoUTC < hojeUTC;

          return {
            id: emp.id,
            vencimento: formatData(emp.data_vencimento),
            dataInicio: emp.data_inicio ? emp.data_inicio.toISOString() : null,
            situacao: quitado ? "quitado" : estaAtrasado ? "atrasado" : venceHoje ? "hoje" : "em_dia",
            status: emp.status,
            tipoPagamento: emp.tipo_pagamento,
            frequencia: emp.frequencia,
            principal,
            total: principal * (1 + juros / 100),
            valorJuros: principal * (juros / 100),
            taxaJuros: juros,
            taxaMulta: Number(emp.taxa_multa),
            atrasoTipo: emp.atraso_tipo,
            atrasoValor: emp.atraso_valor != null ? Number(emp.atraso_valor) : null,
            observacoes: emp.observacoes,
            parcelas: emp.parcelas.map((p) => ({
              numero: p.numero,
              valor: Number(p.valor),
              data_vencimento: p.data_vencimento.toISOString(),
              status: p.status,
              data_pagamento: p.data_pagamento ? p.data_pagamento.toISOString() : null,
            })),
          } satisfies EmprestimoClienteItem;
        })}
      />

      {/* Cheques da Pessoa */}
      <div className="premium-card overflow-hidden bg-white border border-slate-200 shadow-sm rounded-2xl">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Troca de Cheques</h2>
          <Link
            href={`/cheques`}
            className="flex items-center space-x-1 bg-emerald-50 text-emerald-700 p-2 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors"
          >
            <span>Ir para Cheques</span>
          </Link>
        </div>

        <div className="divide-y divide-slate-100">
          {cliente.cheques.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              Nenhum cheque vinculado a esta pessoa.
            </div>
          ) : (
            cliente.cheques.map((cheque) => {
              const valorBruto = Number(cheque.valor);
              const valorLiquido = Number(cheque.valor_liquido || cheque.valor);
              const taxa = Number(cheque.taxa_desconto || 0);

              return (
                <div key={cheque.id} className="p-4 flex flex-col space-y-3 hover:bg-slate-50/60 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-900">
                        Vencimento: {formatData(cheque.data_compensacao)}
                      </span>
                      {cheque.status === "compensado" ? (
                        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full uppercase">
                          Compensado
                        </span>
                      ) : cheque.status === "devolvido" ? (
                        <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2 py-0.5 rounded-full uppercase">
                          Devolvido
                        </span>
                      ) : (
                        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full uppercase">
                          Pendente
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                      <div className="border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 bg-white">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Cheque</span>
                        <span className="text-xs sm:text-sm font-bold text-slate-900">{formatBRL(valorBruto)}</span>
                      </div>
                      <div className="border border-slate-200 rounded-lg px-2.5 sm:px-3 py-1.5 bg-white">
                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Taxa {taxa}%</span>
                        <span className="text-xs sm:text-sm font-bold text-slate-900">{formatBRL(valorBruto - valorLiquido)}</span>
                      </div>
                    </div>
                    <div className="text-right border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 sm:px-3 py-1.5">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 block">Líquido</span>
                      <span className="text-xs sm:text-sm font-bold text-emerald-700">{formatBRL(valorLiquido)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
