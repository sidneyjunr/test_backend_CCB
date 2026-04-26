import mongoose from "mongoose";

const AtletaSchema = new mongoose.Schema(
  {
    nome_completo: { 
      type: String, 
      required: true,
      set: (val) => val?.toUpperCase() || val
    },

    data_nascimento: {
      type: Date,
      required: true,
      set: (val) => {
        if (!val) return val;
        const d = new Date(val);
        return new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
        );
      },
    },

    documento_id: { type: String, required: true, unique: true, index: true },
    rg: { type: String },
    url_documento: { type: String },
    verificado_pelo_admin: { type: Boolean, default: false },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

AtletaSchema.virtual("data_formatada").get(function () {
  if (!this.data_nascimento) return null;
  return this.data_nascimento.toLocaleDateString("pt-BR", { timeZone: "UTC" });
});

export const Atleta = mongoose.model("Atleta", AtletaSchema);
