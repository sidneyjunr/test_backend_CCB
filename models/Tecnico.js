import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const TecnicoSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    senha_hash: { type: String },
    equipe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Equipe",
      required: true,
    },
    is_assistente: { type: Boolean, default: false },
    assinatura_path: { type: String, default: null },
    assinatura_public_id: { type: String, default: null },
    assinatura_definida: { type: Boolean, default: false },
    senha_redefinida: { type: Boolean, default: false },
    tentativas_falhas: { type: Number, default: 0, min: 0 },
    bloqueado_ate: { type: Date, default: null },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

TecnicoSchema.index({ equipe_id: 1 });

TecnicoSchema.pre("save", async function () {
  if (!this.isModified("senha_hash")) return;
  if (!this.senha_hash) return;
  const salt = await bcrypt.genSalt(10);
  this.senha_hash = await bcrypt.hash(this.senha_hash, salt);
});

TecnicoSchema.methods.matchSenha = async function (senha_digitada) {
  if (!this.senha_hash) return false;
  return bcrypt.compare(senha_digitada, this.senha_hash);
};

export const Tecnico = mongoose.model("Tecnico", TecnicoSchema);
