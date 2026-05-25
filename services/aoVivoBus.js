import { EventEmitter } from "events";

// Bus em memória para o placar/feed ao vivo. Os handlers da súmula (mesário)
// publicam aqui a cada alteração de estado e os viewers públicos consomem via
// SSE (publicController.streamAoVivo).
//
// LIMITAÇÃO: funciona apenas com UMA instância do backend (deploy atual:
// `node index.js`). Se um dia escalar para múltiplas instâncias/cluster, este
// bus em memória não propaga entre processos — trocar por Redis pub/sub.
const emitter = new EventEmitter();
// Muitos viewers podem assistir o mesmo jogo; desliga o aviso de leak do Node.
emitter.setMaxListeners(0);

const canal = (jogoId) => `jogo:${jogoId}`;
// Canal único agregado para a home — evita N conexões SSE (1 por jogo ao vivo)
// que estourariam o limite de 6 conexões/origem do HTTP/1.1 no navegador.
const CANAL_HOME = "home";

export const publicar = (jogoId, payload) => {
  if (!jogoId) return;
  emitter.emit(canal(jogoId), payload);
  // Espelha o essencial (placar + status) no canal da home.
  emitter.emit(CANAL_HOME, {
    jogoId: String(jogoId),
    placar: payload?.placar ?? null,
    encerrado: !!payload?.encerrado,
  });
};

// Inscreve um listener no canal de um jogo. Retorna função de cancelamento.
export const inscrever = (jogoId, cb) => {
  const c = canal(jogoId);
  emitter.on(c, cb);
  return () => emitter.off(c, cb);
};

// Inscreve no canal agregado da home (todos os jogos ao vivo num só stream).
export const inscreverHome = (cb) => {
  emitter.on(CANAL_HOME, cb);
  return () => emitter.off(CANAL_HOME, cb);
};
