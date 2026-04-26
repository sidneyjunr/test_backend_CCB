import mongoose from "mongoose";

const EscalacaoSchema = new mongoose.Schema(
  {
    jogo_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Jogo",
      required: true,
    },
    equipe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      required: true,
    },
    atletas_selecionados: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Atleta" },
    ],
    camisas: [
      {
        atleta_id: { type: mongoose.Schema.Types.ObjectId, ref: "Atleta" },
        numero_camisa: { type: String },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const Escalacao = mongoose.model("Escalacao", EscalacaoSchema);
