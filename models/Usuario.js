import mongoose from "mongoose";
import bcrypt from "bcryptjs";

//CRIAÇÃO SIMPLES DO SCHEMA DO USUARIO
const UsuarioSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    senha_hash: { type: String, required: true },
    tipo_usuario: {
      type: String,
      enum: ["admin", "tecnico"],
      default: "tecnico",
    },
  },
  { timestamps: true } //Esse timestamp diz qual a data de criação de usuario
);

//Metodo para fazer o hash antes da senha ser salva
UsuarioSchema.pre("save", async function (next) {
  if (!this.isModified("senha_hash")) {
    //Se o contrário de senha hash for modificado já pula pro next, só vai trocar se for a senha q for trocada
    return next();
  }
  try {
    //o salt é o tempero, aqui a gente vai misturar a senha que o usuario vai mandar e gerar umas letras aleatorias para fazer a diferenciação de senhas iguais no bd
    const salt = await bcrypt.genSalt(10);

    this.senha_hash = await bcrypt.hash(this.senha_hash, salt);
  } catch (error) {
    next(error);
  }
});

UsuarioSchema.methods.matchPassword = async function (senha_digitada) {
  return await bcrypt.compare(senha_digitada, this.senha_hash);
};

export const Usuario = mongoose.model("Usuario", UsuarioSchema);
