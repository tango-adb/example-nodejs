import {
  Adb,
  AdbBanner,
  AdbIncomingSocketHandler,
  AdbSocket,
  AdbTransport,
} from "@yume-chan/adb";
import {
  Consumable,
  ReadableStream,
  WritableStream,
} from "@yume-chan/stream-extra";
import * as Comlink from "comlink";
import { WebSocketEndpoint } from "server/lib/endpoint";
import type { NodeManager } from "server/lib/link";
import {
  LinkTransportProperties,
  SocketLink,
  TransportLink,
} from "server/lib/remote";

class LinkSocket implements AdbSocket {
  #service: string;
  get service() {
    return this.#service;
  }

  #link: SocketLink;

  #readable = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const { value, done } = await this.#link.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel: async () => {
      await this.#link.close();
    },
  });
  get readable() {
    return this.#readable;
  }

  #writable = new WritableStream<Consumable<Uint8Array>>({
    write: async (chunk) => {
      await this.#link.write(
        chunk.value,
        Comlink.proxy(() => chunk.consume())
      );
    },
    close: async () => {
      await this.#link.close();
    },
  });
  get writable() {
    return this.#writable;
  }

  get closed() {
    return this.#link.closed;
  }

  constructor(service: string, link: SocketLink) {
    this.#service = service;
    this.#link = link;
  }

  async close() {
    await this.#link.close();
  }
}

export class LinkTransport implements AdbTransport {
  static async wrap(link: TransportLink) {
    const properties = await link.properties;
    const disconnected = link.disconnected;
    return new LinkTransport(link, properties, disconnected);
  }

  #link: TransportLink;
  #properties: LinkTransportProperties;

  get serial() {
    return this.#properties.serial;
  }

  get maxPayloadSize() {
    return this.#properties.maxPayloadSize;
  }

  get banner() {
    return this.#properties.banner as unknown as AdbBanner;
  }

  #disconnected: Promise<void>;
  get disconnected() {
    return this.#disconnected;
  }

  get clientFeatures() {
    return this.#properties.clientFeatures;
  }

  constructor(
    link: TransportLink,
    properties: LinkTransportProperties,
    disconnected: Promise<void>
  ) {
    this.#link = link;
    this.#properties = properties;
    this.#disconnected = disconnected;
  }

  async connect(service: string) {
    const link = await this.#link.connect(service);
    return new LinkSocket(service, link);
  }

  async addReverseTunnel(handler: AdbIncomingSocketHandler, address?: string) {
    return await this.#link.addReverseTunnel(
      Comlink.proxy((service, link) => handler(new LinkSocket(service, link))),
      address
    );
  }

  async removeReverseTunnel(address: string) {
    return await this.#link.removeReverseTunnel(address);
  }

  async clearReverseTunnels() {
    await this.#link.clearReverseTunnels();
  }

  async close() {
    await this.#link.close();
  }
}

const id = Math.random().toString().substring(2);

const manager = Comlink.wrap<NodeManager>(
  new WebSocketEndpoint(new WebSocket(`ws://${location.hostname}:8081/${id}`))
);

const connections: Map<string, Promise<Adb>> = new Map();

export async function listDevices() {
  return manager.listDevices();
}

export async function adbConnect(
  serial: string,
  onAuthenticating?: () => void
) {
  let connection = connections.get(serial);
  if (!connection) {
    connection = (async () => {
      try {
        const transport = await manager.adbConnect(
          id,
          serial,
          Comlink.proxy(() => onAuthenticating?.())
        );
        transport.disconnected.then(
          () => connections.delete(serial),
          () => connections.delete(serial)
        );

        return new Adb(await LinkTransport.wrap(transport));
      } catch (e) {
        connections.delete(serial);
        throw e;
      }
    })();
    connections.set(serial, connection);
  }
  return await connection;
}
