import mongoose from "mongoose";

const ArbitragemSchema = new mongoose.Schema(
  {
    crew_chief: { type: String, default: "" },
    fiscal_1: { type: String, default: "" },
    fiscal_2: { type: String, default: "" },
    crew_chief_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    fiscal_1_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    fiscal_2_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    crew_chief_assinatura: { type: String, default: null },
    fiscal_1_assinatura: { type: String, default: null },
    fiscal_2_assinatura: { type: String, default: null },
  },
  { _id: false }
);

const MesaSchema = new mongoose.Schema(
  {
    apontador: { type: String, default: "" },
    cronometrista: { type: String, default: "" },
    operador_24s: { type: String, default: "" },
    representante: { type: String, default: "" },
    apontador_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    cronometrista_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    operador_24s_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    representante_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    apontador_assinatura: { type: String, default: null },
    cronometrista_assinatura: { type: String, default: null },
    operador_24s_assinatura: { type: String, default: null },
    representante_assinatura: { type: String, default: null },
  },
  { _id: false }
);

const JogadorSumulaSchema = new mongoose.Schema(
  {
    atleta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      required: true,
    },
    numero: {
      type: Number,
      min: 0,
      max: 99,
      default: null,
    },
    // titular: começou o jogo como um dos 5 iniciais (FIBA). Imutável após o
    // início da partida — usado pelo PDF para marcar X+bolinha na coluna E.
    titular: { type: Boolean, default: false },
    // em_quadra: está atualmente em quadra (muda a cada substituição). Usado
    // pelas validações de substituição e pelo filtro da tela do mesário.
    em_quadra: { type: Boolean, default: false },
    capitao: { type: Boolean, default: false },
    faltas: { type: Number, default: 0, min: 0 },
    excluido: { type: Boolean, default: false },
    desqualificado: { type: Boolean, default: false },
  },
  { _id: false }
);

const ComissaoMembroSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true },
    funcao: { type: String, required: true },
    tecnico_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tecnico",
      default: null,
    },
    assinatura_path: { type: String, default: null },
  },
  { _id: false }
);

const PlacarQuartoSchema = new mongoose.Schema(
  {
    quarto: { type: Number, required: true, min: 1, max: 10 },
    pontos_a: { type: Number, default: 0, min: 0 },
    pontos_b: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const SumulaSchema = new mongoose.Schema(
  {
    jogo_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Jogo",
      required: true,
    },
    competicao_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Competicao",
      required: true,
    },
    equipe_a_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      required: true,
    },
    equipe_b_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      required: true,
    },
    status: {
      type: String,
      enum: ["pre_jogo", "em_andamento", "finalizada", "cancelada"],
      default: "pre_jogo",
    },
    quarto_atual: { type: Number, default: 1, min: 1, max: 10 },

    arbitragem: { type: ArbitragemSchema, default: () => ({}) },
    mesa: { type: MesaSchema, default: () => ({}) },

    jogadores_a: { type: [JogadorSumulaSchema], default: [] },
    jogadores_b: { type: [JogadorSumulaSchema], default: [] },

    comissao_a: { type: [ComissaoMembroSchema], default: [] },
    comissao_b: { type: [ComissaoMembroSchema], default: [] },

    placar_por_quarto: { type: [PlacarQuartoSchema], default: [] },
    placar_final: {
      pontos_a: { type: Number, default: 0 },
      pontos_b: { type: Number, default: 0 },
    },
    equipe_vencedora_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      default: null,
    },

    protesto: {
      houve: { type: Boolean, default: false },
      descricao: { type: String, default: "" },
    },

    hora_inicio: { type: Date, default: null },
    hora_fim: { type: Date, default: null },

    mesario_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Usuario",
      default: null,
    },

    hash_finalizado: { type: String, default: null },
  },
  { timestamps: true }
);

SumulaSchema.index({ jogo_id: 1 }, { unique: true });
SumulaSchema.index({ competicao_id: 1, status: 1 });

SumulaSchema.pre("save", async function () {
  const validarUnicoNumero = (jogadores, equipeLabel) => {
    const numeros = jogadores
      .map((j) => j.numero)
      .filter((n) => n !== null && n !== undefined);
    const set = new Set(numeros);
    if (set.size !== numeros.length) {
      return `Numeros de camisa duplicados na equipe ${equipeLabel}`;
    }
    return null;
  };

  if (this.status !== "pre_jogo") {
    const erroA = validarUnicoNumero(this.jogadores_a, "A");
    if (erroA) throw new Error(erroA);
    const erroB = validarUnicoNumero(this.jogadores_b, "B");
    if (erroB) throw new Error(erroB);

    const titularesA = this.jogadores_a.filter((j) => j.titular).length;
    const titularesB = this.jogadores_b.filter((j) => j.titular).length;
    if (titularesA !== 5 || titularesB !== 5) {
      throw new Error(
        "Cada equipe precisa de exatamente 5 titulares para iniciar"
      );
    }

    const capitaoA = this.jogadores_a.filter((j) => j.capitao).length;
    const capitaoB = this.jogadores_b.filter((j) => j.capitao).length;
    if (capitaoA !== 1 || capitaoB !== 1) {
      throw new Error("Cada equipe precisa ter exatamente 1 capitao");
    }
  }
});

export const Sumula = mongoose.model("Sumula", SumulaSchema);
