"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
  payFullLoan,
  receberSoJurosEmprestimo,
  reprogramarEmprestimo,
} from "@/app/emprestimos/[id]/actions";

export type AcaoEmMassa = "excluir" | "renovar" | "reprogramar" | "quitar";

export interface ResultadoItemMassa {
  id: string;
  status: "ok" | "ignorado" | "erro";
  mensagem?: string;
}

export interface ResultadoEmMassa {
  itens: ResultadoItemMassa[];
}

interface OpcoesEmMassa {
  /** yyyy-mm-dd — obrigatório para "reprogramar". */
  novaData?: string;
  /** Quitar: cobrar juros de atraso conforme a regra de cada empréstimo (padrão: true). */
  cobrarJurosAtraso?: boolean;
  /** Enviar confirmação via WhatsApp (padrão: false nas ações em massa, exceto quando solicitado). */
  enviarWhatsapp?: boolean;
}

/**
 * Aplica uma ação a vários empréstimos de UM cliente.
 * Cada empréstimo é processado de forma independente: uma falha não desfaz os demais.
 * Não envia WhatsApp (evita uma mensagem por empréstimo para o mesmo cliente).
 */
export async function alterarEmprestimosEmMassa(
  clienteId: string,
  ids: string[],
  acao: AcaoEmMassa,
  opcoes: OpcoesEmMassa = {}
): Promise<ResultadoEmMassa> {
  if (!ids || ids.length === 0) {
    throw new Error("Selecione ao menos um empréstimo.");
  }
  if (acao === "reprogramar" && !/^\d{4}-\d{2}-\d{2}$/.test(opcoes.novaData ?? "")) {
    throw new Error("Informe a nova data de vencimento.");
  }

  // Só empréstimos do próprio cliente (impede ids de outro cliente via requisição manipulada)
  const emprestimos = await prisma.emprestimo.findMany({
    where: { id: { in: ids }, cliente_id: clienteId },
    include: { parcelas: { select: { status: true } } },
  });
  const porId = new Map(emprestimos.map((e) => [e.id, e]));

  const itens: ResultadoItemMassa[] = [];

  for (const id of ids) {
    const emp = porId.get(id);
    if (!emp) {
      itens.push({ id, status: "erro", mensagem: "Empréstimo não encontrado para este cliente." });
      continue;
    }

    try {
      if (acao === "excluir") {
        await prisma.emprestimo.delete({ where: { id } });
        itens.push({ id, status: "ok" });
        continue;
      }

      const abertas = emp.parcelas.filter((p) => p.status === "aberto").length;
      if (abertas === 0) {
        itens.push({ id, status: "ignorado", mensagem: "Sem parcelas em aberto (já quitado)." });
        continue;
      }

      if (acao === "renovar") {
        // Mesma regra do botão de renovação da lista: só empréstimos à vista (nunca parcelados)
        const isRenov = (s: string) => s === "pago_renovacao" || s.includes("renovacao") || s === "renovado";
        const naoRenov = emp.parcelas.filter((p) => !isRenov(p.status));
        const isParcelado =
          emp.tipo_pagamento === "parcelado" ||
          emp.tipo_pagamento === "parcela_juros_mes" ||
          abertas > 1;
        const isAVista =
          !isParcelado &&
          (emp.tipo_pagamento === "a_vista" ||
            emp.tipo_pagamento === "a_vista_juros" ||
            emp.tipo_pagamento === "juros_compostos" ||
            naoRenov.length <= 1);
        if (!isAVista) {
          itens.push({ id, status: "ignorado", mensagem: "Renovação só vale para empréstimos à vista." });
          continue;
        }
        await receberSoJurosEmprestimo(id, opcoes.enviarWhatsapp ?? false);
      } else if (acao === "reprogramar") {
        await reprogramarEmprestimo(id, opcoes.novaData!, 0, 0, emp.frequencia, opcoes.enviarWhatsapp ?? false);
      } else if (acao === "quitar") {
        await payFullLoan(id, false, opcoes.cobrarJurosAtraso ?? true, opcoes.enviarWhatsapp ?? false);
      }

      itens.push({ id, status: "ok" });
    } catch (err: unknown) {
      itens.push({ id, status: "erro", mensagem: (err instanceof Error && err.message) || "Erro inesperado." });
    }
  }

  revalidatePath(`/clientes/${clienteId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  return { itens };
}
