import { prisma } from "@/lib/db";
import {
  TrendingUp,
  DollarSign,
  AlertCircle,
  Plus,
  Users,
  ArrowUpRight,
  Wallet,
  BadgeDollarSign,
  BarChart3,
  Sparkles,
  Clock3,
  CheckCircle2,
  Target,
} from "lucide-react";
import Link from "next/link";
import { ProjecaoBarChart } from "@/components/ProjecaoBarChart";
import { CarteiraPieChart } from "@/components/CarteiraPieChart";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { obterConfiguracoesSistema } from "@/app/configuracoes/actions";

export const revalidate = 0;

export default async function DashboardPage() {
  const [hojeUTC, configSistema] = [hojeEmBrasilia(), await obterConfiguracoesSistema()];
  const modoCarencia = configSistema.regra_carencia_30_dias;
  const modoCarencia10 = configSistema.regra_carencia_10_dias;
  const limiteCarenciaUTC = new Date(hojeUTC);
  limiteCarenciaUTC.setUTCDate(hojeUTC.getUTCDate() - (modoCarencia10 ? 10 : 30));
  const limiteHojeCarencia10UTC = new Date(hojeUTC);
  limiteHojeCarencia10UTC.setUTCDate(hojeUTC.getUTCDate() - 2);

  const ontemUTC = new Date(hojeUTC);
  ontemUTC.setUTCDate(hojeUTC.getUTCDate() - 1);

  const anoAtualInicio = new Date(Date.UTC(hojeUTC.getUTCFullYear(), 0, 1));
  const mesAtualInicio = new Date(Date.UTC(hojeUTC.getUTCFullYear(), hojeUTC.getUTCMonth(), 1));

  const limiteSemana = new Date(hojeUTC);
  limiteSemana.setUTCDate(hojeUTC.getUTCDate() + 7);
  const limiteMes = new Date(hojeUTC);
  limiteMes.setUTCDate(hojeUTC.getUTCDate() + 30);
  const limiteAno = new Date(hojeUTC);
  limiteAno.setUTCDate(hojeUTC.getUTCDate() + 365);
  const limite7DiasUTC = new Date(hojeUTC);
  limite7DiasUTC.setUTCDate(hojeUTC.getUTCDate() + 7);

  // Buscar empréstimos ATIVOS e QUITADOS simultaneamente para maior velocidade (Promise.all)
  const [emprestimosAtivos, emprestimosQuitados] = await Promise.all([
    prisma.emprestimo.findMany({
      where: { status: "ativo" },
      include: { cliente: true, parcelas: true, parceiro: true },
      orderBy: { data_vencimento: "asc" },
    }),
    prisma.emprestimo.findMany({
      where: { status: "quitado" },
      include: { parcelas: true, parceiro: true },
    })
  ]);

  // ────────────────────────────────────────────────────────
  // MÉTRICAS DE CARTEIRA ATIVA
  // ────────────────────────────────────────────────────────
  let totalEmprestado = 0;
  let totalAReceber = 0;
  let totalAtrasadosCount = 0;
  let atrasadosOntemCount = 0;
  let atrasadosAnterioresCount = 0;
  let carencia10Count = 0;
  let vencendoHojeCount = 0;
  let ativosEmDiaCount = 0;
  let receberHoje = 0;
  let receberSemana = 0;
  let receberMes = 0;
  let receberAno = 0;
  let receberParceiros = 0;
  let receberProprio = 0;
  const parceirosMap: Record<string, { nome: string; total: number; count: number }> = {};

  const mesesProjecao = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(hojeUTC);
    d.setUTCMonth(hojeUTC.getUTCMonth() + i);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      label: d.toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", ""),
      valor: 0,
    };
  });

  emprestimosAtivos.forEach((emp) => {
    const principal = Number(emp.valor_emprestado);
    const juros = Number(emp.taxa_juros);
    const totalDevido = principal * (1 + juros / 100);

    totalEmprestado += principal;
    totalAReceber += totalDevido;

    const vencObj = new Date(emp.data_vencimento);
    const vencimentoUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));

    let estaAtrasado = false;
    let atrasouOntem = false;
    let venceHoje = false;
    let emCarencia10 = false;

    const usaCarencia = modoCarencia || modoCarencia10;

    if (emp.parcelas && emp.parcelas.length > 0) {
      const temParcelasAbertas = emp.parcelas.some((p) => p.status === "aberto");
      if (temParcelasAbertas) {
        estaAtrasado = emp.parcelas.some((p) => {
          if (p.status !== "aberto") return false;
          const pvObj = new Date(p.data_vencimento);
          const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));
          return usaCarencia ? pvUTC < limiteCarenciaUTC : pvUTC < hojeUTC;
        });

        atrasouOntem = emp.parcelas.some((p) => {
          if (p.status !== "aberto") return false;
          const pvObj = new Date(p.data_vencimento);
          const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));
          return pvUTC.getTime() === ontemUTC.getTime();
        });

        venceHoje = emp.parcelas.some((p) => {
          if (p.status !== "aberto") return false;
          const pvObj = new Date(p.data_vencimento);
          const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));
          if (modoCarencia10) {
            return pvUTC <= hojeUTC && pvUTC >= limiteHojeCarencia10UTC;
          }
          return pvUTC.getTime() === hojeUTC.getTime();
        });

        if (modoCarencia10 && !estaAtrasado) {
          emCarencia10 = emp.parcelas.some((p) => {
            if (p.status !== "aberto") return false;
            const pvObj = new Date(p.data_vencimento);
            const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));
            return pvUTC < limiteHojeCarencia10UTC && pvUTC >= limiteCarenciaUTC;
          });
        }
      }
    } else {
      const limiteAtraso = usaCarencia ? limiteCarenciaUTC : hojeUTC;
      if (vencimentoUTC < limiteAtraso) {
        estaAtrasado = true;
        if (vencimentoUTC.getTime() === ontemUTC.getTime()) {
          atrasouOntem = true;
        }
      } else if (modoCarencia10 && vencimentoUTC < limiteHojeCarencia10UTC && vencimentoUTC >= limiteCarenciaUTC) {
        emCarencia10 = true;
      } else if (modoCarencia10 ? (vencimentoUTC <= hojeUTC && vencimentoUTC >= limiteHojeCarencia10UTC) : (vencimentoUTC.getTime() === hojeUTC.getTime())) {
        venceHoje = true;
      }
    }

    if (estaAtrasado) {
      totalAtrasadosCount++;
      if (atrasouOntem) atrasadosOntemCount++;
      else atrasadosAnterioresCount++;
    } else {
      ativosEmDiaCount++;
      if (emCarencia10) carencia10Count++;
    }

    if (venceHoje && !estaAtrasado && !emCarencia10) vencendoHojeCount++;

    const isParceiro = emp.parceiro_id !== null;
    const parceiroNome = emp.parceiro?.nome || "Próprio";

    if (emp.parcelas && emp.parcelas.length > 0) {
      emp.parcelas.forEach((p) => {
        if (p.status === "aberto") {
          const pvObj = new Date(p.data_vencimento);
          const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));
          const valor = Number(p.valor);

          if (isParceiro) {
            receberParceiros += valor;
            if (!parceirosMap[emp.parceiro_id!]) {
              parceirosMap[emp.parceiro_id!] = { nome: parceiroNome, total: 0, count: 0 };
            }
            parceirosMap[emp.parceiro_id!].total += valor;
            parceirosMap[emp.parceiro_id!].count++;
          } else {
            receberProprio += valor;
          }

          if (pvUTC.getTime() === hojeUTC.getTime()) receberHoje += valor;
          if (pvUTC >= hojeUTC && pvUTC <= limiteSemana) receberSemana += valor;
          if (pvUTC >= hojeUTC && pvUTC <= limiteMes) receberMes += valor;
          if (pvUTC >= hojeUTC && pvUTC <= limiteAno) receberAno += valor;

          mesesProjecao.forEach((m) => {
            if (pvUTC.getUTCFullYear() === m.year && pvUTC.getUTCMonth() === m.month) {
              m.valor += valor;
            }
          });
        }
      });
    } else {
      const valor = totalDevido;
      if (isParceiro) {
        receberParceiros += valor;
        if (!parceirosMap[emp.parceiro_id!]) {
          parceirosMap[emp.parceiro_id!] = { nome: parceiroNome, total: 0, count: 0 };
        }
        parceirosMap[emp.parceiro_id!].total += valor;
        parceirosMap[emp.parceiro_id!].count++;
      } else {
        receberProprio += valor;
      }
      if (vencimentoUTC.getTime() === hojeUTC.getTime()) receberHoje += valor;
      if (vencimentoUTC >= hojeUTC && vencimentoUTC <= limiteSemana) receberSemana += valor;
      if (vencimentoUTC >= hojeUTC && vencimentoUTC <= limiteMes) receberMes += valor;
      if (vencimentoUTC >= hojeUTC && vencimentoUTC <= limiteAno) receberAno += valor;
      mesesProjecao.forEach((m) => {
        if (vencimentoUTC.getUTCFullYear() === m.year && vencimentoUTC.getUTCMonth() === m.month) {
          m.valor += valor;
        }
      });
    }
  });

  // ────────────────────────────────────────────────────────
  // MÉTRICAS DE GANHOS REAIS (QUITADOS)
  // ────────────────────────────────────────────────────────
  let ganhoTotal = 0;         // Juros recebidos de TODOS os quitados
  let ganhoMesAtual = 0;      // Juros recebidos este mês (pagamentos feitos em parcelas)
  let ganhoAnoAtual = 0;      // Juros recebidos este ano
  let faturadoTotal = 0;      // Total bruto recebido (principal + juros)
  let emprestimosQuitadosCount = emprestimosQuitados.length;
  let ticketMedioQuitado = 0;

  emprestimosQuitados.forEach((emp) => {
    const principal = Number(emp.valor_emprestado);
    const juros = Number(emp.taxa_juros);

    if (emp.parcelas && emp.parcelas.length > 0) {
      // Calcular com base nas parcelas pagas
      emp.parcelas.forEach((p) => {
        if (p.status.startsWith("pago") && p.valor_pago) {
          const valorPago = Number(p.valor_pago);
          faturadoTotal += valorPago;

          const pvObj = new Date(p.data_vencimento);
          const pvUTC = new Date(Date.UTC(pvObj.getUTCFullYear(), pvObj.getUTCMonth(), pvObj.getUTCDate()));

          if (pvUTC >= mesAtualInicio && pvUTC <= hojeUTC) {
            ganhoMesAtual += valorPago;
          }
          if (pvUTC >= anoAtualInicio && pvUTC <= hojeUTC) {
            ganhoAnoAtual += valorPago;
          }
        }
      });
      // Ganho de juros = faturado - principal
      const totalPagoEmp = emp.parcelas
        .filter((p) => p.status.startsWith("pago") && p.valor_pago)
        .reduce((acc, p) => acc + Number(p.valor_pago), 0);
      ganhoTotal += Math.max(0, totalPagoEmp - principal);
    } else {
      // Fallback sem parcelas
      const totalDevido = principal * (1 + juros / 100);
      faturadoTotal += totalDevido;
      ganhoTotal += totalDevido - principal;
    }
  });

  if (emprestimosQuitadosCount > 0) {
    ticketMedioQuitado = faturadoTotal / emprestimosQuitadosCount;
  }

  const lucroEstimado = totalAReceber - totalEmprestado;
  const parceirosList = Object.values(parceirosMap).sort((a, b) => b.total - a.total);

  const formatBRL = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const totalRecebiveisCalculados = receberProprio + receberParceiros;
  const pctProprio = totalRecebiveisCalculados > 0 ? (receberProprio / totalRecebiveisCalculados) * 100 : 0;
  const pctParceiros = totalRecebiveisCalculados > 0 ? (receberParceiros / totalRecebiveisCalculados) * 100 : 0;
  const maxProjecao = Math.max(...mesesProjecao.map((m) => m.valor), 1);

  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  // Taxa de sucesso (quitados / (quitados + ativos))
  const totalEmprestimosGeral = emprestimosAtivos.length + emprestimosQuitadosCount;
  const taxaSucesso = totalEmprestimosGeral > 0 ? (emprestimosQuitadosCount / totalEmprestimosGeral) * 100 : 0;

  return (
    <div className="space-y-8 w-full max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1880px] mx-auto px-1 animate-fade-in text-zinc-900">

      {/* ── CABEÇALHO ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-sm font-bold text-emerald-600 uppercase tracking-widest">Ao vivo</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Painel Geral
          </h1>
          <p className="text-sm sm:text-base text-slate-500 mt-1">
            {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }).format(new Date())}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <Link
            href="/clientes/novo"
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 border border-zinc-200 bg-white text-slate-700 hover:bg-slate-50 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm active:scale-95 text-center"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>Novo Cliente</span>
          </Link>
          <Link
            href="/emprestimos/novo"
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-md shadow-emerald-500/20 active:scale-95 text-center"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Novo Empréstimo</span>
          </Link>
        </div>
      </div>

      {/* ── ROW 1: CAPITAL + A RECEBER ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">

        {/* Capital em Campo */}
        <Link href="/emprestimos" className="relative overflow-hidden bg-white card-accent border border-zinc-200 rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group cursor-pointer active:scale-[0.98]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Capital em Campo</span>
            <div className="w-8 h-8 rounded-xl bg-zinc-100 flex items-center justify-center group-hover:bg-zinc-200 transition-colors">
              <Wallet className="w-4 h-4 text-zinc-600" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight text-zinc-900 leading-none break-words">
            {formatBRL(totalEmprestado)}
          </div>
          <div className="mt-3 text-xs sm:text-sm text-zinc-400 flex items-center justify-between flex-wrap gap-2">
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-emerald-600">{ativosEmDiaCount} em dia</span>
              <span className="text-zinc-300">•</span>
              <span className="font-bold text-rose-500">{totalAtrasadosCount} atrasados</span>
              <span className="text-xs text-zinc-400">({emprestimosAtivos.length} total)</span>
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-zinc-100/50 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
        </Link>

        {/* Total a Receber */}
        <Link href="/emprestimos" className="relative overflow-hidden bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm hover:shadow-emerald-500/10 hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer active:scale-[0.98]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-emerald-600">A Receber</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black tracking-tight text-emerald-600 leading-none break-words">
            {formatBRL(totalAReceber)}
          </div>
          <div className="mt-3 text-xs sm:text-sm text-zinc-400 flex items-center justify-between flex-wrap gap-2">
            <span>Juros incluso: <span className="text-emerald-500 font-bold">{formatBRL(lucroEstimado)}</span></span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500" />
          </div>
          <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-emerald-50/50 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
        </Link>
      </div>

      {/* ── ROW 2: ALERTAS (3 cards) ── */}
      <div className="grid grid-cols-1 min-[420px]:grid-cols-3 sm:grid-cols-3 gap-3 sm:gap-4">

        {/* Vencendo Hoje / Hoje (0 a 2d) */}
        <Link href="/emprestimos?filtro=hoje" className="relative overflow-hidden bg-white border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-amber-500/10 hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer active:scale-[0.98]">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-amber-600 truncate">
              {modoCarencia10 ? "Hoje (0 a 2d)" : "Vencendo Hoje"}
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors shrink-0">
              <Clock3 className="w-4 h-4 text-amber-500" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black tracking-tight text-amber-600 leading-none">
            {vencendoHojeCount}
          </div>
          <div className="mt-2 text-xs sm:text-sm text-zinc-400 flex items-center justify-between">
            <span className="truncate">
              {modoCarencia10 ? "hoje, 1 e 2 dias" : vencendoHojeCount === 1 ? "vence hoje" : "vencem hoje"}
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-amber-500 shrink-0" />
          </div>
          <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-amber-50/50 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
        </Link>

        {/* Atrasados Ontem / 10 Dias Carência */}
        <Link href={modoCarencia10 ? "/emprestimos?filtro=carencia_10" : "/cobrancas?filtro=ontem"} className="relative overflow-hidden bg-white border border-orange-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-orange-500/10 hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer active:scale-[0.98]">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-orange-500 truncate">
              {modoCarencia10 ? "10 Dias Carência" : "Atrasados Ontem"}
            </span>
            <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors shrink-0">
              <Clock3 className="w-4 h-4 text-orange-500" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-black tracking-tight text-orange-600 leading-none">
            {modoCarencia10 ? carencia10Count : atrasadosOntemCount}
          </div>
          <div className="mt-2 text-xs sm:text-sm text-zinc-400 flex items-center justify-between">
            <span className="truncate">
              {modoCarencia10 ? "2 a 10 dias" : atrasadosOntemCount === 1 ? "venceu ontem" : "venceram ontem"}
            </span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-orange-500 shrink-0" />
          </div>
          <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-orange-50/50 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
        </Link>

        {/* Atrasados Anteriores / Atrasados (10+d) */}
        <Link href={modoCarencia10 ? "/emprestimos?filtro=atrasados" : "/cobrancas?filtro=anteriores"} className="relative overflow-hidden bg-white border border-rose-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-rose-500/10 hover:shadow-lg hover:-translate-y-0.5 transition-all group cursor-pointer active:scale-[0.98]">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-rose-500 truncate">
              {modoCarencia10 ? "Atrasados" : "Atrasados Anteriores"}
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center group-hover:bg-rose-100 transition-colors shrink-0">
              <AlertCircle className="w-4 h-4 text-rose-500" />
            </div>
          </div>
          <div className="flex items-end justify-between gap-1">
            <div>
              <div className="text-xl sm:text-2xl font-black tracking-tight text-rose-600 leading-none">
                {modoCarencia10 ? totalAtrasadosCount : atrasadosAnterioresCount}
              </div>
              <div className="mt-2 text-xs sm:text-sm text-zinc-400 flex items-center gap-1.5">
                <span className="truncate">{modoCarencia10 ? "há 10+ dias" : "há 2+ dias"}</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-rose-500 shrink-0" />
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] sm:text-xs font-bold text-rose-500 bg-rose-50 border border-rose-100 px-2 py-0.5 sm:py-1 rounded-full whitespace-nowrap">
                Total: {totalAtrasadosCount}
              </span>
            </div>
          </div>
          <div className="absolute -bottom-4 -right-4 w-20 h-20 rounded-full bg-rose-50/50 group-hover:scale-110 transition-transform duration-500 pointer-events-none" />
        </Link>
      </div>

      {/* ── ROW 2: RECEBÍVEIS POR PERÍODO ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
          <h2 className="text-sm font-black text-zinc-400 uppercase tracking-widest">Recebíveis por Período</h2>
        </div>
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-4 gap-3 sm:gap-4">
          {[
            { label: "Hoje", value: receberHoje, accent: "border-l-amber-500", text: "text-amber-600" },
            { label: "Esta semana (7d)", value: receberSemana, accent: "border-l-emerald-500", text: "text-emerald-600" },
            { label: "No mês (30d)", value: receberMes, accent: "border-l-cyan-500", text: "text-cyan-600" },
            { label: "No ano (365d)", value: receberAno, accent: "border-l-indigo-500", text: "text-indigo-600" },
          ].map((item, idx) => (
            <div key={idx} className={`bg-white card-accent border border-zinc-200 rounded-2xl p-4 sm:p-5 shadow-sm border-l-4 ${item.accent} hover:shadow-md transition-all`}>
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">{item.label}</span>
              <div className={`text-lg sm:text-2xl font-black mt-2 leading-none break-words ${item.text}`}>
                {formatBRL(item.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ROW 3: GRÁFICOS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Projeção de Recebimentos */}
        <div className="bg-white card-accent border border-zinc-200 rounded-2xl p-6 lg:col-span-2 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
              Projeção de Recebimentos
            </h3>
            <span className="text-sm font-bold text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-full">
              Próximos 6 meses
            </span>
          </div>
          <ProjecaoBarChart data={mesesProjecao} />
        </div>

        {/* Distribuição de Carteira */}
        <div className="bg-white card-accent border border-zinc-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest mb-1 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-indigo-500" />
              Distribuição de Carteira
            </h3>

            <CarteiraPieChart
              receberProprio={receberProprio}
              receberParceiros={receberParceiros}
              totalRecebivel={totalRecebiveisCalculados}
              pctProprio={pctProprio}
              pctParceiros={pctParceiros}
            />

            <div className="space-y-2.5 mt-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 flex-shrink-0 shadow-sm shadow-cyan-500/50" />
                  <span className="text-zinc-500">Capital Próprio</span>
                  <span className="text-sm font-black text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">{pctProprio.toFixed(0)}%</span>
                </div>
                <span className="font-black text-zinc-900 text-sm">{formatBRL(receberProprio)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-500 flex-shrink-0 shadow-sm shadow-violet-500/50" />
                  <span className="text-zinc-500">Parceiros</span>
                  <span className="text-sm font-black text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">{pctParceiros.toFixed(0)}%</span>
                </div>
                <span className="font-black text-zinc-900 text-sm">{formatBRL(receberParceiros)}</span>
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-200/60 pt-3 mt-4 flex items-center justify-between">
            <span className="text-zinc-400 uppercase text-sm font-black">Total Recebível</span>
            <span className="font-black text-emerald-600 text-sm">{formatBRL(totalRecebiveisCalculados)}</span>
          </div>
        </div>
      </div>

      {/* ── ROW 4: GANHOS & FATURAMENTO ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-yellow-500" />
          <h2 className="text-sm font-black text-zinc-400 uppercase tracking-widest">Ganhos & Faturamento Real</h2>
          <span className="text-xs bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">Baseado em quitados</span>
        </div>
        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-4 gap-3 sm:gap-4">

          {/* Ganho Total em Juros */}
          <div className="col-span-1 relative overflow-hidden bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-5 shadow-lg shadow-emerald-500/25 text-white">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest opacity-80">Juros Ganhos (Total)</span>
              <div className="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center">
                <BadgeDollarSign className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black leading-none break-words">{formatBRL(ganhoTotal)}</div>
            <div className="mt-2 text-xs sm:text-sm opacity-70">De {emprestimosQuitadosCount} contratos quitados</div>
            <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          </div>

          {/* Faturado Este Mês */}
          <div className="col-span-1 relative overflow-hidden bg-white card-accent border border-zinc-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Faturado Este Mês</span>
              <div className="w-7 h-7 rounded-xl bg-sky-50 flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5 text-sky-500" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-black leading-none text-sky-600 break-words">{formatBRL(ganhoMesAtual)}</div>
            <div className="mt-2 text-xs sm:text-sm text-zinc-400">Parcelas quitadas no mês</div>
          </div>

          {/* Faturado Este Ano */}
          <div className="col-span-1 relative overflow-hidden bg-white card-accent border border-zinc-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Faturado Este Ano</span>
              <div className="w-7 h-7 rounded-xl bg-violet-50 flex items-center justify-center">
                <ArrowUpRight className="w-3.5 h-3.5 text-violet-500" />
              </div>
            </div>
            <div className="text-xl sm:text-2xl font-black leading-none text-violet-600 break-words">{formatBRL(ganhoAnoAtual)}</div>
            <div className="mt-2 text-xs sm:text-sm text-zinc-400">Parcelas quitadas em {hojeUTC.getUTCFullYear()}</div>
          </div>

          {/* Taxa de Sucesso */}
          <div className="col-span-1 relative overflow-hidden bg-white card-accent border border-zinc-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Taxa de Quitação</span>
              <div className="w-7 h-7 rounded-xl bg-teal-50 flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" />
              </div>
            </div>
            <div className="text-2xl font-black leading-none text-teal-600">{taxaSucesso.toFixed(1)}%</div>
            <div className="mt-1.5 w-full bg-zinc-100 rounded-full h-1.5">
              <div
                className="h-1.5 rounded-full bg-gradient-to-r from-teal-400 to-teal-600 transition-all duration-700"
                style={{ width: `${taxaSucesso}%` }}
              />
            </div>
            <div className="mt-1.5 text-xs sm:text-sm text-zinc-400">{emprestimosQuitadosCount} de {totalEmprestimosGeral} contratos</div>
          </div>

        </div>

        {/* Resumo Compacto */}
        <div className="bg-white card-accent border border-zinc-200 rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row flex-wrap gap-4 sm:gap-6 items-start sm:items-center">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <Target className="w-4.5 h-4.5 text-emerald-500" />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Total Faturado (Bruto)</div>
                <div className="text-lg sm:text-xl font-black text-zinc-900 leading-tight">{formatBRL(faturadoTotal)}</div>
              </div>
            </div>
            <div className="h-8 w-px bg-zinc-200 hidden sm:block" />
            <div className="h-px w-full bg-zinc-100 sm:hidden" />
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                <BadgeDollarSign className="w-4.5 h-4.5 text-indigo-500" />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Lucro Potencial (Carteira Ativa)</div>
                <div className="text-lg sm:text-xl font-black text-indigo-600 leading-tight">{formatBRL(lucroEstimado)}</div>
              </div>
            </div>
            <div className="h-8 w-px bg-zinc-200 hidden sm:block" />
            <div className="h-px w-full bg-zinc-100 sm:hidden" />
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <DollarSign className="w-4.5 h-4.5 text-amber-500" />
              </div>
              <div>
                <div className="text-xs sm:text-sm font-black uppercase tracking-widest text-zinc-400">Ticket Médio (Quitados)</div>
                <div className="text-lg sm:text-xl font-black text-amber-600 leading-tight">{formatBRL(ticketMedioQuitado)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 5: PARCEIROS ── */}
      {parceirosList.length > 0 && (
        <div className="bg-white card-accent border border-zinc-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-black text-zinc-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-violet-500" />
            Recebíveis por Parceiros
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4">
            {parceirosList.map((p, idx) => (
              <div key={idx} className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-col justify-between hover:border-violet-300 transition-all">
                <span className="text-sm font-black text-slate-700 truncate">{p.nome}</span>
                <div className="mt-3 flex items-end justify-between">
                  <span className="text-sm font-black text-violet-600">{formatBRL(p.total)}</span>
                  <span className="text-xs text-zinc-400 font-bold">{p.count} parcelas</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
