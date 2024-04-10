import "source-map-support/register.js";

import * as Comlink from "comlink";
import * as WS from "ws";
import { WebSocketEndpoint } from "./endpoint.js";
import { NodeManager } from "./link.js";

const link = new NodeManager();

const server = new WS.WebSocketServer({ port: 8081, host: "0.0.0.0" }, () => {
  console.log("Listening on port 8081");
});
server.on("connection", (client, request) => {
  const url = new URL(request.url!, "https://localhost");
  const id = url.pathname.substring(1);
  console.log("client", id);

  link.addClient(id);
  client.addEventListener("close", () => {
    console.log("client disconnected", id);
    link.deleteClient(id);
  });

  Comlink.expose(link, new WebSocketEndpoint(client as unknown as WebSocket));
});
