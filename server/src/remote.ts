import { AdbDaemonTransport, AdbFeature, type AdbSocket } from "@yume-chan/adb";
import {
  Consumable,
  type ReadableStreamDefaultReadResult,
  type ReadableStreamDefaultReader,
} from "@yume-chan/stream-extra";
import * as Comlink from "comlink";

export class SocketLink {
  #socket: AdbSocket;
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #writer: WritableStreamDefaultWriter<Consumable<Uint8Array>>;

  get closed() {
    return this.#socket.closed;
  }

  constructor(socket: AdbSocket) {
    this.#socket = socket;
    this.#reader = socket.readable.getReader();
    this.#writer = socket.writable.getWriter();
  }

  async read(): Promise<ReadableStreamDefaultReadResult<Uint8Array>> {
    return await this.#reader.read();
  }

  async write(data: Uint8Array, consume: () => void) {
    const consumable = new Consumable(data);
    await this.#writer.write(consumable);
    await consumable.consumed;
    consume();
  }

  async #readRemaining() {
    try {
      while (true) {
        const { done } = await this.#reader.read();
        if (done) {
          return;
        }
      }
    } catch {}
  }

  async close() {
    this.#readRemaining();
    await this.#socket.close();
  }
}

export interface LinkTransportProperties {
  serial: string;
  maxPayloadSize: number;
  banner: {
    product: string | undefined;
    model: string | undefined;
    device: string | undefined;
    features: AdbFeature[];
  };
  clientFeatures: readonly AdbFeature[];
}

export class TransportManager {
  #transport: AdbDaemonTransport;

  constructor(transport: AdbDaemonTransport) {
    this.#transport = transport;
  }

  get serial() {
    return this.#transport.serial;
  }

  get properties(): Promise<LinkTransportProperties> {
    return Promise.resolve({
      serial: this.#transport.serial,
      maxPayloadSize: this.#transport.maxPayloadSize,
      banner: {
        product: this.#transport.banner.product,
        model: this.#transport.banner.model,
        device: this.#transport.banner.device,
        features: this.#transport.banner.features,
      },
      clientFeatures: this.#transport.clientFeatures,
    });
  }

  get disconnected() {
    return this.#transport.disconnected;
  }

  async connect(service: string): Promise<AdbSocket> {
    return await this.#transport.connect(service);
  }

  async addReverseTunnel(
    handler: (socket: AdbSocket) => void,
    address?: string
  ) {
    return this.#transport.addReverseTunnel(handler, address);
  }

  async removeReverseTunnel(address: string) {
    return this.#transport.removeReverseTunnel(address);
  }

  async clearReverseTunnels() {
    return this.#transport.clearReverseTunnels();
  }

  #refCount = 0;

  async addRef() {
    this.#refCount++;
  }

  async close() {
    if (--this.#refCount === 0) {
      await this.#transport.close();
    }
  }
}

export class TransportLink {
  #manager: TransportManager;
  #sockets = new Set<SocketLink>();

  get serial() {
    return this.#manager.serial;
  }

  constructor(manager: TransportManager) {
    this.#manager = manager;
    manager.addRef();
  }

  get properties() {
    return this.#manager.properties;
  }

  get disconnected() {
    return this.#manager.disconnected;
  }

  async connect(service: string): Promise<SocketLink> {
    const socket = await this.#manager.connect(service);
    const link = new SocketLink(socket);
    this.#sockets.add(link);
    return Comlink.proxy(link);
  }

  async addReverseTunnel(
    handler: (service: string, socket: SocketLink) => void,
    address?: string
  ) {
    return this.#manager.addReverseTunnel((socket) => {
      const link = new SocketLink(socket);
      this.#sockets.add(link);
      return handler(socket.service, Comlink.proxy(link));
    }, address);
  }

  async removeReverseTunnel(address: string) {
    return this.#manager.removeReverseTunnel(address);
  }

  async clearReverseTunnels() {
    return this.#manager.clearReverseTunnels();
  }

  #closed = false;

  async close() {
    if (this.#closed) {
      throw new Error("Transport already closed");
    }
    this.#closed = true;

    for (const socket of this.#sockets) {
      socket.close();
    }
    await this.#manager.close();
  }
}

export interface ManagerLink {
  addClient(id: string): Promise<void>;

  adbConnect(
    client: string,
    serial: string,
    onAuthenticating: () => void
  ): Promise<TransportLink>;
}
