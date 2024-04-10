import {
  AdbDaemonTransport,
  AdbPublicKeyAuthenticator,
  AdbSignatureAuthenticator,
  adbGeneratePublicKey,
  type AdbCredentialStore,
  type AdbDaemonConnection,
} from "@yume-chan/adb";
import {
  ADB_DEFAULT_DEVICE_FILTER,
  AdbDaemonWebUsbConnection,
  AdbDaemonWebUsbDeviceManager,
} from "@yume-chan/adb-daemon-webusb";
import * as Comlink from "comlink";
import { webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { join } from "node:path";
import { WebUSB } from "usb";
import { TransportLink, TransportManager, type ManagerLink } from "./remote.js";

class AdbNodeCredentialStore implements AdbCredentialStore {
  #name: string;

  constructor(name: string) {
    this.#name = name;
  }

  async generateKey() {
    const { privateKey: cryptoKey } = await webcrypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        // 65537
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: "SHA-1",
      },
      true,
      ["sign", "verify"]
    );

    const privateKey = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", cryptoKey)
    );
    await writeFile(
      join(homedir(), ".android", "adbkey"),
      Buffer.from(privateKey).toString("utf8")
    );
    await writeFile(
      join(homedir(), ".android", "adbkey.pub"),
      `${Buffer.from(adbGeneratePublicKey(privateKey)).toString("base64")} ${
        this.#name
      }\n`
    );

    return {
      buffer: privateKey,
      name: this.#name,
    };
  }

  async #readPubKeyName() {
    const content = await readFile(
      join(homedir(), ".android", "adbkey.pub"),
      "utf8"
    );
    const pubKeyName = content.split(" ")[1];
    return pubKeyName || `${userInfo().username}@${hostname()}`;
  }

  async *iterateKeys() {
    const content = await readFile(
      join(homedir(), ".android", "adbkey"),
      "utf8"
    );
    const privateKey = Buffer.from(
      content.split("\n").slice(1, -2).join(""),
      "base64"
    );
    yield {
      buffer: privateKey,
      name: await this.#readPubKeyName(),
    };
  }
}

class NodeUsbConnection implements AdbDaemonConnection {
  #connection: AdbDaemonWebUsbConnection;

  constructor(connection: AdbDaemonWebUsbConnection) {
    this.#connection = connection;
  }

  async isUsb(): Promise<boolean> {
    return true;
  }

  controlTransferOut(
    setup: USBControlTransferParameters,
    data?: BufferSource | undefined
  ): Promise<USBOutTransferResult> {
    return this.#connection.device.raw.controlTransferOut(setup, data);
  }

  get readable() {
    return this.#connection.readable;
  }

  get writable() {
    return this.#connection.writable;
  }
}

export class NodeManager implements ManagerLink {
  #usbManager = new AdbDaemonWebUsbDeviceManager(
    new WebUSB({ allowAllDevices: true })
  );

  #serialToTransports: Map<string, Promise<TransportManager>> = new Map();
  #clientToTransports: Map<string, Set<TransportLink>> = new Map();

  #credentialStore = new AdbNodeCredentialStore("tango");

  async addClient(id: string): Promise<void> {
    this.#clientToTransports.set(id, new Set());
  }

  async deleteClient(id: string) {
    for (const transport of this.#clientToTransports.get(id)!) {
      await transport.close().catch(() => {});
    }

    this.#clientToTransports.delete(id);
  }

  async listDevices() {
    const devices = await this.#usbManager.getDevices();
    return devices.map((device) => ({
      serial: device.serial,
      name: device.raw.productName,
    }));
  }

  async #usbConnect(serial: string): Promise<AdbDaemonConnection> {
    const devices = await this.#usbManager.getDevices([
      {
        ...ADB_DEFAULT_DEVICE_FILTER,
        serialNumber: serial,
      },
    ]);

    if (devices.length === 0) {
      throw new Error("Device not plugged in.");
    }

    let lastError: unknown;
    for (const device of devices) {
      try {
        const connection = await device.connect();
        return new NodeUsbConnection(connection);
      } catch (e) {
        lastError = e;
      }
    }

    throw lastError;
  }

  async adbConnect(
    client: string,
    serial: string,
    onAuthenticating: () => void
  ): Promise<TransportLink> {
    console.log("transports", this.#serialToTransports.size);
    let promise = this.#serialToTransports.get(serial);
    if (!promise) {
      promise = (async () => {
        try {
          const connection = await this.#usbConnect(serial);

          const transport = await AdbDaemonTransport.authenticate({
            serial,
            connection,
            credentialStore: this.#credentialStore,
            authenticators: [
              AdbSignatureAuthenticator,
              async function* (store, getNextRequest) {
                onAuthenticating?.();
                yield* AdbPublicKeyAuthenticator(store, getNextRequest);
              },
            ],
          });

          const cleanup = () => {
            console.log("cleanup");
            this.#serialToTransports.delete(serial);
          };
          transport.disconnected.then(cleanup, cleanup);

          const manager = new TransportManager(transport);
          return manager;
        } catch (e) {
          this.#serialToTransports.delete(serial);
          throw e;
        }
      })();
      this.#serialToTransports.set(serial, promise);
    }

    const manager = await promise;
    const link = new TransportLink(manager);
    this.#clientToTransports.get(client)!.add(link);

    const cleanup = () => {
      this.#clientToTransports.get(client)?.delete(link);
    };
    manager.disconnected.then(cleanup, cleanup);

    return Comlink.proxy(link);
  }
}
