import mongoose from "mongoose";

const EquipeSchema = new mongoose.Schema({
  nome_equipe: { 
    type: String, 
    required: true,
    set: (val) => val?.toUpperCase() || val
  },
  //tecnicoid vai ser do tipo objeto ID referenciado lá na coleção Usuario. Até pq a gente vai criar um usuario lá no usuario.js e vai referenciar ele aqui
  tecnico_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Usuario",
    required: true,
  },
  competicao_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Competicao",
    required: true,
  },
  categoria_id: { type: mongoose.Schema.Types.ObjectId, required: true },
});

EquipeSchema.index({ tecnico_id: 1 });
EquipeSchema.index({ competicao_id: 1 });

export const Equipe = mongoose.model("Equipe", EquipeSchema);
