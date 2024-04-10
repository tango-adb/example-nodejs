import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { BIN, VERSION } from "@yume-chan/fetch-scrcpy-server";
import {
  AndroidAvcLevel,
  AndroidAvcProfile,
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  AndroidScreenPowerMode,
  CodecOptions,
  DEFAULT_SERVER_PATH,
  ScrcpyDeviceMessageType,
  ScrcpyInjectTouchControlMessage,
  ScrcpyInstanceId,
  ScrcpyOptionsLatest,
  ScrcpyPointerId,
  ScrcpyVideoOrientation1_18,
  clamp,
} from "@yume-chan/scrcpy";
import { TinyH264Decoder } from "@yume-chan/scrcpy-decoder-tinyh264";
import {
  ReadableStream,
  WrapConsumableStream,
  WritableStream,
} from "@yume-chan/stream-extra";
import { Suspense, createResource } from "solid-js";
import { useParams } from "solid-start";
import { adbConnect } from "~/components/link";

export class ScrcpyKeyboardInjector {
  private readonly client: AdbScrcpyClient;

  #controlLeft = false;
  #controlRight = false;
  #shiftLeft = false;
  #shiftRight = false;
  #altLeft = false;
  #altRight = false;
  #metaLeft = false;
  #metaRight = false;

  #capsLock = false;
  #numLock = true;

  #keys: Set<AndroidKeyCode> = new Set();

  public constructor(client: AdbScrcpyClient) {
    this.client = client;
  }

  private setModifier(keyCode: AndroidKeyCode, value: boolean) {
    switch (keyCode) {
      case AndroidKeyCode.ControlLeft:
        this.#controlLeft = value;
        break;
      case AndroidKeyCode.ControlRight:
        this.#controlRight = value;
        break;
      case AndroidKeyCode.ShiftLeft:
        this.#shiftLeft = value;
        break;
      case AndroidKeyCode.ShiftRight:
        this.#shiftRight = value;
        break;
      case AndroidKeyCode.AltLeft:
        this.#altLeft = value;
        break;
      case AndroidKeyCode.AltRight:
        this.#altRight = value;
        break;
      case AndroidKeyCode.MetaLeft:
        this.#metaLeft = value;
        break;
      case AndroidKeyCode.MetaRight:
        this.#metaRight = value;
        break;
      case AndroidKeyCode.CapsLock:
        if (value) {
          this.#capsLock = !this.#capsLock;
        }
        break;
      case AndroidKeyCode.NumLock:
        if (value) {
          this.#numLock = !this.#numLock;
        }
        break;
    }
  }

  private getMetaState(): AndroidKeyEventMeta {
    let metaState = 0;
    if (this.#altLeft) {
      metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltLeftOn;
    }
    if (this.#altRight) {
      metaState |= AndroidKeyEventMeta.AltOn | AndroidKeyEventMeta.AltRightOn;
    }
    if (this.#shiftLeft) {
      metaState |=
        AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftLeftOn;
    }
    if (this.#shiftRight) {
      metaState |=
        AndroidKeyEventMeta.ShiftOn | AndroidKeyEventMeta.ShiftRightOn;
    }
    if (this.#controlLeft) {
      metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlLeftOn;
    }
    if (this.#controlRight) {
      metaState |= AndroidKeyEventMeta.CtrlOn | AndroidKeyEventMeta.CtrlRightOn;
    }
    if (this.#metaLeft) {
      metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaLeftOn;
    }
    if (this.#metaRight) {
      metaState |= AndroidKeyEventMeta.MetaOn | AndroidKeyEventMeta.MetaRightOn;
    }
    if (this.#capsLock) {
      metaState |= AndroidKeyEventMeta.CapsLockOn;
    }
    if (this.#numLock) {
      metaState |= AndroidKeyEventMeta.NumLockOn;
    }
    return metaState;
  }

  public async down(key: string): Promise<void> {
    const keyCode = AndroidKeyCode[key as keyof typeof AndroidKeyCode];
    if (!keyCode) {
      return;
    }

    this.setModifier(keyCode, true);
    this.#keys.add(keyCode);
    await this.client.controlMessageWriter?.injectKeyCode({
      action: AndroidKeyEventAction.Down,
      keyCode,
      metaState: this.getMetaState(),
      repeat: 0,
    });
  }

  public async up(key: string): Promise<void> {
    const keyCode = AndroidKeyCode[key as keyof typeof AndroidKeyCode];
    if (!keyCode) {
      return;
    }

    this.setModifier(keyCode, false);
    this.#keys.delete(keyCode);
    await this.client.controlMessageWriter?.injectKeyCode({
      action: AndroidKeyEventAction.Up,
      keyCode,
      metaState: this.getMetaState(),
      repeat: 0,
    });
  }

  public async reset(): Promise<void> {
    this.#controlLeft = false;
    this.#controlRight = false;
    this.#shiftLeft = false;
    this.#shiftRight = false;
    this.#altLeft = false;
    this.#altRight = false;
    this.#metaLeft = false;
    this.#metaRight = false;
    for (const key of this.#keys) {
      this.up(AndroidKeyCode[key]);
    }
    this.#keys.clear();
  }
}

const POINTER_EVENT_BUTTON_TO_ANDROID_BUTTON = [
  AndroidMotionEventButton.Primary,
  AndroidMotionEventButton.Tertiary,
  AndroidMotionEventButton.Secondary,
  AndroidMotionEventButton.Back,
  AndroidMotionEventButton.Forward,
];

export default function DevicePage() {
  const params = useParams();

  const [adb] = createResource(
    () => params.serial,
    async (serial: string) => {
      const adb = await adbConnect(serial);
      return adb;
    }
  );

  const [client] = createResource(
    () => adb.latest,
    async (adb) => {
      await AdbScrcpyClient.pushServer(
        adb,
        await fetch(BIN)
          .then(
            (response) =>
              response.body! as unknown as ReadableStream<Uint8Array>
          )
          .then((stream) => stream.pipeThrough(new WrapConsumableStream()))
      );

      const client = await AdbScrcpyClient.start(
        adb,
        DEFAULT_SERVER_PATH,
        VERSION,
        new AdbScrcpyOptionsLatest(
          new ScrcpyOptionsLatest({
            scid: ScrcpyInstanceId.random(),
            audio: false,
            lockVideoOrientation: ScrcpyVideoOrientation1_18.Portrait,
            videoBitRate: 2_000_000,
            videoCodecOptions: new CodecOptions({
              profile: AndroidAvcProfile.Baseline,
              level: AndroidAvcLevel.Level4,
            }),
            cleanup: false,
            tunnelForward: true,
          })
        )
      );

      await client.videoStream!.then(async ({ stream }) => {
        const decoder = new TinyH264Decoder();
        stream.pipeTo(decoder.writable);

        const renderer = decoder.renderer;
        renderer.style.maxWidth = "100%";
        renderer.style.maxHeight = "100%";
        renderer.style.touchAction = "none";
        renderer.style.outline = "none";
        container.appendChild(renderer);

        const clientToDevicePoint = (clientX: number, clientY: number) => {
          const rect = renderer.getBoundingClientRect();
          const percentageX = clamp((clientX - rect.x) / rect.width, 0, 1);
          const percentageY = clamp((clientY - rect.y) / rect.height, 0, 1);

          const { screenWidth, screenHeight } = client as {
            screenWidth: number;
            screenHeight: number;
          };

          return {
            x: percentageX * screenWidth,
            y: percentageY * screenHeight,
          };
        };

        let writingMoves = false;
        const moves = new Map<
          bigint,
          Omit<ScrcpyInjectTouchControlMessage, "type">
        >();

        async function injectMove() {
          if (writingMoves) {
            return;
          }

          writingMoves = true;
          for (const message of moves.values()) {
            await client.controlMessageWriter?.injectTouch(message);
          }
          moves.clear();
          writingMoves = false;
        }

        const handleTouch = async (e: PointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          renderer.focus();
          renderer.setPointerCapture(e.pointerId);

          if (e.type === "pointerdown") {
            fullscreen.requestFullscreen();
          }

          const { type, clientX, clientY, button, buttons } = e;

          const action = {
            pointerdown: AndroidMotionEventAction.Down,
            pointermove:
              buttons === 0
                ? AndroidMotionEventAction.HoverMove
                : AndroidMotionEventAction.Move,
            pointerup: AndroidMotionEventAction.Up,
          }[type]!;

          const { x, y } = clientToDevicePoint(clientX, clientY);

          const { screenWidth, screenHeight } = client as {
            screenWidth: number;
            screenHeight: number;
          };

          let pointerId = BigInt(e.pointerId);
          if (e.pointerType === "mouse") {
            pointerId = ScrcpyPointerId.Finger;
          }

          const message: Omit<ScrcpyInjectTouchControlMessage, "type"> = {
            action,
            pointerId,
            pointerX: x,
            pointerY: y,
            screenWidth,
            screenHeight,
            pressure: buttons === 0 ? 0 : 1,
            actionButton: POINTER_EVENT_BUTTON_TO_ANDROID_BUTTON[button],
            buttons,
          };

          if (e.type === "pointermove") {
            moves.set(pointerId, message);
            injectMove();
            return;
          }

          if (e.type === "pointerup") {
            moves.delete(pointerId);
          }

          await client.controlMessageWriter?.injectTouch(message);
        };

        renderer.addEventListener("pointermove", (e) => {
          console.log("move");
        });
        renderer.addEventListener("pointerdown", handleTouch);
        renderer.addEventListener("pointermove", handleTouch);
        renderer.addEventListener("pointerup", handleTouch);
        renderer.addEventListener("contextmenu", (e) => e.preventDefault());

        renderer.addEventListener("wheel", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const { clientX, clientY } = e;

          const { x, y } = clientToDevicePoint(clientX, clientY);

          const { screenWidth, screenHeight } = client as {
            screenWidth: number;
            screenHeight: number;
          };

          client!.controlMessageWriter!.injectScroll({
            pointerX: x,
            pointerY: y,
            screenWidth,
            screenHeight,
            scrollX: -e.deltaX / 100,
            scrollY: -e.deltaY / 100,
            buttons: 0,
          });
        });

        const keyboardInjector = new ScrcpyKeyboardInjector(client);
        renderer.tabIndex = 0;
        renderer.addEventListener("keydown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) {
            return;
          }
          keyboardInjector?.down(e.code);
        });
        renderer.addEventListener("keyup", (e) => {
          e.preventDefault();
          e.stopPropagation();
          keyboardInjector?.up(e.code);
        });
        renderer.setAttribute("aria-label", "Device Screen");

        await client.controlMessageWriter!.setScreenPowerMode(
          AndroidScreenPowerMode.Off
        );
      });

      client.deviceMessageStream?.pipeTo(
        new WritableStream({
          write: (message) => {
            switch (message.type) {
              case ScrcpyDeviceMessageType.Clipboard:
                navigator.clipboard.writeText(message.content);
                break;
            }
          },
        })
      );

      return client;
    }
  );

  let fullscreen!: HTMLDivElement;
  let container!: HTMLDivElement;

  return (
    <div
      ref={fullscreen}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        background: "black",
      }}
    >
      <Suspense fallback={<div>Connecting...</div>}>
        {void adb()}
        {void client()}
        <div
          ref={container}
          style={{
            flex: 1,
            height: 0,
            display: "flex",
            "justify-content": "center",
            "align-items": "center",
            background: "black",
          }}
        />
        <div
          style={{
            "flex-shrink": 0,
            display: "flex",
            "justify-content": "space-around",
          }}
        >
          <button
            style={{ width: "80px", height: "40px" }}
            onClick={async () => {
              await client.latest!.controlMessageWriter!.backOrScreenOn(
                AndroidKeyEventAction.Down
              );
              await client.latest!.controlMessageWriter!.backOrScreenOn(
                AndroidKeyEventAction.Up
              );
            }}
          >
            Back
          </button>
          <button
            style={{ width: "80px", height: "40px" }}
            onClick={async () => {
              await client.latest!.controlMessageWriter!.injectKeyCode({
                action: AndroidKeyEventAction.Down,
                keyCode: AndroidKeyCode.AndroidHome,
                metaState: 0,
                repeat: 0,
              });
              await client.latest!.controlMessageWriter!.injectKeyCode({
                action: AndroidKeyEventAction.Up,
                keyCode: AndroidKeyCode.AndroidHome,
                metaState: 0,
                repeat: 0,
              });
            }}
          >
            Home
          </button>
          <button
            style={{ width: "80px", height: "40px" }}
            onClick={async () => {
              await client.latest!.controlMessageWriter!.injectKeyCode({
                action: AndroidKeyEventAction.Down,
                keyCode: AndroidKeyCode.AndroidAppSwitch,
                metaState: 0,
                repeat: 0,
              });
              await client.latest!.controlMessageWriter!.injectKeyCode({
                action: AndroidKeyEventAction.Up,
                keyCode: AndroidKeyCode.AndroidAppSwitch,
                metaState: 0,
                repeat: 0,
              });
            }}
          >
            Overview
          </button>
        </div>
      </Suspense>
    </div>
  );
}
