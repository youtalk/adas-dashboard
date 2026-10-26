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

// A camera preset value, for example camera.chase.pitch_deg=30, so the presets
// can be tuned on the booth monitor without editing config.json.
const PRESET_KEY = /^camera\.(chase|high)\.(pitch_deg|distance_m|lookahead_m)$/;

// Query parameters override config.json key by key (design section 7). A ws://
// or wss:// value names an endpoint; endpoint names are free.
export function loadConfig(query: URLSearchParams, fileConfig: Config): Config {
  const c: Config = structuredClone(fileConfig);
  for (const [k, v] of query) {
    const preset = PRESET_KEY.exec(k);
    if (v.startsWith("ws://") || v.startsWith("wss://")) {
      c.endpoints[k] = v;
    } else if ((SCALAR_KEYS as readonly string[]).includes(k)) {
      // Drop a value the type does not allow, so ?units=furlongs cannot lie to Config.
      if (SCALAR_VALUES[k] && !SCALAR_VALUES[k].includes(v)) continue;
      (c as unknown as Record<string, string>)[k] = v;
    } else if (preset) {
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n)) continue;
      c.camera[preset[1] as keyof Config["camera"]][preset[2] as keyof CameraPreset] = n;
    }
  }
  return c;
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("config.json");
  const file = (await res.json()) as Config;
  return loadConfig(new URLSearchParams(location.search), file);
}
