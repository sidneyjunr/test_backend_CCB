import mongoose from "mongoose";

const CategoriaSchema = new mongoose.Schema({
  nome: { type: String, required: true },
});

const CompeticaoSchema = new mongoose.Schema({
  nome: { type: String, required: true }, //Exemplo : Copa Cearense de Basquete
  ano: { type: Number, required: true }, // Edição 2025
  categorias: [CategoriaSchema],
});

CompeticaoSchema.index({ nome: 1, ano: 1 });

export const Competicao = mongoose.model("Competicao", CompeticaoSchema);
