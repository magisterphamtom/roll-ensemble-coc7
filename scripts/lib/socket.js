import { MODULE_ID } from "../settings.js";

const SOCKET_NAME = `module.${MODULE_ID}`;

export function initSocket(handlers) {
  game.socket.on(SOCKET_NAME, (payload) => {
    const handler = handlers[payload?.action];
    if (handler) handler(payload.data);
  });
}

export function broadcast(action, data) {
  game.socket.emit(SOCKET_NAME, { action, data });
}
