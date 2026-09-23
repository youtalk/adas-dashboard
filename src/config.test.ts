import { describe, expect, it } from "vitest";
import { loadConfig, type Config } from "./config";

const file: Config = {
  endpoints: { stack: "ws://board:8090/stack", world: "ws://host:8091/world" },
  camera_url: "http://board:8080/",
  units: "mph",
  theme: "dark",
  camera: {
    chase: { pitch_deg: 25, distance_m: 18, lookahead_m: 12 },
    high: { pitch_deg: 50, distance_m: 60, lookahead_m: 30 },
  },
};

describe("loadConfig", () => {
  it("returns the file configuration when the query is empty", () => {
    expect(loadConfig(new URLSearchParams(""), file)).toEqual(file);
  });

  it("replaces endpoints given in the query and keeps the others", () => {
    const q = new URLSearchParams("stack=ws://10.0.0.2:9000/s");
    const c = loadConfig(q, file);
    expect(c.endpoints).toEqual({ stack: "ws://10.0.0.2:9000/s", world: "ws://host:8091/world" });
  });

  it("overrides scalar keys from the query", () => {
    const q = new URLSearchParams("units=km/h&theme=light&camera_url=http://x/");
    const c = loadConfig(q, file);
    expect(c.units).toBe("km/h");
    expect(c.theme).toBe("light");
    expect(c.camera_url).toBe("http://x/");
  });

  it("drops a scalar override whose value the type does not allow", () => {
    const q = new URLSearchParams("units=furlongs&theme=light");
    const c = loadConfig(q, file);
    expect(c.units).toBe("mph");
    expect(c.theme).toBe("light");
  });

  it("ignores unknown query keys", () => {
    const c = loadConfig(new URLSearchParams("foo=bar"), file);
    expect(c).toEqual(file);
  });
});
