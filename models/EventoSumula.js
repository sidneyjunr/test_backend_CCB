import mongoose from "mongoose";

const TIPOS_EVENTO = [
  "ponto",
  "falta",
  "timeout",
  "substituicao",
  "inicio_quarto",
  "fim_quarto",
];

// FIBA 2024:
//   P = Pessoal (com lances_livres 0/1/2/3)
//   T = Tecnica de jogador (2a T -> desqualificacao)
//   C = Tecnica do tecnico (Coach)
//   B = Tecnica de banco (comissao/substituto)
//   U = Antidesportiva (2a U -> desqualificacao)
//   D = Desqualificante (desqualificacao imediata)
// P2 / U2 sao aliases legados mantidos para compatibilidade com eventos antigos.
const TIPOS_FALTA = ["P", "T", "C", "B", "U", "D", "P2", "U2"];

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

    ponto_progressivo: { type: Number, default: null, min: 0 },

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
    // Faltas C (tecnico) e B (banco/comissao) podem ser atribuidas ao
    // tecnico_id em vez de jogador_id. Demais tipos exigem jogador.
    const ehFaltaTecnico =
      (this.tipo_falta === "C" || this.tipo_falta === "B") && this.tecnico_id;
    if (!this.jogador_id && !ehFaltaTecnico) {
      throw new Error("Evento falta requer jogador_id ou tecnico_id (C/B)");
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
});

export const EventoSumula = mongoose.model("EventoSumula", EventoSumulaSchema);
export const TIPOS_FALTA_ENUM = TIPOS_FALTA;
export const TIPOS_EVENTO_ENUM = TIPOS_EVENTO;
