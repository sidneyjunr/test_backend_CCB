import mongoose from "mongoose";

// Critérios disponíveis para ordenar a classificação de uma categoria.
// A ordem em criterios_classificacao define a prioridade (1º = mais forte).
export const CRITERIOS_CLASSIFICACAO = [
  "pontos",
  "confronto_direto",
  "saldo",
  "pontos_pro",
  "pontos_contra",
  "vitorias",
  "aproveitamento",
];

const GrupoSchema = new mongoose.Schema({
  nome: { type: String, required: true }, // Exemplo: "Grupo A"
});

const CategoriaSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  // chaveamento_unico: tabela única. grupos: uma tabela por grupo.
  formato: {
    type: String,
    enum: ["chaveamento_unico", "grupos"],
    default: "chaveamento_unico",
  },
  // Usado apenas quando formato === "grupos".
  grupos: { type: [GrupoSchema], default: [] },
  // Ordem de prioridade dos critérios de desempate da classificação.
  criterios_classificacao: {
    type: [{ type: String, enum: CRITERIOS_CLASSIFICACAO }],
    default: ["pontos", "confronto_direto", "saldo", "pontos_pro"],
  },
  // Sistema de pontuação da categoria.
  pontos_vitoria: { type: Number, default: 2, min: 0 },
  pontos_derrota: { type: Number, default: 1, min: 0 },
});

const CompeticaoSchema = new mongoose.Schema({
  nome: { type: String, required: true }, //Exemplo : Copa Cearense de Basquete
  ano: { type: Number, required: true }, // Edição 2025
  categorias: [CategoriaSchema],
});

CompeticaoSchema.index({ nome: 1, ano: 1 });

export const Competicao = mongoose.model("Competicao", CompeticaoSchema);
