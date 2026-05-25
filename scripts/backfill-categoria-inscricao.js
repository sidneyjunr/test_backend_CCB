/*
 * Backfill do campo `categoria_id` em Inscricao.
 *
 * Inscrições criadas antes da regra de agregamento por categoria não têm o
 * campo `categoria_id`. Este script preenche cada uma usando a categoria da
 * equipe associada (equipe.categoria_id).
 *
 * Rodar uma única vez, após o deploy do novo schema:
 *   node scripts/backfill-categoria-inscricao.js
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import { Inscricao } from "../models/Inscricao.js";
import { Equipe } from "../models/Equipe.js";

dotenv.config({ quiet: true });

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("ERRO: MONGO_URI não configurado.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Conectado ao banco.");

  // Apenas inscrições ainda sem categoria_id
  const pendentes = await Inscricao.find({
    categoria_id: { $exists: false },
  });
  console.log(`Inscrições sem categoria_id: ${pendentes.length}`);

  let atualizadas = 0;
  let semEquipe = 0;

  for (const insc of pendentes) {
    const equipe = await Equipe.findById(insc.equipe_id).select("categoria_id");
    if (!equipe || !equipe.categoria_id) {
      semEquipe++;
      console.warn(
        `  [SKIP] Inscrição ${insc._id}: equipe ${insc.equipe_id} sem categoria.`
      );
      continue;
    }
    await Inscricao.updateOne(
      { _id: insc._id },
      { categoria_id: equipe.categoria_id }
    );
    atualizadas++;
  }

  console.log(`\nConcluído. Atualizadas: ${atualizadas} | Ignoradas: ${semEquipe}`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Falha no backfill:", err);
  process.exit(1);
});
