export type CameraPreset = { pitch_deg: number; distance_m: number; lookahead_m: number };

export type Config = {
  endpoints: Record<string, string>;
  camera_url: string;
  units: "mph" | "km/h";
  theme: "dark" | "light";
  camera: { chase: CameraPreset; high: CameraPreset };
};

const SCALAR_KEYS = ["camera_url", "units", "theme"] as const;

// The values a scalar key accepts. camera_url is a free string, so it is absent here.
const SCALAR_VALUES: Record<string, readonly string[]> = {
  units: ["mph", "km/h"],
  theme: ["dark", "light"],
};

// Query keys that are not scalar keys are endpoint names (design section 7).
export function loadConfig(query: URLSearchParams, fileConfig: Config): Config {
  const c: Config = structuredClone(fileConfig);
  for (const [k, v] of query) {
    if (v.startsWith("ws://") || v.startsWith("wss://")) {
      c.endpoints[k] = v;
    } else if ((SCALAR_KEYS as readonly string[]).includes(k)) {
      // Drop a value the type does not allow, so ?units=furlongs cannot lie to Config.
      if (SCALAR_VALUES[k] && !SCALAR_VALUES[k].includes(v)) continue;
      (c as unknown as Record<string, string>)[k] = v;
    }
  }
  return c;
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("config.json");
  const file = (await res.json()) as Config;
  return loadConfig(new URLSearchParams(location.search), file);
}
