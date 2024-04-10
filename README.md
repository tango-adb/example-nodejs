# Remote ADB

This repository demonstrates how to access Android devices using Node.js, and forward the ADB connection to Web clients.

## Features

* List Android devices connected to the server over USB
* Mirror the device screen and control the device from a Web client

## How does it work?

1. The server uses [Tango](https://docs.tangoapp.dev/) in [Direct Connection mode](https://docs.tangoapp.dev/#direct-connection-transport) to connect to Android devices over USB.
2. It creates a custom protocol to forward ADB sockets to Web clients over WebSocket.
3. The Web client creates a [custom transport](https://docs.tangoapp.dev/tango/custom-transport/) that converts WebSocket messages back to ADB sockets.
4. The Web client creates an [`Adb`](https://docs.tangoapp.dev/api/) instance to operate on the device.

The server can share a device with multiple clients, because the client operates on ADB socket level.

## Data Protocol

[Comlink](https://github.com/GoogleChromeLabs/comlink) library is used to simplify the communication between the server and the client. It allows calling functions on the server from the client as if they were local functions.

Comlink doesn't support WebSocket connections by default, so a custom endpoint object is created. It uses MsgPack format to serialize and deserialize Comlink messages.

Note that although Comlink very easy to use, it's definitely not the most efficient way, due to its messaging overhead. Sending raw data on the WebSocket connection will be more efficient, for example using one WebSocket connection for each ADB socket.

## Run

```bash
git clone --recurse-submodules https://github.com/tango-adb/demo-nodejs.git
pnpm i
pnpm recursive run build
```

### Start the server

```bash
cd server
pnpm start
```

The server listens on port 8081.

### Start the client

```bash
cd client
pnpm start
```

The client project has its own server listening on port 3000.

## Other possible architectures

In this demo, the client uses Tango to serialize and deserialize ADB commands, and the server uses Tango to send other commands to the device.

It can be safer to only use Tango on the server side, and creating API endpoints for each feature you want to expose to the client. This way, the client can't execute arbitrary ADB commands, but only the ones you expose.
