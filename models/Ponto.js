import mongoose from "mongoose";

const pontoSchema = new mongoose.Schema(
  {
    atleta_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Atleta",
      required: true,
    },
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
    quarto: {
      type: Number,
      required: true,
      min: 1,
      max: 6,
    },
    numero_camisa: {
      type: String,
      required: true,
    },
    tipo_cesta: {
      type: Number,
      required: true,
      enum: [1, 2, 3], // 1 = lance livre, 2 = bola de 2, 3 = bola de 3
    },
  },
  { timestamps: true },
);

pontoSchema.index({ jogo_id: 1, equipe_id: 1 });
pontoSchema.index({ atleta_id: 1 });

const Ponto = mongoose.model("Ponto", pontoSchema);
export default Ponto;
