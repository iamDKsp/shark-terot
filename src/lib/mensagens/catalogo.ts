/**
 * Catálogo ÚNICO de mensagens WhatsApp do sistema.
 *
 * Este arquivo é puro (sem imports de servidor) e pode ser usado tanto no
 * servidor quanto em componentes client (ex.: pré-visualização do editor).
 *
 * O usuário só grava no banco quando EDITA uma mensagem; sem edição vale o
 * `textoPadrao` daqui. "Restaurar padrão" = apagar a linha do banco.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Variáveis
// ─────────────────────────────────────────────────────────────────────────────

export const VARIAVEIS = {
  nome: { descricao: "Primeiro nome do cliente", exemplo: "Maria" },
  nome_completo: { descricao: "Nome completo do cliente", exemplo: "Maria da Silva" },
  valor: { descricao: "Valor da parcela", exemplo: "R$ 1.200,00" },
  data: { descricao: "Data de vencimento da parcela", exemplo: "15/10/2026" },
  num: { descricao: "Número da parcela", exemplo: "3" },
  total_parcelas: { descricao: "Total de parcelas do empréstimo", exemplo: "10" },
  valor_emprestado: { descricao: "Valor emprestado (principal)", exemplo: "R$ 5.000,00" },
  valor_renovacao: { descricao: "Valor da renovação (juros do período)", exemplo: "R$ 500,00" },
  dias_atraso: { descricao: "Dias de atraso da parcela", exemplo: "4" },
  saldo_restante: { descricao: "Saldo restante em aberto", exemplo: "R$ 3.600,00" },
  novo_vencimento: { descricao: "Novo vencimento (após renovação/reprogramação)", exemplo: "15/11/2026" },
  pix_chave: { descricao: "Chave Pix cadastrada", exemplo: "11999998888 (Banco)" },
  pix_titular: { descricao: "Titular do Pix cadastrado", exemplo: "João da Silva" },
  empresa: { descricao: "Nome da empresa", exemplo: "Soluções Financeiras" },
} as const;

export type VariavelId = keyof typeof VARIAVEIS;

export const VARIAVEIS_IDS = Object.keys(VARIAVEIS) as VariavelId[];

/** Contexto usado para preencher as variáveis. Variável ausente vira vazio. */
export type ContextoMensagem = Partial<Record<VariavelId, string>>;

/** Dados fictícios usados na pré-visualização e no "enviar teste". */
export const CONTEXTO_EXEMPLO: Record<VariavelId, string> = Object.fromEntries(
  VARIAVEIS_IDS.map((id) => [id, VARIAVEIS[id].exemplo])
) as Record<VariavelId, string>;

// ─────────────────────────────────────────────────────────────────────────────
// Mensagens
// ─────────────────────────────────────────────────────────────────────────────

export type GrupoMensagem = "cobranca" | "confirmacoes" | "eventos";

export const GRUPOS: Record<GrupoMensagem, { titulo: string; descricao: string }> = {
  cobranca: {
    titulo: "Cobranças",
    descricao: "Lembretes enviados na tela de Cobranças (atrasados, vencendo hoje e a vencer).",
  },
  confirmacoes: {
    titulo: "Confirmações automáticas",
    descricao: "Enviadas automaticamente quando você registra um pagamento, renovação ou novo empréstimo.",
  },
  eventos: {
    titulo: "Outros eventos",
    descricao: "Mensagens opcionais para renegociação e reprogramação. Começam desligadas.",
  },
};

export interface MensagemDef {
  chave: string;
  grupo: GrupoMensagem;
  titulo: string;
  /** Quando esta mensagem é enviada. */
  descricao: string;
  textoPadrao: string;
  /** Variáveis que fazem sentido nesta mensagem. */
  variaveis: VariavelId[];
  /** Estado padrão (ligada/desligada) enquanto o usuário não mexer. */
  padraoAtivo: boolean;
  /** Se o usuário pode desligar esta mensagem. */
  podeDesativar: boolean;
}

const VARS_COBRANCA_PARCELADO: VariavelId[] = [
  "nome", "nome_completo", "valor", "data", "num", "total_parcelas",
  "valor_emprestado", "dias_atraso", "saldo_restante", "empresa",
];
const VARS_COBRANCA_AVISTA: VariavelId[] = [
  "nome", "nome_completo", "valor", "data",
  "valor_emprestado", "valor_renovacao", "dias_atraso", "saldo_restante", "empresa",
];

export const MENSAGENS: MensagemDef[] = [
  // ── Cobranças · Parcelado ──
  {
    chave: "cobranca.atrasado.parcelado",
    grupo: "cobranca",
    titulo: "Atrasado / Vencido · Parcelado",
    descricao: "Parcela de empréstimo parcelado que já venceu.",
    textoPadrao:
      "Olá, {nome}! Notamos que a parcela nº {num} no valor de {valor} do seu empréstimo está pendente (venceu em {data}). Por favor, regularize o quanto antes.",
    variaveis: VARS_COBRANCA_PARCELADO,
    padraoAtivo: true,
    podeDesativar: false,
  },
  {
    chave: "cobranca.hoje.parcelado",
    grupo: "cobranca",
    titulo: "Vencendo hoje · Parcelado",
    descricao: "Parcela de empréstimo parcelado que vence hoje.",
    textoPadrao:
      "Olá, {nome}! Passando para lembrar que hoje ({data}) vence a sua parcela nº {num} no valor de {valor}. Caso já tenha pago, por favor desconsidere.",
    variaveis: VARS_COBRANCA_PARCELADO,
    padraoAtivo: true,
    podeDesativar: false,
  },
  {
    chave: "cobranca.avencer.parcelado",
    grupo: "cobranca",
    titulo: "A vencer (lembrete) · Parcelado",
    descricao: "Parcela de empréstimo parcelado que vence nos próximos 3 dias.",
    textoPadrao:
      "Olá, {nome}! Lembrete: a sua parcela nº {num} no valor de {valor} vencerá em breve, no dia {data}.",
    variaveis: VARS_COBRANCA_PARCELADO,
    padraoAtivo: true,
    podeDesativar: false,
  },
  // ── Cobranças · À vista ──
  {
    chave: "cobranca.atrasado.avista",
    grupo: "cobranca",
    titulo: "Atrasado / Vencido · À vista",
    descricao: "Empréstimo à vista (parcela única) que já venceu.",
    textoPadrao:
      "Olá, {nome}! Notamos que o pagamento de {valor} do seu empréstimo está pendente (venceu em {data}). Por favor, regularize o quanto antes.",
    variaveis: VARS_COBRANCA_AVISTA,
    padraoAtivo: true,
    podeDesativar: false,
  },
  {
    chave: "cobranca.hoje.avista",
    grupo: "cobranca",
    titulo: "Vencendo hoje · À vista",
    descricao: "Empréstimo à vista (parcela única) que vence hoje.",
    textoPadrao:
      "Olá, {nome}! Passando para lembrar que hoje ({data}) vence o pagamento de {valor} do seu empréstimo. Caso já tenha pago, por favor desconsidere.",
    variaveis: VARS_COBRANCA_AVISTA,
    padraoAtivo: true,
    podeDesativar: false,
  },
  {
    chave: "cobranca.avencer.avista",
    grupo: "cobranca",
    titulo: "A vencer (lembrete) · À vista",
    descricao: "Empréstimo à vista (parcela única) que vence nos próximos 3 dias.",
    textoPadrao:
      "Olá, {nome}! Lembrete: o pagamento de {valor} do seu empréstimo vencerá em breve, no dia {data}.",
    variaveis: VARS_COBRANCA_AVISTA,
    padraoAtivo: true,
    podeDesativar: false,
  },
  // ── Rodapé das cobranças ──
  {
    chave: "cobranca.rodape",
    grupo: "cobranca",
    titulo: "Rodapé das cobranças (Pix e renovação)",
    descricao:
      "Anexado ao final de TODAS as mensagens de cobrança. Se a chave Pix não estiver cadastrada, o rodapé não é enviado.",
    textoPadrao:
      "💳 *Para pagar:*\nPix: {pix_chave}\nNome: {pix_titular}\n\nSe preferir, podemos combinar para buscar pessoalmente em dinheiro. 😊\n\n🔄 *Ou, se preferir, podemos fazer a renovação do empréstimo!*\nO valor da renovação é de apenas *{valor_renovacao}* (juros do período). Entre em contato e combinamos!",
    variaveis: ["pix_chave", "pix_titular", "valor_renovacao", "valor", "data", "nome", "empresa"],
    padraoAtivo: true,
    podeDesativar: true,
  },

  // ── Confirmações automáticas ──
  {
    chave: "pagamento.parcela",
    grupo: "confirmacoes",
    titulo: "Pagamento de parcela confirmado",
    descricao: "Enviada ao registrar o pagamento de uma parcela (sem quitar o empréstimo).",
    textoPadrao: "Muito obrigado, pagamento confirmado!",
    variaveis: ["nome", "nome_completo", "valor", "num", "total_parcelas", "saldo_restante", "empresa"],
    padraoAtivo: true,
    podeDesativar: true,
  },
  {
    chave: "pagamento.quitacao",
    grupo: "confirmacoes",
    titulo: "Empréstimo quitado",
    descricao: "Enviada ao quitar o empréstimo (quitação total ou pagamento da última parcela).",
    textoPadrao: "Muito obrigado, {nome}! Pagamento confirmado e seu empréstimo foi quitado. 🎉",
    variaveis: ["nome", "nome_completo", "valor", "valor_emprestado", "empresa"],
    padraoAtivo: true,
    podeDesativar: true,
  },
  {
    chave: "renovacao.confirmada",
    grupo: "confirmacoes",
    titulo: "Renovação confirmada",
    descricao: "Enviada ao receber só os juros e renovar o empréstimo.",
    textoPadrao: "Sua renovação foi feita com sucesso! Obrigado.",
    variaveis: ["nome", "nome_completo", "valor", "novo_vencimento", "valor_emprestado", "empresa"],
    padraoAtivo: true,
    podeDesativar: true,
  },
  {
    chave: "emprestimo.contratado",
    grupo: "confirmacoes",
    titulo: "Novo empréstimo (legenda do PDF)",
    descricao: "Legenda do PDF do cronograma enviado ao criar um empréstimo.",
    textoPadrao: "Contratação realizada com sucesso!",
    variaveis: ["nome", "nome_completo", "valor_emprestado", "total_parcelas", "empresa"],
    padraoAtivo: true,
    podeDesativar: false,
  },
  {
    chave: "cronograma.envio",
    grupo: "confirmacoes",
    titulo: "Envio do cronograma (legenda do PDF)",
    descricao: "Legenda do PDF quando você clica em enviar o cronograma no detalhe do empréstimo.",
    textoPadrao: "Olá {nome_completo}, segue em anexo o cronograma de parcelas do seu empréstimo.",
    variaveis: ["nome", "nome_completo", "valor_emprestado", "total_parcelas", "empresa"],
    padraoAtivo: true,
    podeDesativar: false,
  },

  // ── Outros eventos (desligados por padrão) ──
  {
    chave: "renegociacao.confirmada",
    grupo: "eventos",
    titulo: "Renegociação registrada",
    descricao: "Enviada após renegociar a dívida (abatimento + novo vencimento).",
    textoPadrao:
      "Olá, {nome}! Sua renegociação foi registrada. Saldo restante: {saldo_restante}. Novo vencimento: {novo_vencimento}.",
    variaveis: ["nome", "nome_completo", "saldo_restante", "novo_vencimento", "valor", "empresa"],
    padraoAtivo: false,
    podeDesativar: true,
  },
  {
    chave: "reprogramacao.confirmada",
    grupo: "eventos",
    titulo: "Reprogramação registrada",
    descricao: "Enviada após reprogramar o empréstimo (nova data e/ou frequência).",
    textoPadrao:
      "Olá, {nome}! Seu empréstimo foi reprogramado. Novo vencimento: {novo_vencimento}. Saldo em aberto: {saldo_restante}.",
    variaveis: ["nome", "nome_completo", "saldo_restante", "novo_vencimento", "valor", "empresa"],
    padraoAtivo: false,
    podeDesativar: true,
  },
];

export type ChaveMensagem = (typeof MENSAGENS)[number]["chave"];

const POR_CHAVE = new Map(MENSAGENS.map((m) => [m.chave, m]));

export function getMensagemDef(chave: string): MensagemDef | undefined {
  return POR_CHAVE.get(chave);
}

/** Chave da mensagem de cobrança para um tipo/modalidade. */
export function chaveCobranca(
  tipo: "atrasados" | "hoje" | "aVencer",
  parcelaUnica: boolean
): string {
  const t = tipo === "atrasados" ? "atrasado" : tipo === "hoje" ? "hoje" : "avencer";
  return `cobranca.${t}.${parcelaUnica ? "avista" : "parcelado"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configurações da base (Pix, empresa) e respostas rápidas
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfiguracoesBase {
  pix_chave: string;
  pix_titular: string;
  empresa_nome: string;
}

/** Sem dados pessoais como padrão: cada base cadastra o seu Pix. */
export const CONFIG_PADRAO: ConfiguracoesBase = {
  pix_chave: "",
  pix_titular: "",
  empresa_nome: "Soluções Financeiras",
};

export const RESPOSTAS_RAPIDAS_PADRAO: string[] = [
  "Olá, {nome}, tudo bem? Lembrando que seu empréstimo vence em breve.",
  "Olá, {nome}, sua parcela vence hoje. Qualquer dúvida estou à disposição!",
  "Muito obrigado, pagamento confirmado!",
  "Olá, {nome}, notamos um pequeno atraso. Como podemos ajudar?",
  "Olá, {nome}, seu empréstimo já consta como quitado. Muito obrigado!",
];

/** Variáveis aceitas nas respostas rápidas e na mensagem personalizada. */
export const VARIAVEIS_RESPOSTA_RAPIDA: VariavelId[] = VARIAVEIS_IDS;
