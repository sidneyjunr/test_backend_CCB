import mongoose from "mongoose";

const ArbitrosEscaladosSchema = new mongoose.Schema(
  {
    crew_chief_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    fiscal_1_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    fiscal_2_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    apontador_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    cronometrista_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    operador_24s_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
    representante_id: { type: mongoose.Schema.Types.ObjectId, ref: "Arbitro", default: null },
  },
  { _id: false }
);

const JogoSchema = new mongoose.Schema(
  {
    competicao_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Competicao",
      required: true,
    },
    categoria_id: { type: mongoose.Schema.Types.ObjectId, required: true },
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
    placar_a: { type: Number, default: 0 },
    placar_b: { type: Number, default: 0 },
    data_jogo: { type: Date, required: true },
    local: { type: String },
    status: {
      type: String,
      enum: ["agendado", "em andamento", "finalizado", "cancelado"],
      default: "agendado",
    },
    arbitros_escalados: { type: ArbitrosEscaladosSchema, default: () => ({}) },
  },
  { timestamps: true }
);

JogoSchema.index({ competicao_id: 1 });
JogoSchema.index({ status: 1 });

export const Jogo = mongoose.model("Jogo", JogoSchema);
