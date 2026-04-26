import mongoose from "mongoose";
import bcrypt from "bcryptjs";

export const FUNCOES_ARBITRO = [
  "crew_chief",
  "fiscal_1",
  "fiscal_2",
  "apontador",
  "cronometrista",
  "operador_24s",
  "representante",
];

const ArbitroSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    senha_hash: { type: String, required: true },
    funcoes: {
      type: [String],
      enum: FUNCOES_ARBITRO,
      default: [],
    },
    assinatura_path: { type: String, default: null },
    assinatura_public_id: { type: String, default: null },
    assinatura_definida: { type: Boolean, default: false },
    senha_redefinida: { type: Boolean, default: false },
    jogos_contador: { type: Number, default: 0, min: 0 },
    tentativas_falhas: { type: Number, default: 0, min: 0 },
    bloqueado_ate: { type: Date, default: null },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ArbitroSchema.index({ funcoes: 1 });

ArbitroSchema.pre("save", async function () {
  if (!this.isModified("senha_hash")) return;
  const salt = await bcrypt.genSalt(10);
  this.senha_hash = await bcrypt.hash(this.senha_hash, salt);
});

ArbitroSchema.methods.matchSenha = async function (senha_digitada) {
  return bcrypt.compare(senha_digitada, this.senha_hash);
};

export const Arbitro = mongoose.model("Arbitro", ArbitroSchema);
