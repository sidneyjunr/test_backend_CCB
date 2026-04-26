import mongoose from "mongoose";

const InscricaoSchema = new mongoose.Schema(
  {
    atleta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      required: true,
    },
    equipe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      required: true,
    },
    competicao_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Competicao",
      required: true,
    },

    ja_jogou: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pendente", "aprovado", "recusado", "ativo", "inativo"],
      default: "pendente",
    },
    motivo_recusa: { type: String },
    tipo: {
      type: String,
      enum: ["inscricao", "agregacao"],
      default: "inscricao",
      description:
        "Tipo de solicitação: 'inscricao' (novo atleta com documento) ou 'agregacao' (atleta existente)",
    },
  },
  { timestamps: true }
);

InscricaoSchema.index({ atleta_id: 1, equipe_id: 1, competicao_id: 1 });
InscricaoSchema.index({ status: 1 });

export const Inscricao = mongoose.model("Inscricao", InscricaoSchema);
