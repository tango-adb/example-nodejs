import type { Endpoint } from "comlink";
import { Packr, Unpackr, addExtension, type Options } from "msgpackr";

const msgpackOptions: Partial<Options> = {
  useRecords: true,
  structuredClone: true,
  bundleStrings: true,
};

const packer = new Packr(msgpackOptions);
const unpacker = new Unpackr(msgpackOptions);

let currentEndpoint: WebSocketEndpoint | null = null;

addExtension({
  Class: MessagePort,
  type: 100,
  write(instance: MessagePort) {
    const endpoint = currentEndpoint;
    if (!endpoint) {
      throw new Error("No current endpoint");
    }

    const id = (Math.random() * (1 << 30)) | 0;
    new WebSocketMessagePort(endpoint, instance, id);
    return id;
  },
  read(id: number) {
    const endpoint = currentEndpoint;
    if (!endpoint) {
      throw new Error("No current endpoint");
    }

    const channel = new MessageChannel();
    new WebSocketMessagePort(endpoint, channel.port1, id);
    return channel.port2;
  },
});

class WebSocketMessagePort {
  endpoint: WebSocketEndpoint;
  id: number;
  port: MessagePort;

  constructor(endpoint: WebSocketEndpoint, port: MessagePort, id: number) {
    this.endpoint = endpoint;
    this.id = id;
    this.port = port;
    endpoint.ports.set(this.id, this);
    port.onmessage = (e) => {
      const data = e.data;
      if (data.type === "RELEASE") {
        endpoint.ports.delete(this.id);
      }

      currentEndpoint = endpoint;
      const array = packer.pack({
        port: this.id,
        data,
        transfer: e.ports,
      });
      currentEndpoint = null;
      endpoint.send(array);
    };
  }
}

type Listener = (e: Event) => void;

export class WebSocketEndpoint implements Endpoint {
  socket: WebSocket;
  #listeners = new Set<Listener>();

  ports = new Map<number, WebSocketMessagePort>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (e) => {
      currentEndpoint = this;
      const { port, data, transfer } = unpacker.unpack(new Uint8Array(e.data));
      currentEndpoint = null;
      if (port === 0) {
        this.#listeners.forEach((listener) =>
          listener({ data } as MessageEvent)
        );
        return;
      }
      this.ports.get(port)?.port.postMessage(data, transfer);
    });
  }

  send(data: Uint8Array) {
    if (this.socket.readyState === this.socket.CONNECTING) {
      this.socket.addEventListener(
        "open",
        () => {
          this.socket.send(data);
        },
        { once: true }
      );
    } else {
      this.socket.send(data);
    }
  }

  postMessage(message: unknown, transfer: Transferable[]) {
    currentEndpoint = this;
    const array = packer.pack({
      port: 0,
      data: message,
      transfer,
    });
    currentEndpoint = null;
    this.send(array);
  }

  addEventListener(type: string, listener: Listener) {
    this.#listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.#listeners.delete(listener);
  }
}
