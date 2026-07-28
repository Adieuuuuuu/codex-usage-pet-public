import { DurableObject } from "cloudflare:workers";
import { RoomHandler } from "./room.js";
import { handleWorkerRequest } from "./worker.js";

export default {
  async fetch(request, env) {
    return handleWorkerRequest(request, env);
  },
};

export class CodexPhoneRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.handler = new RoomHandler(ctx, env);
  }

  fetch(request) {
    return this.handler.fetch(request);
  }

  webSocketMessage(socket, message) {
    return this.handler.webSocketMessage(socket, message);
  }

  webSocketError(socket, error) {
    return this.handler.webSocketError(socket, error);
  }
}
