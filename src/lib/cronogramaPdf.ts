import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ParcelaPdfItem {
  numero: number;
  data_vencimento: string | Date;
  valor: number;
  status?: string;
  data_pagamento?: string | Date | null;
  principal?: number;
  juros?: number;
  multa?: number;
}

export interface CronogramaPdfData {
  clienteNome: string;
  clienteDocumento?: string | null;
  tipoPagamento?: string;
  valorEmprestado: number;
  taxaJuros?: number;
  taxaMulta?: number;
  atrasoTipo?: string | null;
  atrasoValor?: number | null;
  observacoes?: string | null;
  dataGeracao?: string | Date;
  parcelas: ParcelaPdfItem[];
}

export function formatarDataBr(d?: string | Date | null): string {
  if (!d) return "";
  if (typeof d === "string") {
    const raw = d.split("T")[0];
    const parts = raw.split("-");
    if (parts.length === 3) {
      return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
    }
  }
  const dt = new Date(d);
  const dia = String(dt.getUTCDate()).padStart(2, "0");
  const mes = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const ano = dt.getUTCFullYear();
  return `${dia}/${mes}/${ano}`;
}

export function formatarMoeda(val: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(val || 0).replace(/\u00A0/g, " ");
}

export function getTipoModalityTitle(tipo?: string): string {
  switch (tipo) {
    case "parcelado":
      return "CRONOGRAMA DE PARCELAS - FIXAS";
    case "a_vista":
      return "CRONOGRAMA DE PARCELAS - À VISTA";
    case "a_vista_juros":
      return "CRONOGRAMA DE PARCELAS - FIXAS";
    case "juros_mensais":
      return "CRONOGRAMA DE PARCELAS - JUROS MENSAIS";
    case "parcela_juros_mes":
      return "CRONOGRAMA DE PARCELAS - FIXAS";
    case "juros_compostos":
      return "CRONOGRAMA DE PARCELAS - JUROS COMPOSTOS";
    default:
      return "CRONOGRAMA DE PARCELAS - FIXAS";
  }
}

export function formatarStatusParcela(status?: string, dataVencimento?: string | Date): string {
  if (!status) return "A Vencer";
  const st = status.toLowerCase();
  if (st === "pago_renovacao" || st.includes("renovacao") || st === "renovado") {
    return "Renovação (Pago)";
  }
  if (st === "pago" || st === "pago_com_atraso" || st === "quitado" || st.startsWith("pago")) {
    return "Pago";
  }
  if (st === "atrasado") {
    return "Atrasado";
  }

  // Se estiver "aberto", checar se a data já venceu
  if (dataVencimento) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const venc = new Date(dataVencimento);
    if (venc < hoje) {
      return "Atrasado";
    }
  }

  return "A Vencer";
}

function isParcelaRenovacao(status?: string): boolean {
  if (!status) return false;
  const st = status.toLowerCase();
  return st === "pago_renovacao" || st.includes("renovacao") || st === "renovado";
}

/**
 * Calcula a decomposição de Principal, Juros e Multa para cada parcela de acordo com a modalidade
 */
export function calcularLinhasParcelas(data: CronogramaPdfData) {
  const { valorEmprestado, parcelas, tipoPagamento } = data;
  const parcelasNormaisCount = parcelas.filter((p) => !isParcelaRenovacao(p.status)).length || 1;

  let principalRestante = valorEmprestado;
  let normalIndex = 0;

  return parcelas.map((p) => {
    const isRenov = isParcelaRenovacao(p.status);
    let principal = 0;
    let juros = 0;
    const multa = p.multa ?? 0;
    const total = Number(p.valor) || 0;

    if (isRenov) {
      principal = 0;
      juros = total;
    } else {
      const isLastNormal = normalIndex === parcelasNormaisCount - 1;
      normalIndex++;

      if (p.principal !== undefined && p.juros !== undefined) {
        principal = p.principal;
        juros = p.juros;
      } else if (tipoPagamento === "a_vista") {
        principal = total;
        juros = 0;
      } else if (tipoPagamento === "a_vista_juros" || tipoPagamento === "juros_compostos" || parcelasNormaisCount === 1) {
        principal = valorEmprestado;
        juros = Math.max(0, total - valorEmprestado);
      } else if (tipoPagamento === "juros_mensais") {
        if (isLastNormal) {
          principal = valorEmprestado;
          juros = Math.max(0, total - valorEmprestado);
        } else {
          principal = 0;
          juros = total;
        }
      } else {
        // Parcelado normal ou fixas
        const parcelaPrincipalBase = Number((valorEmprestado / parcelasNormaisCount).toFixed(2));
        if (isLastNormal) {
          principal = Number(Math.max(0, principalRestante).toFixed(2));
        } else {
          principal = parcelaPrincipalBase;
          principalRestante -= parcelaPrincipalBase;
        }
        juros = Math.max(0, Number((total - principal).toFixed(2)));
      }
    }

    const statusFormatado = formatarStatusParcela(p.status, p.data_vencimento);

    return {
      numero: p.numero,
      vencimento: formatarDataBr(p.data_vencimento),
      principal: formatarMoeda(principal),
      juros: formatarMoeda(juros),
      multa: formatarMoeda(multa),
      total: formatarMoeda(total),
      status: statusFormatado,
      valorTotalNum: total,
      principalNum: principal,
      jurosNum: juros,
      isRenovacao: isRenov,
    };
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Gera a instância do jsPDF pronta para salvar no cliente ou exportar como buffer/base64 no servidor
 */
export function gerarCronogramaPdf(data: CronogramaPdfData): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const marginX = 40;

  // 1. Título Principal
  const title = getTipoModalityTitle(data.tipoPagamento);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42); // #0F172A
  doc.text(title, marginX, 55);

  // 2. Cliente
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  const clienteTexto = `Cliente: ${(data.clienteNome || "NÃO INFORMADO").toUpperCase()}`;
  doc.text(clienteTexto, marginX, 85);

  // 3. Data de Geração
  const dataHojeStr = data.dataGeracao ? formatarDataBr(data.dataGeracao) : formatarDataBr(new Date());
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(100, 116, 139); // #64748B
  doc.text(`Gerado em: ${dataHojeStr}`, marginX, 102);

  // 4. Subtítulo: Detalhamento das Parcelas
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59); // #1E293B
  doc.text("DETALHAMENTO DAS PARCELAS", marginX, 142);

  // 5. Linhas da Tabela
  const linhasCalculadas = calcularLinhasParcelas(data);
  const tableRows = linhasCalculadas.map((item) => [
    String(item.numero),
    item.vencimento,
    item.principal,
    item.juros,
    item.multa,
    item.total,
    item.status,
  ]);

  const totalGeralNum = linhasCalculadas.reduce((acc, curr) => acc + curr.valorTotalNum, 0);

  // 6. Renderizar Tabela com AutoTable
  autoTable(doc, {
    startY: 156,
    head: [["Parcela", "Vencimento", "Principal", "Juros", "Multa", "Total", "Status"]],
    body: tableRows,
    theme: "grid",
    headStyles: {
      fillColor: [11, 25, 44], // #0B192C Azul Marinho Escuro
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 9,
      cellPadding: 7,
      lineWidth: 0.5,
      lineColor: [11, 25, 44],
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      fontSize: 8.5,
      cellPadding: 7,
      lineWidth: 0.5,
      lineColor: [226, 232, 240], // #E2E8F0
      valign: "middle",
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 45 }, // Parcela
      1: { halign: "center", cellWidth: 75 }, // Vencimento
      2: { halign: "center", cellWidth: 80 }, // Principal
      3: { halign: "center", cellWidth: 70 }, // Juros
      4: { halign: "center", cellWidth: 70 }, // Multa
      5: { halign: "center", fontStyle: "bold", cellWidth: 88 }, // Total
      6: { halign: "center", cellWidth: 87.28 }, // Status
    },
    margin: { left: marginX, right: marginX },
  });

  // 7. Total Geral Centralizado abaixo da tabela
  const finalY = (doc as any).lastAutoTable?.finalY || 240;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Geral: ${formatarMoeda(totalGeralNum)}`, pageWidth / 2, finalY + 32, {
    align: "center",
  });

  // 8. Observações / Condições em Caso de Atraso
  const textoAtraso = obterTextoAtrasoPdf(data.atrasoTipo, data.atrasoValor);
  const obsLimpa = data.observacoes?.replace(/\[DIA_BASE:\s*\d+\]/gi, "").trim();

  if (textoAtraso || obsLimpa) {
    const pageHeight = doc.internal.pageSize.getHeight();
    const boxWidth = pageWidth - marginX * 2;
    const paddingX = 14;
    const paddingY = 12;
    const maxTextWidth = boxWidth - paddingX * 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    let linhasAtraso: string[] = [];
    if (textoAtraso) {
      linhasAtraso = doc.splitTextToSize(textoAtraso, maxTextWidth);
    }

    let linhasObs: string[] = [];
    if (obsLimpa) {
      linhasObs = doc.splitTextToSize(`Observações adicionais: ${obsLimpa}`, maxTextWidth);
    }

    const espacoLinha = 11.5;
    let alturaConteudo = 14; // Altura do cabeçalho da caixa
    if (linhasAtraso.length > 0) {
      alturaConteudo += 6 + linhasAtraso.length * espacoLinha;
    }
    if (linhasObs.length > 0) {
      alturaConteudo += (linhasAtraso.length > 0 ? 8 : 4) + linhasObs.length * espacoLinha;
    }

    const boxHeight = alturaConteudo + paddingY * 2;

    let startY = finalY + 50;
    // Se não couber na página atual, move para uma nova página
    if (startY + boxHeight > pageHeight - 40) {
      doc.addPage();
      startY = 40;
    }

    // Fundo do card
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.roundedRect(marginX, startY, boxWidth, boxHeight, 6, 6, "FD");

    // Barra lateral de destaque
    doc.setFillColor(15, 23, 42); // #0F172A
    doc.roundedRect(marginX, startY, 4, boxHeight, 2, 2, "F");

    // Cabeçalho
    let cursorY = startY + paddingY + 8;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text("CONDIÇÕES EM CASO DE ATRASO NO PAGAMENTO", marginX + paddingX, cursorY);

    cursorY += 13;

    // Texto de atraso
    if (linhasAtraso.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85); // slate-700
      doc.text(linhasAtraso, marginX + paddingX, cursorY);
      cursorY += linhasAtraso.length * espacoLinha + 6;
    }

    // Observações adicionais
    if (linhasObs.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text(linhasObs, marginX + paddingX, cursorY);
    }
  }

  return doc;
}

/**
 * Retorna o texto formal e profissional de cobrança moratória por atraso diário
 */
export function obterTextoAtrasoPdf(tipo?: string | null, valor?: number | null): string | null {
  const val = Number(valor);
  if (!tipo || !val || val <= 0) return null;

  if (tipo === "fixo_dia") {
    const valorFmt = formatarMoeda(val);
    return `Em caso de atraso ou inadimplemento no pagamento de qualquer parcela, incidirá acréscimo moratório no valor fixo de ${valorFmt} por dia de atraso, calculado a partir do primeiro dia subsequente ao vencimento até a efetiva quitação.`;
  }

  if (tipo === "percentual_dia") {
    return `Em caso de atraso ou inadimplemento no pagamento de qualquer parcela, incidirão juros moratórios à razão de ${val}% ao dia sobre o valor da parcela em aberto, calculados a partir do primeiro dia subsequente ao vencimento até a efetiva quitação.`;
  }

  return null;
}

/**
 * Função utilitária para download direto no navegador (Client-side)
 */
export function baixarCronogramaPdfCliente(data: CronogramaPdfData, nomeArquivoCustom?: string) {
  const doc = gerarCronogramaPdf(data);
  const clienteSlug = (data.clienteNome || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-");
  
  const nomeArquivo = nomeArquivoCustom || `cronograma-${clienteSlug}.pdf`;
  doc.save(nomeArquivo);
}

/**
 * Função utilitária para gerar Base64 do PDF (Server-side / WhatsApp)
 */
export function obterCronogramaPdfBase64(data: CronogramaPdfData): string {
  const doc = gerarCronogramaPdf(data);
  const arrayBuffer = doc.output("arraybuffer");
  return arrayBufferToBase64(arrayBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO EM MASSA (MÚLTIPLOS EMPRÉSTIMOS DO CLIENTE BEM DIVIDIDOS E EXPLICADOS)
// ─────────────────────────────────────────────────────────────────────────────

export interface EmprestimoMassaPdfItem {
  id: string;
  vencimento: string; // dd/mm/aaaa
  dataInicio?: string | Date | null;
  situacao: "quitado" | "atrasado" | "hoje" | "em_dia";
  status?: string;
  tipoPagamento?: string;
  frequencia?: string;
  principal: number;
  total: number;
  valorJuros: number;
  taxaJuros: number;
  taxaMulta: number;
  atrasoTipo?: string | null;
  atrasoValor?: number | null;
  observacoes?: string | null;
  parcelas: ParcelaPdfItem[];
}

export interface RelatorioEmprestimosPdfData {
  clienteNome: string;
  clienteDocumento?: string | null;
  clienteTelefone?: string | null;
  dataGeracao?: string | Date;
  emprestimos: EmprestimoMassaPdfItem[];
}

function obterNomeModalidadeLegivel(tipo?: string, frequencia?: string): string {
  const freqMap: Record<string, string> = {
    diario: "Diário",
    semanal: "Semanal",
    quinzenal: "Quinzenal",
    mensal: "Mensal",
  };
  const freq = frequencia && freqMap[frequencia] ? ` (${freqMap[frequencia]})` : "";

  switch (tipo) {
    case "a_vista":
      return "À Vista (Sem Juros)";
    case "a_vista_juros":
      return `À Vista com Juros${freq}`;
    case "juros_compostos":
      return `Juros Compostos${freq}`;
    case "parcelado":
      return `Parcelado em Parcelas Fixas${freq}`;
    case "juros_mensais":
      return `Juros por Período + Capital no Final${freq}`;
    case "parcela_juros_mes":
      return `Parcelado com Juros ao Mês${freq}`;
    default:
      return `Contrato de Empréstimo${freq}`;
  }
}

function obterSituacaoBadgeInfo(situacao: EmprestimoMassaPdfItem["situacao"]): {
  label: string;
  bg: [number, number, number];
  text: [number, number, number];
} {
  switch (situacao) {
    case "quitado":
      return { label: "QUITADO", bg: [226, 232, 240], text: [51, 65, 85] };
    case "atrasado":
      return { label: "EM ATRASO", bg: [254, 226, 226], text: [185, 28, 28] };
    case "hoje":
      return { label: "VENCE HOJE", bg: [254, 243, 199], text: [180, 83, 9] };
    case "em_dia":
    default:
      return { label: "EM DIA", bg: [209, 250, 229], text: [4, 120, 87] };
  }
}

function calcularResumoEmprestimoItem(emp: EmprestimoMassaPdfItem) {
  const parcelasEfetivas: ParcelaPdfItem[] =
    emp.parcelas && emp.parcelas.length > 0
      ? emp.parcelas
      : [
          {
            numero: 1,
            data_vencimento: emp.vencimento.includes("/")
              ? emp.vencimento.split("/").reverse().join("-")
              : emp.vencimento,
            valor: emp.total,
            status: emp.situacao === "quitado" ? "pago" : "aberto",
          },
        ];

  const parcelasAbertas = parcelasEfetivas.filter((p) => p.status === "aberto");
  const parcelasPagas = parcelasEfetivas.filter(
    (p) => p.status && (p.status.startsWith("pago") || p.status === "quitado")
  );
  const renovacoesPagas = parcelasEfetivas.filter((p) => isParcelaRenovacao(p.status));

  const valorPago =
    emp.situacao === "quitado" && parcelasPagas.length === 0
      ? emp.total
      : parcelasPagas.reduce((acc, p) => acc + Number(p.valor || 0), 0);

  const saldoAberto =
    emp.situacao === "quitado"
      ? 0
      : parcelasAbertas.length > 0
      ? parcelasAbertas.reduce((acc, p) => acc + Number(p.valor || 0), 0)
      : emp.total;

  return {
    parcelasEfetivas,
    qtdParcelasTotal: parcelasEfetivas.filter((p) => !isParcelaRenovacao(p.status)).length || 1,
    qtdAbertas: emp.situacao === "quitado" ? 0 : parcelasAbertas.length,
    qtdPagas: parcelasPagas.length,
    qtdRenovacoes: renovacoesPagas.length,
    valorPago,
    saldoAberto,
  };
}

function gerarExplicacaoEmprestimo(
  emp: EmprestimoMassaPdfItem,
  resumo: ReturnType<typeof calcularResumoEmprestimoItem>
): string {
  const modalidade = obterNomeModalidadeLegivel(emp.tipoPagamento, emp.frequencia);
  const partes: string[] = [];

  partes.push(
    `Modalidade: ${modalidade}. Valor emprestado (capital) de ${formatarMoeda(emp.principal)} com taxa de juros de ${emp.taxaJuros}% (${formatarMoeda(emp.valorJuros)} de juros)${
      emp.taxaMulta > 0 ? ` e multa de ${emp.taxaMulta}%` : ""
    }, totalizando ${formatarMoeda(emp.total)} com vencimento em ${emp.vencimento}.`
  );

  if (resumo.qtdRenovacoes > 0) {
    partes.push(
      `Possui ${resumo.qtdRenovacoes} renovação(ões) de juros registrada(s) no histórico.`
    );
  }

  if (emp.situacao === "quitado") {
    partes.push(`Este empréstimo encontra-se totalmente QUITADO.`);
  } else {
    partes.push(
      `Saldo atual a pagar neste empréstimo: ${formatarMoeda(resumo.saldoAberto)}${
        resumo.valorPago > 0 ? ` (Já pago: ${formatarMoeda(resumo.valorPago)})` : ""
      }.`
    );
  }

  return partes.join(" ");
}

/**
 * Gera um PDF consolidado contendo múltiplos empréstimos selecionados de um cliente,
 * com Resumo Geral no topo, Tabela Índice e Seções Individuais bem divididas e explicadas.
 */
export function gerarEmprestimosEmMassaPdf(data: RelatorioEmprestimosPdfData): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2; // 523.28 pt
  const dataHojeStr = data.dataGeracao
    ? formatarDataBr(data.dataGeracao)
    : formatarDataBr(new Date());

  const emprestimos = data.emprestimos || [];
  const resumosPorEmp = emprestimos.map((emp) => ({
    emp,
    resumo: calcularResumoEmprestimoItem(emp),
  }));

  // Cálculos consolidados gerais
  const totalCapital = resumosPorEmp.reduce((acc, x) => acc + x.emp.principal, 0);
  const totalJurosContratado = resumosPorEmp.reduce((acc, x) => acc + x.emp.valorJuros, 0);
  const totalContratado = resumosPorEmp.reduce((acc, x) => acc + x.emp.total, 0);
  const totalJaPago = resumosPorEmp.reduce((acc, x) => acc + x.resumo.valorPago, 0);
  const totalSaldoAberto = resumosPorEmp.reduce((acc, x) => acc + x.resumo.saldoAberto, 0);
  const qtdQuitados = resumosPorEmp.filter((x) => x.emp.situacao === "quitado").length;
  const qtdEmAberto = emprestimos.length - qtdQuitados;

  // ── 1. CABEÇALHO PRINCIPAL DO DOCUMENTO ──
  doc.setFillColor(15, 23, 42); // #0F172A
  doc.roundedRect(marginX, 32, contentWidth, 64, 8, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text("DEMONSTRATIVO DETALHADO DE EMPRÉSTIMOS", marginX + 16, 55);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225); // slate-300
  const nomeClienteUpper = (data.clienteNome || "NÃO INFORMADO").toUpperCase();
  const docInfo =
    data.clienteDocumento && data.clienteDocumento !== "Não cadastrado"
      ? `  |  CPF/RG: ${data.clienteDocumento}`
      : "";
  doc.text(`Cliente: ${nomeClienteUpper}${docInfo}`, marginX + 16, 73);

  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(
    `Emitido em: ${dataHojeStr}  |  ${emprestimos.length} empréstimo${
      emprestimos.length !== 1 ? "s" : ""
    } selecionado${emprestimos.length !== 1 ? "s" : ""} (${qtdEmAberto} em aberto, ${qtdQuitados} quitado${
      qtdQuitados !== 1 ? "s" : ""
    })`,
    marginX + 16,
    87
  );

  let cursorY = 110;

  // ── 2. QUADRO DE RESUMO FINANCEIRO GERAL ──
  const cardGap = 8;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const cardHeight = 46;

  const cardsResumo = [
    {
      label: "CAPITAL EMPRESTADO",
      valor: formatarMoeda(totalCapital),
      bg: [248, 250, 252] as [number, number, number],
      border: [226, 232, 240] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
    },
    {
      label: "JUROS CONTRATADOS",
      valor: formatarMoeda(totalJurosContratado),
      bg: [248, 250, 252] as [number, number, number],
      border: [226, 232, 240] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
    },
    {
      label: "TOTAL CONTRATADO",
      valor: formatarMoeda(totalContratado),
      bg: [248, 250, 252] as [number, number, number],
      border: [226, 232, 240] as [number, number, number],
      text: [15, 23, 42] as [number, number, number],
    },
    {
      label: "SALDO A PAGAR",
      valor: formatarMoeda(totalSaldoAberto),
      bg: [236, 253, 245] as [number, number, number], // emerald-50
      border: [167, 243, 208] as [number, number, number], // emerald-200
      text: [4, 120, 87] as [number, number, number], // emerald-700
    },
  ];

  cardsResumo.forEach((c, idx) => {
    const x = marginX + idx * (cardWidth + cardGap);
    doc.setFillColor(...c.bg);
    doc.setDrawColor(...c.border);
    doc.roundedRect(x, cursorY, cardWidth, cardHeight, 6, 6, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(c.label, x + 10, cursorY + 16);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...c.text);
    doc.text(c.valor, x + 10, cursorY + 34);
  });

  cursorY += cardHeight + 18;

  // ── 3. TABELA DE VISÃO GERAL DOS EMPRÉSTIMOS SELECIONADOS ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text("1. VISÃO GERAL DOS EMPRÉSTIMOS SELECIONADOS", marginX, cursorY);
  cursorY += 8;

  const resumoRows = resumosPorEmp.map(({ emp, resumo }, i) => {
    const sit = obterSituacaoBadgeInfo(emp.situacao);
    return [
      `#${i + 1}`,
      emp.vencimento,
      `${ formatarMoeda(emp.principal) }`,
      `${emp.taxaJuros}% (${formatarMoeda(emp.valorJuros)})`,
      `${emp.taxaMulta}%`,
      formatarMoeda(emp.total),
      formatarMoeda(resumo.saldoAberto),
      sit.label,
    ];
  });

  autoTable(doc, {
    startY: cursorY,
    head: [
      [
        "Contrato",
        "Vencimento",
        "Emprestado",
        "Taxa / Juros",
        "Multa",
        "Total",
        "A Pagar",
        "Situação",
      ],
    ],
    body: resumoRows,
    theme: "grid",
    headStyles: {
      fillColor: [30, 41, 59], // slate-800
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      fontSize: 8,
      cellPadding: 5,
    },
    bodyStyles: {
      textColor: [30, 41, 59],
      fontSize: 8,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      valign: "middle",
      halign: "center",
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 44 },
      1: { cellWidth: 62 },
      2: { cellWidth: 72 },
      3: { cellWidth: 88 },
      4: { cellWidth: 40 },
      5: { fontStyle: "bold", cellWidth: 72 },
      6: { fontStyle: "bold", textColor: [4, 120, 87], cellWidth: 72 },
      7: { fontStyle: "bold", cellWidth: 73.28 },
    },
    margin: { left: marginX, right: marginX },
  });

  cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 40) + 22;

  // Título da seção de detalhamento individual
  if (cursorY + 140 > pageHeight - 40) {
    doc.addPage();
    cursorY = 40;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text("2. DETALHAMENTO E EXPLICAÇÃO POR EMPRÉSTIMO", marginX, cursorY);
  cursorY += 12;

  // ── 4. SEÇÕES INDIVIDUAIS BEM DIVIDIDAS PARA CADA EMPRÉSTIMO ──
  resumosPorEmp.forEach(({ emp, resumo }, idx) => {
    const sit = obterSituacaoBadgeInfo(emp.situacao);
    const explicacao = gerarExplicacaoEmprestimo(emp, resumo);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const explicacaoLinhas: string[] = doc.splitTextToSize(explicacao, contentWidth - 24);
    const alturaExplicacao = explicacaoLinhas.length * 11 + 14;
    const alturaHeaderBloco = 26 + 34 + alturaExplicacao;

    // Verificar espaço mínimo antes de abrir o bloco do empréstimo
    if (cursorY + alturaHeaderBloco + 70 > pageHeight - 45) {
      doc.addPage();
      cursorY = 40;
    }

    // 4.1 Faixa de título do Empréstimo #N
    doc.setFillColor(11, 25, 44); // #0B192C
    doc.roundedRect(marginX, cursorY, contentWidth, 26, 5, 5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(
      `EMPRÉSTIMO #${idx + 1} DE ${emprestimos.length}   |   VENCIMENTO: ${emp.vencimento}`,
      marginX + 12,
      cursorY + 16.5
    );

    // Badge de situação à direita da faixa
    const badgeW = 74;
    const badgeH = 16;
    const badgeX = marginX + contentWidth - badgeW - 8;
    const badgeY = cursorY + 5;
    doc.setFillColor(...sit.bg);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...sit.text);
    doc.text(sit.label, badgeX + badgeW / 2, badgeY + 11, { align: "center" });

    cursorY += 28;

    // 4.2 Caixa de Resumo + Explicação do Empréstimo
    const boxHeight = 32 + alturaExplicacao;
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.roundedRect(marginX, cursorY, contentWidth, boxHeight, 5, 5, "FD");

    // Linha de indicadores rápidos do empréstimo
    const colW = contentWidth / 4;
    const metricas = [
      { titulo: "Valor Emprestado", valor: formatarMoeda(emp.principal) },
      { titulo: "Taxa de Juros", valor: `${emp.taxaJuros}% (${formatarMoeda(emp.valorJuros)})` },
      { titulo: "Multa Contratual", valor: `${emp.taxaMulta}%` },
      { titulo: "Total do Contrato", valor: formatarMoeda(emp.total) },
    ];

    metricas.forEach((m, mIdx) => {
      const mx = marginX + mIdx * colW + 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(m.titulo.toUpperCase(), mx, cursorY + 12);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(m.valor, mx, cursorY + 24);
    });

    // Linha divisória interna
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX + 10, cursorY + 30, marginX + contentWidth - 10, cursorY + 30);

    // Texto explicativo detalhado
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(explicacaoLinhas, marginX + 12, cursorY + 42);

    cursorY += boxHeight + 6;

    // 4.3 Tabela de Parcelas deste Empréstimo
    const linhasCalc = calcularLinhasParcelas({
      clienteNome: data.clienteNome,
      tipoPagamento: emp.tipoPagamento,
      valorEmprestado: emp.principal,
      taxaJuros: emp.taxaJuros,
      taxaMulta: emp.taxaMulta,
      parcelas: resumo.parcelasEfetivas,
    });

    const rowsParcelas = linhasCalc.map((item) => [
      item.isRenovacao ? `Renov. ${item.numero}` : `Parcela ${item.numero}`,
      item.vencimento,
      item.principal,
      item.juros,
      item.multa,
      item.total,
      item.status,
    ]);

    autoTable(doc, {
      startY: cursorY,
      head: [["Parcela / Item", "Vencimento", "Principal", "Juros", "Multa", "Total", "Status"]],
      body: rowsParcelas,
      theme: "grid",
      headStyles: {
        fillColor: [51, 65, 85], // slate-700
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
        fontSize: 8,
        cellPadding: 5,
      },
      bodyStyles: {
        textColor: [30, 41, 59],
        fontSize: 8,
        cellPadding: 5,
        lineColor: [226, 232, 240],
        valign: "middle",
        halign: "center",
      },
      columnStyles: {
        0: { cellWidth: 68 },
        1: { cellWidth: 70 },
        2: { cellWidth: 78 },
        3: { cellWidth: 72 },
        4: { cellWidth: 60 },
        5: { fontStyle: "bold", cellWidth: 85 },
        6: { fontStyle: "bold", cellWidth: 90.28 },
      },
      margin: { left: marginX, right: marginX },
    });

    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 6;

    // 4.4 Condições de atraso / observações específicas deste empréstimo (se houver)
    const textoAtraso = obterTextoAtrasoPdf(emp.atrasoTipo, emp.atrasoValor);
    const obsLimpa = emp.observacoes?.replace(/\[DIA_BASE:\s*\d+\]/gi, "").trim();

    if (textoAtraso || obsLimpa) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const notas: string[] = [];
      if (textoAtraso) notas.push(`Condição de atraso: ${textoAtraso}`);
      if (obsLimpa) notas.push(`Observações: ${obsLimpa}`);
      const linhasNota: string[] = doc.splitTextToSize(notas.join(" | "), contentWidth - 20);
      const hNota = linhasNota.length * 10 + 10;

      if (cursorY + hNota > pageHeight - 40) {
        doc.addPage();
        cursorY = 40;
      }

      doc.setFillColor(255, 251, 235); // amber-50
      doc.setDrawColor(253, 230, 138); // amber-200
      doc.roundedRect(marginX, cursorY, contentWidth, hNota, 4, 4, "FD");
      doc.setTextColor(146, 64, 14); // amber-800
      doc.text(linhasNota, marginX + 10, cursorY + 12);
      cursorY += hNota + 6;
    }

    // Separador visual entre os empréstimos
    if (idx < resumosPorEmp.length - 1) {
      cursorY += 6;
      doc.setDrawColor(203, 213, 225);
      doc.setLineDashPattern([3, 3], 0);
      doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
      doc.setLineDashPattern([], 0);
      cursorY += 14;
    } else {
      cursorY += 10;
    }
  });

  // ── 5. FECHAMENTO TOTALIZADOR NO FINAL DO DOCUMENTO ──
  if (cursorY + 62 > pageHeight - 40) {
    doc.addPage();
    cursorY = 40;
  }

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(marginX, cursorY, contentWidth, 52, 7, 7, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `RESUMO FINAL (${emprestimos.length} EMPRÉSTIMO${emprestimos.length !== 1 ? "S" : ""})`,
    marginX + 16,
    cursorY + 20
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Capital: ${formatarMoeda(totalCapital)}   |   Juros: ${formatarMoeda(
      totalJurosContratado
    )}   |   Total Contratado: ${formatarMoeda(totalContratado)}   |   Já Pago: ${formatarMoeda(totalJaPago)}`,
    marginX + 16,
    cursorY + 37
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(52, 211, 153); // emerald-400
  doc.text(
    `A PAGAR: ${formatarMoeda(totalSaldoAberto)}`,
    marginX + contentWidth - 16,
    cursorY + 30,
    { align: "right" }
  );

  // ── 6. RODAPÉ COM PAGINAÇÃO EM TODAS AS PÁGINAS ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Demonstrativo de Empréstimos - ${nomeClienteUpper}`,
      marginX,
      pageHeight - 20
    );
    doc.text(
      `Página ${p} de ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 20,
      { align: "right" }
    );
  }

  return doc;
}

export function obterNomeArquivoEmprestimosPdf(clienteNome: string, qtd: number): string {
  const clienteSlug = (clienteNome || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `emprestimos-${clienteSlug}-${qtd}.pdf`;
}

export function baixarEmprestimosEmMassaPdf(
  data: RelatorioEmprestimosPdfData,
  nomeArquivoCustom?: string
) {
  const doc = gerarEmprestimosEmMassaPdf(data);
  const nomeArquivo =
    nomeArquivoCustom ||
    obterNomeArquivoEmprestimosPdf(data.clienteNome, data.emprestimos.length);
  doc.save(nomeArquivo);
}

export function obterEmprestimosEmMassaPdfBase64(data: RelatorioEmprestimosPdfData): string {
  const doc = gerarEmprestimosEmMassaPdf(data);
  const arrayBuffer = doc.output("arraybuffer");
  return arrayBufferToBase64(arrayBuffer);
}

