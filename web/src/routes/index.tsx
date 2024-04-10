import { For, Suspense, createResource } from "solid-js";
import { A } from "solid-start";
import { listDevices } from "~/components/link";

export default function Home() {
  const [devices] = createResource(() => listDevices());

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <Suspense fallback={<div>Loading...</div>}>
        <For each={devices()}>
          {(device) => (
            <div>
              <A
                href={`/${device.serial}`}
                style={{ "line-height": "1.5", "font-size": "2em" }}
              >
                {device.name}
              </A>
            </div>
          )}
        </For>
      </Suspense>
    </div>
  );
}
