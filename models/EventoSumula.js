import mongoose from "mongoose";

const TIPOS_EVENTO = [
  "ponto",
  "falta",
  "timeout",
  "substituicao",
  "inicio_quarto",
  "fim_quarto",
  // Snapshot de quem esta em quadra apos timeout / fim_quarto. FIBA: tecnico
  // nao precisa anunciar pares de substituicao apos esses eventos. Mesario
  // marca os 5 atletas em quadra e o sistema infere as entradas que faltam.
  "set_em_quadra",
  // Atleta escalado sem numero (chegou atrasado) recebe numero de camisa
  // durante o jogo. Registrado como evento para entrar no botao desfazer.
  "definir_numero",
];

// FIBA 2024:
//   P = Pessoal (com lances_livres 0/1/2/3)
//   T = Tecnica de jogador (2a T -> desqualificacao)
//   C = Tecnica do tecnico (Coach)
//   B = Tecnica de banco (comissao/substituto)
//   U = Antidesportiva (2a U -> desqualificacao)
//   D = Desqualificante (desqualificacao imediata)
//   F = Briga (Art. 39 / B.8.3.14) — preenche todos os espacos restantes do
//       atleta com "F". Conta como pessoal (entra em FALTAS_PESSOAIS).
// P2 / U2 sao aliases legados mantidos para compatibilidade com eventos antigos.
const TIPOS_FALTA = ["P", "T", "C", "B", "U", "D", "F", "P2", "U2"];

const EventoSumulaSchema = new mongoose.Schema(
  {
    sumula_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sumula",
      required: true,
    },
    sequencia: { type: Number, required: true, min: 1 },
    quarto: { type: Number, required: true, min: 1, max: 10 },
    tipo: { type: String, enum: TIPOS_EVENTO, required: true },
    equipe: {
      type: String,
      enum: ["A", "B"],
      default: null,
    },
    jogador_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      default: null,
    },

    // Falta atribuida ao tecnico (C) ou banco/comissao (B). Quando setado,
    // jogador_id deve ser null. Conta na sumula contra a comissao tecnica.
    tecnico_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tecnico",
      default: null,
    },

    // Par de faltas canceladas reciprocamente (FIBA B.8.4 — penalidades iguais
    // entre adversarios podem se compensar). Aponta para o evento da outra
    // falta. LEGADO: novos eventos usam `cancelada_manual` (flag simples) e
    // o pareamento eh feito visualmente pelo arbitro. Mantido aqui para nao
    // quebrar sumulas antigas.
    falta_cancelada_por: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventoSumula",
      default: null,
    },

    // Flag manual de falta cancelada — quando true, o PDF imprime sufixo "c"
    // (ex.: Pc, Tc) e os lances livres nao sao executados. O pareamento entre
    // duas faltas que se compensam fica sob responsabilidade do arbitro: ele
    // marca cada uma das duas como cancelada e o sistema apenas registra.
    cancelada_manual: {
      type: Boolean,
      default: false,
    },

    // Cascata FIBA B.8.3.10: D em substituto/assistente gera B2 adicional no
    // tecnico principal. Este campo aponta para o evento original (D) que
    // disparou a cascata. Cascatas NAO contam como falta de equipe (Art. 39).
    cascata_de: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventoSumula",
      default: null,
    },

    // FIBA B.8.3.14 / B.8.3.15 — subtipo de briga.
    //   "invasao"           = sair da area do banco durante briga (B.8.3.14)
    //   "envolvimento_ativo" = participacao fisica ativa na briga (B.8.3.15)
    // Quando setado em evento D/F, dispara fluxo especial de cascata:
    //   - Invasao: pessoa banco recebe D + F nos slots restantes; tecnico recebe
    //     UNICA B2 (deduplicada por fight_group_id).
    //   - Envolvimento: pessoa recebe D2 + F restantes; tecnico recebe UNICA B2;
    //     se proprio tecnico envolvido recebe D2+F+F (sem B2 extra).
    subtipo_briga: {
      type: String,
      enum: ["invasao", "envolvimento_ativo", null],
      default: null,
    },

    // Identificador comum a todos os eventos da mesma briga. Usado para
    // deduplicar a cascata B2 do tecnico — uma briga gera UMA B2, mesmo com
    // varios envolvidos. Mesma briga pode ser editada incrementalmente
    // (adicionar mais envolvidos) reusando o mesmo fight_group_id.
    fight_group_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // FIBA B.8.3.13/.14/.15 — falta de membro da delegacao acompanhante.
    // Anota-se com "B" (ou "B2") com circulo (B circulado / B2 circulado) na
    // linha do tecnico principal. NAO conta para o limite de 3 tecnicas que
    // gera GD do tecnico. PDF renderiza com SVG circle ao redor da letra.
    marcador_circulo: {
      type: Boolean,
      default: false,
    },

    // Categoria FIBA da pessoa que recebeu a falta. Usada pelo recálculo do
    // estado para decidir se a falta conta como falta de equipe e se
    // incrementa o contador pessoal do atleta.
    categoria_pessoa: {
      type: String,
      enum: [
        "jogador_quadra",
        "substituto",
        "excluido",
        "tecnico",
        "assistente",
        null,
      ],
      default: null,
    },

    valor: {
      type: Number,
      enum: [1, 2, 3, null],
      default: null,
    },

    tipo_falta: {
      type: String,
      enum: [...TIPOS_FALTA, null],
      default: null,
    },

    // Lances livres concedidos pela falta (FIBA 2024 B.8.3.8).
    // P: 0 (sem LL) | 1 (cesta e falta) | 2 (no ato de arremesso de 2) | 3 (no ato de arremesso de 3)
    // T: 1 (padrao) | C: 1 | B: 1 ou 2 (B2 com desqualificacao de membro)
    // U: 2 (padrao) | 3 (no ato de arremesso de 3)
    // D: 2 (padrao)
    lances_livres: {
      type: Number,
      min: 0,
      max: 3,
      default: null,
    },

    jogador_entra_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      default: null,
    },
    jogador_sai_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      default: null,
    },

    // FIBA B.7: apenas o minuto inteiro do quarto (0-10) em que o timeout foi concedido.
    minuto_jogo: { type: Number, min: 0, max: 10, default: null },

    // FIBA B.8.4 — regra "uso ou perde": no Q4 com 3/3 timeouts disponiveis,
    // se o tecnico pede TO nos ultimos 2 minutos, perde automaticamente o 1o
    // dos 3. Marcado em evento timeout sintetico (sem minuto_jogo) que
    // antecede o TO real. Renderizado na sumula como caixa riscada.
    perdido_2min: { type: Boolean, default: false },

    ponto_progressivo: { type: Number, default: null, min: 0 },

    // Snapshot do conjunto em quadra para evento set_em_quadra. Lista de
    // atleta_id (ate 5 elementos em jogos normais; menos quando o time
    // continua com N-1 apos exclusao sem reposicao).
    jogadores_em_quadra: {
      type: [mongoose.Schema.Types.ObjectId],
      default: undefined,
    },

    cancelado: { type: Boolean, default: false },

    ip: { type: String, default: null },
    user_agent: { type: String, default: null },
  },
  { timestamps: true }
);

EventoSumulaSchema.index({ sumula_id: 1, sequencia: 1 }, { unique: true });
EventoSumulaSchema.index({ sumula_id: 1, cancelado: 1 });
EventoSumulaSchema.index({ sumula_id: 1, tipo: 1 });

EventoSumulaSchema.pre("validate", async function () {
  if (this.tipo === "ponto") {
    if (![1, 2, 3].includes(this.valor)) {
      throw new Error("Evento ponto requer valor 1, 2 ou 3");
    }
    if (!this.jogador_id || !this.equipe) {
      throw new Error("Evento ponto requer jogador_id e equipe");
    }
  }
  if (this.tipo === "falta") {
    if (!TIPOS_FALTA.includes(this.tipo_falta)) {
      throw new Error("Evento falta requer tipo_falta valido");
    }
    if (!this.equipe) {
      throw new Error("Evento falta requer equipe");
    }
    // Faltas C (tecnico), B (banco/comissao) e D (desqualificante — direta
    // ou via briga, FIBA Art. 39 / B.8.3.14) podem ser atribuidas ao
    // tecnico_id em vez de jogador_id. FIBA Art. 7.9 — quando o tecnico e um
    // jogador-tecnico, C/B/D sao atribuidas ao jogador_id dele (com
    // categoria_pessoa="tecnico"). Demais tipos exigem jogador.
    const ehFaltaComissao =
      (this.tipo_falta === "C" || this.tipo_falta === "B" || this.tipo_falta === "D") &&
      (this.tecnico_id || this.jogador_id);
    if (!this.jogador_id && !ehFaltaComissao) {
      throw new Error("Evento falta requer jogador_id ou tecnico_id (C/B/D)");
    }
  }
  if (this.tipo === "substituicao") {
    // jogador_entra_id pode ser null quando e uma saida forcada (jogador excluido/
    // desqualificado e o banco nao tem reposicao, time joga com N-1).
    if (!this.jogador_sai_id || !this.equipe) {
      throw new Error(
        "Evento substituicao requer jogador_sai_id e equipe"
      );
    }
  }
  if (this.tipo === "timeout" && !this.equipe) {
    throw new Error("Evento timeout requer equipe");
  }
  if (this.tipo === "set_em_quadra") {
    if (!this.equipe) {
      throw new Error("Evento set_em_quadra requer equipe");
    }
    if (
      !Array.isArray(this.jogadores_em_quadra) ||
      this.jogadores_em_quadra.length < 2 ||
      this.jogadores_em_quadra.length > 5
    ) {
      throw new Error(
        "Evento set_em_quadra requer 2 a 5 atletas em jogadores_em_quadra",
      );
    }
  }
});

export const EventoSumula = mongoose.model("EventoSumula", EventoSumulaSchema);
export const TIPOS_FALTA_ENUM = TIPOS_FALTA;
export const TIPOS_EVENTO_ENUM = TIPOS_EVENTO;
